from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit


def url_extension(url: str) -> str:
    return Path(urlsplit(url.strip()).path).suffix.lower()


def url_basename(url: str) -> str:
    return Path(urlsplit(url.strip()).path).name


def load_internal_id_set(path: Path, task_numbers: set[int]) -> set[str]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"Ожидался dict в {path}, получено: {type(raw).__name__}")
    return {
        str(internal_id).strip().lower()
        for internal_id, number in raw.items()
        if isinstance(internal_id, str) and number in task_numbers
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Удалить png/gif из images для заданных номеров задач и удалить файлы из assets."
        )
    )
    parser.add_argument("--tasks", type=Path, default=Path("tasks.jsonl"))
    parser.add_argument("--map", type=Path, default=Path("map.json"))
    parser.add_argument("--assets-dir", type=Path, default=Path("assets"))
    parser.add_argument(
        "--internal-id-to-task-number",
        type=Path,
        default=Path("internal_id_to_task_number.json"),
    )
    parser.add_argument(
        "--task-number",
        type=int,
        action="append",
        default=[5],
        help="Номер задания (можно повторять), по умолчанию: 5",
    )
    parser.add_argument(
        "--ext",
        action="append",
        default=[".png", ".gif"],
        help="Расширения для удаления (можно повторять), по умолчанию: .png и .gif",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Применить изменения (без этого флага — только отчёт).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    task_numbers = set(args.task_number)
    drop_exts = {str(ext).lower() for ext in args.ext if str(ext).startswith(".")}
    internal_ids = load_internal_id_set(args.internal_id_to_task_number, task_numbers)

    removed_files: set[str] = set()
    tasks_seen = 0
    tasks_matched = 0
    images_removed = 0

    out_lines: list[str] = []
    with args.tasks.open(encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            tasks_seen += 1
            row = json.loads(line)
            iid = str(row.get("internal_id", "")).strip().lower()
            if iid in internal_ids and isinstance(row.get("images"), list):
                tasks_matched += 1
                new_images: list[dict] = []
                for item in row["images"]:
                    if not isinstance(item, dict):
                        new_images.append(item)
                        continue
                    src = str(item.get("src", ""))
                    if url_extension(src) in drop_exts:
                        images_removed += 1
                        basename = url_basename(src)
                        if basename:
                            removed_files.add(basename)
                        continue
                    new_images.append(item)
                row["images"] = new_images
            out_lines.append(json.dumps(row, ensure_ascii=False))

    map_removed = 0
    if args.map.exists():
        raw_map = json.loads(args.map.read_text(encoding="utf-8"))
        if isinstance(raw_map, dict) and removed_files:
            for fname in list(raw_map.keys()):
                if fname in removed_files:
                    raw_map.pop(fname, None)
                    map_removed += 1
        else:
            raw_map = raw_map if isinstance(raw_map, dict) else {}
    else:
        raw_map = {}

    assets_deleted = 0
    assets_missing = 0
    for fname in sorted(removed_files):
        target = args.assets_dir / fname
        if target.exists():
            if args.apply:
                target.unlink()
            assets_deleted += 1
        else:
            assets_missing += 1

    print(
        "Готово:" if args.apply else "Dry-run:",
        f"номера={sorted(task_numbers)}",
        f"internal_id={len(internal_ids)}",
        f"расширения={sorted(drop_exts)}",
        f"строк={tasks_seen}",
        f"совпало={tasks_matched}",
        f"images_удалено={images_removed}",
        f"файлов_в_assets={assets_deleted}",
        f"файлов_не_найдено={assets_missing}",
        f"удалено_из_map={map_removed}",
    )

    if args.apply:
        args.tasks.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
        if isinstance(raw_map, dict):
            args.map.write_text(json.dumps(raw_map, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
