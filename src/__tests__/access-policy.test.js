import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_SCOPES, defaultScopesForPolicy, normalizeSelectedScopes } from "../access-policy.js"

test("defaultScopesForPolicy keeps existing defaults when policy is unavailable", () => {
  assert.deepEqual(defaultScopesForPolicy(null), DEFAULT_SCOPES)
})

test("defaultScopesForPolicy filters defaults to scopes published by Access", () => {
  const policy = {
    scopes: {
      "capture:webpage": {},
      "memory:read_summary": {},
      "experimental:only": {}
    }
  }

  assert.deepEqual(defaultScopesForPolicy(policy), ["capture:webpage", "memory:read_summary"])
})

test("defaultScopesForPolicy falls back to Access scopes when no default is available", () => {
  const policy = {
    scopes: {
      "custom:read": {},
      "custom:write": {}
    }
  }

  assert.deepEqual(defaultScopesForPolicy(policy), ["custom:read", "custom:write"])
})

test("normalizeSelectedScopes removes duplicates and unknown policy scopes", () => {
  const policy = {
    scopes: {
      "capture:webpage": {},
      "memory:write": {}
    }
  }

  assert.deepEqual(
    normalizeSelectedScopes(["capture:webpage", "unknown:scope", "memory:write", "capture:webpage"], policy),
    ["capture:webpage", "memory:write"]
  )
})
