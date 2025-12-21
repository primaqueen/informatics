from __future__ import annotations

import argparse
import json
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml

from generate_task_mdx import load_task_number_map, render_task_mdx


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Запуск pipeline по pipeline.yml.")
    parser.add_argument("--config", type=Path, default=Path("pipeline.yml"))
    parser.add_argument(
        "--only",
        type=str,
        default="",
        help="Запустить только перечисленные стадии (через запятую).",
    )
    parser.add_argument(
        "--skip",
        type=str,
        default="",
        help="Пропустить перечисленные стадии (через запятую).",
    )
    return parser.parse_args()


def load_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Не найден конфиг: {path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("pipeline.yml должен содержать верхнеуровневый словарь")
    return data


def resolve_refs(value: Any, paths: dict[str, Path]) -> Any:
    if isinstance(value, str) and value in paths:
        return paths[value]
    if isinstance(value, dict):
        return {k: resolve_refs(v, paths) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve_refs(v, paths) for v in value]
    return value


def resolve_paths(cfg: dict[str, Any], root: Path) -> dict[str, Path]:
    raw_paths = cfg.get("paths") or {}
    if not isinstance(raw_paths, dict):
        raise ValueError("paths должен быть словарём")
    paths: dict[str, Path] = {}
    for key, value in raw_paths.items():
        if not isinstance(key, str) or not isinstance(value, str):
            continue
        paths[key] = (root / value).resolve()
    return paths


def run_cmd(cmd: list[str]) -> None:
    pretty = " ".join(shlex.quote(part) for part in cmd)
    print(f"$ {pretty}")
    subprocess.run(cmd, check=True)


def stage_enabled(stage: dict[str, Any], only: set[str], skip: set[str]) -> bool:
    stage_id = str(stage.get("id") or "").strip()
    if only and stage_id not in only:
        return False
    if skip and stage_id in skip:
        return False
    enabled = stage.get("enabled", True)
    return bool(enabled)


def build_parse_cmd(params: dict[str, Any]) -> list[str]:
    script = Path(__file__).with_name("parse_fipi_pages.py")
    cmd = [sys.executable, str(script)]
    cmd += ["--pages-dir", str(params["pages_dir"])]
    cmd += ["--output", str(params["output"])]
    cmd += ["--assets-dir", str(params["assets_dir"])]
    cmd += ["--map", str(params["map_json"])]
    if not params.get("download", True):
        cmd.append("--no-download")
    for num in params.get("drop_images_for_task_number", []) or []:
        cmd += ["--drop-images-for-task-number", str(num)]
    for ext in params.get("drop_image_ext", []) or []:
        cmd += ["--drop-image-ext", str(ext)]
    if params.get("internal_id_map"):
        cmd += ["--internal-id-to-task-number", str(params["internal_id_map"])]
    return cmd


def build_transform_cmd(params: dict[str, Any]) -> list[str]:
    script = Path(__file__).with_name("transform_tasks.py")
    cmd = [sys.executable, str(script)]
    cmd += ["--input", str(params["input"])]
    cmd += ["--output", str(params["output"])]
    cmd += ["--kes-output", str(params["kes_output"])]
    for num in params.get("drop_images_for_task_number", []) or []:
        cmd += ["--drop-images-for-task-number", str(num)]
    for ext in params.get("drop_image_ext", []) or []:
        cmd += ["--drop-image-ext", str(ext)]
    if params.get("internal_id_map"):
        cmd += ["--internal-id-to-task-number", str(params["internal_id_map"])]
    return cmd


def render_mdx_all(params: dict[str, Any]) -> dict[str, int]:
    input_path = Path(params["input"])
    output_dir = Path(params["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    overwrite = bool(params.get("overwrite", False))
    task_number_map_path = Path(params.get("task_number_map") or "internal_id_to_task_number.json")
    task_number_map = load_task_number_map(task_number_map_path)

    written = 0
    skipped = 0
    total = 0

    with input_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            total += 1
            row = json.loads(line)
            internal_id = str(row.get("internal_id") or "").strip().upper()
            if not internal_id:
                continue
            out_path = output_dir / f"{internal_id}.mdx"
            if out_path.exists() and not overwrite:
                skipped += 1
                continue
            task_number = task_number_map.get(internal_id)
            out_path.write_text(render_task_mdx(row, task_number=task_number), encoding="utf-8")
            written += 1

    return {"total": total, "written": written, "skipped": skipped}


def render_mdx_task_number(params: dict[str, Any]) -> dict[str, int]:
    input_path = Path(params["input"])
    output_dir = Path(params["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    overwrite = bool(params.get("overwrite", False))
    task_number = int(params["task_number"])

    task_number_map_path = Path(params.get("task_number_map") or "internal_id_to_task_number.json")
    task_number_map = load_task_number_map(task_number_map_path)
    target_ids = {k for k, v in task_number_map.items() if v == task_number}

    written = 0
    skipped = 0
    total = 0

    with input_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            internal_id = str(row.get("internal_id") or "").strip().upper()
            if not internal_id or internal_id not in target_ids:
                continue
            total += 1
            out_path = output_dir / f"{internal_id}.mdx"
            if out_path.exists() and not overwrite:
                skipped += 1
                continue
            out_path.write_text(
                render_task_mdx(row, task_number=task_number),
                encoding="utf-8",
            )
            written += 1

    return {"total": total, "written": written, "skipped": skipped}


def render_mdx_internal_id(params: dict[str, Any]) -> dict[str, int]:
    input_path = Path(params["input"])
    output_dir = Path(params["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    overwrite = bool(params.get("overwrite", False))
    internal_id = str(params["internal_id"]).strip().upper()

    written = 0
    skipped = 0
    total = 0

    with input_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            row_id = str(row.get("internal_id") or "").strip().upper()
            if row_id != internal_id:
                continue
            total += 1
            out_path = output_dir / f"{internal_id}.mdx"
            if out_path.exists() and not overwrite:
                skipped += 1
                return {"total": total, "written": written, "skipped": skipped}
            out_path.write_text(
                render_task_mdx(row, task_number=None),
                encoding="utf-8",
            )
            written += 1
            return {"total": total, "written": written, "skipped": skipped}

    return {"total": total, "written": written, "skipped": skipped}


def publish_assets(copy_specs: list[dict[str, Any]]) -> dict[str, int]:
    copied_files = 0
    copied_dirs = 0
    for spec in copy_specs:
        src = Path(spec["from"]).resolve()
        dst = Path(spec["to"]).resolve()
        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
            for item in src.iterdir():
                target = dst / item.name
                if item.is_dir():
                    shutil.copytree(item, target, dirs_exist_ok=True)
                    copied_dirs += 1
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(item.read_bytes())
                    copied_files += 1
            continue

        if src.is_file():
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(src.read_bytes())
            copied_files += 1
            continue

        raise FileNotFoundError(f"Источник для publish не найден: {src}")

    return {"files": copied_files, "dirs": copied_dirs}


def run_stage(stage: dict[str, Any], paths: dict[str, Path]) -> dict[str, Any]:
    stage_type = stage.get("type")
    params = resolve_refs(stage.get("params") or {}, paths)
    started = time.time()

    if stage_type == "parse_pages":
        run_cmd(build_parse_cmd(params))
        return {"status": "ok", "duration": time.time() - started}

    if stage_type == "transform_tasks":
        run_cmd(build_transform_cmd(params))
        return {"status": "ok", "duration": time.time() - started}

    if stage_type == "render_mdx":
        mode = str(params.get("mode") or "all")
        if mode == "all":
            stats = render_mdx_all(params)
        elif mode == "task_number":
            stats = render_mdx_task_number(params)
        elif mode == "internal_id":
            stats = render_mdx_internal_id(params)
        else:
            raise ValueError(f"Неизвестный режим render_mdx: {mode}")
        return {"status": "ok", "duration": time.time() - started, "stats": stats}

    if stage_type == "publish":
        copy_specs = params.get("copy") or []
        if not isinstance(copy_specs, list):
            raise ValueError("publish.params.copy должен быть списком")
        resolved_specs: list[dict[str, Any]] = []
        for item in copy_specs:
            if not isinstance(item, dict):
                continue
            resolved = resolve_refs(item, paths)
            resolved_specs.append(resolved)
        stats = publish_assets(resolved_specs)
        return {"status": "ok", "duration": time.time() - started, "stats": stats}

    if stage_type == "verify_mdx":
        script = Path(__file__).with_name("scripts").joinpath("verify_mdx.py")
        cmd = [sys.executable, str(script)]
        cmd += ["--input", str(params["input"])]
        cmd += ["--mdx-dir", str(params["mdx_dir"])]
        if params.get("allow_extra"):
            cmd.append("--allow-extra")
        run_cmd(cmd)
        return {"status": "ok", "duration": time.time() - started}

    raise ValueError(f"Неизвестный тип стадии: {stage_type}")


def main() -> None:
    args = parse_args()
    cfg = load_config(args.config)
    root = Path.cwd()
    paths = resolve_paths(cfg, root)

    only = {s.strip() for s in args.only.split(",") if s.strip()}
    skip = {s.strip() for s in args.skip.split(",") if s.strip()}

    report: dict[str, Any] = {"stages": [], "config": str(args.config)}
    stages = cfg.get("stages") or []
    if not isinstance(stages, list):
        raise ValueError("stages должен быть списком")

    for stage in stages:
        if not isinstance(stage, dict):
            continue
        if not stage_enabled(stage, only, skip):
            continue
        stage_id = str(stage.get("id") or stage.get("type"))
        print(f"\n==> {stage_id}")
        info = run_stage(stage, paths)
        report["stages"].append({"id": stage_id, **info})

    report_cfg = cfg.get("report") or {}
    report_path = resolve_refs(report_cfg.get("output") or "", paths)
    if report_path:
        report_path = Path(report_path)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nОтчёт: {report_path}")


if __name__ == "__main__":
    main()
