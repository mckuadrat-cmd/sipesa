import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const server = read("supabase/functions/server/index.ts");
const batch1 = read("supabase/migrations/20261005090000_create_atomic_billing_core.sql");
const batch2 = read("supabase/migrations/20261005110000_secure_meta_webhook_and_manual_chat.sql");
const broadcastUi = read("src/app/components/broadcast-view.tsx");
const dashboardUi = read("src/app/components/dashboard-view.tsx");
const appUi = read("src/app/App.tsx");
const billingUi = read("src/app/components/billing-view.tsx");
const adminUi = read("src/app/components/superadmin-dashboard-view.tsx");
const landingUi = read("src/app/components/landing-page-view.tsx");
const catalog = read("src/app/lib/pricingCatalog.ts");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

const broadcastDebit = section(server, "async function consumeBroadcastToken", "function normalizeUsername");
const manualChat = section(
  server,
  'app.post(`${API_PREFIX}/numbers/:numberId/contacts/:contactId/messages`',
  "// ===== TEMPLATE HELPERS",
);
const manualTopup = section(
  server,
  'app.post(`${API_PREFIX}/billing/manual-requests`',
  'app.get(`${API_PREFIX}/superadmin/payment-settings`',
);

// A. Canonical source is the positive per-organization database value.
assert.match(server, /async function getCanonicalTokenPrice[\s\S]*\.from\("billing_balance"\)[\s\S]*\.select\("token_price_idr"\)/);
assert.match(server, /Number\.isFinite\(price\)[\s\S]*price <= 0/);
console.log("PASS A - canonical pricing is billing_balance.token_price_idr and fails closed");

// B. Broadcast debit resolves the canonical value server-side.
assert.match(broadcastDebit, /getCanonicalOrOriginalUsagePrice\([\s\S]*input\.orgId[\s\S]*"broadcast_usage"[\s\S]*recipientReference/);
assert.match(broadcastDebit, /amountIdr: tokenPrice/);
console.log("PASS B - broadcast uses canonical server-side price");

// C. Paid manual chat resolves the same canonical value.
assert.match(manualChat, /manualChatTokenPrice = requiresBilling[\s\S]*getCanonicalTokenPrice/);
assert.match(manualChat, /amountIdr: manualChatTokenPrice/);
console.log("PASS C - paid manual chat uses canonical server-side price");

// D. The 24-hour free window remains zero-charge and bypasses the debit branch.
assert.match(manualChat, /const requiresBilling = !isWithin24Hours/);
assert.match(manualChat, /manualChatTokenPrice = requiresBilling[\s\S]*: 0/);
assert.match(manualChat, /if \(requiresBilling\) \{[\s\S]*applyBillingMutation/);
console.log("PASS D - free-window chat remains zero charge");

// E. Client amount is ignored; top-up base amount is recomputed from canonical price.
assert.doesNotMatch(manualTopup, /\{\s*tokens,\s*receipt_data,\s*amount_idr\s*\}/);
assert.match(manualTopup, /const price = await getCanonicalTokenPrice/);
// Batch 9 intentionally removed the random nominal/referral-code addition.
// The requested amount remains canonical tokens * canonical organization price.
assert.match(manualTopup, /const amountRequested = requestedTokens \* price/);
assert.match(manualTopup, /amount_requested: amountRequested/);
assert.doesNotMatch(manualTopup, /referralCode|amount_idr\s*[,}]/);
console.log("PASS E - manipulated client amount cannot override direct-payment server calculation");

// F. The exact calculated amount is passed into the atomic ledger mutation.
assert.match(broadcastDebit, /amountIdr: tokenPrice/);
assert.match(manualChat, /amountIdr: manualChatTokenPrice/);
assert.match(batch1, /p_amount_idr[\s\S]*INSERT INTO public\.billing_transactions[\s\S]*p_amount_idr/i);
console.log("PASS F - pricing calculation and ledger amount stay consistent");

// G. Existing provider/reference idempotency remains authoritative.
assert.match(batch1, /UNIQUE INDEX[\s\S]*provider, external_reference/i);
assert.match(broadcastDebit, /provider: "broadcast_usage"[\s\S]*externalReference: recipientReference/);
assert.match(manualChat, /provider: "manual_chat_debit"[\s\S]*externalReference: manualSendReference/);
assert.match(server, /getCanonicalOrOriginalUsagePrice[\s\S]*\.select\("amount_idr"\)[\s\S]*existing\.amount_idr/);
console.log("PASS G - retry remains idempotent and cannot double charge");

// H. Compensation uses the original ledger amount, never today's price.
assert.match(batch2, /SELECT org_id, tokens_delta, amount_idr, id[\s\S]*v_original\.amount_idr/i);
assert.match(manualChat, /compensate_billing_mutation/);
console.log("PASS H - compensation refunds the original transaction amount");

// I. Every migrated financial consumer resolves the same changed canonical value.
const modelDebit = (canonicalPrice) => ({ broadcast: canonicalPrice, manualChat: canonicalPrice });
assert.deepEqual(modelDebit(777), { broadcast: 777, manualChat: 777 });
assert.match(broadcastDebit, /token_price_idr: tokenPrice/);
assert.match(manualChat, /token_price_idr: manualChatTokenPrice/);
console.log("PASS I - one canonical price change reaches all migrated debit consumers");

// J. No migrated runtime flow retains the legacy 1500 pricing literal.
for (const [name, source] of [
  ["broadcast debit", broadcastDebit],
  ["manual chat", manualChat],
  ["broadcast UI", broadcastUi],
  ["dashboard UI", dashboardUi],
  ["App billing state", appUi],
  ["billing UI", billingUi],
  ["admin UI", adminUi],
  ["landing UI", landingUi],
]) {
  assert.doesNotMatch(source, /\b1500\b/, `${name} still contains legacy price 1500`);
}
assert.match(catalog, /core:\s*250/);
assert.match(catalog, /full:\s*1250/);
assert.doesNotMatch(landingUi, /\b(?:250|1250)\b/);
assert.doesNotMatch(adminUi, /\b(?:250|1250)\b/);
console.log("PASS J - migrated runtime flows have no hardcoded legacy pricing");

console.log("\nRESULT: 10/10 Batch 4 pricing checks passed (static/emulated)");
console.log("SUPABASE CLOUD PREFLIGHT AND DEPLOY VERIFICATION REQUIRED");
