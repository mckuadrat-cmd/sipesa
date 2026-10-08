import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const app = read("src/app/App.tsx");
const contacts = read("src/app/components/contact-list-view.tsx");
const templates = read("src/app/components/template-management.tsx");
const billing = read("src/app/components/billing-view.tsx");
const superadmin = read("src/app/components/superadmin-dashboard-view.tsx");
const chat = read("src/app/components/chat-interface.tsx");
const helper = read("src/app/hooks/use-visibility-refresh.ts");

assert.doesNotMatch(app, /setInterval\([\s\S]{0,300}loadData\([\s\S]{0,100},\s*1000\)/);
assert.match(app, /getAppRefreshPlan\(requestedView\)/);
assert.match(app, /visibilityState === "visible"/);
assert.match(app, /loadDataInFlightRef\.current/);
assert.match(app, /pendingLoadDataRef\.current/);

for (const [name, source] of [
  ["Contacts", contacts],
  ["Templates", templates],
  ["Billing", billing],
  ["Superadmin", superadmin],
]) {
  assert.doesNotMatch(source, /setInterval\([\s\S]{0,500},\s*1000\)/, `${name} still polls every second`);
  assert.match(source, /intervalMs:\s*30_000/, `${name} must use the conservative refresh interval`);
  assert.match(source, /useVisibilityRefresh/, `${name} must use visibility-aware refresh`);
}

assert.match(helper, /document\.visibilityState === "hidden"/);
assert.match(helper, /inFlightRef\.current/);
assert.match(helper, /trailingRefreshRef\.current/);
assert.match(contacts, /await refreshContacts\(\)/);
assert.match(templates, /await refreshTemplates\(\)/);
assert.match(billing, /refreshManualRequests\(\)/);
assert.match(superadmin, /refreshSuperadminData\(\)/);

// Batch 6B supersedes the temporary Batch 6A exception for Chat/Inbox.
assert.doesNotMatch(chat, /pollMessages\(\)[\s\S]{0,100},\s*1000\)/);
assert.match(chat, /intervalMs:\s*30_000/);

console.log("Batch 6A polling regression: PASS");
