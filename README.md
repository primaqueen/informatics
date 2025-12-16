# Деплой фронтенда `ege.braintent.ru` в Yandex Cloud (S3 + CDN) через Terraform

Цель: статический фронтенд из `frontend/` (Vite) деплоится в **Yandex Object Storage** и раздаётся через **Yandex CDN** на домене `ege.braintent.ru`.

DNS находится у **reg.ru**, поэтому записи DNS создаём **вручную** (Terraform управляет только ресурсами в Yandex Cloud и выводит, какие DNS-записи нужны).

Двигаемся по шагам так, чтобы после каждого шага было понятно, что Terraform реально поднял инфраструктуру и сайт доступен.

---

## Требования

- `terraform` (проверено на `Terraform v1.13+`)
- `yc` (Yandex Cloud CLI)
- Node.js + npm (для билда фронтенда)

---

## 0) Подготовка `yc` и базовые параметры

1) Убедиться, что `yc` настроен и указывает на нужные `cloud`/`folder`:

```bash
yc init
yc config get cloud-id
yc config get folder-id
```

2) Убедиться, что в этой папке есть/будет сертификат (если уже выпускал вручную в UI — нужно узнать его `certificate_id`):

```bash
yc cm certificate list
```

Нам понадобятся `cloud_id`, `folder_id` и (опционально) `certificate_id`.

---

## 1) Terraform bootstrap: сервисный аккаунт + S3 ключи + бакет под tfstate

**Зачем:** создать сервисный аккаунт и S3-ключи для Object Storage, а также бакет под Terraform state.

### 1.1. Применяем bootstrap

```bash
cd infra/bootstrap

# Локально (не коммитим): задаём обязательные переменные.
cat > secrets.auto.tfvars <<'EOF'
cloud_id  = "..."
folder_id = "..."
EOF

# Токен можно задать переменной окружения (не коммитим):
export TF_VAR_yc_token="$(yc iam create-token)"

terraform init
terraform apply
```

Если применилось без проблем — фиксируем кратко:
- создан service account
- выданы роли на folder
- созданы S3 access/secret key
- создан bucket для tfstate с versioning

### 1.2. Проверяем, что ключи и бакет есть

```bash
terraform output
terraform output -raw storage_access_key
terraform output -raw tfstate_bucket_name
```

Важно: `storage_secret_key` — секрет. Его смотреть только через `terraform output -raw storage_secret_key` и не сохранять в гит.

---

## 2) Terraform prod: Object Storage (origin) + CDN + Certificate Manager + DNS

### 2.1. Подготовить секреты для Terraform (локально, без коммита)

Создаём файл `infra/prod/frontend/secrets.auto.tfvars`:

```hcl
cloud_id           = "..."
folder_id          = "..."
domain             = "ege.braintent.ru"

storage_access_key = "..."
storage_secret_key = "..."

# Если сертификат уже выпущен вручную (CM):
certificate_id     = "..."
```

Значения `storage_*` берём из `infra/bootstrap` outputs.

Если на этом шаге встретились проблемы (например, “нет прав на DNS/CM/CDN”) — добавляем в раздел “Проблемы” ниже.

### 2.2. Подключить remote state (S3 backend) и применить

Terraform backend для Yandex Object Storage использует S3-совместимый протокол и требует AWS-переменные окружения:

```bash
cd infra/prod/frontend

export TF_VAR_yc_token="$(yc iam create-token)"

export AWS_ACCESS_KEY_ID="$(cd ../../bootstrap && terraform output -raw storage_access_key)"
export AWS_SECRET_ACCESS_KEY="$(cd ../../bootstrap && terraform output -raw storage_secret_key)"

export TFSTATE_BUCKET="$(cd ../../bootstrap && terraform output -raw tfstate_bucket_name)"

terraform init \
  -backend-config="bucket=${TFSTATE_BUCKET}" \
  -backend-config="key=prod/frontend/terraform.tfstate"

terraform apply
```

**Что должно появиться:**
- бакет фронтенда (static website hosting включён)
- публичная политика на чтение объектов (origin открыт на чтение)
- managed сертификат на `ege.braintent.ru` (если `certificate_id` не задан)
- CDN resource с `cname=ege.braintent.ru`
- outputs с тем, какие DNS-записи нужно создать в reg.ru

### 2.3. Проверка работоспособности домена/HTTPS

1) Создать CNAME в reg.ru по output-ам Terraform:

```bash
export AWS_ACCESS_KEY_ID="$(cd ../../bootstrap && terraform output -raw storage_access_key)"
export AWS_SECRET_ACCESS_KEY="$(cd ../../bootstrap && terraform output -raw storage_secret_key)"

terraform output -raw dns_cname_record_name
terraform output -raw dns_cname_record_value
```

2) Проверить ответ по домену:

```bash
curl -I https://ege.braintent.ru
```

Если `certificate_id` не задан, Terraform запросит managed сертификат и выведет DNS challenge в output `cert_dns_challenge` — эту CNAME-запись нужно добавить в reg.ru и затем повторить `terraform apply`.

