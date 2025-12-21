from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Проверка соответствия MDX-файлов задачам из tasks_clean.jsonl."
    )
    parser.add_argument("--input", type=Path, default=Path("tasks_clean.jsonl"))
    parser.add_argument("--mdx-dir", type=Path, default=Path("frontend/content/tasks"))
    parser.add_argument(
        "--allow-extra",
        action="store_true",
        help="Не считать лишние MDX ошибкой.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if not args.input.exists():
        raise FileNotFoundError(f"Не найден входной файл: {args.input}")
    if not args.mdx_dir.exists():
        raise FileNotFoundError(f"Не найдена папка MDX: {args.mdx_dir}")

    task_ids: set[str] = set()
    with args.input.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            internal_id = str(row.get("internal_id") or "").strip().upper()
            if internal_id:
                task_ids.add(internal_id)

    mdx_files = sorted(args.mdx_dir.glob("*.mdx"))
    mdx_ids = {p.stem.upper() for p in mdx_files}

    missing = sorted(task_ids - mdx_ids)
    extra = sorted(mdx_ids - task_ids)

    empty_files: list[str] = []
    no_frontmatter: list[str] = []
    for path in mdx_files:
        if path.stat().st_size == 0:
            empty_files.append(path.name)
            continue
        first_line = path.read_text(encoding="utf-8").splitlines()[:1]
        if not first_line or first_line[0].strip() != "---":
            no_frontmatter.append(path.name)

    print("Проверка MDX:")
    print(f"  задач в базе: {len(task_ids)}")
    print(f"  файлов MDX: {len(mdx_files)}")
    print(f"  отсутствуют MDX: {len(missing)}")
    print(f"  лишние MDX: {len(extra)}")
    print(f"  пустые файлы: {len(empty_files)}")
    print(f"  без frontmatter: {len(no_frontmatter)}")

    if missing:
        print("Примеры отсутствующих:", ", ".join(missing[:20]))
    if extra and not args.allow_extra:
        print("Примеры лишних:", ", ".join(extra[:20]))
    if empty_files:
        print("Пустые:", ", ".join(empty_files[:20]))
    if no_frontmatter:
        print("Без frontmatter:", ", ".join(no_frontmatter[:20]))

    has_errors = bool(missing or empty_files or no_frontmatter)
    if extra and not args.allow_extra:
        has_errors = True

    if has_errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
