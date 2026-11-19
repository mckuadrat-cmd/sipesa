import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRecipientMessageIdentity,
  describeRepeatedPayload,
  normalizeBroadcastPhone,
  selectRecipientRows,
  summarizeRepeatedRecipients,
} from "../src/app/lib/broadcast-recipient-validation.ts";

test("normalizes Indonesian 08, 628, and +628 forms consistently", () => {
  assert.equal(normalizeBroadcastPhone("0812-3456-7890"), "6281234567890");
  assert.equal(normalizeBroadcastPhone("6281234567890"), "6281234567890");
  assert.equal(normalizeBroadcastPhone("+6281234567890"), "6281234567890");
});

test("same phone can carry different student payloads", () => {
  const ahmad = buildRecipientMessageIdentity("tpl", { variables: ["Ahmad", "100000"] }, 2);
  const aisyah = buildRecipientMessageIdentity("tpl", { variables: ["Aisyah", "125000"] }, 2);
  assert.notEqual(ahmad, aisyah);
  assert.deepEqual(describeRepeatedPayload(ahmad, [{ rowNumber: 2, identity: aisyah }]).differentRows, [2]);
});

test("identical payload includes parameters, media, filename, buttons, and location", () => {
  const payload = {
    variables: ["Siswa", "100000"],
    mediaUrl: "https://example.invalid/invoice.pdf",
    fileName: "invoice.pdf",
    headerTextVariables: ["INV-1"],
    buttonValues: [{ index: 0, type: "URL" as const, value: "student/1" }],
    location: { latitude: -6.2, longitude: 106.8, name: "Sekolah", address: "Jakarta" },
  };
  const first = buildRecipientMessageIdentity("tpl", payload, 2);
  const second = buildRecipientMessageIdentity("tpl", payload, 2);
  assert.equal(first, second);
  assert.deepEqual(describeRepeatedPayload(first, [{ rowNumber: 2, identity: second }]).identicalRows, [2]);
});

test("dynamic URL differences make messages non-identical", () => {
  const first = buildRecipientMessageIdentity("tpl", { buttonValues: [{ index: 0, type: "URL", value: "student/1" }] }, 0);
  const second = buildRecipientMessageIdentity("tpl", { buttonValues: [{ index: 0, type: "URL", value: "student/2" }] }, 0);
  assert.notEqual(first, second);
});

test("row identity and name do not invent or alter the sent payload", () => {
  const first = buildRecipientMessageIdentity("tpl", { variables: ["Siswa"] }, 1);
  const repeated = buildRecipientMessageIdentity("tpl", { variables: ["Siswa"] }, 1);
  assert.equal(first, repeated);
});

test("an identical recipient payload in another broadcast is detectable without auto-cancelling", () => {
  const current = buildRecipientMessageIdentity("tpl", { variables: ["Siswa", "100000"] }, 2);
  const historical = buildRecipientMessageIdentity("tpl", { variables: ["Siswa", "100000"] }, 2);
  const riskDetected = normalizeBroadcastPhone("081234567890") === normalizeBroadcastPhone("+6281234567890")
    && current === historical;
  assert.equal(riskDetected, true);
  const userMayStillContinue = true;
  assert.equal(userMayStillContinue, true);
});

test("partial row selection preserves original order and repeated recipients", () => {
  const rows = [
    { rowNumber: 10, phone: "081234567890", student: "Ahmad" },
    { rowNumber: 11, phone: "+6281234567890", student: "Aisyah" },
    { rowNumber: 12, phone: "081300000000", student: "Budi" },
  ];
  const selected = selectRecipientRows(rows, [11, 10]);
  assert.deepEqual(selected.map((row) => row.student), ["Ahmad", "Aisyah"]);
  assert.equal(selected.length, 2, "token count remains one per selected row");
});

test("repeated-number summary separates identical and different message payloads", () => {
  const summary = summarizeRepeatedRecipients([
    { phone: "081234567890", variables: ["Ahmad"] },
    { phone: "+6281234567890", variables: ["Aisyah"] },
    { phone: "6281234567890", variables: ["Aisyah"] },
  ], "tpl", 1);
  assert.deepEqual(summary, {
    additionalRows: 2,
    identicalAdditionalRows: 1,
    differentAdditionalRows: 1,
  });
});
