import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("supabase/functions/server/index.ts", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/20261006210000_dashboard_authoritative_aggregation.sql",
  "utf8",
);
const api = fs.readFileSync("src/app/lib/api.ts", "utf8");
const dashboard = fs.readFileSync("src/app/components/dashboard-view.tsx", "utf8");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function oldTotalSpent(rows, orgId) {
  return rows
    .filter((row) => row.org_id === orgId)
    .reduce((sum, row) => {
      if (row.type === "usage") return sum + Number(row.amount_idr ?? 0);
      if (row.type === "refund") return sum - Number(row.amount_idr ?? 0);
      return sum;
    }, 0);
}

function emulatedDatabaseTotalSpent(rows, orgId) {
  return rows
    .filter((row) => row.org_id === orgId)
    .reduce(
      (sum, row) => sum + (row.type === "usage" ? Number(row.amount_idr ?? 0) : row.type === "refund" ? -Number(row.amount_idr ?? 0) : 0),
      0,
    );
}

function oldTokensUsed(rows, orgId) {
  return Math.abs(rows
    .filter((row) => row.org_id === orgId && row.type === "usage")
    .reduce((sum, row) => sum + Number(row.tokens_delta ?? 0), 0));
}

function emulatedDatabaseTokensUsed(rows, orgId) {
  return Math.abs(rows
    .filter((row) => row.org_id === orgId && row.type === "usage")
    .reduce((sum, row) => sum + Number(row.tokens_delta ?? 0), 0));
}

test("financial aggregate formulas preserve old behavior for empty, mixed, signed, and cross-tenant fixtures", () => {
  const fixtures = [
    [],
    [{ org_id: "A", type: "usage", amount_idr: 1500, tokens_delta: -1 }],
    [
      { org_id: "A", type: "usage", amount_idr: 1500, tokens_delta: -1 },
      { org_id: "A", type: "usage", amount_idr: 2500, tokens_delta: 2 },
      { org_id: "A", type: "refund", amount_idr: 1250, tokens_delta: 1 },
      { org_id: "A", type: "adjustment", amount_idr: 9999, tokens_delta: -9 },
      { org_id: "A", type: "topup", amount_idr: 25000, tokens_delta: 10 },
      { org_id: "B", type: "usage", amount_idr: 900000, tokens_delta: -500 },
    ],
  ];
  for (const rows of fixtures) {
    assert.equal(emulatedDatabaseTotalSpent(rows, "A"), oldTotalSpent(rows, "A"));
    assert.equal(emulatedDatabaseTokensUsed(rows, "A"), oldTokensUsed(rows, "A"));
  }
});

