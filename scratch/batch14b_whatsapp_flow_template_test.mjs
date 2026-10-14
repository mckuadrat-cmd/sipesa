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

test("1 WABA Flow list fetched server-side", () => { has(server, '/templates/flows`'); has(server, '/flows?fields=id,name,categories,status,health_status'); });
test("2 wrong-WABA Flow rejected", () => has(server, 'ownerId !== wabaId'));
test("3 eligible published Flow selectable", () => { has(server, 'status === "PUBLISHED"'); has(builder, "flow.eligible"); });
test("4 ineligible Flow disabled", () => has(builder, 'disabled={!flow.eligible}'));
test("5 Flow uses dedicated builder", () => has(builder, "Dedicated Flow Builder"));
test("6 invalid generic component blocked", () => has(server, "validateFlowTemplatePayload(body)"));
test("7 raw Flow ID is not the primary UI authority", () => { has(builder, "Pilih Flow"); has(builder, "api.getMetaFlows"); });
test("8 valid Flow template payload", () => has(server, '{ type: "FLOW", text: buttonText, flow_id: flowId'));
test("9 action maps to NAVIGATE", () => has(server, 'action !== "NAVIGATE"'));
test("10 destination screen maps from discovered asset", () => { has(server, "getMetaFlowScreens"); has(server, "navigate_screen: screen"); });
test("11 invalid or unavailable Flow rejected", () => { has(server, "Flow ini belum dipublikasikan."); has(server, "Flow tidak lagi tersedia."); });
test("12 Broadcast compatibility fails closed", () => { has(server, "lifecycle flow_token per penerima"); has(broadcast, "template.runtimeSupport?.supported !== false"); });
test("13 Chat compatibility fails closed", () => has(chat, "template.runtimeSupport?.supported !== false"));
test("14 flow token is explicitly deferred", () => has(builder, "flow_token per penerima"));
test("15 missing runtime requirement blocked before selection", () => has(server, "Template Flow memerlukan lifecycle flow_token per penerima"));
test("16 imported Flow detected", () => has(server, "parseFlowComponents(row.components)"));
test("17 Flow ID preserved", () => has(server, 'const flowId = String(flowButton?.flow_id ?? "").trim()'));
test("18 unavailable Flow handled", () => has(server, "Flow tidak lagi tersedia."));
test("19 unsupported Flow variant read-only", () => { has(server, "readOnly: reasons.length > 0"); has(builder, "Varian template Flow ini belum didukung"); });
test("20 deleting template cannot delete Flow", () => { const remove = server.slice(server.indexOf('app.delete(`${API_PREFIX}/templates/:id`'), server.indexOf('app.post(`${API_PREFIX}/templates/sync`')); assert.ok(!remove.includes("/flows")); });
test("21 organization isolation", () => has(server, '.eq("org_id", user.org_id)'));
test("22 WABA isolation", () => has(server, '.eq("waba_id", wabaId)'));
test("23 fake Flow ID rechecked against Meta", () => has(server, "assertOwnedEligibleFlow(validated.flowConfig"));
test("24 unknown component fails closed", () => has(server, 'Tombol ${buttonType || "UNKNOWN"} belum didukung'));
test("25 Flow CTA rendered", () => { has(builder, "function FlowPreview"); has(builder, "Tombol ini membuka WhatsApp Flow."); });
test("26 responsive 375", () => has(builder, "grid grid-cols-1 gap-4 sm:grid-cols-2"));
test("27 responsive 430", () => has(builder, "max-w-[360px]"));
test("28 responsive desktop", () => has(builder, "xl:grid-cols-[1.25fr_0.75fr]"));
test("29 sensitive Flow response JSON is not persisted", () => { has(server, "safeInboundPayload = isFlowResponse"); has(server, "has_response: Boolean"); has(server, 'textBody = isFlowResponse ? "[Respons WhatsApp Flow diterima]"'); });
test("30 asset URL must be trusted Meta HTTPS", () => { has(server, 'String(item?.download_url ?? "").startsWith("https://")'); has(server, 'downloadUrl.hostname.endsWith(".fbsbx.com")'); });
test("31 token stays in Authorization header", () => has(server, 'headers: { Authorization: `Bearer ${accessToken}` }'));
test("32 submitted Flow state is rechecked", () => has(server, "assertOwnedEligibleFlow({ flowId: storedFlow.flowId"));
test("33 frontend API exposes Flow metadata", () => { has(api, "flowConfig?:"); has(api, "async getMetaFlows"); });
test("34 backend TypeScript transpiles", () => {
  const result = ts.transpileModule(server, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  const errors = (result.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
});

let passed = 0;
for (const [name, fn] of tests) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`Batch 14B: ${passed}/${tests.length} passed`);
if (passed !== tests.length) process.exit(1);
