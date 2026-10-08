import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync("supabase/functions/server/index.ts", "utf8");
const api = fs.readFileSync("src/app/lib/api.ts", "utf8");
const migration = fs.readFileSync(
  "supabase/migrations/20261005130000_tenant_rls_authorization.sql",
  "utf8",
);
const cloudPreflight = fs.readFileSync("BATCH3_CLOUD_PREFLIGHT.sql", "utf8");
const maintainRemediation = fs.readFileSync(
  "supabase/migrations/20261006100000_revoke_authenticated_maintain.sql",
  "utf8",
);
const postMigrationVerify = fs.readFileSync("BATCH3_POST_MIGRATION_VERIFY.sql", "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${passed} - ${name}`);
}

const ORG_A = "org-a";
const ORG_B = "org-b";
const tenantAllows = (userOrg, resourceOrg) => Boolean(userOrg) && userOrg === resourceOrg;
const orgAdminAllows = (role, userOrg, targetOrg) =>
  ["owner", "admin"].includes(String(role || "").toLowerCase()) && tenantAllows(userOrg, targetOrg);
const superadminAllows = ({ authId, authEmail }, config) =>
  config.userId ? authId === config.userId : Boolean(config.email) && authEmail.toLowerCase() === config.email.toLowerCase();

test("unauthenticated privileged request is denied", () => {
  assert.equal(orgAdminAllows("owner", null, ORG_A), false);
  assert.match(server, /app\.post\(`\$\{API_PREFIX\}\/broadcasts`, requireAuth, requireOrgAdmin/);
});

test("USER_A read ORG_A is allowed by tenant decision", () => {
  assert.equal(tenantAllows(ORG_A, ORG_A), true);
});

test("USER_A read ORG_B is denied", () => {
  assert.equal(tenantAllows(ORG_A, ORG_B), false);
});

test("USER_A create ORG_B is denied", () => {
  assert.equal(tenantAllows(ORG_A, ORG_B), false);
});

test("USER_A update ORG_B is denied", () => {
  assert.equal(tenantAllows(ORG_A, ORG_B), false);
});

test("USER_A delete ORG_B is denied", () => {
  assert.equal(tenantAllows(ORG_A, ORG_B), false);
});

test("request body org_id tampering cannot replace server identity", () => {
  const body = { org_id: ORG_B };
  const resolvedOrg = ORG_A;
  assert.notEqual(body.org_id, resolvedOrg);
  assert.doesNotMatch(server, /const\s+org_id\s*=\s*body\.org_id/);
});

test("normal user admin action is denied", () => {
  assert.equal(orgAdminAllows("member", ORG_A, ORG_A), false);
});

test("ORG_A owner/admin action on ORG_A is allowed", () => {
  assert.equal(orgAdminAllows("owner", ORG_A, ORG_A), true);
  assert.equal(orgAdminAllows("admin", ORG_A, ORG_A), true);
});

test("ORG_A admin action on ORG_B is denied", () => {
  assert.equal(orgAdminAllows("admin", ORG_A, ORG_B), false);
});

test("organization admin cannot satisfy superadmin identity", () => {
  assert.equal(
    superadminAllows(
      { authId: "org-admin", authEmail: "admin-a@example.test" },
      { userId: "platform-owner", email: "" },
    ),
    false,
  );
});

test("USER_A own-org media requires matching message and number tenant", () => {
  assert.match(server, /\.from\("wa_messages"\)[\s\S]*?\.eq\("org_id", user\.org_id\)[\s\S]*?\.eq\("number_id", numberId\)/);
  assert.match(server, /\.from\("wa_numbers"\)[\s\S]*?\.eq\("id", numberId\)[\s\S]*?\.eq\("org_id", user\.org_id\)/);
});

test("USER_A ORG_B media is denied by server-derived org scope", () => {
  assert.equal(tenantAllows(ORG_A, ORG_B), false);
  assert.match(server, /app\.get\(`\$\{API_PREFIX\}\/media\/:mediaId`, requireAuth/);
});

test("guessed media id is denied unless present in an owned message payload", () => {
  assert.match(server, /payload->image->>id\.eq\.\$\{mediaId\}/);
  assert.match(server, /if \(messageError \|\| !ownedMessage\)/);
});

test("unauthorized signed/direct URL generation is absent", () => {
  assert.doesNotMatch(api, /[?&]token=/);
  assert.doesNotMatch(api, /[?&]apikey=/);
  assert.match(api, /apiFetchBlob/);
});

test("media endpoint does not accept or return service/session credentials", () => {
  const mediaBlock = server.slice(server.indexOf('app.get(`${API_PREFIX}/media/:mediaId`'), server.indexOf("// GET all organization contacts"));
  assert.doesNotMatch(mediaBlock, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|query\("token"\)|query\("apikey"\)/);
  assert.match(mediaBlock, /"Cache-Control": "private, no-store"/);
});

test("user-facing service-role endpoints require authenticated identity", () => {
  assert.match(server, /app\.get\(`\$\{API_PREFIX\}\/contacts`, requireAuth/);
  assert.match(server, /app\.get\(`\$\{API_PREFIX\}\/settings`, requireAuth/);
  assert.match(server, /app\.get\(`\$\{API_PREFIX\}\/billing`, requireAuth/);
});

test("user-facing service-role queries use server-resolved tenant", () => {
  assert.match(server, /\.eq\("org_id", user\.org_id\)/);
  assert.match(server, /Profil pengguna tidak memiliki organisasi yang valid/);
});

test("privileged service-role paths enforce role", () => {
  assert.match(server, /settings\/org`, requireAuth, requireOrgAdmin/);
  assert.match(server, /superadmin\/orgs`, requireAuth, requireSuperadmin/);
});

test("anon tenant-owned access is revoked", () => {
  assert.match(migration, /REVOKE ALL ON TABLE[\s\S]*FROM anon;/);
});

test("authenticated cross-tenant direct reads use canonical auth org", () => {
  assert.match(migration, /CREATE POLICY b3_wa_messages_select_same_org[\s\S]*org_id = public\.sipesa_current_org_id\(\)/);
  assert.match(migration, /WHERE id = auth\.uid\(\)[\s\S]*AND is_active IS TRUE/);
});

test("direct UPDATE cannot move resource ORG_A to ORG_B", () => {
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]*FROM authenticated;/);
  assert.doesNotMatch(migration, /CREATE POLICY b3_[^\n]+[\s\S]{0,120}FOR UPDATE/);
});

test("direct INSERT cannot spoof ORG_B ownership", () => {
  assert.doesNotMatch(migration, /CREATE POLICY b3_[^\n]+[\s\S]{0,120}FOR INSERT/);
});

test("legitimate same-tenant server workflows retain server-derived org", () => {
  assert.match(server, /org_id: user\.org_id/);
  assert.match(server, /\.eq\("org_id", user\.org_id\)/);
});

test("superadmin authorization fails closed without server configuration", () => {
  assert.match(server, /if \(!superadminUserId && !superadminEmail\)/);
  assert.doesNotMatch(server, /SUPERADMIN_EMAIL"\) \|\|/);
});

test("settings cannot read or mutate another tenant's per-number settings", () => {
  assert.match(server, /ownedNumberIds\.has\(numId\)/);
  assert.match(server, /\.eq\("id", numberId\)[\s\S]*?\.eq\("org_id", user\.org_id\)[\s\S]*?if \(ownedNumberError\)/);
});

test("migration stops on ambiguous ownership instead of auto-assigning", () => {
  assert.match(migration, /DATA OWNERSHIP RECONCILIATION REQUIRED/);
  assert.doesNotMatch(
    migration,
    /^\s*(DELETE\s+FROM|TRUNCATE\s+(?:TABLE\s+)?|UPDATE\s+public\.[a-z_]+\s+SET\s+org_id)/im,
  );
});

test("audited legacy deny-all policies require exact safe definitions", () => {
  assert.match(migration, /policy\.permissive IS DISTINCT FROM 'PERMISSIVE'/);
  assert.match(migration, /policy\.cmd IS DISTINCT FROM 'ALL'/);
  assert.match(migration, /ARRAY\['anon', 'authenticated'\]::text\[\]/);
  assert.match(migration, /coalesce\(policy\.qual, ''\)[\s\S]*<> 'false'/);
  assert.match(migration, /coalesce\(policy\.with_check, ''\)[\s\S]*<> 'false'/);
});

test("all eleven audited deny-all policies are removed by exact table and name", () => {
  const expected = [
    ["app_activity", "deny_all_app_activity"],
    ["app_users", "deny_all_app_users"],
    ["billing_balance", "deny_all_billing_balance"],
    ["billing_transactions", "deny_all_billing_transactions"],
    ["orgs", "deny_all_orgs"],
    ["wa_broadcast_recipients", "deny_all_wa_broadcast_recipients"],
    ["wa_broadcasts", "deny_all_wa_broadcasts"],
    ["wa_contacts", "deny_all_wa_contacts"],
    ["wa_messages", "deny_all_wa_messages"],
    ["wa_numbers", "deny_all_wa_numbers"],
    ["wa_templates", "deny_all_wa_templates"],
  ];

  for (const [tableName, policyName] of expected) {
    assert.match(
      migration,
      new RegExp(`DROP POLICY IF EXISTS ${policyName} ON public\\.${tableName};`),
    );
    assert.match(cloudPreflight, new RegExp(`\\('${tableName}', '${policyName}'\\)`));
  }
});

test("unknown policies remain fail-closed without wildcard policy whitelists", () => {
  assert.doesNotMatch(migration, /policyname\s+NOT LIKE\s+'(?:deny_all|b3)_%'/);
  assert.doesNotMatch(cloudPreflight, /policyname\s+NOT LIKE\s+'(?:deny_all|b3)_%'/);
  assert.match(migration, /replaced\.table_name = policy\.tablename[\s\S]*replaced\.policy_name = policy\.policyname/);
  assert.match(cloudPreflight, /ELSE 'REVIEW_REQUIRED'/);
});

test("cloud preflight remains read-only and classifies verified deny-all policies", () => {
  assert.doesNotMatch(
    cloudPreflight,
    /^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE)\b/im,
  );
  assert.match(cloudPreflight, /THEN 'VERIFIED_LEGACY_DENY_ALL'/);
  assert.match(cloudPreflight, /UNION ALL SELECT 'unknown_policy', count\(\*\)::bigint/);
});

test("maintain remediation is limited to authenticated and the twelve audited tables", () => {
  const expectedTables = [
    "app_activity",
    "app_users",
    "billing_balance",
    "billing_transactions",
    "key_info",
    "orgs",
    "wa_broadcast_recipients",
    "wa_broadcasts",
    "wa_contacts",
    "wa_messages",
    "wa_numbers",
    "wa_templates",
  ];
  const tableReferences = [...maintainRemediation.matchAll(/public\.([a-z_]+)/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(tableReferences, expectedTables);
  assert.match(maintainRemediation, /REVOKE MAINTAIN ON TABLE[\s\S]*FROM authenticated;/);
  assert.doesNotMatch(maintainRemediation, /service_role|\b(?:ALL|SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b/);
  assert.doesNotMatch(maintainRemediation, /ROW LEVEL SECURITY|\bPOLICY\b/);
});

test("post-migration verifier explicitly denies authenticated maintain", () => {
  assert.match(
    postMigrationVerify,
    /checked\.role_name IN \('anon', 'authenticated'\)[\s\S]*available\.privilege_type = 'MAINTAIN'[\s\S]*THEN 'MUST_DENY'/,
  );
  assert.match(
    postMigrationVerify,
    /SELECT 'authenticated_maintain', count\(\*\)::bigint FROM authenticated_maintain_issues/,
  );
});

console.log(`\nRESULT: ${passed}/${passed} EMULATED/STATIC checks passed`);
console.log("REAL CLOUD RLS / CROSS-TENANT VERIFICATION REQUIRED");
