from __future__ import annotations

import json
import os
import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict
from urllib.parse import urljoin, urlsplit

import requests
from bs4 import BeautifulSoup, Tag
from requests.packages.urllib3.exceptions import InsecureRequestWarning

ATTACHMENT_EXTENSIONS = (
    ".pdf",
    ".doc",
    ".docx",
    ".rtf",
    ".zip",
    ".rar",
    ".7z",
    ".xls",
    ".xlsx",
    ".txt",
    ".csv",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".zip",
    ".rar",
    ".7z",
)

BASE_CONTEXT_URL = "https://ege.fipi.ru/"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
ASSETS_DIR = Path("assets")
MAP_PATH = Path("map.json")
SKIP_SSL_VERIFY = os.environ.get("FIPI_SKIP_SSL_VERIFY", "0") not in {"0", "", "false", "False"}


@dataclass
class ParsedAttachment:
    href: str
    text: str


class AttachmentDict(TypedDict):
    href: str
    text: str


class OptionDict(TypedDict):
    value: str
    text: str


MetaDict = TypedDict(
    "MetaDict",
    {
        "КЭС": list[str],
        "Тип ответа": str,
        "internal_id": str,
    },
)


class TaskDict(TypedDict):
    qid: str
    suffix: str
    guid: str
    internal_id: str
    hint: str  # пустая строка, если хинт дефолтный и не несёт новой информации
    question_text: str
    question_html: str
    images: list[dict[str, str]]
    attachments: list[AttachmentDict]
    answer_type: str
    options: list[OptionDict]
    meta: MetaDict  # без дублирования internal_id
    page_index: int
    index_on_page: int


@dataclass(frozen=True)
class AssetCandidate:
    internal_id: str
    source: str
    kind: str  # "image" | "attachment"


@dataclass(frozen=True)
class AssetMapping:
    internal_id: str
    source_url: str
    short_name: str
    saved_path: Path
    original_name: str


def url_extension(url: str) -> str:
    """Возвращает расширение файла из URL/пути без учёта query/fragment."""
    parsed = urlsplit(url.strip())
    return Path(parsed.path).suffix.lower()


def attr_to_str(value: str | list[str] | None) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return "".join(value)
    return str(value)


