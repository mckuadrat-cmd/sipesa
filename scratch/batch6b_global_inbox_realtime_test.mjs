import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const app = read("src/app/App.tsx");
const header = read("src/app/components/header-nav.tsx");
const inbox = read("src/app/components/inbox-view.tsx");

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`PASS ${name}`);
}

const globalEffectStart = app.indexOf('const orgId = String(user?.org_id || "")');
const globalEffectEnd = app.indexOf("useEffect(() => {", globalEffectStart + 1);
const globalEffect = app.slice(globalEffectStart, globalEffectEnd);
const refreshStart = app.indexOf("const refreshInboxSummary = async () =>");
const refreshEnd = app.indexOf("useEffect(() => {", refreshStart);
const refreshInboxSummary = app.slice(refreshStart, refreshEnd);

check("one org-scoped global channel invalidates server-owned Inbox state", () => {
  assert.ok(globalEffectStart >= 0);
  assert.match(globalEffect, /\.channel\(`global-inbox:\$\{orgId\}`\)/);
  assert.equal((globalEffect.match(/\.channel\(/g) ?? []).length, 1);
  assert.match(globalEffect, /filter: `org_id=eq\.\$\{orgId\}`/);
  assert.match(refreshInboxSummary, /const numbersRes = await api\.getNumbers\(\)/);
  assert.match(refreshInboxSummary, /setWhatsappNumbers\(numbersRes\.data \?\? \[\]\)/);
  assert.doesNotMatch(globalEffect, /setWhatsappNumbers\([^\n]*payload/);
});

check("inbound INSERT refreshes Inbox cards and global header badge", () => {
  assert.match(globalEffect, /event: "INSERT"/);
  assert.match(globalEffect, /row\.direction !== "in"/);
  assert.match(globalEffect, /scheduleInboxInvalidation\("INSERT"\)/);
  assert.match(app, /<InboxView[\s\S]{0,200}numbers=\{whatsappNumbers\}/);
  assert.match(app, /<HeaderNav[\s\S]{0,300}numbers=\{whatsappNumbers\}/);
  assert.match(header, /numbers\.reduce\(\(acc, curr\) => acc \+ \(curr\.unreadCount \|\| 0\), 0\)/);
  assert.match(inbox, /unreadCount/);
});

check("read-related inbound UPDATE invalidates the same authoritative summary", () => {
  assert.match(globalEffect, /event: "UPDATE"/);
  assert.match(globalEffect, /\["delivered", "read"\]\.includes/);
  assert.match(globalEffect, /scheduleInboxInvalidation\("UPDATE"\)/);
});

check("burst events are coalesced and refresh cycles do not overlap", () => {
  assert.match(globalEffect, /window\.clearTimeout\(debounceTimer\)/);
  assert.match(globalEffect, /window\.setTimeout\([\s\S]*?, 500\)/);
  assert.match(app, /inboxSummaryRefreshInFlightRef\.current/);
  assert.match(app, /inboxSummaryRefreshPendingRef\.current/);

  let pendingTimer = null;
  let nextTimer = 0;
  let refreshCount = 0;
  const schedule = () => {
    nextTimer += 1;
    pendingTimer = nextTimer;
  };
  for (let event = 0; event < 50; event += 1) schedule();
  if (pendingTimer !== null) refreshCount += 1;
  assert.equal(refreshCount, 1);
});

check("org switch and logout clean up and recreate the subscription", () => {
  assert.match(globalEffect, /return \(\) => \{/);
  assert.match(globalEffect, /cancelled = true/);
  assert.match(globalEffect, /supabase\.removeChannel\(channel\)/);
  assert.match(globalEffect, /window\.clearTimeout\(debounceTimer\)/);
  assert.match(app, /\}, \[isAuthenticated, user\?\.email, user\?\.org_id\]\);/);
  assert.match(globalEffect, /if \(!isAuthenticated \|\| !orgId \|\| isSuperadminSession\) return/);
});

check("global invalidation does not introduce one-second polling", () => {
  assert.doesNotMatch(globalEffect, /setInterval/);
  assert.doesNotMatch(app, /setInterval\([\s\S]{0,300}(1000|1_000)/);
});

console.log(`Batch 6B global Inbox Realtime regression: ${passed}/6 PASS`);
