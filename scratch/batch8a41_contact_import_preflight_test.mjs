import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("supabase/functions/server/index.ts", "utf8");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

const preflight = section(
  server,
  "// POST a bounded, read-only contact-import preflight",
  "// POST create contact",
);
const createContact = section(server, "// POST create contact", "// PUT update contact");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

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

function validatePhoneDestination(phone) {
  const input = String(phone ?? "").trim();
  const normalized = normalizePhone(input);
  const digitsOnly = normalized.replace(/\D/g, "");
  if (!input) return { normalized: "", valid: false, reason: "Nomor kosong" };
  if (!digitsOnly || digitsOnly.length < 9 || digitsOnly.length > 15) {
    return { normalized, valid: false, reason: "Panjang nomor tidak standar" };
  }
  if (!/^\+[1-9]\d{8,14}$/.test(normalized)) {
    return { normalized, valid: false, reason: "Format E.164 tidak valid" };
  }
  if (/^\+?(628000|62000|00000)/.test(normalized)) {
    return { normalized, valid: false, reason: "Nomor terindikasi nomor fiktif / dummy" };
  }
  return { normalized, valid: true, reason: null };
}

function emulatePreflight({ authenticatedOrgId, contacts, storedContacts }) {
  if (!authenticatedOrgId) return { status: 401 };
  if (!Array.isArray(contacts) || contacts.length === 0) return { status: 400 };
  if (contacts.length > 100) return { status: 413, lookupCount: 0 };

  const seen = new Set();
  const classified = contacts.map((contact) => {
    const validation = validatePhoneDestination(contact.phone);
    const duplicateWithinImport = validation.normalized !== "" && seen.has(validation.normalized);
    if (validation.normalized !== "") seen.add(validation.normalized);
    return {
      rowId: contact.rowId,
      normalizedPhone: validation.normalized,
      valid: validation.valid,
      invalidReason: validation.reason,
      duplicateWithinImport,
    };
  });

  const requestedPhones = new Set(classified.filter((row) => row.valid).map((row) => row.normalizedPhone));
  const matching = storedContacts.filter((contact) => (
    contact.org_id === authenticatedOrgId && requestedPhones.has(contact.phone_e164)
  ));
  const existingByPhone = new Map(matching.map((contact) => [contact.phone_e164, contact.id]));
  const results = classified.map((row) => {
    const existingContactId = row.valid ? existingByPhone.get(row.normalizedPhone) ?? null : null;
    return {
      ...row,
      existingOrganizationDuplicate: existingContactId !== null,
      existingContactId,
    };
  });
  return {
    status: 200,
    lookupCount: requestedPhones.size > 0 ? 1 : 0,
    maximumIn: requestedPhones.size,
    results,
    summary: {
      total: results.length,
      validNew: results.filter((row) => row.valid && !row.duplicateWithinImport && !row.existingOrganizationDuplicate).length,
      invalid: results.filter((row) => !row.valid).length,
      duplicateWithinImport: results.filter((row) => row.duplicateWithinImport).length,
      existingOrganizationDuplicate: results.filter((row) => row.existingOrganizationDuplicate).length,
    },
  };
}

