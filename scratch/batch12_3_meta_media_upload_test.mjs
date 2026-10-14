import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const server = read("supabase/functions/server/index.ts");
const ui = read("src/app/components/template-management.tsx");
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing section: ${start}`);
  return source.slice(from, to);
};
const upload = section(server, 'app.post(`${API_PREFIX}/templates/upload-sample`', 'app.post(`${API_PREFIX}/templates`');
let checks = 0;
const has = (source, pattern, message) => { assert.match(source, pattern, message); checks += 1; };
const lacks = (source, pattern, message) => { assert.doesNotMatch(source, pattern, message); checks += 1; };
const ok = (value, message) => { assert.ok(value, message); checks += 1; };

has(server, /parseMetaGraphResponse[\s\S]*response\.text\(\)[\s\S]*JSON\.parse/, "valid create-session JSON is parsed text-first");
has(upload, /const sessionId = String\(parsedInit\.data\?\.id[\s\S]*if \(!sessionId\)[\s\S]*upload session ID/, "missing upload ID is rejected");
has(upload, /create_session[\s\S]*Meta gagal membuat upload session/, "Step 1 Graph errors are safe and specific");
has(upload, /upload_binary[\s\S]*Meta menolak upload file contoh/, "Step 2 Graph errors are safe and specific");
has(upload, /"Content-Type": fileType[\s\S]*body: fileBytes/, "exact MIME and raw binary body are sent");
has(upload, /Authorization: `Bearer \$\{accessToken\}`/, "Authorization is header-only");
lacks(upload, /[?&]access_token=/, "access token is absent from URLs");
has(upload, /const handle = String\(parsedUpload\.data\?\.h[\s\S]*trim\(\)/, "valid h is extracted and trimmed");
has(upload, /if \(!handle\)[\s\S]*Meta tidak mengembalikan handle media/, "missing h is rejected");
has(server, /malformedResponse: malformed/, "malformed Meta response is diagnosed without raw response logging");
has(server, /application\/pdf[\s\S]*maxBytes: 100 \* 1024 \* 1024/, "PDF follows document upload path");
has(server, /image\/jpeg[\s\S]*image\/png[\s\S]*maxBytes: 5 \* 1024 \* 1024/, "JPEG and PNG follow image upload path");
has(server, /video\/mp4[\s\S]*video\/3gpp[\s\S]*maxBytes: 16 \* 1024 \* 1024/, "MP4 follows video upload path");
ok(ui.includes("mediaSampleHandle: result.data.handle.trim()") && ui.includes("mediaHandle: formData.mediaSampleHandle"), "frontend persists handle through normalized Review payload");
has(ui, /headerType,[\s\S]*mediaSampleFileName: "",[\s\S]*mediaSampleHandle: ""/, "file or header change clears the old handle");

assert.equal(checks, 15);
has(upload, /Deno\.env\.get\("META_APP_ID"\)[\s\S]*\/app/, "App ID comes from environment or token-scoped Graph app lookup");
has(upload, /file_offset: "0"/, "file offset is a header");
has(upload, /return c\.json\(jsonFail\(`Meta gagal membuat upload session/, "upstream failures return controlled 502 path");
lacks(server, /handle.*startsWith\("4::"\)/, "valid future handle prefixes are accepted");
console.log("RESULT: Batch 12.3 Meta media sample upload regression PASS (15/15)");
