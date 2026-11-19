import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOfficialTemplateCategory, normalizeTemplateCategorySource } from "../src/app/lib/template-category.ts";

test("accepts only official Meta template categories", () => {
  assert.equal(normalizeOfficialTemplateCategory("MARKETING"), "marketing");
  assert.equal(normalizeOfficialTemplateCategory("UTILITY"), "utility");
  assert.equal(normalizeOfficialTemplateCategory("AUTHENTICATION"), "authentication");
  assert.equal(normalizeOfficialTemplateCategory("finance"), null);
  assert.equal(normalizeOfficialTemplateCategory(undefined), null);
});

test("does not silently label unresolved Meta category as marketing", () => {
  assert.equal(normalizeTemplateCategorySource(undefined, true), "unknown");
  assert.equal(normalizeOfficialTemplateCategory(undefined) ?? "unknown", "unknown");
  assert.equal(normalizeTemplateCategorySource(undefined, false), "local");
});
