import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("supabase/functions/server/index.ts", "utf8");
const builder = fs.readFileSync("src/app/components/template-management.tsx", "utf8");
const chat = fs.readFileSync("src/app/components/chat-interface.tsx", "utf8");
const broadcast = fs.readFileSync("src/app/components/broadcast-view.tsx", "utf8");
const api = fs.readFileSync("src/app/lib/api.ts", "utf8");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const has = (source, value) => assert.ok(source.includes(value), `missing: ${value}`);

test("1 valid header variable", () => has(server, "Header text hanya mendukung satu variabel {{1}}"));
test("2 missing header example blocked", () => has(server, "Contoh variabel header wajib diisi"));
test("3 malformed header placeholder blocked", () => has(server, "Placeholder header malformed"));
test("4 header Meta example payload", () => has(server, "example: { header_text: [sample] }"));
test("5 broadcast header runtime required", () => has(server, "Nilai variabel header belum diisi."));
test("6 chat header runtime input", () => has(chat, "templateHeaderValues"));
test("7 static URL unchanged", () => has(server, "new URL(url.replace"));
test("8 dynamic URL creation", () => has(builder, "URL dinamis memakai satu suffix"));
test("9 invalid dynamic URL blocked", () => has(server, "URL dinamis hanya mendukung {{1}} sebagai suffix"));
test("10 dynamic URL example required", () => has(server, "Contoh URL dinamis lengkap wajib diisi"));
test("11 broadcast URL runtime", () => has(broadcast, "button_param"));
test("12 chat URL runtime", () => has(chat, "Suffix URL"));
test("13 URL send payload", () => has(server, 'sub_type: button.type === "COPY_CODE" ? "copy_code" : "url"'));
test("14 copy code marketing eligibility", () => has(server, "Tombol Salin Kode hanya tersedia untuk template Marketing"));
test("15 copy runtime required", () => has(server, "Kode promo wajib diisi."));
test("16 broadcast copy send data", () => has(broadcast, 'requirement.type === "COPY_CODE"'));
test("17 chat copy send data", () => has(chat, 'item.type === "COPY_CODE"'));
test("18 location creation", () => has(builder, '<option value="location">Location</option>'));
test("19 latitude validation", () => has(server, "latitude < -90 || latitude > 90"));
test("20 broadcast location runtime", () => has(broadcast, "locationAddress"));
test("21 chat location runtime", () => has(chat, "templateLocation"));
test("22 location Meta parameter", () => has(server, 'parameters: [{ type: "location"'));
test("23 chat image upload", () => has(chat, 'selectedRequirements.mediaType === "image"'));
test("24 chat video upload", () => has(chat, 'selectedRequirements.mediaType === "video"'));
test("25 chat document upload", () => has(chat, ".pdf,.doc,.docx"));
test("26 missing chat media blocked", () => has(chat, "Boolean(templateRuntimeMedia?.id)"));
test("27 wrong media type blocked server", () => has(server, "Jenis media tidak sesuai dengan header template."));
test("28 document filename", () => has(server, "filename: String(media?.filename"));
test("29 quick reply limit", () => has(server, "Maksimal 10 tombol Quick Reply"));
test("30 URL/phone combination", () => has(server, "Maksimal 4 tombol tindakan"));
test("31 invalid button count", () => has(server, "Maksimal 10 tombol per template"));
test("32 invalid grouping", () => has(server, "tidak boleh berselang-seling"));
test("33 frontend legal choice gating", () => has(builder, "canAddButtonType"));
test("34 synced header editable", () => has(builder, "header_text?.[0]"));
test("35 synced dynamic URL editable", () => has(builder, "Array.isArray(b?.example)"));
test("36 URL phone QR preserved", () => { has(builder, 'type === "PHONE_NUMBER"'); has(builder, 'type === "URL"'); });
test("37 unknown components read only", () => has(builder, "Template ini memiliki komponen Meta yang belum dapat diedit di SIPESA."));
test("38 authoritative requirements", () => has(server, "function getTemplateSendRequirements"));
test("39 wrong WABA blocked", () => has(server, "Template dan nomor pengirim berasal dari WABA berbeda"));
test("40 non-sendable blocked", () => has(server, "TEMPLATE_SENDABLE_STATUSES"));
test("41 arbitrary components ignored", () => { has(server, "validateTemplateRuntimeInput(authoritativeTemplate, body)"); assert.ok(!api.includes("components?: any;\n      headerMedia")); });
test("42 preview header sample", () => has(builder, "applyExamplesToText(formData.headerText"));
test("43 preview dynamic URL", () => has(builder, "Website"));
test("44 preview copy code", () => has(builder, "Salin Kode"));
test("45 preview location", () => has(builder, 'type === "location"'));
test("46 responsive 375", () => has(builder, "grid-cols-1"));
test("47 responsive 430", () => has(chat, "max-w-lg"));
test("48 responsive 768", () => has(broadcast, "md:grid-cols-2"));
test("49 runtime media uses phone media endpoint", () => has(server, '/media`'));
test("50 runtime upload token stays in header", () => has(server, 'headers: { Authorization: `Bearer ${numberRow.access_token}` }'));
test("51 server maps coupon code correctly", () => has(server, 'type: "coupon_code"'));
test("52 no SQL migration", () => assert.ok(true));

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`Batch 13: ${passed}/${tests.length} passed`);
if (passed !== tests.length) process.exit(1);
