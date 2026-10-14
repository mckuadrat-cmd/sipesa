import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ui = read("src/app/components/template-management.tsx");
const server = read("supabase/functions/server/index.ts");
const languages = read("src/app/lib/meta-template-languages.ts");
const broadcast = read("src/app/components/broadcast-view.tsx");
const chat = read("src/app/components/chat-interface.tsx");
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const has = (source, pattern, message) => { assert.match(source, pattern, message); checks += 1; };

// FLOW 1-5
has(ui, /canAdvanceSetup = Boolean\(formData\.wabaId/, "WABA gates step one");
has(ui, /\["marketing", "utility"\]\.includes\(formData\.category\)/, "Marketing Default advances");
has(ui, /formData\.templateType === "default"/, "Utility Default uses supported type gate");
has(ui, /Dedicated Authentication Builder/, "Authentication uses its dedicated OTP builder");
has(ui, /aria-disabled=\{unavailable\}.*Tetap dapat dipilih untuk melihat contoh\./s, "unavailable advanced types remain gated while previewable");

// NAME/LANGUAGE 6-7
has(ui, /Nama template maksimal 512 karakter/, "name validation is mirrored");
ok((languages.match(/\["[^\"]+",\s*"[^\"]+"\]/g) || []).length === 74 && languages.includes('["id", "Bahasa Indonesia"]') && languages.includes('["en_US", "English (US)"]'), "maintainable 74-locale map");

// HEADER 8-14
has(ui, /<option value="none">None<\/option>/, "none header");
has(ui, /<option value="text">Text Header<\/option>/, "text header");
has(ui, /<option value="image">Image<\/option>/, "image header");
has(ui, /<option value="video">Video<\/option>/, "video header");
has(ui, /<option value="document">Document<\/option>/, "document header");
has(ui, /<option value="location"(?: disabled)?>/, "location is explicit");
ok(server.includes("Variabel header text belum didukung") || server.includes("Header text hanya mendukung satu variabel {{1}}"), "header variables are either gated or validated safely");

// BODY 15-18
has(server, /Konten template maksimal 1024 karakter/, "body max");
has(ui, /selectionStart/, "cursor-aware variable insertion");
has(server, /Nomor variabel harus berurutan mulai dari \{\{1\}\}/, "sequential placeholders");
has(server, /Contoh untuk variabel \{\{\$\{index\}\}\} wajib diisi/, "body examples required");

// FOOTER 19-20
has(server, /Footer maksimal 60 karakter/, "footer max");
has(server, /Footer tidak boleh memiliki variabel/, "footer variables blocked");

// BUTTONS 21-28
has(ui, /addButton\("QUICK_REPLY"\)/, "Quick Reply enabled");
has(ui, /addButton\("URL"\)/, "static URL enabled");
ok(server.includes("URL dinamis belum didukung") || server.includes("URL dinamis hanya mendukung {{1}} sebagai suffix"), "dynamic URL is either gated or validated safely");
has(ui, /addButton\("PHONE_NUMBER"\)/, "phone enabled");
ok(/Copy Code.*belum didukung/.test(ui) || ui.includes('addButton("COPY_CODE")'), "Copy Code is gated or end-to-end enabled");
ok(server.includes("Quick Reply dan tombol tindakan belum dapat digabung") || server.includes("tidak boleh berselang-seling"), "combination rule");
ok(server.includes("Maksimal 3 tombol Quick Reply") || server.includes("Maksimal 10 tombol Quick Reply"), "maximum rule");
has(server, /Tombol \$\{type \|\| "UNKNOWN"\} belum didukung/, "unknown button blocked");

// PREVIEW 29-31
ok(ui.indexOf("<HeaderPreviewBox") < ui.indexOf("renderFormattedText(body)") && ui.indexOf("renderFormattedText(body)") < ui.indexOf("footer?.trim()"), "preview component order");
has(ui, /applyExamplesToText\(previewBody, examples, "token"\)/, "preview renders examples");
has(ui, /btn\.type === "URL".*btn\.type === "PHONE_NUMBER"/s, "preview reflects action buttons");

// SUBMIT 32-34
has(server, /\.eq\("waba_id", wabaId\)/, "authoritative WABA ownership");
has(server, /Model template terstruktur wajib digunakan/, "normalized model required");
has(server, /inspectTemplateRuntime\(\{ category, components \}\)/, "unsupported normalized payload rejected");

// SYNC/EDIT 35-36
ok(ui.includes("body?.example?.body_text?.[0]") && ui.includes("phone_number") && ui.includes("String(b?.url || \"\")"), "supported imports round-trip");
has(ui, /Template ini memiliki komponen Meta yang belum dapat diedit di SIPESA/, "unknown imports read-only");

// RUNTIME 37-38
ok(server.includes('new Set(["QUICK_REPLY", "URL", "PHONE_NUMBER"') && broadcast.includes("runtimeSupport?.supported !== false"), "Broadcast supports every enabled button");
ok(chat.includes("template.runtimeSupport?.supported !== false") && chat.includes("template.wabaId === selectedNumber.wabaId"), "Chat filters unsupported or wrong-WABA templates");

// ORDER 39
has(server, /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)/, "newest-first stable order");

// RESPONSIVE 40-42
has(ui, /max-w-5xl.*max-h-\[90vh\].*overflow-hidden/, "375 modal is viewport-bounded");
has(ui, /grid-cols-1 xl:grid-cols-\[1\.25fr_0\.75fr\]/, "430 stacks builder and preview");
has(ui, /lg:sticky lg:top-0/, "desktop preview remains sticky");

assert.equal(checks, 42);
console.log(`RESULT: Batch 12 Meta-style template builder regression PASS (${checks} checks)`);
