.PHONY: install lint typecheck format parse

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
