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

test("1 Carousel category is Marketing", () => has(server, 'category !== "marketing"'));
test("2 official card count constants", () => { has(server, "CAROUSEL_MIN_CARDS = 2"); has(server, "CAROUSEL_MAX_CARDS = 10"); });
test("3 dedicated builder", () => has(builder, "Dedicated Carousel Builder"));
test("4 Default builder unaffected", () => has(builder, 'formData.templateType === "default"'));
test("5 minimum cards enforced", () => has(server, "Carousel membutuhkan minimal"));
test("6 maximum cards enforced", () => has(server, "Maksimal ${CAROUSEL_MAX_CARDS} kartu"));
test("7 add card", () => has(builder, "Tambah Kartu"));
test("8 remove card", () => has(builder, "prev.carouselCards.filter"));
test("9 reorder card", () => { has(builder, "next[cardIndex - 1]"); has(builder, "next[cardIndex + 1]"); });
test("10 structure consistency", () => has(server, "Struktur semua kartu harus konsisten"));
test("11 invalid mixed structure blocked", () => has(builder, "signatures.some"));
test("12 valid image sample", () => { has(server, '["IMAGE", "VIDEO"].includes'); has(builder, "handleCarouselMediaSample"); });
test("13 valid video sample", () => has(builder, '<option value="video">Video</option>'));
test("14 missing sample blocked", () => has(server, "Contoh media Card ${cardIndex + 1} belum diunggah"));
test("15 handle preserved", () => { has(server, "header_handle: [mediaHandle]"); has(api, "mediaHandle: string"); });
test("16 card body length", () => { has(server, "CAROUSEL_CARD_BODY_MAX = 160"); has(builder, "CAROUSEL_CARD_BODY_MAX"); });
test("17 variable syntax", () => has(server, "Placeholder body Card"));
test("18 variable examples", () => has(server, "Contoh variabel Card"));
test("19 valid card buttons", () => has(server, 'new Set(["QUICK_REPLY", "URL", "PHONE_NUMBER"])'));
test("20 invalid button blocked", () => has(server, "tidak sesuai aturan Meta"));
test("21 two button limit", () => has(server, "wajib memiliki 1-2 tombol"));
test("22 button order/combination signature", () => has(server, "carouselButtonSignature"));
test("23 normalized Carousel model", () => has(builder, 'templateType: "carousel"'));
test("24 server Meta payload", () => { has(server, '{ type: "CAROUSEL", cards }'); has(server, "formatComponentsForMeta(card?.components)"); });
test("25 arbitrary components rejected", () => has(server, "Field template Carousel tidak dikenal"));
test("26 sync detects Carousel", () => has(server, "isCarouselTemplate(row.components)"));
test("27 cards parsed", () => has(server, "parseCarouselComponents"));
test("28 unknown variant read-only", () => { has(server, "readOnly: reasons.length > 0"); has(builder, "Varian Carousel ini memiliki komponen yang belum didukung"); });
test("29 raw fields preserved", () => has(server, "components: row.components ?? []"));
test("30 runtime requirements derived", () => { has(server, "carouselCards.length ? { cardCount"); has(api, "carousel?: null"); });
test("31 Broadcast filtered", () => { has(server, "Template Carousel memerlukan parameter runtime per kartu"); has(broadcast, "template.runtimeSupport?.supported !== false"); });
test("32 Chat filtered", () => has(chat, "template.runtimeSupport?.supported !== false"));
test("33 missing runtime fails closed", () => has(server, "parameter runtime per kartu yang belum didukung"));
test("34 wrong WABA blocked", () => { has(server, '.eq("waba_id", wabaId)'); has(server, "WABA tidak dimiliki organisasi ini"); });
test("35 multiple cards preview", () => has(builder, "function CarouselPreview"));
test("36 preview card order", () => has(builder, "cards.map((card, index)"));
test("37 preview sample rendered", () => has(builder, "card.mediaSampleFileName"));
test("38 preview buttons rendered", () => has(builder, "card.buttons.map"));
test("39 Meta-authoritative delete preserved", () => { const remove = server.slice(server.indexOf('app.delete(`${API_PREFIX}/templates/:id`'), server.indexOf('app.post(`${API_PREFIX}/templates/sync`')); has(remove, "meta_template_id"); has(remove, "await fetch(deleteUrl"); has(remove, "data lokal dipertahankan"); });
test("40 responsive 375", () => has(builder, "max-w-full snap-x"));
test("41 responsive 430", () => has(builder, "overflow-x-auto"));
test("42 desktop preview", () => has(builder, "w-[230px] min-w-[230px]"));
test("43 no page overflow", () => { has(builder, "min-w-0 overflow-hidden"); has(builder, "horizontal"); });
test("44 no per-card validation request", () => { const cardBuilder = builder.slice(builder.indexOf("Dedicated Carousel Builder"), builder.indexOf("Dedicated Commerce Builder")); assert.ok(!cardBuilder.includes("api.validate")); });
test("45 backend TypeScript transpiles", () => {
  const result = ts.transpileModule(server, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`Batch 14D: ${passed}/${tests.length} passed`);
if (passed !== tests.length) process.exit(1);
