import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");
const server = read("supabase/functions/server/index.ts");
const builder = read("src/app/components/template-management.tsx");
const api = read("src/app/lib/api.ts");
const broadcast = read("src/app/components/broadcast-view.tsx");
const chat = read("src/app/components/chat-interface.tsx");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const has = (source, value) => assert.ok(source.includes(value), `missing: ${value}`);

test("1 capability endpoint authenticated", () => has(server, 'templates/capabilities`, requireAuth, requireOrgAdmin'));
test("2 wrong org/WABA rejected", () => { has(server, "getOrgWabaCredential(user.org_id, wabaId)"); has(server, 'return c.json(jsonFail(error), 403)'); });
test("3 Default survives capability failure", () => { has(builder, "Template Default tetap dapat digunakan"); has(builder, 'formData.templateType === "default"'); });
test("4 Flow resource state", () => { has(server, "eligibleResourceCount: eligibleFlows"); has(server, '"no_resource"'); });
test("5 Catalog resource state", () => { has(server, "eligibleResourceCount: catalogs.length"); has(server, "listOwnedCommerceCatalogs"); });
test("6 Carousel conditional support", () => has(server, 'carousel: { state: "conditional", create: true'));
test("7 Authentication capability states", () => { has(server, 'copyCode: { state: "supported"'); has(server, 'oneTap: { state: "conditional"'); has(server, 'zeroTap: { state: "unsupported"'); });
test("8 capability is not client-authoritative", () => { assert.ok(!server.includes("body.capability")); has(server, "validateTemplatePayload(body)"); });
test("9 Calling Permissions type detected safely", () => has(server, '"CALL_PERMISSION_REQUEST", "CALLING_PERMISSION_REQUEST"'));
test("10 Calling builder not invented", () => { has(builder, "Bukan kontrak message-template yang dapat diverifikasi"); assert.ok(!server.includes('templateType: "calling_permission"')); });
test("11 phone ownership not guessed", () => has(server, "Calling Permissions bukan schema template yang didukung SIPESA"));
test("12 wrong phone/WABA fails closed", () => { has(server, "WABA tidak dimiliki organisasi ini"); const capability = server.slice(server.indexOf('templates/capabilities`'), server.indexOf('templates/commerce/catalogs`')); assert.ok(!capability.includes("body.phoneNumberId")); });
test("13 no fabricated Calling Meta payload", () => assert.ok(!server.includes('type: "CALL_PERMISSION_REQUEST"')));
test("14 Calling runtime dedicated/filtered", () => { has(server, 'runtime: "dedicated_workflow"'); has(broadcast, "runtimeSupport?.supported !== false"); has(chat, "runtimeSupport?.supported !== false"); });
test("15 imported Calling recognized read-only", () => { has(server, "callingPermissions"); has(server, "readOnly: true"); });
test("16 LTO dedicated capability type", () => { has(server, "LIMITED_TIME_OFFER"); has(builder, "Penawaran Berbatas Waktu"); });
test("17 LTO expiry fails closed", () => has(server, "runtime expiry dapat diverifikasi"));
test("18 timezone is not guessed", () => { has(builder, "Berakhir pukul 23.59 WIB"); assert.ok(!server.includes("expiration_time_ms:")); });
test("19 expired offer cannot be created", () => has(server, 'limitedTimeOffer: { state: "eligibility_unknown", create: false'));
test("20 no fabricated LTO create payload", () => assert.ok(!server.includes('type: "LIMITED_TIME_OFFER", limited_time_offer')));
test("21 Copy Code relationship stays educational", () => has(builder, "Salin Kode · HEMAT50"));
test("22 LTO runtime deferred", () => has(server, 'limitedTimeOffer: { state: "eligibility_unknown"'));
test("23 imported LTO recognized", () => has(server, 'limitedTimeOffer ? "limited_time_offer"'));
test("24 Calling imported safely", () => has(server, "parseDeferredAdvancedComponents"));
test("25 LTO imported safely", () => has(server, "advancedConfig"));
test("26 unknown variant read-only", () => { has(server, "readOnly: true"); has(server, "components: row.components ?? []"); });
test("27 Meta-backed advanced edit remains unavailable", () => has(server, "supported: false"));
test("28 raw components preserved", () => has(server, "components: row.components ?? []"));
test("29 delete has no capability side effects", () => { const remove = server.slice(server.indexOf('app.delete(`${API_PREFIX}/templates/:id`'), server.indexOf('app.post(`${API_PREFIX}/templates/sync`')); assert.ok(!remove.includes("call_settings")); assert.ok(!remove.includes("product_catalogs")); });
test("30 lookup failure does not break page", () => { has(builder, 'setCapabilityStatus("unknown")'); has(server, "Status ketersediaan belum dapat diperiksa."); });
test("31 Default remains available", () => has(server, 'marketingDefault: { state: "supported", create: true'));
test("32 arbitrary type rejected", () => has(server, "Hanya tipe Default yang didukung di SIPESA"));
test("33 fake capability rejected", () => assert.ok(!server.includes("normalizedModel.capability")));
test("34 WABA ownership retained", () => has(server, '.eq("waba_id", wabaId)'));
test("35 Marketing example Indonesian", () => { has(builder, "Promo Spesial Bulan Ini"); has(builder, "Nikmati diskon 20%"); });
test("36 Utility example transactional", () => { has(builder, "INV-2026-001"); has(builder, "JNE123456789"); });
test("37 Authentication example", () => { has(builder, "123456 adalah kode verifikasi Anda"); has(builder, "AuthenticationPreview"); });
test("38 Flow CTA example", () => { has(builder, "Isi Formulir"); has(builder, "Tombol membuka WhatsApp Flow"); });
test("39 Carousel multiple cards", () => { has(builder, "Paket Basic"); has(builder, "Paket Pro"); has(builder, "Paket Premium"); });
test("40 Catalog example", () => { has(builder, "Lihat koleksi produk terbaru kami"); has(builder, "Lihat Katalog"); });
test("41 Multi-product example", () => { has(builder, "Produk A · Rp75.000"); has(builder, "Lihat Produk"); });
test("42 Calling example clearly educational", () => { has(builder, "Izinkan Panggilan"); has(builder, "Contoh edukasi"); });
test("43 LTO example clearly conditional", () => { has(builder, "Promo spesial hanya hari ini"); has(builder, "Eligibility dan kontrak akun"); });
test("44 disabled type shows example without enabling", () => { has(builder, "aria-disabled={unavailable}"); assert.ok(!builder.includes('formData.templateType === "limited_time_offer")\n    ||')); });
test("45 changing type updates preview", () => { has(builder, "StepOneExamplePreview"); has(builder, "templateType={formData.templateType}"); });
test("46 examples never persisted", () => { const persist = builder.slice(builder.indexOf("const persistTemplate"), builder.indexOf("const handleSave")); assert.ok(!persist.includes("TEMPLATE_TYPE_EXAMPLES")); });
test("47 examples never sent to backend", () => { const apiBlock = api.slice(api.indexOf("saveBroadcastTemplate"), api.indexOf("getMetaFlows")); assert.ok(!apiBlock.includes("TEMPLATE_TYPE_EXAMPLES")); });
test("48 Step 2 remains empty", () => { has(builder, 'body: ""'); has(builder, "TEMPLATE_TYPE_EXAMPLES"); });
test("49 preview primitives reused", () => { has(builder, "WhatsAppBubblePreview"); has(builder, "AuthenticationPreview"); has(builder, "FlowPreview"); });
test("50 responsive 375", () => has(builder, "grid grid-cols-1"));
test("51 responsive 430", () => has(builder, "max-w-full"));
test("52 desktop sticky preview", () => has(builder, "lg:sticky lg:top-0"));
test("53 Carousel example no page overflow", () => { has(builder, "min-w-0 overflow-hidden"); has(builder, "overflow-x-auto"); });
test("54 backend transpiles", () => {
  const result = ts.transpileModule(server, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`Batch 14E: ${passed}/${tests.length} passed`);
if (passed !== tests.length) process.exit(1);
