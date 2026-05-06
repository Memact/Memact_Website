import assert from "node:assert/strict"
import test from "node:test"
import { hasDuplicateAppName, normalizeAppName } from "../app-name.js"

test("normalizeAppName creates comparable app slugs", () => {
  assert.equal(normalizeAppName("  Personal   Capture Layer  "), "personal-capture-layer")
  assert.equal(normalizeAppName("Personal!! Capture—Layer"), "personal-capture-layer")
  assert.equal(normalizeAppName("---My   App---"), "my-app")
  assert.equal(normalizeAppName("Research/Capture_v2"), "research-capture-v2")
})

test("hasDuplicateAppName matches names and backend slugs", () => {
  const apps = [
    { name: "Personal Capture Layer" },
    { name: "Shown Name", slug: "work-capture" }
  ]

  assert.equal(hasDuplicateAppName(apps, " personal capture layer "), true)
  assert.equal(hasDuplicateAppName(apps, "Work Capture"), true)
  assert.equal(hasDuplicateAppName(apps, "Travel Capture"), false)
})

test("hasDuplicateAppName treats punctuation-only separators like spaces", () => {
  const apps = [{ name: "Research Capture v2" }]

  assert.equal(hasDuplicateAppName(apps, "research/capture_v2"), true)
})

test("hasDuplicateAppName ignores empty normalized names", () => {
  assert.equal(hasDuplicateAppName([{ name: "" }], " !!! "), false)
})
