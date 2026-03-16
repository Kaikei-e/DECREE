env "docker" {
  src = "file://schema.hcl"
  dev = "docker://postgres/17/dev?search_path=public"

  migration {
    dir = "file://migrations"
  }

  url = getenv("ATLAS_DB_URL")
}