Примечание: изменения в CDN могут применяться/распространяться не мгновенно. Если после `terraform apply` домен ещё отдаёт старый ответ, подожди 10–15 минут и/или сделай purge кеша:

```bash
yc cdn cache purge --resource-id <resource_id> --all
```

---

## 3) Деплой статики (без AWS CLI, через `yc`)

Сборка фронтенда:

```bash
cd frontend
npm ci
npm run build
```

Далее грузим `frontend/dist` в бакет фронтенда.
Названия бакета берём из Terraform:

```bash
cd ../infra/prod/frontend
export FRONTEND_BUCKET="$(terraform output -raw frontend_bucket_name)"
cd ../../../
```

Рекомендуемый вариант (2 прохода, чтобы `index.html` не кешировался, а ассеты кешировались долго):

```bash
# 1) ассеты (кроме index.html) — долгий кеш
yc storage s3 cp --recursive frontend/dist "s3://${FRONTEND_BUCKET}/" \
  --exclude "index.html" \
  --cache-control "public, max-age=31536000, immutable"

# 2) index.html — без кеша (чтобы релизы подхватывались быстро)
yc storage s3 cp frontend/dist/index.html "s3://${FRONTEND_BUCKET}/index.html" \
  --cache-control "no-cache"
```

То же самое одной командой (скрипт):

```bash
# Важно: yc storage s3 работает через S3 API и требует S3-ключи в переменных окружения.
export AWS_ACCESS_KEY_ID="$(cd infra/bootstrap && terraform output -raw storage_access_key)"
export AWS_SECRET_ACCESS_KEY="$(cd infra/bootstrap && terraform output -raw storage_secret_key)"

bash scripts/deploy_frontend_yc.sh frontend/dist "${FRONTEND_BUCKET}"

# Или короче (скрипт сам возьмёт ключи из infra/bootstrap):
bash scripts/deploy_frontend_yc.sh --from-terraform frontend/dist "${FRONTEND_BUCKET}"

# Полезно для браузера: скрипт выставляет Content-Type и Cache-Control на каждый файл.
# Можно дополнительно инициировать purge CDN:
bash scripts/deploy_frontend_yc.sh --from-terraform --purge-cdn frontend/dist "${FRONTEND_BUCKET}"

# Если хочется видеть прогресс по файлам:
bash scripts/deploy_frontend_yc.sh --from-terraform --purge-cdn --verbose frontend/dist "${FRONTEND_BUCKET}"
```

Проверка:

```bash
curl -I https://ege.braintent.ru
```

Если CDN держит старый `index.html`, можно сделать purge:

```bash
yc cdn cache purge --help
```

---

## Проблемы (заполняем по мере прохождения)

### Остались тестовые бакеты `tf-*`

Что было: во время диагностики прав S3 могли появиться временные бакеты вида `tf-poltest*`, `tf-princtest*`.

Что делать: их можно удалить (важно **не трогать** `tfstate-*` и `*-frontend`).

```bash
export AWS_ACCESS_KEY_ID="$(cd infra/bootstrap && terraform output -raw storage_access_key)"
export AWS_SECRET_ACCESS_KEY="$(cd infra/bootstrap && terraform output -raw storage_secret_key)"

for b in $(yc storage bucket list --format json | jq -r '.[].name' | rg '^tf-(poltest|princtest)'); do
  yc storage s3 rm --recursive "s3://${b}/" || true
  yc storage bucket delete "${b}" || true
done
```

### 403 AccessDenied при загрузке файлов в бакет через `yc storage s3 cp`

Что было: `yc storage s3 cp` возвращал `AccessDenied` на `PutObject` в бакет фронтенда.

Причина: у service account не было прав на запись в бакет на уровне ACL/Policy (S3 API). При этом через `yc storage bucket get` бакет был виден, но операции S3 (`PutObject`, `ListObjects`) отдавали 403.

Как решили:
1) Разово выдали service account полный доступ к бакету (ACL grant) через `yc`:

```bash
yc storage bucket update ege-braintent-ru-b1gtllig4qi3sbgd68n1-frontend \
  --grants grant-type=grant-type-account,grantee-id=<service_account_id>,permission=permission-full-control
```

2) Закрепили это в Terraform через `yandex_storage_bucket_grant`.

### 404 NoSuchBucket через CDN при открытии домена

Что было: `curl -I https://ege.braintent.ru` отдавал 404 `NoSuchBucket`, хотя бакет существовал.

Причина: CDN прокидывал `Host: ege.braintent.ru` в origin `*.website.yandexcloud.net`. Для website-origin это приводит к `NoSuchBucket`.

Как решили: в `yandex_cdn_resource.options` отключили `forward_host_header` и задали `custom_host_header` равным домену website endpoint.

### (пример) Сертификат не выпускается / долго в статусе `VALIDATING`

Что было: ...

Как решили: ...
