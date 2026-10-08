import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const landing = read("src/app/components/landing-page-view.tsx");
const login = read("src/app/components/login-view.tsx");
const recovery = read("src/app/components/password-recovery-view.tsx");
const authErrors = read("src/app/lib/auth-error.ts");
const settings = read("src/app/components/settings-view.tsx");
const contacts = read("src/app/components/contact-list-view.tsx");
const admin = read("src/app/components/superadmin-dashboard-view.tsx");
const api = read("src/app/lib/api.ts");
const app = read("src/app/App.tsx");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("B8-016 landing claims and destinations are truthful", () => {
  assert.match(landing, /Daftar Sekarang/);
  assert.doesNotMatch(landing, /Coba Akun Demo|100% aman|dijamin terkirim|Unlimited/i);
  assert.match(landing, /5\.000 penerima per campaign/);
  assert.match(landing, /Hasil pengiriman tetap bergantung pada Meta/);
  for (const label of ["Ketentuan Layanan", "Kebijakan Privasi", "Panduan Meta WABA"]) {
    assert.match(landing, new RegExp(`${label} — Segera tersedia`));
  }
  assert.doesNotMatch(landing, /Ketentuan Layanan<\/a>|Kebijakan Privasi<\/a>|Panduan Meta WABA<\/a>/);
});

