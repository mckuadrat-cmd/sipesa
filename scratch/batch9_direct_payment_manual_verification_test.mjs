import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const server = read("supabase/functions/server/index.ts");
const migration = read("supabase/migrations/20261007180000_direct_manual_payment.sql");
const api = read("src/app/lib/api.ts");
const billing = read("src/app/components/billing-view.tsx");
const admin = read("src/app/components/superadmin-dashboard-view.tsx");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("authoritative request and destination model is relational and tenant-linked", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.payment_destinations/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.manual_payment_requests/);
  for (const field of [
    "org_id", "requested_by", "tokens_requested", "amount_requested", "payment_method",
    "destination_account_id", "payment_reference", "proof_object_path", "status",
    "rejection_reason", "submitted_at", "reviewed_at", "reviewed_by", "billing_ledger_id",
  ]) assert.match(migration, new RegExp(`\\b${field}\\b`));
  assert.match(migration, /status IN \('draft', 'submitted', 'approved', 'rejected'\)/);
  assert.match(migration, /payment_reference text NOT NULL UNIQUE/);
});

test("tables and proof/assets buckets are private service-role resources", () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(migration, /REVOKE ALL ON TABLE public\.manual_payment_requests FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /'payment-proofs'[\s\S]{0,120}false/);
  assert.match(migration, /'payment-assets'[\s\S]{0,120}false/);
  assert.match(migration, /5242880/);
  assert.match(server, /Cache-Control": "private, no-store/);
  assert.doesNotMatch(server, /getPublicUrl\(/);
});

test("user create derives tenant, price, and amount on server", () => {
  const route = server.slice(server.indexOf('app.post(`${API_PREFIX}/billing/manual-requests`, requireAuth'), server.indexOf('app.post(`${API_PREFIX}/billing/manual-requests/:id/proof`'));
  assert.match(route, /const user = c\.get\("authUser"\)/);
  assert.match(route, /getCanonicalTokenPrice\(supa, user\.org_id\)/);
  assert.match(route, /amountRequested = requestedTokens \* price/);
  assert.match(route, /org_id: user\.org_id/);
  assert.match(route, /requested_by: user\.id/);
  assert.doesNotMatch(route, /amount_idr|approvedAmount|creditAmount|client.*org_id/i);
});

test("inactive destination and invalid amount are rejected before request insert", () => {
  const route = server.slice(server.indexOf('app.post(`${API_PREFIX}/billing/manual-requests`, requireAuth'), server.indexOf('app.post(`${API_PREFIX}/billing/manual-requests/:id/proof`'));
  assert.match(route, /!Number\.isSafeInteger\(requestedTokens\) \|\| requestedTokens <= 0/);
  assert.match(route, /\.eq\("active", true\)/);
  assert.ok(route.indexOf('.eq("active", true)') < route.indexOf('.from("manual_payment_requests")'));
});

test("proof upload validates ownership, draft state, MIME, and size server-side", () => {
  const route = server.slice(server.indexOf('app.post(`${API_PREFIX}/billing/manual-requests/:id/proof`'), server.indexOf('app.post(`${API_PREFIX}/billing/manual-requests/:id/submit`'));
  assert.match(route, /PAYMENT_PROOF_MIME_EXTENSIONS\.get\(proof\.type\)/);
  assert.match(route, /proof\.size > PAYMENT_PROOF_MAX_BYTES/);
  assert.match(route, /\.eq\("org_id", user\.org_id\)/);
  assert.match(route, /requestRow\.status !== "draft"/);
  assert.match(route, /payment-proofs|PAYMENT_PROOF_BUCKET/);
  assert.doesNotMatch(route, /Meta|billing_transactions|apply_billing_mutation/);
});

test("submit is idempotent and requires proof plus active destination", () => {
  const route = server.slice(server.indexOf('app.post(`${API_PREFIX}/billing/manual-requests/:id/submit`'), server.indexOf('app.get(`${API_PREFIX}/billing/manual-requests/:id/proof`'));
  assert.match(route, /\["submitted", "approved"\]\.includes\(requestRow\.status\)/);
  assert.match(route, /!requestRow\.proof_object_path/);
  assert.match(route, /!destination\?\.active/);
  assert.match(route, /\.eq\("status", "draft"\)/);
  assert.match(route, /status: "submitted"/);
});

test("proof read is owner or configured-superadmin only and never exposes storage path", () => {
  const route = server.slice(server.indexOf('app.get(`${API_PREFIX}/billing/manual-requests/:id/proof`'), server.indexOf('app.get(`${API_PREFIX}/rules`'));
  assert.match(route, /if \(!isConfiguredSuperadmin\(user\)\) query = query\.eq\("org_id", user\.org_id\)/);
  assert.match(route, /\.download\(requestRow\.proof_object_path\)/);
  const dto = server.slice(server.indexOf("function paymentRequestDto"), server.indexOf("function legacyPaymentRequestDto"));
  assert.doesNotMatch(dto, /proof_object_path:/);
});

