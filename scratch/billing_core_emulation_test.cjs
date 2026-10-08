// Batch 1A Billing Core transaction-model tests.
//
// These tests deliberately emulate PostgreSQL transaction semantics. They are
// useful regression checks, but they do NOT prove real PostgreSQL locking or
// concurrency behavior. Run the migration tests against staging before release.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

class BillingCoreModel {
  constructor() {
    this.balance = new Map();
    this.ledger = new Map();
    this.manualRequests = new Map();
    this.tail = Promise.resolve();
  }

  exclusive(action) {
    const run = this.tail.then(action, action);
    this.tail = run.catch(() => undefined);
    return run;
  }

  mutateState(state, input, fault) {
    if (!input.orgId || !Number.isInteger(input.delta) || input.delta === 0) {
      throw new Error("invalid financial input");
    }
    if (!input.provider || !input.reference || !input.description) {
      throw new Error("invalid idempotency/audit input");
    }
    if (!Number.isFinite(input.amountIdr) || input.amountIdr < 0) {
      throw new Error("invalid amount");
    }

    const key = `${input.provider.toLowerCase()}:${input.reference}`;
    const existing = state.ledger.get(key);
    if (existing) {
      if (
        existing.orgId !== input.orgId ||
        existing.delta !== input.delta ||
        existing.amountIdr !== input.amountIdr
      ) {
        throw new Error("idempotency payload mismatch");
      }
      return { ...existing, applied: false, duplicate: true };
    }

    if (fault === "balance") throw new Error("injected balance failure");

    const before = state.balance.get(input.orgId) ?? 0;
    const after = before + input.delta;
    if (after < 0) throw new Error("insufficient balance");
    state.balance.set(input.orgId, after);

    if (fault === "ledger") throw new Error("injected ledger failure");

    const row = {
      orgId: input.orgId,
      delta: input.delta,
      amountIdr: input.amountIdr,
      before,
      after,
      reason: input.description,
      actor: input.actor ?? null,
      key,
    };
    state.ledger.set(key, row);
    return { ...row, applied: true, duplicate: false };
  }

  async mutate(input, fault) {
    return this.exclusive(async () => {
      const state = {
        balance: new Map(this.balance),
        ledger: new Map(this.ledger),
      };
      const result = this.mutateState(state, input, fault);
      this.balance = state.balance;
      this.ledger = state.ledger;
      return result;
    });
  }

  async approveManual(requestId, actor = "admin@example.test") {
    return this.exclusive(async () => {
      const balances = new Map(this.balance);
      const ledger = new Map(this.ledger);
      const requests = new Map(
        [...this.manualRequests].map(([key, value]) => [key, { ...value }]),
      );
      const request = requests.get(requestId);
      if (!request) throw new Error("manual request not found");

      const result = this.mutateState(
        { balance: balances, ledger },
        {
          orgId: request.orgId,
          delta: request.tokens,
          amountIdr: request.amountIdr,
          provider: "manual",
          reference: requestId,
          description: `Manual approval ${requestId}`,
          actor,
        },
      );
      request.status = "approved";
      request.actor = actor;
      requests.set(requestId, request);

      this.balance = balances;
      this.ledger = ledger;
      this.manualRequests = requests;
      return result;
    });
  }
}

const event = (overrides = {}) => ({
  orgId: "org-a",
  delta: 10,
  amountIdr: 15000,
  provider: "test_provider",
  reference: "event-1",
  description: "Test mutation",
  actor: "actor-1",
  ...overrides,
});