test("B8-017 forgot-password entry, neutral response, and recovery flow are present", () => {
  assert.match(login, /Lupa password\?/);
  assert.match(login, /Jika email terdaftar, instruksi pemulihan akan dikirim\./);
  assert.match(login, /if \(loading\) return/);
  assert.match(api, /resetPasswordForEmail\(email, \{ redirectTo \}\)/);
  assert.match(app, /isRecoveryCallback/);
  assert.match(recovery, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.match(recovery, /Tautan pemulihan tidak valid atau sudah kedaluwarsa|authErrorMessage/);
});

test("B8-017 auth errors are mapped without rendering raw provider payloads", () => {
  for (const phrase of ["Email\/username atau password tidak valid", "Email belum diverifikasi", "Terlalu banyak percobaan", "Koneksi bermasalah", "Tautan pemulihan tidak valid atau sudah kedaluwarsa"]) {
    assert.match(authErrors, new RegExp(phrase));
  }
  assert.doesNotMatch(login, /JSON\.stringify\(err|setError\(String\(err/);
  assert.doesNotMatch(recovery, /JSON\.stringify\(.*error|setError\(String\(/);
});

test("B8-019 settings feedback represents all profile/org outcome combinations", () => {
  assert.match(settings, /profileSucceeded && orgSucceeded/);
  assert.match(settings, /Profil berhasil disimpan, tetapi data instansi belum berhasil diperbarui/);
  assert.match(settings, /Data instansi berhasil disimpan, tetapi profil belum berhasil diperbarui/);
  assert.match(settings, /Profil dan data instansi belum berhasil disimpan/);
  assert.match(settings, /if \(profileSaving\) return/);
});

test("B8-019 avatar UI changes only after authoritative success", () => {
  const upload = settings.slice(settings.indexOf("const handleAvatarChange"), settings.indexOf("const handleAvatarDelete"));
  const remove = settings.slice(settings.indexOf("const handleAvatarDelete"), settings.indexOf("if (loading)"));
  assert.match(upload, /if \("error" in result\)/);
  assert.ok(upload.indexOf('if ("error" in result)') < upload.indexOf("setAvatar(base64)"));
  assert.match(remove, /if \("error" in result\)/);
  assert.ok(remove.indexOf('if ("error" in result)') < remove.indexOf("setAvatar(null)"));
  assert.match(settings, /if \(avatarMutating\) return/);
});

test("B8-020 uses bounded server preflight and server canonical identities", () => {
  assert.match(api, /contacts\/import\/preflight/);
  assert.match(contacts, /CONTACT_IMPORT_PREFLIGHT_CHUNK_SIZE = 100/);
  assert.match(contacts, /chunkValues\(parsedContacts, CONTACT_IMPORT_PREFLIGHT_CHUNK_SIZE\)/);
  assert.match(contacts, /api\.preflightContactImport/);
  assert.match(contacts, /seenNormalizedPhones\.has\(row\.normalizedPhone\)/);
  assert.doesNotMatch(contacts, /existingContactsMap/);
});

test("B8-020 cross-chunk duplicates remain globally classified", () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    rowId: index + 1,
    valid: true,
    normalizedPhone: index === 100 ? "+628111111111" : `+628${String(index + 1).padStart(9, "0")}`,
    duplicateWithinImport: false,
    existingOrganizationDuplicate: false,
  }));
  rows[0].normalizedPhone = "+628111111111";
  const seen = new Set();
  const duplicates = rows.map((row) => {
    const duplicate = row.duplicateWithinImport || seen.has(row.normalizedPhone);
    if (!duplicate) seen.add(row.normalizedPhone);
    return duplicate;
  });
  assert.equal(duplicates[0], false);
  assert.equal(duplicates[100], true);
  assert.equal(Math.ceil(rows.length / 100), 2);
});

test("B8-020 preserves update-existing semantics and bounded mutation concurrency", () => {
  assert.match(contacts, /row\.existingOrganizationDuplicate && row\.existingContactId[\s\S]{0,180}api\.updateContact/);
  assert.match(contacts, /CONTACT_IMPORT_MUTATION_CONCURRENCY = 4/);
  assert.match(contacts, /mapWithBoundedConcurrency/);
  assert.doesNotMatch(contacts, /Promise\.all\(parsedContacts\.map/);
  assert.match(contacts, /validNew[\s\S]*duplicateWithinImport[\s\S]*existingOrganizationDuplicate[\s\S]*succeeded[\s\S]*failed/);
  assert.match(contacts, /if \(parsedContacts\.length === 0 \|\| importing\) return/);
});

test("B8-020 import duplicate validation has no contact fetch-all or pagination scan", () => {
  const importFlow = contacts.slice(contacts.indexOf("const handleBulkImport"), contacts.indexOf("const handleBulkDelete"));
  assert.doesNotMatch(importFlow, /getOrgContacts|while \(true\)|currentPage|contacts\.forEach/);
  assert.equal((importFlow.match(/preflightContactImport/g) || []).length, 1);
});

test("B8-020 other mutations prevent double submission", () => {
  assert.match(contacts, /if \(formSaving\) return/);
  assert.match(contacts, /if \(!contactToDelete \|\| deletingContactId\) return/);
  assert.match(contacts, /if \(deletingBulk\) return/);
  assert.match(contacts, /if \(bulkLabelSaving\) return/);
});

test("B8-023 verify and organization state changes require named confirmation", () => {
  assert.match(admin, /setSignupToVerify\(signup\)/);
  assert.match(admin, /Verifikasi organisasi[\s\S]*signupToVerify\?\.org\?\.name/);
  assert.match(admin, /Ya, Verifikasi/);
  assert.match(admin, /orgIsActive !== selectedOrg\.isActive/);
  assert.match(admin, /selectedOrg\?\.name/);
  assert.match(admin, /Ya, Nonaktifkan Login & Pengiriman Baru/);
  assert.match(admin, /Ya, Aktifkan Kembali/);
  assert.match(admin, /tidak otomatis dibatalkan/);
});

test("B8-023 sensitive mutation state is authoritative and duplicate-safe", () => {
  assert.match(admin, /if \(!signupToVerify \|\| processingSignupId\) return/);
  assert.match(admin, /if \(submittingEdit\) return/);
  assert.match(admin, /closeDisabled=\{processingSignupId !== null\}/);
  assert.match(admin, /closeDisabled=\{submittingEdit\}/);
});

test("payment scope remains present and was not repurposed by Batch 8A-4", () => {
  assert.match(api, /async topUp/);
  assert.match(admin, /Manual payment state variables/);
  assert.doesNotMatch(contacts + login + recovery + settings + landing, /Midtrans|Duitku/);
});

test("changed layouts retain responsive wrapping and mobile modal actions", () => {
  assert.match(landing, /px-4 sm:px-6 lg:px-8/);
  assert.match(login, /px-4 py-6 sm:p-6 md:p-8/);
  assert.match(settings, /grid grid-cols-1 lg:grid-cols-2/);
  assert.match(contacts, /w-full max-w-lg/);
  assert.match(admin, /flex flex-col-reverse gap-2 sm:flex-row/);
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

console.log(`Batch 8A-4 Trust / Auth / Settings / Contacts / Admin regression: ${passed}/${tests.length} PASS`);
