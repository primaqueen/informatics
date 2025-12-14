"""Генерация MDX-оверрайда для задачи из tasks_clean.jsonl.

Зачем:
    * `tasks_clean.jsonl` остаётся базой (сгенерированной автоматически).
    * Ручные правки храним в `frontend/content/tasks/<INTERNAL_ID>.mdx`.

Что делает скрипт:
    * находит задачу по `internal_id` в `tasks_clean.jsonl`;
    * берёт `question_html_clean` и конвертирует в Markdown;
    * учитывает `<sub>`/`<sup>` и переводит в TeX: `111<sub>10</sub>` → `$111_{10}$`;
    * пишет MDX файл (frontmatter + markdown body).

Запуск:
    uv run python generate_task_mdx.py --internal-id 09DBe5
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, NavigableString, Tag

from transform_tasks import html_to_markdown

SUB_SUP_BASE_RE = re.compile(r"([0-9A-Za-zА-Яа-я]+)\s*$")
INLINE_CODE_RE = re.compile(r"(?P<fence>`+)(?P<code>[^`]*?)(?P=fence)")
MATH_EQ_MATH_RE = re.compile(r"\$(?P<a>[^$\n]+?)\$\s*=\s*\$(?P<b>[^$\n]+?)\$")
NUM_EQ_MATH_RE = re.compile(r"(?P<a>\b\d+\b)\s*=\s*\$(?P<b>[^$\n]+?)\$")
MATH_EQ_NUM_RE = re.compile(r"\$(?P<a>[^$\n]+?)\$\s*=\s*(?P<b>\b\d+\b)")
SINGLE_LEADING_SPACE_RE = re.compile(r"(?m)^ (?![ \t])")
LETTER_ITEM_RE = re.compile(r"^(?P<label>[A-Za-zА-Яа-яЁё])\)\s*(?P<rest>.+)$")
ORDERED_ITEM_RE = re.compile(r"^(?P<indent>[ \t]*)(?:\d+[.)])\s+")
TASK5_ITALIC_VARS = {"N", "R"}
TASK5_NUMBER_TOKEN_RE = re.compile(r"(?<![0-9A-Za-zА-Яа-я_])\d+(?![0-9A-Za-zА-Яа-я_])")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--internal-id", required=True, help="internal_id задачи, например 09DBe5")
    parser.add_argument("--input", type=Path, default=Path("tasks_clean.jsonl"))
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("frontend/content/tasks"),
        help="куда писать *.mdx",
    )
    parser.add_argument("--overwrite", action="store_true", help="перезаписать файл, если уже есть")
    return parser.parse_args()


def load_task(input_path: Path, internal_id: str) -> dict[str, Any]:
    target = internal_id.strip().lower()
    with input_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if str(row.get("internal_id", "")).lower() == target:
                return row
    raise ValueError(f"Задача с internal_id={internal_id!r} не найдена в {input_path}")


def load_task_number_map(
    path: Path = Path("internal_id_to_task_number.json"),
) -> dict[str, int | None]:
    """Читает маппинг internal_id -> номер задачи (например, 5)."""
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(raw, dict):
        return {}

    mapping: dict[str, int | None] = {}
    for key, value in raw.items():
        if not isinstance(key, str):
            continue
        if value is None:
            mapping[key.upper()] = None
            continue
        try:
            mapping[key.upper()] = int(value)
        except (TypeError, ValueError):
            mapping[key.upper()] = None
    return mapping


def convert_task5_vars_to_math(text: str) -> str:
    """Для задач №5: `*N*`/`*R*` -> `$N$`/`$R$` (формульный курсив)."""
    for var in TASK5_ITALIC_VARS:
        text = text.replace(f"*{var}*", f"${var}$")
    return text


def _split_by_math_spans(text: str) -> list[tuple[str, bool]]:
    """Разбивает строку на сегменты «текст/математика».

    Нужно, чтобы не трогать содержимое `$...$`/`$$...$$`.
    """
    if not text:
        return [("", False)]

    segments: list[tuple[str, bool]] = []
    buf: list[str] = []
    mode: str = "text"  # text | inline | display

    def flush(is_math: bool) -> None:
        nonlocal buf
        if not buf:
            return
        segments.append(("".join(buf), is_math))
        buf = []

    i = 0
    n = len(text)
    while i < n:
        ch = text[i]

        if mode == "text":
            if (
                ch == "$"
                and i + 1 < n
                and text[i : i + 2] == "$$"
                and (i == 0 or text[i - 1] != "\\")
            ):
                flush(False)
                mode = "display"
                buf.append("$$")
                i += 2
                continue
            if ch == "$" and (i == 0 or text[i - 1] != "\\"):
                flush(False)
                mode = "inline"
                buf.append("$")
                i += 1
                continue

            buf.append(ch)
            i += 1
            continue

        if mode == "inline":
            buf.append(ch)
            if ch == "$" and text[i - 1] != "\\":
                flush(True)
                mode = "text"
            i += 1
            continue

        if mode == "display":
            if (
                ch == "$"
                and i + 1 < n
                and text[i : i + 2] == "$$"
                and (i == 0 or text[i - 1] != "\\")
            ):
                buf.append("$$")
                i += 2
                flush(True)
                mode = "text"
                continue

            buf.append(ch)
            i += 1
            continue

    flush(mode != "text")
    return segments


def _wrap_numbers_in_plain_text(text: str) -> str:
    """Оборачивает числа в `$...$`, стараясь не ломать ссылки и raw HTML."""
    if not text:
        return text

    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]

        # Raw HTML tag: <...>
        if ch == "<":
            j = text.find(">", i + 1)
            if j == -1:
                out.append(text[i:])
                break
            out.append(text[i : j + 1])
            i = j + 1
            continue

        # Markdown link/image destination: ](...)
        if ch == "]" and i + 1 < n and text[i + 1] == "(":
            j = i + 2
            depth = 1
            while j < n and depth:
                if text[j] == "(":
                    depth += 1
                elif text[j] == ")":
                    depth -= 1
                j += 1
            out.append(text[i:j])
            i = j
            continue

        m = TASK5_NUMBER_TOKEN_RE.match(text, i)
        if m:
            out.append(f"${m.group(0)}$")
            i = m.end()
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def convert_task5_numbers_to_math(markdown: str) -> str:
    """Для задач №5: оборачивает отдельные числа в `$...$` вне уже существующих формул."""
    segments = _split_by_math_spans(markdown)
    out: list[str] = []
    for seg, is_math in segments:
        if is_math:
            out.append(seg)
            continue

        # Не ломаем маркеры нумерованных списков (1./2./3.) — оставляем префикс как есть.
        lines = seg.splitlines(keepends=True)
        for line in lines:
            marker = ORDERED_ITEM_RE.match(line)
            if not marker:
                out.append(_wrap_numbers_in_plain_text(line))
                continue

            prefix = line[: marker.end()]
            rest = line[marker.end() :]
            out.append(prefix + _wrap_numbers_in_plain_text(rest))

    return "".join(out)


def _as_tex_script(kind: str, text: str) -> str:
    op = "_" if kind == "sub" else "^"
    return f"{op}{{{text}}}"


def convert_sub_sup_to_tex(html: str) -> str:
    """Заменяет пары base + <sub>/<sup> на `$base_{...}$` / `$base^{...}$`.

    Пример:
        `111<sub>10</sub>` -> `$111_{10}$`
    """

    soup = BeautifulSoup(f"<root>{html}</root>", "html.parser")
    root = soup.find("root") or soup

    for tag in list(root.find_all(["sub", "sup"])):
        kind = tag.name or ""
        script_text = tag.get_text(strip=True)
        if not script_text:
            tag.decompose()
            continue

        base_node = tag.previous_sibling
        while isinstance(base_node, NavigableString) and base_node.strip() == "":
            base_node = base_node.previous_sibling

        script = _as_tex_script(kind, script_text)

        if base_node is None:
            tag.replace_with(f"${script}$")
            continue

        if isinstance(base_node, NavigableString):
            text = str(base_node)
            stripped = text.strip()

            # Если прямо перед sub/sup уже стоит `$...$`, аккуратно дописываем скрипт внутрь.
            if re.fullmatch(r"\$[^$]+\$", stripped):
                inner = stripped[1:-1]
                new_math = f"${inner}{script}$"
                base_node.replace_with(text.replace(stripped, new_math, 1))
                tag.decompose()
                continue

            m = SUB_SUP_BASE_RE.search(text)
            if m:
                base = m.group(1)
                before = text[: m.start(1)]
                base_node.replace_with(f"{before}${base}{script}$")
                tag.decompose()
                continue

            # Фолбэк: не нашли base — оставляем только скрипт.
            tag.replace_with(f"${script}$")
            continue

        if isinstance(base_node, Tag):
            base_text = base_node.get_text(strip=True)
            if base_text:
                base_node.replace_with(f"${base_text}{script}$")
                tag.decompose()
                continue

            tag.replace_with(f"${script}$")
            continue

        tag.replace_with(f"${script}$")

    return "".join(str(child) for child in root.contents)


def _merge_equals_in_text(text: str) -> str:
    """Склеивает равенства в один `$...$`, чтобы не было смешения шрифтов (math/text).

    Примеры:
        `$11_{10}$ = $102_{3}$` -> `$11_{10} = 102_{3}$`
        `12 = $1100_{2}$` -> `$12 = 1100_{2}$`
        `$1100100_{2}$ = 100` -> `$1100100_{2} = 100$`
    """

    prev = None
    merged = text
    while prev != merged:
        prev = merged
        merged = MATH_EQ_MATH_RE.sub(
            lambda m: f"${m.group('a').strip()} = {m.group('b').strip()}$",
            merged,
        )
        merged = NUM_EQ_MATH_RE.sub(
            lambda m: f"${m.group('a').strip()} = {m.group('b').strip()}$",
            merged,
        )
        merged = MATH_EQ_NUM_RE.sub(
            lambda m: f"${m.group('a').strip()} = {m.group('b').strip()}$",
            merged,
        )
    return merged


def _transform_outside_inline_code(text: str, task_number: int | None) -> str:
    if not text:
        return text

    text = SINGLE_LEADING_SPACE_RE.sub("", text)
    text = normalize_letter_subpoints(text)

    parts: list[str] = []
    last = 0
    for match in INLINE_CODE_RE.finditer(text):
        segment = _merge_equals_in_text(text[last : match.start()])
        if task_number == 5:
            segment = convert_task5_vars_to_math(segment)
            segment = convert_task5_numbers_to_math(segment)
        parts.append(segment)
        parts.append(match.group(0))
        last = match.end()
    tail = _merge_equals_in_text(text[last:])
    if task_number == 5:
        tail = convert_task5_vars_to_math(tail)
        tail = convert_task5_numbers_to_math(tail)
    parts.append(tail)
    return "".join(parts)


def normalize_letter_subpoints(markdown: str) -> str:
    """Преобразует параграфы вида `а) ...`/`б) ...` в подпункты.

    В Markdown нет нативной нумерации подпунктов кириллицей. Вместо «списка со скрытым
    маркером» делаем подпункты как **отдельные абзацы внутри предыдущего пункта списка**
    (это даёт корректный отступ без лишних `-` в исходнике):

        2. ...

           а) ...

           б) ...
    """

    if not markdown:
        return markdown

    lines = markdown.splitlines()
    ends_with_newline = markdown.endswith("\n")

    out: list[str] = []
    prev_nonblank: str | None = None

    def push(line: str) -> None:
        nonlocal prev_nonblank
        out.append(line)
        if line.strip():
            prev_nonblank = line

    i = 0
    n = len(lines)
    while i < n:
        if not lines[i].strip():
            push(lines[i])
            i += 1
            continue

        # Собираем «параграф» (блок непустых строк).
        paragraph: list[str] = []
        while i < n and lines[i].strip():
            paragraph.append(lines[i])
            i += 1

        first = paragraph[0].lstrip()
        if not LETTER_ITEM_RE.match(first):
            for line in paragraph:
                push(line)
            continue

        # Контекст: если перед подпунктами шёл нумерованный пункт, делаем подпункты
        # как абзацы внутри этого пункта (нужен корректный отступ).
        indent = ""
        prev_match = ORDERED_ITEM_RE.match(prev_nonblank or "")
        if prev_match:
            indent = " " * prev_match.end()

        # Собираем последовательность подпунктов, разделённых пустыми строками.
        items: list[list[str]] = [paragraph]
        tail_blank_count = 0

        k = i
        while True:
            blanks_start = k
            while k < n and not lines[k].strip():
                k += 1
            blanks_count = k - blanks_start
            if k >= n:
                tail_blank_count = blanks_count
                break

            if not LETTER_ITEM_RE.match(lines[k].lstrip()):
                tail_blank_count = blanks_count
                break

            next_paragraph: list[str] = []
            while k < n and lines[k].strip():
                next_paragraph.append(lines[k])
                k += 1
            items.append(next_paragraph)

        # Рендерим подпункты как абзацы внутри списка.
        for index, item in enumerate(items):
            match = LETTER_ITEM_RE.match(item[0].lstrip())
            if not match:
                for line in item:
                    push(line)
                continue

            label = match.group("label")
            rest = match.group("rest").strip()
            push(f"{indent}{label}) {rest}".rstrip())

            if len(item) > 1:
                for continuation_line in item[1:]:
                    push(f"{indent}{continuation_line.strip()}".rstrip())

            # Отделяем подпункты пустой строкой (как в исходных <p>).
            if index < len(items) - 1:
                push("")

        # Сохраняем хотя бы один пустой разделитель после списка, если он был в исходнике.
        if tail_blank_count:
            push("")

        i = k

    result = "\n".join(out)
    if ends_with_newline and not result.endswith("\n"):
        result += "\n"
    return result


def normalize_math_in_markdown(markdown: str, *, task_number: int | None) -> str:
    """Нормализует markdown, избегая правок внутри fenced code blocks и inline code."""
    if not markdown:
        return markdown

    lines = markdown.splitlines(keepends=True)
    out: list[str] = []
    buffer: list[str] = []
    in_fence = False
    fence: str | None = None

    def flush_buffer() -> None:
        nonlocal buffer
        if not buffer:
            return
        out.append(_transform_outside_inline_code("".join(buffer), task_number))
        buffer = []

    for line in lines:
        fence_match = re.match(r"^(```|~~~)", line)
        if fence_match:
            marker = fence_match.group(1)
            if not in_fence:
                flush_buffer()
                in_fence = True
                fence = marker
                out.append(line)
                continue
            if marker == fence:
                in_fence = False
                fence = None
                out.append(line)
                continue

        if in_fence:
            out.append(line)
        else:
            buffer.append(line)

    flush_buffer()
    return "".join(out)


def to_frontmatter(task: dict[str, Any]) -> str:
    answer_type = str(task.get("answer_type") or "unknown")
    kes_raw = (task.get("meta") or {}).get("КЭС") or []
    kes_codes: list[str] = []
    if isinstance(kes_raw, list):
        for item in kes_raw:
            if not isinstance(item, str):
                continue
            code = item.strip().split(" ", 1)[0].strip()
            if code and code not in kes_codes:
                kes_codes.append(code)
    hint = str(task.get("hint") or "")
    options = task.get("options") or []

    lines: list[str] = ["---", f"answer_type: {answer_type}"]

    if kes_codes:
        lines.append("kes:")
        for code in kes_codes:
            lines.append(f'  - "{code}"')
    else:
        lines.append("kes: []")

    if hint.strip():
        lines.append("hint: |")
        for hline in hint.rstrip("\n").splitlines():
            lines.append(f"  {hline}")
    else:
        lines.append('hint: ""')

    if answer_type == "single_choice":
        lines.append("options:")
        if isinstance(options, list) and options:
            for item in options:
                value = "" if item is None else str((item or {}).get("value", ""))
                text = "" if item is None else str((item or {}).get("text", ""))
                lines.append(f'  - value: "{value}"')
                if text.strip():
                    lines.append("    text: |")
                    for tline in text.rstrip("\n").splitlines():
                        lines.append(f"      {tline}")
                else:
                    lines.append('    text: ""')
        else:
            lines.append("  []")

    lines.append("---")
    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    task = load_task(args.input, args.internal_id)

    internal_id = str(task.get("internal_id") or "").upper()
    if not internal_id:
        raise ValueError("У задачи отсутствует internal_id")

    task_number = load_task_number_map().get(internal_id)

    raw_html = str(task.get("question_html_clean") or "")
    converted_html = convert_sub_sup_to_tex(raw_html)
    body = html_to_markdown(converted_html).strip() + "\n"
    body = normalize_math_in_markdown(body, task_number=task_number)

    out_dir: Path = args.output_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{internal_id}.mdx"
    if out_path.exists() and not args.overwrite:
        raise FileExistsError(f"Файл уже существует: {out_path} (используй --overwrite)")

    mdx = to_frontmatter(task) + "\n" + body
    out_path.write_text(mdx, encoding="utf-8")
    print(f"OK: {out_path}")


if __name__ == "__main__":
    main()
