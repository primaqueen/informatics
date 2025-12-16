output "frontend_bucket_name" {
  value       = yandex_storage_bucket.frontend.bucket
  description = "Bucket name with frontend static files."
}

output "frontend_website_endpoint" {
  value       = yandex_storage_bucket.frontend.website_endpoint
  description = "Website endpoint used as CDN origin."
}

output "cdn_provider_cname" {
  value       = yandex_cdn_resource.frontend.provider_cname
  description = "CNAME target for DNS (provider domain)."
}

output "frontend_domain" {
  value       = var.domain
  description = "Frontend domain."
}

output "cdn_resource_id" {
  value       = yandex_cdn_resource.frontend.id
  description = "CDN resource id (нужен для purge)."
}

output "dns_cname_record_name" {
  value       = var.domain
  description = "DNS record name to create at reg.ru (CNAME)."
}

output "dns_cname_record_value" {
  value       = yandex_cdn_resource.frontend.provider_cname
  description = "DNS record value to create at reg.ru (CNAME target)."
}

output "cert_dns_challenge" {
  value = try(
    {
      name   = yandex_cm_certificate.frontend[0].challenges[0].dns_name
      type   = yandex_cm_certificate.frontend[0].challenges[0].dns_type
      value  = yandex_cm_certificate.frontend[0].challenges[0].dns_value
      domain = yandex_cm_certificate.frontend[0].challenges[0].domain
    },
    null
  )
  description = "Если certificate_id не задан: DNS-задание (CNAME) для валидации сертификата в reg.ru."
}
