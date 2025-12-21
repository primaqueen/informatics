.PHONY: install lint typecheck format parse assets pipeline mdx

install:
	uv sync

lint:
	uv run ruff check .

typecheck:
	uv run mypy parse_fipi_pages.py

format:
	uv run ruff format .

parse:
	uv run python parse_fipi_pages.py

assets:
	uv run python download_assets.py

pipeline:
	uv run python pipeline.py

mdx:
	uv run python pipeline.py --only parse,transform,render_mdx

verify_mdx:
	uv run python scripts/verify_mdx.py
