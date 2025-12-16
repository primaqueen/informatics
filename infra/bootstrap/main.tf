provider "yandex" {
  token     = var.yc_token
  cloud_id  = var.cloud_id
  folder_id = var.folder_id
}

locals {
  tfstate_bucket_name = lower(coalesce(var.tfstate_bucket_name, "tfstate-${var.folder_id}"))
}

resource "yandex_iam_service_account" "deployer" {
  name        = var.service_account_name
  folder_id   = var.folder_id
  description = "Terraform + frontend deploy (Object Storage, CDN, DNS, CM)."
}

resource "yandex_resourcemanager_folder_iam_member" "sa_storage_admin" {
  folder_id = var.folder_id
  role      = "storage.admin"
  member    = "serviceAccount:${yandex_iam_service_account.deployer.id}"
}

resource "yandex_resourcemanager_folder_iam_member" "sa_cdn_admin" {
  folder_id = var.folder_id
  role      = "cdn.admin"
  member    = "serviceAccount:${yandex_iam_service_account.deployer.id}"
}

resource "yandex_resourcemanager_folder_iam_member" "sa_cm_admin" {
  folder_id = var.folder_id
  role      = "certificate-manager.admin"
  member    = "serviceAccount:${yandex_iam_service_account.deployer.id}"
}

resource "yandex_iam_service_account_static_access_key" "storage" {
  service_account_id = yandex_iam_service_account.deployer.id
  description        = "S3 static access key for Terraform backend and frontend uploads."
}

resource "yandex_storage_bucket" "tfstate" {
  bucket    = local.tfstate_bucket_name
  folder_id = var.folder_id

  # Важно: эти ключи нужны Terraform backend (S3) и для операций с объектами/политиками.
  access_key = yandex_iam_service_account_static_access_key.storage.access_key
  secret_key = yandex_iam_service_account_static_access_key.storage.secret_key

  force_destroy = false

  versioning {
    enabled = true
  }
}
