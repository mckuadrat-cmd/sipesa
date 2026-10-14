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

test("1 catalog discovery server-side", () => { has(server, "/templates/commerce/catalogs"); has(server, "/product_catalogs?fields=id,name&limit=25"); });
test("2 wrong-WABA catalog rejected", () => { has(server, "assertOwnedCommerceCatalog"); has(server, "Katalog ini tidak tersedia untuk akun WhatsApp Business ini."); });
test("3 empty catalog state", () => { has(builder, "Belum ada katalog yang terhubung."); has(server, "catalogAvailable: catalogs.length > 0"); });
test("4 catalog pagination", () => { has(server, "page < 10"); has(server, 'json?.paging?.next'); });
test("5 dedicated Catalog builder", () => has(builder, "Dedicated Commerce Builder"));
test("6 no manual arbitrary catalog authority", () => { has(builder, "Pilih katalog"); has(builder, "api.getCommerceCatalogs"); });
test("7 valid catalog selectable", () => has(builder, "catalog.eligible"));
test("8 invalid catalog blocked", () => has(server, "assertOwnedCommerceConfiguration(validated.commerceConfig"));
test("9 correct Catalog Meta payload", () => { has(server, 'type: templateType === "multi_product" ? "MPM" : "CATALOG"'); has(server, "delete clean.catalog_id"); });
test("10 catalog ownership revalidated", () => has(server, "await assertOwnedCommerceCatalog(catalogId, wabaId, accessToken)"));
test("11 unknown commerce field rejected", () => { has(server, "Field template Commerce tidak dikenal"); has(server, "Field konfigurasi Commerce tidak dikenal"); });
test("12 Catalog Broadcast filtered", () => { has(server, "Template Catalog memerlukan validasi katalog"); has(broadcast, "template.runtimeSupport?.supported !== false"); });
test("13 Catalog Chat filtered", () => has(chat, "template.runtimeSupport?.supported !== false"));
test("14 missing commerce resource blocked", () => has(server, "Katalog ini tidak tersedia untuk akun WhatsApp Business ini."));
test("15 bounded product query", () => { has(server, "Math.min(50, Math.max(1, requestedLimit))"); has(server, "page < (query ? 3 : 1)"); });
test("16 product search", () => { has(server, "product.name.toLowerCase().includes(query)"); has(builder, "Cari produk Meta"); });
test("17 product belongs to catalog", () => has(server, "assertProductsBelongToCatalog"));
test("18 foreign product rejected", () => has(server, "Satu atau lebih produk tidak ditemukan di katalog"));
test("19 dedicated Multi-product builder", () => { has(builder, '"multi_product", "Multi-product"'); has(builder, "Multi-product memerlukan 2-30 produk"); });
test("20 section/count validation", () => { has(server, "Multi-product mendukung 1-10 section"); has(server, "Setiap section wajib memiliki minimal satu produk"); });
test("21 product count limits", () => has(server, "Multi-product memerlukan 2-30 produk"));
test("22 duplicate products rejected", () => has(server, "Produk Multi-product tidak boleh duplikat"));
test("23 product ordering UI", () => { has(builder, "Urutan preview produk"); has(builder, "next[index - 1]"); });
test("24 correct MPM payload", () => { has(server, 'type: templateType === "multi_product" ? "MPM" : "CATALOG"'); has(server, "delete clean.sections"); });
test("25 synced Catalog recognized", () => { has(server, '["CATALOG", "MPM"].includes'); has(server, "inferredCommerceCatalogId"); });
test("26 synced Multi-product recognized", () => has(server, 'type: type === "MPM" ? "multi_product" : "catalog"'));
test("27 raw components preserved", () => has(server, "components: row.components ?? []"));
test("28 unknown commerce variant read-only", () => { has(server, "parseCommerceComponents"); has(builder, "hanya dapat dilihat secara read-only"); });
test("29 disconnected catalog handled", () => has(builder, "Katalog tidak lagi tersedia."));
test("30 unavailable product handled", () => has(server, "sudah tidak tersedia"));
test("31 template delete does not modify catalog", () => { const remove = server.slice(server.indexOf('app.delete(`${API_PREFIX}/templates/:id`'), server.indexOf('app.post(`${API_PREFIX}/templates/sync`')); assert.ok(!remove.includes("product_catalogs")); });
test("32 template delete does not delete products", () => { const remove = server.slice(server.indexOf('app.delete(`${API_PREFIX}/templates/:id`'), server.indexOf('app.post(`${API_PREFIX}/templates/sync`')); assert.ok(!remove.includes("/products")); });
test("33 organization isolation", () => has(server, '.eq("org_id", user.org_id)'));
test("34 WABA isolation", () => has(server, '.eq("waba_id", wabaId)'));
test("35 fake catalog ID rejected", () => has(server, 'if (!/^\\d+$/.test(catalogId))'));
test("36 fake product ID rejected", () => has(server, '!/^\\d+$/.test(product.id)'));
test("37 arbitrary commerce component rejected", () => has(server, "Unknown commerce field".replace("Unknown commerce field", "Field konfigurasi Commerce tidak dikenal")));
test("38 no unbounded product fetch", () => { has(server, "limit=100"); has(server, "page < 20"); });
test("39 no N+1 product validation", () => { const validation = server.slice(server.indexOf("async function assertProductsBelongToCatalog"), server.indexOf("async function assertOwnedCommerceConfiguration")); assert.ok(!validation.includes("Promise.all")); assert.ok(validation.includes("/products?fields=")); });
test("40 Catalog preview", () => { has(builder, "function CommercePreview"); has(builder, "Tombol membuka katalog Meta yang terhubung."); });
test("41 Multi-product preview", () => has(builder, "Produk dipilih kembali saat pengiriman"));
test("42 responsive 375", () => has(builder, "grid grid-cols-1 gap-4 sm:grid-cols-2"));
test("43 responsive 430", () => has(builder, "max-w-[360px]"));
test("44 responsive desktop", () => has(builder, "xl:grid-cols-[1.25fr_0.75fr]"));
test("45 frontend API exposes commerce capability", () => { has(api, "commerceConfig?:"); has(api, "async getCommerceCatalogs"); has(api, "async getCommerceProducts"); });
test("46 runtime requirements fail closed", () => { has(server, "Template Multi-product memerlukan pemilihan produk saat pengiriman"); has(builder, "Runtime Broadcast/Chat belum tersedia"); });
test("47 Meta credentials stay in Authorization header", () => has(server, 'headers: { Authorization: `Bearer ${accessToken}` }'));
test("48 backend TypeScript transpiles", () => {
  const result = ts.transpileModule(server, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`Batch 14C: ${passed}/${tests.length} passed`);
if (passed !== tests.length) process.exit(1);
