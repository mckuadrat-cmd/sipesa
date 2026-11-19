import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSenderReadiness,
  evaluateTemplateMetadataPolicy,
  inspectMediaReference,
  isMetaTemplateSendableStatus,
} from "../supabase/functions/server/preflight-utils.ts";

test("sender readiness requires tenant-owned configuration fields without exposing credentials", () => {
  const issues = evaluateSenderReadiness({ is_active: true, phone_number_id: "", access_token: "", waba_id: "" });
  assert.deepEqual(issues.map((issue) => issue.code), ["PHONE_NUMBER_ID_MISSING", "ACCESS_TOKEN_MISSING", "WABA_MISSING"]);
  assert.ok(issues.every((issue) => !issue.message.includes("secret")));
  assert.equal(evaluateSenderReadiness({ is_active: true, phone_number_id: "phone", access_token: "token", waba_id: "waba" }).length, 0);
});

test("media preflight blocks insecure and private destinations without fetching them", () => {
  assert.ok(inspectMediaReference("http://example.com/file.pdf").blockers.length > 0);
  assert.ok(inspectMediaReference("https://127.0.0.1/file.pdf").blockers.length > 0);
  assert.ok(inspectMediaReference("https://169.254.169.254/latest/meta-data").blockers.length > 0);
  assert.equal(inspectMediaReference("https://cdn.example.com/file.pdf").reachabilityWarning, true);
  assert.ok(inspectMediaReference("https://user:pass@cdn.example.com/file.pdf").blockers.length > 0);
  assert.ok(inspectMediaReference("https://[::1]/file.pdf").blockers.length > 0);
  assert.ok(inspectMediaReference("not a url").blockers.length > 0);
  assert.deepEqual(inspectMediaReference("meta-media-id"), { blockers: [], reachabilityWarning: false });
});

test("approved templates remain eligible when their trusted Meta snapshot is 7, 30, or 90 days old", () => {
  const now = Date.UTC(2026, 10, 19, 0, 0, 0);
  for (const ageDays of [7, 30, 90]) {
    const policy = evaluateTemplateMetadataPolicy({
      meta_template_id: "meta-template-1",
      category_source: "meta",
      synced_at: new Date(now - ageDays * 24 * 60 * 60 * 1000).toISOString(),
      status: "approved",
      category: "utility",
    }, now);
    assert.equal(policy.blockers.length, 0, `${ageDays} day template must not be blocked by age`);
    assert.equal(policy.shouldRefresh, true);
    assert.deepEqual(policy.warnings.map((issue) => issue.code), ["TEMPLATE_LATEST_STATUS_UNVERIFIED"]);
    assert.equal(isMetaTemplateSendableStatus("APPROVED"), true);
  }
});

test("unverified template metadata remains a blocker regardless of local status", () => {
  const neverSynced = evaluateTemplateMetadataPolicy({
    meta_template_id: "meta-template-1",
    category_source: "unknown",
    synced_at: null,
    status: "approved",
  });
  assert.ok(neverSynced.blockers.some((issue) => issue.code === "TEMPLATE_CATEGORY_NEEDS_SYNC"));
  assert.ok(neverSynced.blockers.some((issue) => issue.code === "TEMPLATE_METADATA_UNVERIFIED"));
});

test("paused, disabled, and deleted Meta lifecycle states remain non-sendable", () => {
  for (const status of ["PAUSED", "DISABLED", "DELETED"]) {
    assert.equal(isMetaTemplateSendableStatus(status), false);
  }
});
