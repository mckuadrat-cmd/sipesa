import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");
const server = read("supabase/functions/server/index.ts");
const builder = read("src/app/components/template-management.tsx");
const broadcast = read("src/app/components/broadcast-view.tsx");
const chat = read("src/app/components/chat-interface.tsx");
const api = read("src/app/lib/api.ts");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const has = (source, value) => assert.ok(source.includes(value), `missing: ${value}`);

test("1 Authentication opens dedicated builder", () => has(builder, "Dedicated Authentication Builder"));
test("2 generic fields are outside auth branch", () => { has(builder, ') : formData.category === "authentication" ? ('); has(builder, "Meta menghasilkan isi OTP"); });
test("3 Marketing and Utility default builder remain", () => { has(builder, 'templateType: value === "authentication" ? "authentication_otp" : "default"'); has(server, "function buildTemplateComponentsFromPayload"); });
test("4 valid Copy Code normalized model", () => { has(builder, 'templateType: "authentication_otp"'); has(builder, "otpButtonType: formData.otpButtonType"); });
test("5 Copy Code Meta payload", () => { has(server, '{ type: "OTP", otp_type: otpButtonType.toUpperCase() }'); has(server, 'category: "authentication"'); });
test("6 expiry validation", () => has(server, "Masa berlaku kode wajib 1-90 menit"));
test("7 security recommendation mapping", () => has(server, '{ type: "BODY", add_security_recommendation: securityRecommendation }'));
test("8 One Tap package required", () => has(server, "Android package name tidak valid"));
test("9 One Tap signature required", () => has(server, "App signature hash wajib 11 karakter Base64"));
test("10 invalid Android metadata is rejected server-side", () => { has(server, "/^[A-Za-z][A-Za-z0-9_]*"); has(server, "/^[A-Za-z0-9+/]{11}$/"); });
test("11 One Tap payload", () => { has(server, 'text: "Copy Code"'); has(server, 'autofill_text: "Autofill"'); has(server, "package_name: packageName"); has(server, "signature_hash: signatureHash"); });
test("12 Zero Tap capability is gated", () => { has(builder, "Zero Tap"); has(builder, "value === 'zero_tap'"); });
test("13 Zero Tap rejected server-side", () => has(server, "Zero Tap belum didukung di SIPESA"));
test("14 imported Authentication is detected", () => has(server, "parseAuthenticationComponents(row.components)"));
test("15 supported Authentication is parsed", () => has(server, '["COPY_CODE", "ONE_TAP"].includes(otpType)'));
test("16 unknown Authentication is read-only", () => { has(server, "readOnly: !supported"); has(builder, "!tpl.authenticationConfig?.supported"); });
test("17 Authentication excluded from normal Broadcast", () => { has(server, "Template Authentication memerlukan workflow OTP khusus"); has(broadcast, "template.runtimeSupport?.supported !== false"); });
test("18 Authentication excluded from normal Chat", () => has(chat, "template.runtimeSupport?.supported !== false"));
test("19 dedicated workflow requirement surfaced", () => has(builder, "Memerlukan workflow OTP khusus"));
test("20 wrong WABA remains rejected", () => has(server, "Template dan nomor pengirim berasal dari WABA berbeda"));
test("21 client generic components are not authoritative", () => { has(server, "validateAuthenticationTemplatePayload(body)"); assert.ok(!server.includes("components: body.components")); });
test("22 unknown Authentication type rejected", () => has(server, "Tipe Authentication tidak didukung"));
test("23 lifecycle remains normalized", () => has(server, "normalizeTemplateStatus(row.status)"));
test("24 rejection reason remains available", () => has(server, "normalizeMetaRejectionReason(row.rejection_reason)"));
test("25 Authentication-specific preview", () => { has(builder, "function AuthenticationPreview"); has(builder, "adalah kode verifikasi Anda"); });
test("26 responsive 375", () => has(builder, "grid grid-cols-1 gap-3 sm:grid-cols-3"));
test("27 responsive 430", () => has(builder, "grid grid-cols-1 gap-4 sm:grid-cols-2"));
test("28 responsive desktop", () => has(builder, "xl:grid-cols-[1.25fr_0.75fr]"));
test("29 Meta-backed Authentication edits fail closed", () => has(server, "Template Authentication yang sudah dikirim ke Meta bersifat read-only di SIPESA"));
test("30 template identity and WABA ownership remain", () => { has(server, '.eq("org_id", user.org_id)'); has(server, '.eq("waba_id", wabaId)'); });
test("31 access token remains in Authorization header", () => has(server, "Authorization: `Bearer ${accessToken}`"));
test("32 API exposes parsed Authentication config", () => has(api, "authenticationConfig?:"));
test("33 backend TypeScript transpiles", () => {
  const result = ts.transpileModule(server, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`Batch 14A: ${passed}/${tests.length} passed`);
if (passed !== tests.length) process.exit(1);
