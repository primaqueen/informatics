#!/usr/bin/env bash
set -euo pipefail

from_terraform="0"
purge_cdn="0"
cdn_resource_id=""
verbose="0"

usage() {
  cat >&2 <<EOF
Usage:
  $0 [--from-terraform] [--purge-cdn] [--cdn-resource-id <id>] [--verbose] <dist_dir> <bucket_name>

Examples:
  $0 --from-terraform frontend/dist my-frontend-bucket
  $0 --from-terraform --purge-cdn --verbose frontend/dist my-frontend-bucket
EOF
}

while [[ $# -gt 0 ]]; do
  case "${1}" in
    --from-terraform)
      from_terraform="1"
      shift
      ;;
    --purge-cdn)
      purge_cdn="1"
      shift
      ;;
    --cdn-resource-id)
      cdn_resource_id="${2:-}"
      shift 2
      ;;
    --verbose)
      verbose="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Неизвестный флаг: ${1}" >&2
      usage
      exit 2
      ;;
    *)
      break
      ;;
  esac
done

dist_dir="${1:-frontend/dist}"
bucket="${2:-}"

if [[ -z "${bucket}" ]]; then
  usage
  exit 2
fi

if [[ ! -d "${dist_dir}" ]]; then
  echo "dist_dir not found: ${dist_dir}" >&2
  exit 2
fi

if [[ ! -f "${dist_dir}/index.html" ]]; then
  echo "index.html not found in: ${dist_dir}" >&2
  exit 2
fi

if [[ "${from_terraform}" == "1" ]]; then
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -z "${repo_root}" ]]; then
    echo "Cannot detect repo root (git rev-parse failed). Запусти из git-репозитория." >&2
    exit 2
  fi

  export AWS_ACCESS_KEY_ID="$(cd "${repo_root}/infra/bootstrap" && terraform output -raw storage_access_key)"
  export AWS_SECRET_ACCESS_KEY="$(cd "${repo_root}/infra/bootstrap" && terraform output -raw storage_secret_key)"

  if [[ "${purge_cdn}" == "1" && -z "${cdn_resource_id}" ]]; then
    cdn_resource_id="$(cd "${repo_root}/infra/prod/frontend" && terraform output -raw cdn_resource_id 2>/dev/null || true)"
  fi
fi

if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  echo "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY не заданы." >&2
  echo "Для yc storage s3 нужны S3-ключи (service account)." >&2
  echo "Варианты:" >&2
  echo "  1) export AWS_ACCESS_KEY_ID=...; export AWS_SECRET_ACCESS_KEY=..." >&2
  echo "  2) $0 --from-terraform ${dist_dir} ${bucket}" >&2
  exit 2
fi

if ! command -v file >/dev/null 2>&1; then
  echo "Требуется утилита 'file' (для определения Content-Type)." >&2
  exit 2
fi

long_cache="public, max-age=31536000, immutable"

upload_one() {
  local abs_path="$1"
  local rel_path="$2"
  local content_type="$3"
  local cache_control="$4"

  if [[ "${verbose}" == "1" ]]; then
    echo "→ ${rel_path} (${content_type}; ${cache_control})"
  fi

  yc storage s3 cp "${abs_path}" "s3://${bucket}/${rel_path}" \
    --content-type "${content_type}" \
    --cache-control "${cache_control}" \
    --only-show-errors
}

total_files="$(find "${dist_dir}" -type f | wc -l | tr -d ' ')"
echo "→ Загрузка файлов в s3://${bucket}/ (файлов: ${total_files})"

i=0
while IFS= read -r -d '' f; do
  rel="${f#${dist_dir%/}/}"
  if [[ "${rel}" == ".DS_Store" || "${rel}" == */.DS_Store ]]; then
    continue
  fi

  i=$((i + 1))
  if [[ "${verbose}" != "1" && $((i % 200)) -eq 0 ]]; then
    echo "… загружено ${i}/${total_files}"
  fi

  case "${f}" in
    *.html)
      upload_one "${f}" "${rel}" "text/html; charset=utf-8" "no-cache"
      ;;
    *.json)
      upload_one "${f}" "${rel}" "application/json" "no-cache"
      ;;
    *.js)
      upload_one "${f}" "${rel}" "application/javascript" "${long_cache}"
      ;;
    *.css)
      upload_one "${f}" "${rel}" "text/css" "${long_cache}"
      ;;
    *.svg)
      upload_one "${f}" "${rel}" "image/svg+xml" "${long_cache}"
      ;;
    *.png)
      upload_one "${f}" "${rel}" "image/png" "${long_cache}"
      ;;
    *.jpg|*.jpeg)
      upload_one "${f}" "${rel}" "image/jpeg" "${long_cache}"
      ;;
    *.gif)
      upload_one "${f}" "${rel}" "image/gif" "${long_cache}"
      ;;
    *.webp)
      upload_one "${f}" "${rel}" "image/webp" "${long_cache}"
      ;;
    *.ico)
      upload_one "${f}" "${rel}" "image/x-icon" "${long_cache}"
      ;;
    *.woff)
      upload_one "${f}" "${rel}" "font/woff" "${long_cache}"
      ;;
    *.woff2)
      upload_one "${f}" "${rel}" "font/woff2" "${long_cache}"
      ;;
    *)
      ct="$(file --mime-type -b "${f}" 2>/dev/null || echo application/octet-stream)"
      upload_one "${f}" "${rel}" "${ct}" "${long_cache}"
      ;;
  esac
done < <(find "${dist_dir}" -type f -print0)

echo "✓ Загрузка завершена"

if [[ "${purge_cdn}" == "1" ]]; then
  if [[ -z "${cdn_resource_id}" ]]; then
    echo "Не удалось определить cdn_resource_id. Передай --cdn-resource-id или используй --from-terraform." >&2
    exit 2
  fi

  echo "→ Purge CDN (resource_id=${cdn_resource_id})"
  yc cdn cache purge --resource-id "${cdn_resource_id}" --all --async >/dev/null
  echo "✓ Purge CDN запущен (async)"
fi