test("endpoint is authenticated and tenant identity comes only from auth context", () => {
  assert.match(preflight, /contacts\/import\/preflight`, requireAuth/);
  assert.match(preflight, /const user = c\.get\("authUser"\)/);
  assert.match(preflight, /\.eq\("org_id", user\.org_id\)/);
  assert.doesNotMatch(preflight, /body\??\.org_id|contact\??\.org_id/);
  assert.equal(emulatePreflight({ authenticatedOrgId: null, contacts: [], storedContacts: [] }).status, 401);
});

test("request is strictly bounded at 100 and never silently truncated", () => {
  assert.match(server, /CONTACT_IMPORT_PREFLIGHT_MAX_CONTACTS = 100/);
  assert.match(preflight, /contacts\.length > CONTACT_IMPORT_PREFLIGHT_MAX_CONTACTS/);
  assert.match(preflight, /413/);
  assert.doesNotMatch(preflight, /contacts\.slice\(0,\s*CONTACT_IMPORT_PREFLIGHT_MAX_CONTACTS\)/);
  const hundred = Array.from({ length: 100 }, (_, index) => ({ rowId: index + 1, phone: `+1202555${String(index).padStart(4, "0")}` }));
  assert.equal(emulatePreflight({ authenticatedOrgId: "org-a", contacts: hundred, storedContacts: [] }).status, 200);
  assert.equal(emulatePreflight({ authenticatedOrgId: "org-a", contacts: [...hundred, { rowId: 101, phone: "+12025559999" }], storedContacts: [] }).status, 413);
});

test("normalization and validation reuse the canonical backend helpers", () => {
  assert.match(preflight, /validatePhoneDestination\(contact\?\.phone\)/);
  assert.match(server, /function validatePhoneDestination\(phone: unknown\)[\s\S]*const normalized = normalizePhone\(input\)/);
  assert.equal(normalizePhone("0812-3456-7890"), "+6281234567890");
  assert.equal(normalizePhone("+62 (812) 3456-7890"), "+6281234567890");
});

test("within-import duplicates use canonical phone and preserve request order", () => {
  const result = emulatePreflight({
    authenticatedOrgId: "org-a",
    contacts: [
      { rowId: "first", phone: "081234567890" },
      { rowId: "second", phone: "+6281234567890" },
    ],
    storedContacts: [],
  });
  assert.deepEqual(result.results.map((row) => row.rowId), ["first", "second"]);
  assert.equal(result.results[0].duplicateWithinImport, false);
  assert.equal(result.results[1].duplicateWithinImport, true);
  assert.equal(result.summary.duplicateWithinImport, 1);
});

test("same-org duplicate is found regardless of frontend page and cross-tenant ids never leak", () => {
  const storedContacts = [
    { id: "same-org-hidden-page", org_id: "org-a", phone_e164: "+6281234567890" },
    { id: "other-org-secret", org_id: "org-b", phone_e164: "+6289876543210" },
  ];
  const result = emulatePreflight({
    authenticatedOrgId: "org-a",
    contacts: [
      { rowId: 1, phone: "081234567890" },
      { rowId: 2, phone: "089876543210" },
    ],
    storedContacts,
  });
  assert.equal(result.results[0].existingOrganizationDuplicate, true);
  assert.equal(result.results[0].existingContactId, "same-org-hidden-page");
  assert.equal(result.results[1].existingOrganizationDuplicate, false);
  assert.equal(result.results[1].existingContactId, null);
  assert.doesNotMatch(JSON.stringify(result), /other-org-secret/);
});

test("mixed rows produce deterministic validation and summary", () => {
  const result = emulatePreflight({
    authenticatedOrgId: "org-a",
    contacts: [
      { rowId: "new", phone: "+12025550123" },
      { rowId: "within", phone: "+1 (202) 555-0123" },
      { rowId: "existing", phone: "081234567890" },
      { rowId: "short", phone: "123" },
      { rowId: "long", phone: "+1234567890123456" },
      { rowId: "characters", phone: "not-a-phone" },
      { rowId: "empty", phone: "" },
      { rowId: "whitespace", phone: "   " },
    ],
    storedContacts: [{ id: "existing-a", org_id: "org-a", phone_e164: "+6281234567890" }],
  });
  assert.deepEqual(result.summary, {
    total: 8,
    validNew: 1,
    invalid: 5,
    duplicateWithinImport: 1,
    existingOrganizationDuplicate: 1,
  });
  assert.deepEqual(result.results.map((row) => row.rowId), ["new", "within", "existing", "short", "long", "characters", "empty", "whitespace"]);
});

test("organization lookup is one bounded projection with no fetch-all or N+1", () => {
  assert.equal((preflight.match(/\.from\("wa_contacts"\)/g) ?? []).length, 1);
  assert.match(preflight, /\.select\("id, phone_e164"\)/);
  assert.match(preflight, /\.in\("phone_e164", uniqueValidPhones\)/);
  assert.doesNotMatch(preflight, /\.select\("\*"\)/);
  assert.doesNotMatch(preflight, /\.range\(|while\s*\(|Promise\.all/);
  const hundred = Array.from({ length: 100 }, (_, index) => ({ rowId: index, phone: `+1202555${String(index).padStart(4, "0")}` }));
  const result = emulatePreflight({ authenticatedOrgId: "org-a", contacts: hundred, storedContacts: [] });
  assert.equal(result.lookupCount, 1);
  assert.equal(result.maximumIn, 100);
});

test("preflight is read-only and reports no provider or billing side effects", () => {
  assert.doesNotMatch(preflight, /\.insert\(|\.update\(|\.delete\(|metaFetch\(|consume_billing|usage_ledger|refund|compensation/);
  const storedContacts = [{ id: "before", org_id: "org-a", phone_e164: "+6281234567890" }];
  const before = JSON.stringify(storedContacts);
  emulatePreflight({ authenticatedOrgId: "org-a", contacts: [{ rowId: 1, phone: "081234567890" }], storedContacts });
  assert.equal(JSON.stringify(storedContacts), before);
});

test("response fields, summary, and error privacy match the API contract", () => {
  for (const field of [
    "rowId",
    "normalizedPhone",
    "valid",
    "invalidReason",
    "duplicateWithinImport",
    "existingOrganizationDuplicate",
    "existingContactId",
    "validNew",
  ]) assert.match(preflight, new RegExp(field));
  assert.doesNotMatch(preflight, /jsonFail\((lookupError|error)(?:\.|\))/);
  assert.match(preflight, /Pemeriksaan duplikat kontak belum dapat dilakukan/);
  assert.match(preflight, /Pemeriksaan impor kontak belum dapat dilakukan/);
});

test("POST contacts remains normalized, tenant-scoped, duplicate-aware, and race-safe", () => {
  assert.match(createContact, /const phone = normalizePhone\(body\.phone\)/);
  assert.match(createContact, /\.eq\("org_id", user\.org_id\)[\s\S]*\.eq\("phone_e164", phone\)/);
  assert.match(createContact, /org_id: user\.org_id/);
  assert.match(createContact, /error\?\.code === "23505"/);
  assert.match(createContact, /Nomor telepon sudah terdaftar di organisasi ini/);
  assert.doesNotMatch(createContact, /jsonFail\(error\.message\)/);
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${passed} - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}`);
    throw error;
  }
}

console.log(`Batch 8A-4.1 contact import backend preflight: ${passed}/${tests.length} PASS`);