def decode_html_bytes(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1251", errors="replace")


def extract_attachments(cell: Tag) -> list[ParsedAttachment]:
    attachments: list[ParsedAttachment] = []
    for a_tag in cell.find_all("a", href=True):
        href = attr_to_str(a_tag.get("href"))
        href_lower = href.lower()
        if "docs/" in href_lower or href_lower.endswith(ATTACHMENT_EXTENSIONS):
            attachments.append(ParsedAttachment(href=href, text=a_tag.get_text(" ", strip=True)))
    return attachments


def extract_media_from_scripts(cell: Tag) -> tuple[list[dict[str, str]], list[AttachmentDict]]:
    images: list[dict[str, str]] = []
    attachments: list[AttachmentDict] = []
    for script in cell.find_all("script"):
        script_text = script.string or "".join(script.strings)
        if not script_text:
            continue
        for candidate in re.findall(r"'([^']+)'", script_text):
            normalized = candidate.strip()
            if not normalized:
                continue
            lower = normalized.lower()
            if any(
                lower.endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp")
            ):
                images.append({"src": normalized, "alt": ""})
            elif "docs/" in lower or any(lower.endswith(ext) for ext in ATTACHMENT_EXTENSIONS):
                attachments.append({"href": normalized, "text": ""})
    return images, attachments


def extract_options(table: Tag) -> tuple[str, list[OptionDict]] | tuple[str, None]:
    answer_type = "unknown"
    options: list[OptionDict] = []
    for tr in table.find_all("tr"):
        input_el = tr.find("input", attrs={"name": "answer"})
        if not input_el:
            continue
        input_type = attr_to_str(input_el.get("type")).lower()
        if input_type == "checkbox":
            answer_type = "multiple_choice"
        elif input_type == "radio":
            answer_type = "single_choice"
        value = attr_to_str(input_el.get("value"))
        tds = tr.find_all("td")
        option_text = tds[-1].get_text(" ", strip=True) if tds else tr.get_text(" ", strip=True)
        options.append({"value": value, "text": option_text})
    if not options:
        return "unknown", None
    return answer_type, options


def parse_meta_block(info_div: Tag | None, suffix: str) -> MetaDict:
    meta: MetaDict = {"КЭС": [], "Тип ответа": "", "internal_id": suffix}
    if not info_div:
        return meta

    task_info = info_div.select_one("div.task-info-content")
    if not task_info:
        return meta

    for tr in task_info.find_all("tr"):
        name_td = tr.find("td", class_="param-name")
        if not name_td:
            continue
        name = name_td.get_text(strip=True)
        value_td = name_td.find_next_sibling("td")
        if not value_td:
            continue
        if name == "КЭС:":
            kes_items = [div.get_text(" ", strip=True) for div in value_td.find_all("div")]
            if not kes_items:
                text = value_td.get_text(" ", strip=True)
                if text:
                    kes_items = [text]
            meta["КЭС"] = kes_items
        elif name == "Тип ответа:":
            meta["Тип ответа"] = value_td.get_text(" ", strip=True)
    return meta


def parse_fipi_page(html: str, page_index: int) -> list[TaskDict]:
    soup = BeautifulSoup(html, "html.parser")
    tasks: list[TaskDict] = []

    qblocks = soup.select("div.qblock")
    for idx, qblock in enumerate(qblocks):
        qid = attr_to_str(qblock.get("id"))
        suffix = qid[1:] if qid else ""
        info_div = soup.find("div", id=f"i{suffix}") if suffix else None

        cell = qblock.select_one("td.cell_0")
        if cell is None:
            print(
                f"Пропускаю блок без текста вопроса на странице {page_index} "
                f"(qid={qid or 'нет'})"
            )
            continue
        question_text = cell.get_text(" ", strip=True) if cell else ""
        question_html = str(cell) if cell else ""

        images: list[dict[str, str]] = []
        attachments: list[AttachmentDict] = []
        if cell:
            for img in cell.find_all("img"):
                images.append(
                    {"src": attr_to_str(img.get("src")), "alt": attr_to_str(img.get("alt"))}
                )
            script_images, script_attachments = extract_media_from_scripts(cell)
            images.extend(script_images)
            attachments.extend(script_attachments)
            for att in extract_attachments(cell):
                attachments.append({"href": att.href, "text": att.text})

        guid_input = qblock.find("input", attrs={"name": "guid"})
        guid = attr_to_str(guid_input.get("value")) if guid_input else ""

        options: list[OptionDict] = []
        answer_type = "unknown"
        distractor_table = qblock.find("table", class_="distractors-table")
        if distractor_table:
            answer_type, opts = extract_options(distractor_table)
            options = opts or []
        else:
            answer_input = qblock.find("input", attrs={"name": "answer"})
            answer_type_attr = attr_to_str(answer_input.get("type")) if answer_input else ""
            text_inputs = [
                inp
                for inp in qblock.find_all("input")
                if attr_to_str(inp.get("type")).lower() == "text"
            ]
            if answer_input and answer_type_attr.lower() == "text":
                answer_type = "short_answer"
            elif text_inputs:
                answer_type = "short_answer"
            elif qblock.find("textarea"):
                answer_type = "short_answer"
            elif qblock.find("select"):
                answer_type = "single_choice"
            elif answer_input:
                answer_type = "unknown"

        hint = ""
        hint_div = qblock.find("div", class_="hint")
        if hint_div:
            hint_text = hint_div.get_text(" ", strip=True)
            # Типовые подсказки («Впишите правильный ответ.» и т.п.) считаем дефолтными и опускаем,
            # чтобы не плодить шум. Любые другие тексты сохраняем.
            default_hints = {
                "Впишите правильный ответ.",
                "Дайте развернутый ответ.",
                "Дайте развёрнутый ответ.",
                "Выберите правильный ответ.",
            }
            if hint_text not in default_hints:
                hint = hint_text

        internal_id_span = info_div.select_one("div.id-text span.canselect") if info_div else None
        internal_id = internal_id_span.get_text(strip=True) if internal_id_span else suffix

        meta = parse_meta_block(info_div, suffix)

        if answer_type == "unknown":
            hint_lower = hint.lower()
            raw_classes: list[str] | str | None = qblock.get("class")
            qblock_classes = (
                raw_classes if isinstance(raw_classes, list) else [attr_to_str(raw_classes)]
            )
            if (
                "hide-form" in qblock_classes
                or "развернут" in hint_lower
                or "развёрнут" in hint_lower
            ):
                answer_type = "short_answer"

        if answer_type == "unknown":
            print(f"Неизвестный тип ответа для задания {qid or 'без id'} на странице {page_index}")

        task: TaskDict = {
            "qid": qid,
            "suffix": suffix,
            "guid": guid,
            "internal_id": internal_id,
            "hint": hint,
            "question_text": question_text,
            "question_html": question_html,
            "images": images,
            "attachments": attachments,
            "answer_type": answer_type,
            "options": options,
            "meta": meta,
            "page_index": page_index,
            "index_on_page": idx,
        }
        tasks.append(task)
    return tasks


def normalize_url(url: str) -> str | None:
    url = url.strip()
    if not url or url.startswith("data:"):
        return None
    return urljoin(BASE_CONTEXT_URL, url)


def choose_extension(url: str) -> str:
    parsed = urlsplit(url)
    ext = Path(parsed.path).suffix
    return ext if ext else ".bin"


def build_asset_candidates(tasks: list[TaskDict]) -> list[AssetCandidate]:
    candidates: list[AssetCandidate] = []
    seen: set[tuple[str, str]] = set()
    for task in tasks:
        internal_id = str(task.get("internal_id", "")).strip()
        for img in task.get("images", []):
            src = str(img.get("src", "")).strip()
            if not src:
                continue
            key = (internal_id, src)
            if key in seen:
                continue
            seen.add(key)
            candidates.append(AssetCandidate(internal_id=internal_id, source=src, kind="image"))
        for att in task.get("attachments", []):
            href = str(att.get("href", "")).strip()
            if not href:
                continue
            key = (internal_id, href)
            if key in seen:
                continue
            seen.add(key)
            candidates.append(
                AssetCandidate(internal_id=internal_id, source=href, kind="attachment")
            )
    return candidates


def build_asset_mapping(
    candidates: list[AssetCandidate], assets_dir: Path
) -> tuple[dict[tuple[str, str], AssetMapping], list[AssetMapping]]:
    per_internal_total = Counter(item.internal_id for item in candidates)
    per_internal_index: Counter[str] = Counter()
    mapping_by_key: dict[tuple[str, str], AssetMapping] = {}
    ordered_entries: list[AssetMapping] = []

    for candidate in candidates:
        per_internal_index[candidate.internal_id] += 1
        index = per_internal_index[candidate.internal_id]
        total = per_internal_total[candidate.internal_id]

        ext = choose_extension(candidate.source)
        suffix = "" if total == 1 else f"_{index}"
        short_name = f"{candidate.internal_id}{suffix}{ext}"
        saved_path = assets_dir / short_name
        original_name = Path(urlsplit(candidate.source).path).name or short_name

        key = (candidate.internal_id, candidate.source)
        mapping = AssetMapping(
            internal_id=candidate.internal_id,
            source_url=candidate.source,
            short_name=short_name,
            saved_path=saved_path,
            original_name=original_name,
        )
        mapping_by_key[key] = mapping
        ordered_entries.append(mapping)

    return mapping_by_key, ordered_entries


def rewrite_tasks(
    tasks: list[TaskDict], mapping_by_key: dict[tuple[str, str], AssetMapping]
) -> list[TaskDict]:
    updated: list[TaskDict] = []
    for task in tasks:
        internal_id = str(task.get("internal_id", "")).strip()
        replacements: dict[str, str] = {
            source: mapping.short_name
            for (iid, source), mapping in mapping_by_key.items()
            if iid == internal_id
        }

        new_task = dict(task)
        new_images: list[dict[str, str]] = []
        for img in task.get("images", []):
            src = str(img.get("src", ""))
            new_src = replacements.get(src, src)
            new_images.append({"src": new_src, "alt": str(img.get("alt", ""))})
        new_task["images"] = new_images

        new_attachments: list[dict[str, str]] = []
        for att in task.get("attachments", []):
            href = str(att.get("href", ""))
            new_href = replacements.get(href, href)
            new_attachments.append({"href": new_href, "text": str(att.get("text", ""))})
        new_task["attachments"] = new_attachments

        question_html = str(task.get("question_html", ""))
        for source, short_name in replacements.items():
            if source in question_html:
                question_html = question_html.replace(source, short_name)
        new_task["question_html"] = question_html

        updated.append(new_task)  # type: ignore[arg-type]
    return updated


def write_map(entries: list[AssetMapping], map_path: Path) -> None:
    content = {
        entry.short_name: {
            "internal_id": entry.internal_id,
            "saved_as": str(entry.saved_path),
            "original_name": entry.original_name,
            "source_url": entry.source_url,
        }
        for entry in entries
    }
    map_path.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")


def write_jsonl(tasks: Iterable[TaskDict], output_path: Path) -> None:
    with output_path.open("w", encoding="utf-8") as f:
        for task in tasks:
            json_line = json.dumps(task, ensure_ascii=False)
            f.write(json_line + "\n")


def download_assets(
    entries: list[AssetMapping],
    max_files: int | None = None,
    filter_substr: str | None = None,
) -> None:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    session.verify = not SKIP_SSL_VERIFY
    if SKIP_SSL_VERIFY:
        requests.packages.urllib3.disable_warnings(InsecureRequestWarning)  # type: ignore[attr-defined]

    downloaded = 0
    for entry in entries:
        if filter_substr and filter_substr not in entry.source_url:
            continue
        if max_files is not None and downloaded >= max_files:
            print(f"Достигнут лимит {max_files} файлов, останавливаюсь.")
            break

        target = entry.saved_path
        if target.exists():
            continue
        url = normalize_url(entry.source_url)
        if not url:
            print(f"Пропускаю некорректную ссылку: {entry.source_url}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        urls_to_try = [url]
        if "/bank/" in url:
            urls_to_try.append(url.replace("/bank/", "/"))

        content: bytes | None = None
        last_status: int | None = None
        for candidate in urls_to_try:
            try:
                resp = session.get(candidate, timeout=30)
            except requests.RequestException as exc:
                print(f"Ошибка загрузки {candidate}: {exc}")
                continue
            last_status = resp.status_code
            if resp.status_code == 200:
                content = resp.content
                url = candidate
                break
        if content is None:
            status_info = f"статус {last_status}" if last_status is not None else "нет ответа"
            print(f"Не удалось скачать {url} ({status_info})")
            continue
        target.write_bytes(content)
        downloaded += 1
        print(f"Сохранено {target} из {url} ({len(content)} байт)")


def load_html_files(pages_dir: str) -> list[tuple[int, str]]:
    dir_path = Path(pages_dir)
    files: list[tuple[int, Path]] = []
    for path in dir_path.glob("*.html"):
        match = re.search(r"page_(\d+)\.html", path.name)
        page_idx = int(match.group(1)) if match else -1
        files.append((page_idx, path))
    files.sort(key=lambda item: (item[0], item[1].name))

    result: list[tuple[int, str]] = []
    for page_idx, path in files:
        data = path.read_bytes()
        html = decode_html_bytes(data)
        result.append((page_idx, html))
    return result


def load_internal_id_to_task_number(path: Path) -> dict[str, int | None]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"Ожидался dict в {path}, получено: {type(raw).__name__}")
    result: dict[str, int | None] = {}
    for key, value in raw.items():
        if not isinstance(key, str):
            continue
        if value is None:
            result[key] = None
            continue
        if isinstance(value, int):
            result[key] = value
            continue
        # На всякий случай — поддержка строковых чисел
        if isinstance(value, str) and value.strip().isdigit():
            result[key] = int(value.strip())
    return result


def drop_images_for_internal_ids(
    tasks: list[TaskDict], internal_ids: set[str], drop_exts: set[str]
) -> int:
    removed = 0
    for task in tasks:
        iid = str(task.get("internal_id", "")).strip().lower()
        if iid not in internal_ids:
            continue
        images = task.get("images", [])
        kept: list[dict[str, str]] = []
        for img in images:
            src = str(img.get("src", ""))
            if url_extension(src) in drop_exts:
                removed += 1
                continue
            kept.append({"src": src, "alt": str(img.get("alt", ""))})
        task["images"] = kept
    return removed


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Парсинг страниц FIPI с генерацией коротких путей и скачиванием файлов"
    )
    parser.add_argument(
        "--pages-dir",
        type=Path,
        default=Path("pages"),
        help="Каталог с HTML страницами (page_*.html)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("tasks.jsonl"),
        help="Путь для сохранения tasks.jsonl",
    )
    parser.add_argument(
        "--assets-dir",
        type=Path,
        default=ASSETS_DIR,
        help="Каталог для сохранения файлов с короткими именами",
    )
    parser.add_argument(
        "--map",
        type=Path,
        default=MAP_PATH,
        help="Путь для сохранения map.json",
    )
    parser.add_argument(
        "--max",
        dest="max_files",
        type=int,
        default=None,
        help="Лимит числа скачиваемых файлов",
    )
    parser.add_argument(
        "--filter",
        dest="filter_substr",
        default=None,
        help="Скачивать только ссылки, содержащие подстроку (по исходному пути)",
    )
    parser.add_argument(
        "--no-download",
        action="store_true",
        help="Не скачивать файлы, только переписать пути и карту",
    )
    parser.add_argument(
        "--internal-id-to-task-number",
        type=Path,
        default=Path("internal_id_to_task_number.json"),
        help="JSON со связкой internal_id -> номер задания (используется для фильтрации)",
    )
    parser.add_argument(
        "--drop-images-for-task-number",
        type=int,
        action="append",
        default=[],
        help=(
            "Для указанных номеров заданий удалить картинки с заданными расширениями "
            "(можно повторять)"
        ),
    )
    parser.add_argument(
        "--drop-image-ext",
        action="append",
        default=[".png", ".gif"],
        help="Расширения картинок для удаления (можно повторять), по умолчанию: .png и .gif",
    )
    args = parser.parse_args()

    all_tasks: list[TaskDict] = []
    for page_idx, html in load_html_files(str(args.pages_dir)):
        page_tasks = parse_fipi_page(html, page_idx)
        all_tasks.extend(page_tasks)
        print(f"Страница {page_idx}: найдено задач {len(page_tasks)}")

    if not all_tasks:
        print("Не найдено задач, ничего не делаю.")
        return

    if args.drop_images_for_task_number:
        mapping = load_internal_id_to_task_number(args.internal_id_to_task_number)
        wanted = set(args.drop_images_for_task_number)
        internal_ids = {iid.lower() for iid, num in mapping.items() if num in wanted}
        drop_exts = {str(ext).lower() for ext in args.drop_image_ext if str(ext).startswith(".")}
        removed = drop_images_for_internal_ids(all_tasks, internal_ids, drop_exts)
        print(
            "Фильтрация картинок:",
            f"номера={sorted(wanted)}",
            f"internal_id={len(internal_ids)}",
            f"расширения={sorted(drop_exts)}",
            f"удалено_из_tasks={removed}",
        )

    candidates = build_asset_candidates(all_tasks)
    mapping_by_key, entries = build_asset_mapping(candidates, args.assets_dir)
    write_map(entries, args.map)
    print(f"Сохранён мэппинг: {args.map} ({len(entries)} элементов)")

    if not args.no_download:
        download_assets(entries, max_files=args.max_files, filter_substr=args.filter_substr)

    rewritten_tasks = rewrite_tasks(all_tasks, mapping_by_key)
    write_jsonl(rewritten_tasks, args.output)
    print(f"Всего записано задач: {len(rewritten_tasks)}")


if __name__ == "__main__":
    main()
