import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const helperSource = read("src/app/lib/template-rejection.ts");
const ui = read("src/app/components/template-management.tsx");
const api = read("src/app/lib/api.ts");
const server = read("supabase/functions/server/index.ts");
const js = ts.transpileModule(helperSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const helpers = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const current = helpers.currentRejectionReason;
const normalize = helpers.normalizeRejectionReason;

assert.equal(current("approved", null), null);
console.log("PASS 1 - approved + null has no rejection UI");
assert.equal(current("approved", "NONE"), null);
console.log("PASS 2 - approved + NONE has no rejection UI");
assert.equal(current("approved", "Previously rejected for policy"), null);
console.log("PASS 3 - approved + historical real reason has no current warning");
assert.equal(current("rejected", "Policy violation"), "Policy violation");
assert.match(ui, /rejectionReason && <span[\s\S]*Alasan penolakan tersedia/);
console.log("PASS 4 - rejected + real reason renders the red indicator path");
assert.equal(current("rejected", null), null);
console.log("PASS 5 - rejected + null shows no fake reason");
assert.equal(current("rejected", "NONE"), null);
assert.doesNotMatch(ui, /Alasan penolakan:<\/strong>/);
console.log("PASS 6 - rejected + NONE never renders sentinel text");
assert.equal(current("pending", "Policy violation"), null);
console.log("PASS 7 - pending + reason has no warning");
assert.equal(current("paused", "Policy violation"), null);
console.log("PASS 8 - paused + reason has no warning");
assert.equal(normalize("   \t\n"), null);
console.log("PASS 9 - whitespace reason is empty");
assert.equal(current("rejected", "  Actual Meta reason  "), "Actual Meta reason");
assert.match(ui, /<span>\{selectedCurrentRejectionReason\}<\/span>/);
console.log("PASS 10 - meaningful reason is trimmed and displayed");

assert.match(api, /normalizeRejectionReason\(t\.rejectionReason \?\? t\.rejection_reason\)/);
assert.match(server, /rejection_reason: normalizeTemplateStatus\(rawStatus\) === "rejected"/);
assert.match(server, /rejection_reason: event === "rejected"/);
console.log("\nRESULT: Batch 12.4 rejection reason UI regression PASS (10/10)");
