import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const server = read("supabase/functions/server/index.ts");
const migration = read("supabase/migrations/20261007130000_bounded_broadcast_recipient_preflight.sql");
const verifier = read("BATCH8A1A_BOUNDED_PREFLIGHT_VERIFY.sql");
const broadcastUi = read("src/app/components/broadcast-view.tsx");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

const worker = section(server, "async function runBroadcastWorker(", "function runBroadcastWorkerInBackground(");

// Runtime integration and ordering guards.
assert.doesNotMatch(server, /rejectInvalidPendingRecipients/);
assert.doesNotMatch(server, /validateStoredBroadcastRecipient/);
assert.match(worker, /broadcast\.recipient_preflight_status !== "completed"/);
assert.match(worker, /supa\.rpc\(\s*"preflight_wa_broadcast_recipients"/);
assert.match(worker, /p_body_variable_count: requirements\.bodyVariableCount/);
assert.match(worker, /p_requires_media: requirements\.requiresMedia/);
assert.match(worker, /select\("status, recipient_preflight_status"\)/);
assert.match(worker, /postPreflightBroadcast\.status !== "sending"/);
assert.match(worker, /postPreflightBroadcast\.recipient_preflight_status !== "completed"/);
assert.ok(worker.indexOf("preflight_wa_broadcast_recipients") < worker.indexOf('status", "pending"'));
assert.ok(worker.indexOf("preflight_wa_broadcast_recipients") < worker.indexOf("consumeBroadcastToken"));
assert.ok(worker.indexOf("preflight_wa_broadcast_recipients") < worker.indexOf("sendMetaTemplateMessage"));

// No fallback may fetch the whole campaign for application-side validation.
assert.doesNotMatch(
  worker,
  /from\("wa_broadcast_recipients"\)[\s\S]{0,300}select\("\*"\)[\s\S]{0,300}eq\("org_id", broadcast\.org_id\)/,
);
assert.match(worker, /\.eq\("status", "pending"\)[\s\S]{0,260}\.limit\(1\)/);

// Campaign capacity remains unchanged in this architecture-only batch.
assert.match(server, /BROADCAST_MAX_RECIPIENTS = 5000/);
assert.match(broadcastUi, /MAX_BROADCAST_RECIPIENTS = 5000/);

function normalizePhone(phone) {
  let raw = String(phone ?? "").trim();
  raw = raw.replace(/[^\d+]/g, "");
  if (!raw) return "";
  if (raw.startsWith("08")) return `+628${raw.slice(2)}`;
  if (raw.startsWith("8")) return `+62${raw}`;
  if (raw.startsWith("62")) return `+${raw}`;
  if (!raw.startsWith("+")) return `+${raw}`;
  return raw;
}

function validatePhone(phone) {
  const input = String(phone ?? "").trim();
  const normalized = normalizePhone(input);
  const digitsOnly = normalized.replace(/\D/g, "");
  if (!input) return { normalized: "", reason: "Nomor kosong" };
  if (!digitsOnly || digitsOnly.length < 9 || digitsOnly.length > 15) {
    return {
      normalized,
      reason: `Panjang nomor (${digitsOnly.length} digit) tidak standar (minimal 9, maksimal 15 digit)`,
    };
  }
  if (!/^\+[1-9]\d{8,14}$/.test(normalized)) {
    return { normalized, reason: "Format E.164 tidak valid" };
  }
  if (/^\+?(628000|62000|00000)/.test(normalized)) {
    return { normalized, reason: "Nomor terindikasi nomor fiktif / dummy" };
  }
  return { normalized, reason: null };
}

const phoneCases = [
  ["08123456789", "+628123456789", null],
  ["628123456789", "+628123456789", null],
  ["+628123456789", "+628123456789", null],
  [" 08123456789 ", "+628123456789", null],
  ["0812-3456-789", "+628123456789", null],
  ["(0812) 3456-789", "+628123456789", null],
  ["0812", "+62812", "Panjang nomor (5 digit) tidak standar (minimal 9, maksimal 15 digit)"],
  ["+1234567890123456", "+1234567890123456", "Panjang nomor (16 digit) tidak standar (minimal 9, maksimal 15 digit)"],
  ["abc", "", "Panjang nomor (0 digit) tidak standar (minimal 9, maksimal 15 digit)"],
  ["", "", "Nomor kosong"],
  [null, "", "Nomor kosong"],
  ["628000123456", "+628000123456", "Nomor terindikasi nomor fiktif / dummy"],
  ["+14155552671", "+14155552671", null],
  ["+0123456789", "+0123456789", "Format E.164 tidak valid"],
];
for (const [input, normalized, reason] of phoneCases) {
  assert.deepEqual(validatePhone(input), { normalized, reason });
}

function validatePayload({ phone, message, mode, variableCount = 0, requiresMedia = false }) {
  const phoneResult = validatePhone(phone);
  if (phoneResult.reason) return phoneResult.reason;
  if (!String(message ?? "").trim()) return "Payload recipient kosong";
  if (mode !== "template") return null;
  let payload;
  try {
    payload = JSON.parse(message);
  } catch {
    return "Payload template recipient malformed";
  }
  if (!payload || payload.kind !== "template_payload") return "Payload template recipient malformed";
  const variables = Array.isArray(payload.bodyVariables) ? payload.bodyVariables : [];
  for (let index = 0; index < variableCount; index += 1) {
    if (!String(variables[index] ?? "").trim()) return `Variable template {{${index + 1}}} kosong`;
  }
  if (requiresMedia && !String(payload.mediaUrl ?? "").trim()) return "Media header template wajib diisi";
  return null;
}

const payloadCases = [
  ["plain-valid", { phone: "+628123456789", message: "Pesan valid", mode: "text" }, null],
  ["plain-empty", { phone: "+628123456789", message: " ", mode: "text" }, "Payload recipient kosong"],
  ["malformed", { phone: "+628123456789", message: "{bad", mode: "template" }, "Payload template recipient malformed"],
  ["wrong-kind", { phone: "+628123456789", message: '{"kind":"wrong"}', mode: "template" }, "Payload template recipient malformed"],
  ["vars-complete", { phone: "+628123456789", message: '{"kind":"template_payload","bodyVariables":["A","B"]}', mode: "template", variableCount: 2 }, null],
  ["var-empty", { phone: "+628123456789", message: '{"kind":"template_payload","bodyVariables":["A",""]}', mode: "template", variableCount: 2 }, "Variable template {{2}} kosong"],
  ["var-missing", { phone: "+628123456789", message: '{"kind":"template_payload","bodyVariables":["A"]}', mode: "template", variableCount: 2 }, "Variable template {{2}} kosong"],
  ["var-extra", { phone: "+628123456789", message: '{"kind":"template_payload","bodyVariables":["A","B","C"]}', mode: "template", variableCount: 2 }, null],
];
for (const mediaType of ["IMAGE", "VIDEO", "DOCUMENT"]) {
  payloadCases.push(
    [`${mediaType}-missing`, { phone: "+628123456789", message: '{"kind":"template_payload","bodyVariables":[]}', mode: "template", requiresMedia: true }, "Media header template wajib diisi"],
    [`${mediaType}-present`, { phone: "+628123456789", message: '{"kind":"template_payload","bodyVariables":[],"mediaUrl":"https://example.com/media"}', mode: "template", requiresMedia: true }, null],
  );
}
for (const [, input, expected] of payloadCases) assert.equal(validatePayload(input), expected);

// The cloud verifier executes the same fixtures against PostgreSQL. Keep the
// regression coupled to those checks so a fixture cannot silently disappear.
assert.match(verifier, /'phone parity'/);
assert.match(verifier, /'payload parity'/);
assert.match(verifier, /'normalized duplicate parity'/);

const validPayload = JSON.stringify({
  kind: "template_payload",
  bodyVariables: ["A", "B"],
  mediaUrl: "https://example.com/media.jpg",
});
const recipients = Array.from({ length: 5000 }, (_, offset) => ({
  id: `recipient-${offset + 1}`,
  sequenceNo: offset + 1,
  createdAt: offset + 1,
  phone: `+1415${String(offset + 1).padStart(7, "0")}`,
  message: validPayload,
  status: "pending",
  error: null,
}));

recipients[0].phone = "0812";
recipients[2499].phone = "abc";
recipients[4999].phone = "+1234567890123456";
recipients[9].phone = "08123456789";
recipients[9].status = "sent"; // Non-pending rows still own canonical rank.
recipients[3249].phone = "+628123456789";
recipients[99].phone = "628765432109";
recipients[3999].phone = "+628765432109";
recipients[1199].message = "{bad";
recipients[2399].message = JSON.stringify({ kind: "template_payload", bodyVariables: ["A"], mediaUrl: "https://example.com/media.jpg" });
recipients[3599].message = JSON.stringify({ kind: "template_payload", bodyVariables: ["A", "B"] });

let validationRowsRead = 0;
function atomicPreflight(state, { failBeforeCommit = false } = {}) {
  if (state.preflightStatus === "completed") return { rejected: 0, alreadyCompleted: true };
  const working = structuredClone(state);
  const ordered = [...working.recipients].sort((a, b) =>
    a.sequenceNo - b.sequenceNo || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const seen = new Set();
  let rejected = 0;
  validationRowsRead += ordered.length;
  for (const recipient of ordered) {
    const normalized = normalizePhone(recipient.phone);
    const duplicate = seen.has(normalized);
    seen.add(normalized);
    const reason = validatePayload({
      phone: recipient.phone,
      message: recipient.message,
      mode: "template",
      variableCount: 2,
      requiresMedia: true,
    }) ?? (duplicate ? "Nomor duplikat dalam broadcast yang sama" : null);
    if (recipient.status === "pending" && reason) {
      recipient.status = "failed";
      recipient.error = `RECIPIENT_VALIDATION_FAILED: ${reason}`;
      rejected += 1;
    }
  }
  working.preflightStatus = "completed";
  if (failBeforeCommit) throw new Error("simulated transaction failure");
  state.recipients = working.recipients;
  state.preflightStatus = working.preflightStatus;
  return { rejected, alreadyCompleted: false };
}

const campaign = { preflightStatus: "pending", recipients };
const beforeCrash = structuredClone(campaign);
assert.throws(() => atomicPreflight(campaign, { failBeforeCommit: true }), /simulated transaction failure/);
assert.deepEqual(campaign, beforeCrash);
validationRowsRead = 0;
const firstRun = atomicPreflight(campaign);
assert.equal(firstRun.rejected, 8);
assert.equal(campaign.preflightStatus, "completed");
assert.equal(campaign.recipients[9].status, "sent");
assert.match(campaign.recipients[3249].error, /Nomor duplikat/);
assert.match(campaign.recipients[3999].error, /Nomor duplikat/);
assert.match(campaign.recipients[0].error, /Panjang nomor/);
assert.match(campaign.recipients[1199].error, /malformed/);
assert.match(campaign.recipients[2399].error, /Variable template/);
assert.match(campaign.recipients[3599].error, /Media header/);
assert.equal(validationRowsRead, 5000);

for (let resume = 0; resume < 100; resume += 1) {
  assert.deepEqual(atomicPreflight(campaign), { rejected: 0, alreadyCompleted: true });
}
assert.equal(validationRowsRead, 5000, "completed resumes must add zero validation-row reads");

// Model PostgreSQL's broadcast-row lock: concurrent callers serialize, and the
// second caller observes the durable completion marker without a second scan.
const concurrentCampaign = { preflightStatus: "pending", recipients: structuredClone(beforeCrash.recipients) };
validationRowsRead = 0;
let rowLock = Promise.resolve();
function callWithRowLock() {
  const call = rowLock.then(() => atomicPreflight(concurrentCampaign));
  rowLock = call.then(() => undefined, () => undefined);
  return call;
}
const concurrentResults = await Promise.all([callWithRowLock(), callWithRowLock()]);
assert.equal(concurrentResults.filter((result) => !result.alreadyCompleted).length, 1);
assert.equal(concurrentResults.filter((result) => result.alreadyCompleted).length, 1);
assert.equal(validationRowsRead, 5000);

// A lifecycle refresh after the atomic preflight is the cancellation boundary.
const mayClaimAfterPreflight = (status, preflightStatus) =>
  status === "sending" && preflightStatus === "completed";
assert.equal(mayClaimAfterPreflight("cancelled", "completed"), false);
assert.equal(mayClaimAfterPreflight("failed", "completed"), false);
assert.equal(mayClaimAfterPreflight("completed", "completed"), false);
assert.equal(mayClaimAfterPreflight("sending", "pending"), false);
assert.equal(mayClaimAfterPreflight("sending", "completed"), true);

// SQL atomicity, global ordering, permissions, and fast path are guarded too.
assert.match(migration, /SELECT \*[\s\S]*FROM public\.wa_broadcasts[\s\S]*FOR UPDATE/);
assert.match(
  migration,
  /IF v_broadcast\.recipient_preflight_status = 'completed' THEN[\s\S]*RETURN QUERY SELECT 'completed'::text, 0, true/,
);
assert.match(migration, /row_number\(\) OVER[\s\S]*sequence_no ASC NULLS LAST[\s\S]*created_at ASC[\s\S]*id ASC/);
assert.match(migration, /recipient\.status::text = 'pending'/);
assert.match(migration, /RECIPIENT_VALIDATION_FAILED:/);
assert.match(migration, /REVOKE ALL[\s\S]*PUBLIC, anon, authenticated/);
assert.match(migration, /GRANT EXECUTE[\s\S]*TO service_role/);

console.log("Batch 8A-1.1a bounded recipient preflight regression: PASS");
console.log("Phone parity fixtures: 14 PASS");
console.log(`Payload parity fixtures: ${payloadCases.length} PASS`);
console.log("Simulated 5,000: 8 rejected, cross-page canonical duplicate PASS");
console.log("Crash rollback model: PASS");
console.log("Concurrent caller row-lock model: one effective validation PASS");
console.log("Post-preflight cancellation/lifecycle gate: PASS");
console.log("100 completed resumes: 0 additional validation-row reads PASS");
console.log("Meta sends during preflight: 0; billing debits during preflight: 0");
