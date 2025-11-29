from __future__ import annotations

import math
import os
import re
import sys
import time
from pathlib import Path

import requests
from requests.packages.urllib3.exceptions import InsecureRequestWarning

PROJ_ID = "B9ACA5BBB2E19E434CD6BEC25284C67F"
PAGESIZE = 100
BASE_URL = "https://ege.fipi.ru/bank/questions.php"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
RETRIES = 3
RETRY_DELAY = 2
FALLBACK_MAX_PAGES = 31  # страницы 0..30
SKIP_SSL_VERIFY = os.environ.get("FIPI_SKIP_SSL_VERIFY", "0") not in {"0", "", "false", "False"}


def get_total_tasks(html: str) -> int | None:
    """
    Ищет в HTML число общего количества заданий (по паттерну «из <число>»).
    """
    patterns = [
        r"setQCount\(\s*(\d+)",
        r"показаны\s+задани[яе]\s+[^<]{0,50}?\sиз\s+(\d+)",
        r"из\s+(\d+)\s+задан",
    ]
    for pat in patterns:
        match = re.search(pat, html, flags=re.IGNORECASE | re.DOTALL)
        if match:
            try:
                return int(match.group(1))
            except ValueError:
                continue
    return None


def download_page(session: requests.Session, page: int) -> str:
    params = {
        "proj": PROJ_ID,
        "page": page,
        "pagesize": PAGESIZE,
    }
    for attempt in range(1, RETRIES + 1):
        resp = session.get(BASE_URL, params=params, timeout=15)
        if resp.status_code == 200:
            resp.encoding = resp.apparent_encoding or "cp1251"
            return resp.text
        if attempt < RETRIES:
            time.sleep(RETRY_DELAY)
    raise RuntimeError(f"Не удалось скачать страницу {page}: статус {resp.status_code}")


def main() -> None:
    output_dir = Path.cwd() / "pages"
    output_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    session.verify = not SKIP_SSL_VERIFY
    if SKIP_SSL_VERIFY:
        requests.packages.urllib3.disable_warnings(InsecureRequestWarning)

    first_html = download_page(session, 0)
    total_tasks = get_total_tasks(first_html)

    if total_tasks is not None:
        total_pages = math.ceil(total_tasks / PAGESIZE)
    else:
        print(
            "Не удалось определить общее количество заданий. "
            "Использую запасной план: страницы 0..30.",
            file=sys.stderr,
        )
        total_pages = FALLBACK_MAX_PAGES

    downloaded = 0
    cache = {0: first_html}

    for page in range(total_pages):
        html = cache.get(page)
        if html is None:
            html = download_page(session, page)

        if total_tasks is None:
            if not html.strip() or "Заданий не найдено" in html:
                break

        file_path = output_dir / f"page_{page}.html"
        file_path.write_text(html, encoding="utf-8")
        downloaded += 1

    print(f"Скачано страниц: {downloaded}")
    print(f"Путь к папке: {output_dir.resolve()}")


if __name__ == "__main__":
    main()
