"""Постпроцессинг tasks.jsonl без повторной загрузки страниц.

Запуск:
    uv run python transform_tasks.py --input tasks.jsonl --output tasks_clean.jsonl

Что делает сейчас:
* удаляет Word-артефакт `<?import namespace = m …>`;
* заменяет MathML-блоки, в которых единственный листовой символ — длинное тире `–`, на сам символ;
* в остальных MathML удаляет префикс `m:` у тегов (оставляя структуру для MathJax/KaTeX);
* заменяет `ShowPictureQ('file')` на `<img src="assets/file" alt="">` и удаляет сам скрипт;
* убирает служебные пустые якоря, пустые параграфы/обёртки и внешний `<td>`-контейнер;
* пишет очищенный HTML в поле `question_html_clean`, исходный `question_html` не трогает;
* генерирует Markdown-версию в поле `question_md`;
* все остальные поля (включая `question_text`) копируются как есть.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

LEAF_NAMES = {
    "mo",
    "mi",
    "mn",
    "mtext",
    "msym",
    "m:mo",
    "m:mi",
    "m:mn",
    "m:mtext",
    "m:msym",
}

DROP_ATTRS = {
    "class",
    "style",
    "bgcolor",
    "width",
    "height",
    "align",
    "valign",
    "lang",
    "svwidth",
    "border",
    "cellpadding",
    "cellspacing",
    "nowrap",
}

EMPTY_REMOVABLE_TAGS = {
    "p",
    "div",
    "span",
    "font",
    "b",
    "i",
    "strong",
    "em",
    "u",
    "sup",
    "sub",
}

UNWRAP_TAGS = {"span", "font", "o:p"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("tasks.jsonl"))
    parser.add_argument("--output", type=Path, default=Path("tasks_clean.jsonl"))
    return parser.parse_args()


def strip_import_pis(html: str) -> str:
    """Убираем `<?import namespace = m ...>` (Word/MathPlayer артефакт)."""
    return re.sub(r"<\?import[^>]*?>", "", html, flags=re.IGNORECASE)


def strip_prefixes(tag: Tag, prefix: str = "m:") -> None:
    """Переименовываем теги вида m:math -> math рекурсивно."""
    if tag.name and tag.name.startswith(prefix):
        tag.name = tag.name[len(prefix) :]
    for child in tag.find_all(True):
        if child.name and child.name.startswith(prefix):
            child.name = child.name[len(prefix) :]


def single_leaf_text(math_tag: Tag) -> str | None:
    """Если в math ровно один листовой узел из LEAF_NAMES — вернуть его текст."""
    leaves: list[str] = []
    for node in math_tag.find_all(True):
        if node.find(True):
            continue
        if node.name in LEAF_NAMES:
            text = node.get_text(strip=True)
            if text:
                leaves.append(text)
    if len(leaves) == 1:
        return leaves[0]
    return None


def clean_html(raw_html: str, stats: Counter[str]) -> str:
    html = strip_import_pis(raw_html)
    soup = BeautifulSoup(f"<root>{html}</root>", "html.parser")
    root = soup.find("root") or soup

    # Чистим теги и атрибуты до специфичных замен
    for tag in list(root.find_all(True)):
        # unwrap декоративных контейнеров
        if tag.name in UNWRAP_TAGS or (tag.name == "div" and not tag.find("table")):
            tag.unwrap()
            continue
        # <br> -> перевод строки
        if tag.name == "br":
            tag.replace_with("\n")
            continue
        # удаляем ненужные атрибуты
        for attr in list(tag.attrs):
            if attr in DROP_ATTRS:
                del tag.attrs[attr]

    # нормализуем неразрывные пробелы
    for text_node in root.find_all(string=True):
        if "\xa0" in text_node:
            text_node.replace_with(text_node.replace("\xa0", " "))

    # Скрипты ShowPictureQ / ShowPictureQ2WH -> img (+ссылка на архив)
    for script in list(root.find_all("script")):
        content = script.string or "".join(script.strings)
        if content:
            # ShowPictureQ2WH('zip','gif',...)
            for zip_name, img_name in re.findall(r"ShowPictureQ2WH\('([^']*)','([^']*)'", content):
                if zip_name:
                    link = soup.new_tag("a", href=f"assets/{zip_name}")
                    link.string = zip_name
                    script.insert_before(link)
                    stats["showpictureq2_link"] += 1
                if img_name:
                    img = soup.new_tag("img", src=f"assets/{img_name}", alt="")
                    script.insert_before(img)
                    stats["showpictureq2_img"] += 1
            # ShowPictureQ('file')
        for fname in re.findall(r"ShowPictureQ\('([^']+)'", content):
            img = soup.new_tag("img", src=f"assets/{fname}", alt="")
            script.insert_before(img)
            stats["showpictureq_replaced"] += 1
        script.decompose()

    # MathML обработка
    for math_tag in list(root.find_all(lambda t: t.name in {"math", "m:math"})):
        text = single_leaf_text(math_tag)
        if text == "–":
            math_tag.replace_with(text)
            stats["math_dash_replaced"] += 1
            continue
        strip_prefixes(math_tag)
        stats["math_kept"] += 1

    # Убираем служебные якоря без href
    for a_tag in list(root.find_all("a")):
        if a_tag.get("href"):
            continue
        if not a_tag.get_text(strip=True) and not a_tag.find(True):
            a_tag.decompose()
            stats["empty_anchor_removed"] += 1
            continue
        a_tag.unwrap()
        stats["anchor_unwrapped"] += 1

    # Удаляем пустые параграфы/обёртки, которые остаются после чистки
    for tag in list(root.find_all(EMPTY_REMOVABLE_TAGS)):
        if tag.find(True):
            continue
        if tag.get_text(strip=True):
            continue
        tag.decompose()
        stats["empty_tag_removed"] += 1

    # Если верхний уровень — единственный служебный контейнер td/tr/tbody, разворачиваем его
    def unwrap_single_wrapper(node: Tag) -> bool:
        children = [c for c in node.contents if not (isinstance(c, str) and c.strip() == "")]
        if len(children) != 1:
            return False
        child = children[0]
        if not isinstance(child, Tag):
            return False
        if child.name not in {"td", "tr", "tbody"}:
            return False
        child.unwrap()
        return True

    while unwrap_single_wrapper(root):
        stats["wrapper_unwrapped"] += 1

    cleaned = "".join(str(child) for child in root.contents)
    return cleaned


def render_children(tag: Tag, indent: str = "") -> str:
    return "".join(render_node(child, indent) for child in tag.children)


def render_list(tag: Tag, indent: str, ordered: bool) -> str:
    items: list[str] = []
    index = 1
    for child in tag.children:
        if isinstance(child, NavigableString):
            if child.strip():
                items.append(indent + child.strip())
            continue
        if not isinstance(child, Tag):
            continue
        if child.name != "li":
            items.append(render_node(child, indent))
            continue
        marker = f"{index}." if ordered else "-"
        index += 1
        body = render_children(child, indent + "   ").strip()
        body = body.replace("\n", "\n" + indent + "   ")
        items.append(f"{indent}{marker} {body}")
    return "\n".join(items) + "\n"


def render_node(node: Tag | NavigableString, indent: str = "") -> str:
    if isinstance(node, NavigableString):
        return str(node)

    name = node.name

    if name == "br":
        return "\n"
    if name in {"strong", "b"}:
        return f"**{render_children(node, indent)}**"
    if name in {"em", "i"}:
        return f"*{render_children(node, indent)}*"
    if name == "code":
        code_text = render_children(node, indent)
        code_text = code_text.replace("`", "\\`")
        return f"`{code_text}`"
    if name == "pre":
        inner = node.get_text()
        return f"\n```\n{inner.strip()}\n```\n"
    if name == "img":
        alt = node.get("alt", "")
        src = node.get("src", "")
        return f"![{alt}]({src})"
    if name == "a":
        href = node.get("href")
        text = render_children(node, indent).strip() or href or ""
        if href:
            return f"[{text}]({href})"
        return text
    if name == "ul":
        return "\n" + render_list(node, indent, ordered=False) + "\n"
    if name == "ol":
        return "\n" + render_list(node, indent, ordered=True) + "\n"
    if name == "li":
        body = render_children(node, indent + "   ").strip()
        body = body.replace("\n", "\n" + indent + "   ")
        return f"{indent}- {body}\n"
    if name == "p":
        content = render_children(node, indent).strip()
        if not content:
            return "\n"
        return f"{content}\n\n"
    if name in {"math", "m:math", "table", "tbody", "thead", "tr", "td", "th"}:
        if name == "table":
            return "\n" + str(node) + "\n"
        return str(node)

    return render_children(node, indent)


def html_to_markdown(cleaned_html: str) -> str:
    """Грубая конверсия в GFM с сохранением таблиц/MathML как встроенного HTML."""

    soup = BeautifulSoup(f"<root>{cleaned_html}</root>", "html.parser")
    root = soup.find("root") or soup
    md = render_children(root)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip() + "\n"


def main() -> None:
    args = parse_args()
    stats: Counter[str] = Counter()

    with args.input.open() as fin, args.output.open("w") as fout:
        for line in fin:
            row = json.loads(line)
            raw_html = row.get("question_html", "")
            cleaned_html = clean_html(raw_html, stats)
            row["question_html_clean"] = cleaned_html
            row["question_md"] = html_to_markdown(cleaned_html)
            # В clean-версии не храним сырое question_html
            row.pop("question_html", None)
            fout.write(json.dumps(row, ensure_ascii=False) + "\n")
            stats["rows"] += 1

    print(
        "Готово:",
        f"строк={stats['rows']}",
        f"math_dash_replaced={stats['math_dash_replaced']}",
        f"math_kept={stats['math_kept']}",
        f"ShowPictureQ→img={stats['showpictureq_replaced']}",
        f"ShowPictureQ2WH→link={stats['showpictureq2_link']}",
        f"ShowPictureQ2WH→img={stats['showpictureq2_img']}",
        f"anchors_unwrapped={stats['anchor_unwrapped']}",
        f"empty_anchors_removed={stats['empty_anchor_removed']}",
        f"empty_tags_removed={stats['empty_tag_removed']}",
        f"wrappers_unwrapped={stats['wrapper_unwrapped']}",
    )


if __name__ == "__main__":
    main()
