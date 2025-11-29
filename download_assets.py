from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests
from requests.packages.urllib3.exceptions import InsecureRequestWarning

BASE_CONTEXT_URL = "https://ege.fipi.ru/"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
ASSETS_DIR = Path("assets")
MAP_PATH = Path("map.json")
SKIP_SSL_VERIFY = os.environ.get("FIPI_SKIP_SSL_VERIFY", "0") not in {"0", "", "false", "False"}


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


def read_tasks(tasks_path: Path) -> list[dict]:
    tasks: list[dict] = []
    with tasks_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                task = json.loads(line)
            except json.JSONDecodeError:
                continue
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


def build_asset_candidates(tasks: list[dict]) -> list[AssetCandidate]:
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


def rewrite_tasks(
    tasks: list[dict], mapping_by_key: dict[tuple[str, str], AssetMapping]
) -> list[dict]:
    updated: list[dict] = []
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

        updated.append(new_task)
    return updated


def write_tasks(tasks: list[dict], output_path: Path) -> None:
    with output_path.open("w", encoding="utf-8") as f:
        for task in tasks:
            f.write(json.dumps(task, ensure_ascii=False) + "\n")


def download_all(
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


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Скачать вложения и картинки из tasks.jsonl с переименованием по internal_id"
    )
    parser.add_argument("--max", type=int, default=None, help="Лимит числа скачиваемых файлов")
    parser.add_argument(
        "--filter",
        dest="filter_substr",
        default=None,
        help="Скачивать только ссылки, содержащие подстроку (по исходному пути)",
    )
    parser.add_argument(
        "--tasks",
        dest="tasks_path",
        type=Path,
        default=Path("tasks.jsonl"),
        help="Путь до исходного tasks.jsonl",
    )
    parser.add_argument(
        "--assets-dir",
        dest="assets_dir",
        type=Path,
        default=ASSETS_DIR,
        help="Каталог для сохранения файлов с короткими именами",
    )
    parser.add_argument(
        "--map",
        dest="map_path",
        type=Path,
        default=MAP_PATH,
        help="Путь для сохранения map.json",
    )
    parser.add_argument(
        "--rewrite-tasks",
        dest="rewrite_tasks_path",
        type=Path,
        default=None,
        help=(
            "Куда записать tasks.jsonl с короткими путями "
            "(если не указан, задачи не переписываются)"
        ),
    )
    parser.add_argument(
        "--inplace",
        action="store_true",
        help=(
            "Перезаписать исходный tasks.jsonl короткими путями "
            "(эквивалент --rewrite-tasks tasks.jsonl)"
        ),
    )
    args = parser.parse_args()

    if not args.tasks_path.exists():
        raise SystemExit(f"Нет файла {args.tasks_path}")

    tasks = read_tasks(args.tasks_path)
    candidates = build_asset_candidates(tasks)
    if not candidates:
        print("Не найдено ни одной ссылки на вложения или картинки.")
        return
    mapping_by_key, entries = build_asset_mapping(candidates, args.assets_dir)

    write_map(entries, args.map_path)
    print(f"Сохранён мэппинг: {args.map_path} ({len(entries)} элементов)")

    download_all(entries, max_files=args.max, filter_substr=args.filter_substr)

    output_tasks_path = args.rewrite_tasks_path
    if args.inplace:
        output_tasks_path = args.tasks_path
    if output_tasks_path:
        updated_tasks = rewrite_tasks(tasks, mapping_by_key)
        write_tasks(updated_tasks, output_tasks_path)
        print(f"Записаны задачи с короткими именами: {output_tasks_path}")


if __name__ == "__main__":
    main()
