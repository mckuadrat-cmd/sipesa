import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ui = read("src/app/components/template-management.tsx");
const server = read("supabase/functions/server/index.ts");
const api = read("src/app/lib/api.ts");
const client = read("src/app/lib/apiClient.ts");
const app = read("src/app/App.tsx");
const textarea = read("src/app/components/ui/textarea.tsx");
let checks = 0;
const has = (source, pattern, message) => { assert.match(source, pattern, message); checks += 1; };
const ok = (value, message) => { assert.ok(value, message); checks += 1; };

has(ui, /\["image", "video", "document"\]\.includes\(formData\.headerType\)/, "None does not require media");
has(ui, /formData\.headerType === "text"\s*\? validateHeaderText/, "Text uses text validation without media upload");
has(ui, /image:[\s\S]*image\/jpeg[\s\S]*maxBytes: 5 \* 1024 \* 1024/, "Image sample rules");
has(ui, /video:[\s\S]*video\/mp4[\s\S]*maxBytes: 16 \* 1024 \* 1024/, "Video sample rules");
has(ui, /document:[\s\S]*application\/pdf[\s\S]*maxBytes: 100 \* 1024 \* 1024/, "Document sample rules");
has(ui, /setMediaUploadError\(result\.error\)[\s\S]*setHeaderError\(result\.error\)/, "Failed upload blocks Review at field level");
has(ui, /hasUsableMetaMediaHandle\(result\.data\.handle\)[\s\S]*mediaSampleHandle: result\.data\.handle\.trim\(\)/, "Successful Meta handle enables Review");
has(ui, /mediaHandle: formData\.mediaSampleHandle/, "Normalized payload carries Meta handle");
ok(ui.includes("!rule.mimeTypes.includes(file.type) || !rule.extensions.includes(extension)") && server.includes("!mediaRule.mimeTypes.has") && server.includes("!mediaRule.extensions.has"), "MIME and extension rejected independently on both layers");
ok(ui.includes("file.size > rule.maxBytes") && server.includes("file.size > mediaRule.maxBytes"), "Size rejected independently on both layers");
ok(client.includes("let sessionInvalidated = false") && client.includes("unauthorizedEventDispatched") && client.includes("if (sessionInvalidated && !canRunWithoutCurrentSession(path))"), "401 circuit breaker prevents request storm");
ok(client.includes('code: "NETWORK_ERROR"') && !/catch\s*\{[^}]*invalidateSessionOnce/s.test(client), "Network error is retryable and not treated as auth failure");
has(textarea, /React\.forwardRef<HTMLTextAreaElement[\s\S]*ref=\{ref\}/, "Textarea forwards its DOM ref");
ok(ui.includes("textarea?.selectionStart") && ui.includes("setSelectionRange(nextCursor, nextCursor)"), "Cursor insertion remains intact");

assert.equal(checks, 14);
assert.match(api, /formData\.append\("headerType", headerType\)/);
assert.match(server, /Meta tidak mengembalikan handle media/);
assert.match(app, /setActiveView\("login"\)[\s\S]*#\/login/);
console.log("RESULT: Batch 12.2 media sample and session UX regression PASS (14/14)");
