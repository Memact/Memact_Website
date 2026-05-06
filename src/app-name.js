export function normalizeAppName(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/ /g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function hasDuplicateAppName(apps, name) {
  const nextSlug = normalizeAppName(name)
  if (!nextSlug) return false
  return apps.some((app) => normalizeAppName(app.slug || app.name) === nextSlug)
}
