provider "yandex" {
  token     = var.yc_token
  cloud_id  = var.cloud_id
  folder_id = var.folder_id

  # Для операций с Object Storage (бакеты/политики) используем S3-ключи.
  # Иначе провайдер пытается работать через IAM-token пользователя и может получать 403.
  storage_access_key = var.storage_access_key
  storage_secret_key = var.storage_secret_key
}

data "terraform_remote_state" "bootstrap" {
  backend = "local"
  config = {
    path = "${path.module}/../../bootstrap/terraform.tfstate"
  }
}

locals {
  domain_slug          = replace(var.domain, ".", "-")
  frontend_bucket_name = lower(coalesce(var.frontend_bucket_name, "${local.domain_slug}-${var.folder_id}-frontend"))
}

resource "yandex_storage_bucket" "frontend" {
  bucket    = local.frontend_bucket_name
  folder_id = var.folder_id

  force_destroy = false

  anonymous_access_flags {
    read        = true
    list        = false
    config_read = false
  }

  website {
    index_document = "index.html"
    error_document = "index.html"
  }
}

resource "yandex_storage_bucket_grant" "frontend_deployer_full_control" {
  bucket = yandex_storage_bucket.frontend.bucket

  access_key = var.storage_access_key
  secret_key = var.storage_secret_key

  grant {
    type        = "CanonicalUser"
    id          = data.terraform_remote_state.bootstrap.outputs.service_account_id
    permissions = ["FULL_CONTROL"]
  }
}

resource "yandex_cm_certificate" "frontend" {
  count   = var.certificate_id == null ? 1 : 0
  name    = "ege-braintent-ru-frontend"
  domains = [var.domain]

  managed {
    challenge_type = "DNS_CNAME"
  }
}

locals {
  cm_certificate_id = var.certificate_id != null ? var.certificate_id : yandex_cm_certificate.frontend[0].id
}

resource "yandex_cdn_origin_group" "frontend" {
  name = "ege-braintent-ru-frontend-origin"

  origin {
    source  = replace(replace(yandex_storage_bucket.frontend.website_endpoint, "https://", ""), "http://", "")
    enabled = true
  }
}

resource "yandex_cdn_resource" "frontend" {
  cname           = var.domain
  active          = true
  origin_group_id = yandex_cdn_origin_group.frontend.id
  origin_protocol = "http"

  options {
    # Если прокидывать Host заголовок с клиента (ege.braintent.ru) на website-origin,
    # Object Storage будет отвечать NoSuchBucket. Фиксируем Host на домен origin.
    forward_host_header = false
    custom_host_header  = replace(replace(yandex_storage_bucket.frontend.website_endpoint, "https://", ""), "http://", "")

    gzip_on                = true
    redirect_http_to_https = true
  }

  ssl_certificate {
    type                   = "certificate_manager"
    certificate_manager_id = local.cm_certificate_id
  }

  depends_on = [
  ]
}
