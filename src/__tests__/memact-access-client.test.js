import assert from "node:assert/strict"
import test from "node:test"
import { ACCESS_MODE, ACCESS_URL } from "../memact-access-client.js"

test("access client falls back to legacy http mode without Supabase env vars", () => {
  assert.equal(ACCESS_MODE, "http")
  assert.equal(ACCESS_URL, "http://127.0.0.1:8787")
})