async function main() {
  let core = new BillingCoreModel();

  const credit = await core.mutate(event());
  assert.equal(core.balance.get("org-a"), 10);
  assert.equal(core.ledger.size, 1);
  assert.deepEqual([credit.before, credit.after], [0, 10]);
  console.log("PASS A - credit keeps balance and ledger consistent");

  const debit = await core.mutate(event({ delta: -3, amountIdr: 4500, reference: "event-2" }));
  assert.deepEqual([debit.before, debit.after], [10, 7]);
  assert.equal(core.ledger.size, 2);
  console.log("PASS B - debit keeps balance and ledger consistent");

  const duplicate = await core.mutate(event());
  assert.equal(duplicate.duplicate, true);
  assert.equal(core.balance.get("org-a"), 7);
  assert.equal(core.ledger.size, 2);
  console.log("PASS C - duplicate reference mutates once");

  core = new BillingCoreModel();
  const concurrent = await Promise.all([
    core.mutate(event()),
    core.mutate(event()),
    core.mutate(event()),
  ]);
  assert.equal(concurrent.filter((row) => row.applied).length, 1);
  assert.equal(core.balance.get("org-a"), 10);
  assert.equal(core.ledger.size, 1);
  console.log("PASS D - emulated concurrent duplicate mutates once");

  core = new BillingCoreModel();
  core.manualRequests.set("manual-1", {
    orgId: "org-a", tokens: 12, amountIdr: 18000, status: "pending",
  });
  await core.approveManual("manual-1");
  const secondApproval = await core.approveManual("manual-1");
  assert.equal(secondApproval.duplicate, true);
  assert.equal(core.balance.get("org-a"), 12);
  assert.equal(core.ledger.size, 1);
  console.log("PASS E - repeated manual approval credits once");

  core = new BillingCoreModel();
  core.manualRequests.set("manual-2", {
    orgId: "org-a", tokens: 12, amountIdr: 18000, status: "pending",
  });
  const approvals = await Promise.all([
    core.approveManual("manual-2", "admin-a"),
    core.approveManual("manual-2", "admin-b"),
  ]);
  assert.equal(approvals.filter((row) => row.applied).length, 1);
  assert.equal(core.balance.get("org-a"), 12);
  assert.equal(core.ledger.size, 1);
  console.log("PASS F - emulated concurrent manual approval credits once");

  const adjustment = await core.mutate(event({
    delta: -2,
    amountIdr: 0,
    provider: "adjustment",
    reference: "adjust-1",
    description: "Correction with reason",
    actor: "superadmin-1",
  }));
  assert.deepEqual([adjustment.before, adjustment.after], [12, 10]);
  assert.equal(adjustment.reason, "Correction with reason");
  assert.equal(adjustment.actor, "superadmin-1");
  console.log("PASS G - adjustment records balance and audit fields");

  const beforeLedgerFailure = core.balance.get("org-a");
  const ledgerCount = core.ledger.size;
  await assert.rejects(
    core.mutate(event({ reference: "ledger-fail" }), "ledger"),
    /injected ledger failure/,
  );
  assert.equal(core.balance.get("org-a"), beforeLedgerFailure);
  assert.equal(core.ledger.size, ledgerCount);
  console.log("PASS H - ledger failure rolls balance back in emulated transaction");

  await assert.rejects(
    core.mutate(event({ reference: "balance-fail" }), "balance"),
    /injected balance failure/,
  );
  assert.equal(core.ledger.size, ledgerCount);
  console.log("PASS I - balance failure creates no successful ledger row");

  await assert.rejects(core.mutate(event({ delta: 0, reference: "invalid" })), /invalid/);
  assert.equal(core.balance.get("org-a"), beforeLedgerFailure);
  assert.equal(core.ledger.size, ledgerCount);
  console.log("PASS J - invalid input creates no mutation");

  const migrationPath = path.resolve(
    __dirname,
    "../supabase/migrations/20261005090000_create_atomic_billing_core.sql",
  );
  const sql = fs.readFileSync(migrationPath, "utf8");
  for (const requiredContract of [
    /FOR UPDATE/i,
    /CREATE UNIQUE INDEX[\s\S]+provider, external_reference/i,
    /WHEN unique_violation/i,
    /approve_manual_payment_with_billing/i,
    /REVOKE ALL ON FUNCTION public\.apply_billing_mutation/i,
    /TO service_role/i,
  ]) {
    assert.match(sql, requiredContract);
  }
  console.log("PASS CONTRACT - migration contains lock, uniqueness, rollback, and privilege controls");
  console.log("\nRESULT: 11/11 EMULATED/STATIC checks passed");
  console.log("STAGING DATABASE VERIFICATION REQUIRED");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