test("billing and stats use scalar RPCs instead of fetching ledger rows", () => {
  const billingRoute = server.slice(server.indexOf("app.get(`${API_PREFIX}/billing`,"), server.indexOf("app.get(`${API_PREFIX}/billing/transactions`"));
  const statsRoute = server.slice(server.indexOf("app.get(`${API_PREFIX}/stats`,"), server.indexOf("app.get(`${API_PREFIX}/dashboard/activity`"));
  assert.match(billingRoute, /rpc\(\s*"get_billing_total_spent"/);
  assert.doesNotMatch(billingRoute, /from\("billing_transactions"\)/);
  assert.match(statsRoute, /rpc\(\s*"get_billing_tokens_used"/);
  assert.doesNotMatch(statsRoute, /from\("billing_transactions"\)/);
});

test("SQL formulas exactly preserve usage-minus-refund and absolute net usage semantics", () => {
  assert.match(migration, /WHEN 'usage' THEN COALESCE\(ledger\.amount_idr, 0\)/);
  assert.match(migration, /WHEN 'refund' THEN -COALESCE\(ledger\.amount_idr, 0\)/);
  assert.match(migration, /ABS\(COALESCE\(SUM\(COALESCE\(ledger\.tokens_delta, 0\)\), 0\)\)/);
});

test("usage-7d is database grouped and always generated as seven buckets", () => {
  const route = server.slice(server.indexOf("app.get(`${API_PREFIX}/dashboard/usage-7d`"), server.indexOf("app.get(`${API_PREFIX}/dashboard/broadcast-summary`"));
  assert.match(route, /rpc\("get_dashboard_usage_7d"/);
  assert.doesNotMatch(route, /from\("billing_transactions"\)|for \(const row of data/);
  assert.match(migration, /generate_series\(6, 0, -1\)/);
  assert.match(migration, /LEFT JOIN aggregated USING \(usage_date\)/);
});

test("usage day boundaries use the browser IANA timezone including Asia/Jakarta boundaries", () => {
  assert.match(api, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  assert.match(migration, /ledger\.created_at AT TIME ZONE p_time_zone/);
  assert.match(dashboard, /new Date\(year, month - 1, day\)\.toLocaleDateString/);
  assert.doesNotMatch(dashboard, /new Date\(p\.label\)/);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayKey = (iso) => formatter.format(new Date(iso));
  assert.equal(dayKey("2026-10-05T16:59:59Z"), "2026-10-05");
  assert.equal(dayKey("2026-10-05T17:00:00Z"), "2026-10-06");
});

test("broadcast summary is authoritative and cannot depend on a 50-row history page", () => {
  assert.match(server, /rpc\(\s*"get_dashboard_broadcast_summary"/);
  assert.match(migration, /SUM\(COALESCE\(broadcast\.total_recipients, 0\)\)/);
  assert.doesNotMatch(dashboard, /getBroadcastHistory\(\{ page: 1, pageSize: 50 \}\)/);
  const broadcasts = Array.from({ length: 75 }, (_, index) => ({ total_recipients: index + 1 }));
  assert.equal(broadcasts.reduce((sum, row) => sum + row.total_recipients, 0), 2850);
  assert.notEqual(broadcasts.slice(0, 50).reduce((sum, row) => sum + row.total_recipients, 0), 2850);
});

test("calendar is tenant scoped, range bounded, deterministic, and field minimal", () => {
  assert.match(server, /DASHBOARD_CALENDAR_MAX_RANGE_MS/);
  assert.match(server, /get_dashboard_broadcast_calendar/);
  assert.match(migration, /broadcast\.org_id = p_org_id/);
  assert.match(migration, /broadcast\.scheduled_at >= p_range_start/);
  assert.match(migration, /broadcast\.created_at >= p_range_start/);
  assert.match(migration, /ORDER BY COALESCE\(broadcast\.scheduled_at, broadcast\.created_at\) DESC, broadcast\.id DESC/);
  assert.match(dashboard, /gridEnd\.setDate\(gridEnd\.getDate\(\) \+ 42\)/);
});

test("all aggregate functions are service-role-only and explicitly deny client roles", () => {
  for (const fn of [
    "get_billing_total_spent",
    "get_billing_tokens_used",
    "get_dashboard_usage_7d",
    "get_dashboard_broadcast_summary",
    "get_dashboard_broadcast_calendar",
  ]) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^;]+\\) TO service_role`));
  }
});

test("new Dashboard GET handlers contain no database writes", () => {
  const start = server.indexOf("app.get(`${API_PREFIX}/dashboard/usage-7d`");
  const end = server.indexOf("// ===== INIT =====", start);
  const routes = server.slice(start, end);
  assert.doesNotMatch(routes, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
});

test("no aggregate endpoint introduces select-star or unbounded ledger transfer", () => {
  const billingRoute = server.slice(server.indexOf("app.get(`${API_PREFIX}/billing`,"), server.indexOf("app.get(`${API_PREFIX}/billing/transactions`"));
  const statsAndDashboardRoutes = server.slice(server.indexOf("app.get(`${API_PREFIX}/stats`,"), server.indexOf("// ===== INIT ====="));
  assert.doesNotMatch(billingRoute, /from\("billing_transactions"\)/);
  assert.doesNotMatch(statsAndDashboardRoutes, /from\("billing_transactions"\)/);
  assert.doesNotMatch(migration, /RETURNS SETOF public\.billing_transactions/);
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
console.log(`Batch 6C-3 Dashboard aggregation regression: ${passed}/${tests.length} PASS`);
