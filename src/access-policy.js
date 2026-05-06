export const DEFAULT_SCOPES = [
  "capture:webpage",
  "schema:write",
  "graph:write",
  "memory:write",
  "memory:read_summary"
]

export function availablePolicyScopes(policy) {
  return Object.keys(policy?.scopes || {})
}

export function defaultScopesForPolicy(policy) {
  const availableScopes = availablePolicyScopes(policy)
  if (!availableScopes.length) return DEFAULT_SCOPES

  const policyDefaults = DEFAULT_SCOPES.filter((scope) => availableScopes.includes(scope))
  return policyDefaults.length ? policyDefaults : availableScopes
}

export function normalizeSelectedScopes(scopes, policy) {
  const selectedScopes = Array.isArray(scopes) ? scopes : []
  const dedupedScopes = [...new Set(selectedScopes)]
  const availableScopes = availablePolicyScopes(policy)
  if (!availableScopes.length) return dedupedScopes

  return dedupedScopes.filter((scope) => availableScopes.includes(scope))
}