test("admin review is server-authorized and rejection never credits billing", () => {
  assert.match(server, /superadmin\/manual-requests`, requireAuth, requireSuperadmin/);
  assert.match(server, /superadmin\/manual-requests\/:id\/approve`, requireAuth, requireSuperadmin/);
  assert.match(server, /superadmin\/manual-requests\/:id\/reject`, requireAuth, requireSuperadmin/);
  const reject = server.slice(server.indexOf('app.post(`${API_PREFIX}/superadmin/manual-requests/:id/reject`'), server.indexOf('app.delete(`${API_PREFIX}/superadmin/manual-requests/:id`'));
  assert.match(reject, /\.eq\("status", "submitted"\)/);
  assert.match(reject, /status: "rejected"/);
  assert.doesNotMatch(reject, /apply_billing_mutation|billing_transactions|billing_balance/);
});

test("approval is atomic, authoritative, and exactly-once through Billing Core", () => {
  assert.match(migration, /FROM public\.manual_payment_requests[\s\S]{0,180}FOR UPDATE/);
  assert.match(migration, /v_new_request\.tokens_requested/);
  assert.match(migration, /v_new_request\.amount_requested/);
  assert.match(migration, /public\.apply_billing_mutation\(/);
  assert.match(migration, /'manual'[\s\S]{0,100}v_new_request\.id::text/);
  assert.match(migration, /SET status = 'approved'[\s\S]{0,220}billing_ledger_id = v_billing_result->>'ledger_id'/);
  assert.match(migration, /IF v_new_request\.status = 'approved'/);
  assert.match(migration, /duplicate', true/);
  assert.doesNotMatch(server, /UPDATE\s+billing_balance|from\("billing_balance"\)\.update/i);
});

test("Billing Core RPC privileges remain service-role-only", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.approve_manual_payment_with_billing\(text, uuid, text\)[\s\S]{0,80}PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.approve_manual_payment_with_billing\(text, uuid, text\)[\s\S]{0,60}service_role/);
});

test("direct payment is primary UI and direct balance topUp is deprecated", () => {
  assert.doesNotMatch(billing, /Midtrans|Snap|snap\.pay|VITE_MIDTRANS/);
  assert.match(billing, /Lanjutkan Pembayaran/);
  assert.match(billing, /Kirim untuk Verifikasi/);
  assert.match(billing, /Menunggu Verifikasi/);
  assert.match(api, /Top-up saldo langsung tidak tersedia/);
  assert.doesNotMatch(api.slice(api.indexOf("async topUp"), api.indexOf("async createMidtransPayment")), /apiFetch/);
});

test("user UI has truthful loading, empty, upload, submit, approved, and rejected states", () => {
  for (const phrase of [
    "Memuat metode pembayaran", "Belum ada rekening atau QRIS aktif", "Memuat riwayat",
    "Belum ada riwayat pembayaran", "Menunggu Bukti Pembayaran", "Menunggu Verifikasi",
    "Disetujui", "Ditolak", "Alasan:", "Saldo tidak bertambah saat bukti dikirim",
  ]) assert.match(billing + server, new RegExp(phrase));
  assert.match(billing, /accept="image\/jpeg,image\/png,image\/webp,application\/pdf"/);
  assert.match(billing, /disabled=\{!proof \|\| Boolean\(mutation\)\}/);
});

test("admin queue has proof, action-specific confirmations, and mutation lock", () => {
  assert.match(admin, /Verifikasi Pembayaran Manual/);
  assert.match(api, /getSuperadminManualRequests\(status = "submitted"\)/);
  assert.match(server, /requestQuery = requestQuery\.eq\("status", statusFilter\)/);
  assert.match(server, /\.limit\(100\)/);
  assert.match(admin, /Setujui & Tambahkan Saldo/);
  assert.match(admin, /payment_reference/);
  assert.match(admin, /handleViewPaymentProof/);
  assert.match(admin, /Ya, Tolak Pembayaran/);
  assert.match(admin, /closeDisabled=\{submittingProcess\}/);
  assert.doesNotMatch(admin, /Hapus Riwayat|handleDeleteRequest/);
});

test("legacy gateway is not a primary dependency and unsafe C-01 route is disabled", () => {
  assert.match(server, /Webhook gateway legacy tidak aktif/);
  assert.match(server, /return c\.json\(jsonFail\("Webhook gateway legacy tidak aktif"\), 410\)/);
  assert.doesNotMatch(billing, /createMidtransPayment|Bayar Sekarang/);
  assert.match(server, /Historical gateway records remain visible for compatibility/);
});

test("payment request listing and proof access are tenant-scoped", () => {
  const list = server.slice(server.indexOf('app.get(`${API_PREFIX}/billing/manual-requests`, requireAuth'), server.indexOf('app.post(`${API_PREFIX}/billing/manual-requests`, requireAuth'));
  assert.match(list, /\.eq\("org_id", user\.org_id\)/);
  assert.match(list, /payment_request:\$\{user\.org_id\}:/);
  assert.doesNotMatch(list, /client.*org_id/i);
});

test("responsive flow and accessible form/modal contracts are present", () => {
  assert.match(billing, /grid grid-cols-1 xl:grid-cols-2/);
  assert.match(billing, /flex flex-col-reverse sm:flex-row/);
  assert.match(billing, /maxWidthClassName="max-w-xl"/);
  assert.match(billing, /htmlFor="topup-token-amount"/);
  assert.match(billing, /htmlFor="payment-proof"/);
  assert.match(billing, /aria-describedby="payment-proof-help payment-flow-error"/);
  assert.match(admin, /overflow-x-auto/);
});

// Model the financial invariant independently of SQL execution. This does not
// replace cloud migration verification; it proves the intended retry contract.
test("modeled double approval credits exactly once", () => {
  const state = { status: "submitted", balance: 0, ledger: new Map() };
  const approve = () => {
    if (state.status === "approved") return { duplicate: true };
    const key = "manual:request-1";
    if (!state.ledger.has(key)) {
      state.balance += 500;
      state.ledger.set(key, 500);
    }
    state.status = "approved";
    return { duplicate: false };
  };
  assert.equal(approve().duplicate, false);
  assert.equal(approve().duplicate, true);
  assert.equal(state.balance, 500);
  assert.equal(state.ledger.size, 1);
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}
console.log(`Batch 9 Direct Payment & Manual Verification regression: ${passed}/${tests.length} PASS`);
