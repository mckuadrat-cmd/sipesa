import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const builder = fs.readFileSync("src/app/components/template-management.tsx", "utf8");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const has = (value) => assert.ok(builder.includes(value), `missing: ${value}`);

test("1 balanced Step 1 desktop layout", () => has('lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]'));
test("2 mobile remains one column", () => has("grid-cols-1 gap-6 overflow-y-auto"));
test("3 modal padding is responsive", () => has("p-2 sm:p-6"));
test("4 category card extracted", () => has("function CategoryCard"));
test("5 category cards have equal minimum height", () => has("min-h-[124px]"));
test("6 category descriptions clamp to two lines", () => has("[-webkit-line-clamp:2]"));
test("7 category radiogroup semantics", () => { has('aria-labelledby="template-category-heading"'); has('role="radio" aria-checked={selected}'); });
test("8 category keyboard focus is visible", () => has("focus-visible:ring-2 focus-visible:ring-emerald-500"));
test("9 template type card extracted", () => has("function TemplateTypeCard"));
test("10 capability badges cover all requested states", () => { for (const state of ["available", "conditional", "no_resource", "unsupported", "deferred"]) has(`\"${state}\"`); });
test("11 unavailable choices stay educational", () => { has("aria-disabled={unavailable}"); has("Tetap dapat dipilih untuk melihat contoh."); });
test("12 capability rules still gate Next", () => { has("const canAdvanceSetup"); has("disabled={!canAdvanceSetup || saving}"); });
test("13 Step 1 preview panel extracted", () => has("function StepOnePreviewPanel"));
test("14 preview follows current selection", () => { has("category={formData.category}"); has("templateType={formData.templateType}"); });
test("15 preview is described as educational", () => has("Contoh edukasi saja — tidak disimpan dan tidak dikirim ke Meta."));
test("16 carousel example renders two cards", () => has("example.cards?.slice(0, 2)"));
test("17 carousel overflow is internal", () => { has("max-w-full overflow-hidden"); has("overflow-x-auto"); });
test("18 carousel has more-card hint", () => has("Geser untuk melihat kartu lainnya"));
test("19 backend and payload files untouched by UI test scope", () => assert.equal(builder.includes("body.capability"), false));
test("20 component transpiles", () => {
  const result = ts.transpileModule(builder, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`Batch 14F: ${passed}/${tests.length} passed`);
if (passed !== tests.length) process.exit(1);
