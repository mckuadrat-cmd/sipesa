-- Batch 3: tenant isolation and direct-database authorization boundaries.
--
-- This migration is intentionally conservative. It does not assign ownership,
-- delete rows, or repair ambiguous data. Every ownership invariant is checked
-- before RLS or grants are changed; a failed assertion aborts the transaction.

DO $$
DECLARE
  v_table_name text;
  missing_count bigint;
  orphan_count bigint;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'app_users',
    'wa_numbers',
    'wa_contacts',
    'wa_messages',
    'wa_templates',
    'wa_broadcasts',
    'wa_broadcast_recipients',
    'billing_balance',
    'billing_transactions'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table_name)) IS NULL THEN
      RAISE EXCEPTION 'Batch 3 preflight: table public.% tidak ditemukan', v_table_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND information_schema.columns.table_name = v_table_name
        AND column_name = 'org_id'
    ) THEN
      RAISE EXCEPTION 'Batch 3 preflight: public.%.org_id tidak ditemukan', v_table_name;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id IS NULL', v_table_name)
      INTO missing_count;
    IF missing_count > 0 THEN
      RAISE EXCEPTION
        'DATA OWNERSHIP RECONCILIATION REQUIRED: public.% memiliki % row dengan org_id NULL',
        v_table_name,
        missing_count;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM public.%I child LEFT JOIN public.orgs parent ON parent.id = child.org_id WHERE parent.id IS NULL',
      v_table_name
    ) INTO orphan_count;
    IF orphan_count > 0 THEN
      RAISE EXCEPTION
        'DATA OWNERSHIP RECONCILIATION REQUIRED: public.% memiliki % orphan organization',
        v_table_name,
        orphan_count;
    END IF;
  END LOOP;

  FOREACH v_table_name IN ARRAY ARRAY['orgs', 'app_activity', 'key_info', 'meta_auto_reply_claims']
  LOOP
    IF to_regclass(format('public.%I', v_table_name)) IS NULL THEN
      RAISE EXCEPTION 'Batch 3 preflight: table public.% tidak ditemukan', v_table_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.wa_messages message
    JOIN public.wa_numbers number ON number.id = message.number_id
    WHERE message.org_id IS DISTINCT FROM number.org_id
  ) THEN
    RAISE EXCEPTION 'DATA OWNERSHIP RECONCILIATION REQUIRED: tenant mismatch wa_messages -> wa_numbers';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wa_messages message
    JOIN public.wa_contacts contact ON contact.id = message.contact_id
    WHERE message.org_id IS DISTINCT FROM contact.org_id
  ) THEN
    RAISE EXCEPTION 'DATA OWNERSHIP RECONCILIATION REQUIRED: tenant mismatch wa_messages -> wa_contacts';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wa_broadcasts broadcast
    JOIN public.wa_numbers number ON number.id = broadcast.number_id
    WHERE broadcast.org_id IS DISTINCT FROM number.org_id
  ) THEN
    RAISE EXCEPTION 'DATA OWNERSHIP RECONCILIATION REQUIRED: tenant mismatch wa_broadcasts -> wa_numbers';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wa_broadcasts broadcast
    JOIN public.wa_templates template ON template.id = broadcast.template_id
    WHERE broadcast.org_id IS DISTINCT FROM template.org_id
  ) THEN
    RAISE EXCEPTION 'DATA OWNERSHIP RECONCILIATION REQUIRED: tenant mismatch wa_broadcasts -> wa_templates';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wa_broadcast_recipients recipient
    JOIN public.wa_broadcasts broadcast ON broadcast.id = recipient.broadcast_id
    WHERE recipient.org_id IS DISTINCT FROM broadcast.org_id
  ) THEN
    RAISE EXCEPTION 'DATA OWNERSHIP RECONCILIATION REQUIRED: tenant mismatch recipients -> broadcasts';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wa_broadcast_recipients recipient
    JOIN public.wa_contacts contact ON contact.id = recipient.contact_id
    WHERE recipient.org_id IS DISTINCT FROM contact.org_id
  ) THEN
    RAISE EXCEPTION 'DATA OWNERSHIP RECONCILIATION REQUIRED: tenant mismatch recipients -> contacts';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.meta_auto_reply_claims claim
    JOIN public.wa_numbers number ON number.id = claim.number_id
    JOIN public.wa_contacts contact ON contact.id = claim.contact_id
    WHERE number.org_id IS DISTINCT FROM contact.org_id
  ) THEN
    RAISE EXCEPTION 'DATA OWNERSHIP RECONCILIATION REQUIRED: tenant mismatch meta_auto_reply_claims';
  END IF;

  -- A permissive USING/WITH CHECK false policy does not override a permissive
  -- allow policy: PostgreSQL combines permissive policies with OR. Accept the
  -- audited legacy deny-all policies only when their table, name, command,
  -- roles, mode, and expressions match exactly. They are removed below before
  -- the canonical Batch 3 policies are created.
  IF EXISTS (
    WITH audited_deny_all(table_name, policy_name) AS (
      VALUES
        ('app_activity', 'deny_all_app_activity'),
        ('app_users', 'deny_all_app_users'),
        ('billing_balance', 'deny_all_billing_balance'),
        ('billing_transactions', 'deny_all_billing_transactions'),
        ('orgs', 'deny_all_orgs'),
        ('wa_broadcast_recipients', 'deny_all_wa_broadcast_recipients'),
        ('wa_broadcasts', 'deny_all_wa_broadcasts'),
        ('wa_contacts', 'deny_all_wa_contacts'),
        ('wa_messages', 'deny_all_wa_messages'),
        ('wa_numbers', 'deny_all_wa_numbers'),
        ('wa_templates', 'deny_all_wa_templates')
    )
    SELECT 1
    FROM pg_policies policy
    JOIN audited_deny_all audited
      ON audited.table_name = policy.tablename
     AND audited.policy_name = policy.policyname
    WHERE policy.schemaname = 'public'
      AND (
        policy.permissive IS DISTINCT FROM 'PERMISSIVE'
        OR policy.cmd IS DISTINCT FROM 'ALL'
        OR (
          SELECT array_agg(role_name::text ORDER BY role_name::text)
          FROM unnest(policy.roles) role_name
        ) IS DISTINCT FROM ARRAY['anon', 'authenticated']::text[]
        OR lower(regexp_replace(coalesce(policy.qual, ''), '[[:space:]()]', '', 'g')) <> 'false'
        OR lower(regexp_replace(coalesce(policy.with_check, ''), '[[:space:]()]', '', 'g')) <> 'false'
      )
  ) THEN
    RAISE EXCEPTION
      'Batch 3 preflight: definisi policy deny-all legacy tidak sesuai hasil audit; review pg_policies sebelum apply';
  END IF;

  -- Refuse every policy that will not be replaced by exact table/name below or
  -- was not one of the exact, definition-verified legacy deny-all policies.
  IF EXISTS (
    WITH audited_deny_all(table_name, policy_name) AS (
      VALUES
        ('app_activity', 'deny_all_app_activity'),
        ('app_users', 'deny_all_app_users'),
        ('billing_balance', 'deny_all_billing_balance'),
        ('billing_transactions', 'deny_all_billing_transactions'),
        ('orgs', 'deny_all_orgs'),
        ('wa_broadcast_recipients', 'deny_all_wa_broadcast_recipients'),
        ('wa_broadcasts', 'deny_all_wa_broadcasts'),
        ('wa_contacts', 'deny_all_wa_contacts'),
        ('wa_messages', 'deny_all_wa_messages'),
        ('wa_numbers', 'deny_all_wa_numbers'),
        ('wa_templates', 'deny_all_wa_templates')
    ),
    replaced_policies(table_name, policy_name) AS (
      VALUES
        ('wa_broadcast_recipients', 'select_wa_broadcast_recipients'),
        ('orgs', 'b3_orgs_select_same_org'),
        ('app_users', 'b3_app_users_select_self'),
        ('wa_numbers', 'b3_wa_numbers_select_same_org'),
        ('wa_contacts', 'b3_wa_contacts_select_same_org'),
        ('wa_messages', 'b3_wa_messages_select_same_org'),
        ('wa_templates', 'b3_wa_templates_select_same_org'),
        ('wa_broadcasts', 'b3_wa_broadcasts_select_same_org'),
        ('wa_broadcast_recipients', 'b3_wa_broadcast_recipients_select_same_org'),
        ('billing_balance', 'b3_billing_balance_select_same_org'),
        ('billing_transactions', 'b3_billing_transactions_select_same_org'),
        ('app_activity', 'b3_app_activity_select_same_org')
    )
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = ANY (ARRAY[
        'orgs', 'app_users', 'wa_numbers', 'wa_contacts', 'wa_messages',
        'wa_templates', 'wa_broadcasts', 'wa_broadcast_recipients',
        'billing_balance', 'billing_transactions', 'app_activity', 'key_info',
        'meta_auto_reply_claims'
      ])
      AND NOT EXISTS (
        SELECT 1
        FROM audited_deny_all audited
        WHERE audited.table_name = policy.tablename
          AND audited.policy_name = policy.policyname
      )
      AND NOT EXISTS (
        SELECT 1
        FROM replaced_policies replaced
        WHERE replaced.table_name = policy.tablename
          AND replaced.policy_name = policy.policyname
      )
  ) THEN
    RAISE EXCEPTION
      'Batch 3 preflight: policy existing yang belum diaudit ditemukan; review pg_policies sebelum apply';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sipesa_current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id
  FROM public.app_users
  WHERE id = auth.uid()
    AND is_active IS TRUE
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.sipesa_current_org_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sipesa_current_org_id() TO authenticated, service_role;

ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.key_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_auto_reply_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_wa_broadcast_recipients ON public.wa_broadcast_recipients;

-- These exact legacy policies were definition-checked in the preflight above.
-- Because permissive false policies are OR-combined with permissive allow
-- policies, retaining them would be redundant and misleading rather than an
-- effective deny layer.
DROP POLICY IF EXISTS deny_all_app_activity ON public.app_activity;
DROP POLICY IF EXISTS deny_all_app_users ON public.app_users;
DROP POLICY IF EXISTS deny_all_billing_balance ON public.billing_balance;
DROP POLICY IF EXISTS deny_all_billing_transactions ON public.billing_transactions;
DROP POLICY IF EXISTS deny_all_orgs ON public.orgs;
DROP POLICY IF EXISTS deny_all_wa_broadcast_recipients ON public.wa_broadcast_recipients;
DROP POLICY IF EXISTS deny_all_wa_broadcasts ON public.wa_broadcasts;
DROP POLICY IF EXISTS deny_all_wa_contacts ON public.wa_contacts;
DROP POLICY IF EXISTS deny_all_wa_messages ON public.wa_messages;
DROP POLICY IF EXISTS deny_all_wa_numbers ON public.wa_numbers;
DROP POLICY IF EXISTS deny_all_wa_templates ON public.wa_templates;

DROP POLICY IF EXISTS b3_orgs_select_same_org ON public.orgs;
CREATE POLICY b3_orgs_select_same_org ON public.orgs
  FOR SELECT TO authenticated
  USING (id = public.sipesa_current_org_id());

DROP POLICY IF EXISTS b3_app_users_select_self ON public.app_users;
CREATE POLICY b3_app_users_select_self ON public.app_users
  FOR SELECT TO authenticated
  USING (id = auth.uid() AND org_id = public.sipesa_current_org_id());

DROP POLICY IF EXISTS b3_wa_numbers_select_same_org ON public.wa_numbers;
CREATE POLICY b3_wa_numbers_select_same_org ON public.wa_numbers
  FOR SELECT TO authenticated
  USING (org_id = public.sipesa_current_org_id());

DROP POLICY IF EXISTS b3_wa_contacts_select_same_org ON public.wa_contacts;
CREATE POLICY b3_wa_contacts_select_same_org ON public.wa_contacts
  FOR SELECT TO authenticated
  USING (org_id = public.sipesa_current_org_id());

DROP POLICY IF EXISTS b3_wa_messages_select_same_org ON public.wa_messages;
CREATE POLICY b3_wa_messages_select_same_org ON public.wa_messages
  FOR SELECT TO authenticated
  USING (org_id = public.sipesa_current_org_id());

DROP POLICY IF EXISTS b3_wa_templates_select_same_org ON public.wa_templates;
CREATE POLICY b3_wa_templates_select_same_org ON public.wa_templates
  FOR SELECT TO authenticated
  USING (org_id = public.sipesa_current_org_id());

DROP POLICY IF EXISTS b3_wa_broadcasts_select_same_org ON public.wa_broadcasts;
CREATE POLICY b3_wa_broadcasts_select_same_org ON public.wa_broadcasts
  FOR SELECT TO authenticated
  USING (org_id = public.sipesa_current_org_id());

DROP POLICY IF EXISTS b3_wa_broadcast_recipients_select_same_org ON public.wa_broadcast_recipients;
CREATE POLICY b3_wa_broadcast_recipients_select_same_org ON public.wa_broadcast_recipients
  FOR SELECT TO authenticated
  USING (org_id = public.sipesa_current_org_id());

DROP POLICY IF EXISTS b3_billing_balance_select_same_org ON public.billing_balance;
CREATE POLICY b3_billing_balance_select_same_org ON public.billing_balance
  FOR SELECT TO authenticated
  USING (org_id = public.sipesa_current_org_id());

DROP POLICY IF EXISTS b3_billing_transactions_select_same_org ON public.billing_transactions;
CREATE POLICY b3_billing_transactions_select_same_org ON public.billing_transactions
  FOR SELECT TO authenticated
  USING (org_id = public.sipesa_current_org_id());

DROP POLICY IF EXISTS b3_app_activity_select_same_org ON public.app_activity;
CREATE POLICY b3_app_activity_select_same_org ON public.app_activity
  FOR SELECT TO authenticated
  USING (org_id = public.sipesa_current_org_id());

-- All application writes flow through the authenticated Edge Function, which
-- performs role and tenant checks before its service-role client mutates data.
-- No INSERT/UPDATE/DELETE policy is created for anon/authenticated.
REVOKE ALL ON TABLE
  public.orgs,
  public.app_users,
  public.wa_numbers,
  public.wa_contacts,
  public.wa_messages,
  public.wa_templates,
  public.wa_broadcasts,
  public.wa_broadcast_recipients,
  public.billing_balance,
  public.billing_transactions,
  public.app_activity,
  public.key_info,
  public.meta_auto_reply_claims
FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.orgs,
  public.app_users,
  public.wa_numbers,
  public.wa_contacts,
  public.wa_messages,
  public.wa_templates,
  public.wa_broadcasts,
  public.wa_broadcast_recipients,
  public.billing_balance,
  public.billing_transactions,
  public.app_activity,
  public.key_info,
  public.meta_auto_reply_claims
FROM authenticated;

-- Never expose credential-bearing/internal tables directly. wa_numbers is
-- served through a redacted API response; key_info and claims are internal.
REVOKE SELECT ON TABLE public.wa_numbers, public.key_info, public.meta_auto_reply_claims
FROM authenticated;

GRANT SELECT ON TABLE
  public.orgs,
  public.app_users,
  public.wa_contacts,
  public.wa_messages,
  public.wa_templates,
  public.wa_broadcasts,
  public.wa_broadcast_recipients,
  public.billing_balance,
  public.billing_transactions,
  public.app_activity
TO authenticated;

-- Diagnostic queries to run manually before applying in Supabase Cloud:
--
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename = ANY (ARRAY[
--     'orgs','app_users','wa_numbers','wa_contacts','wa_messages','wa_templates',
--     'wa_broadcasts','wa_broadcast_recipients','billing_balance',
--     'billing_transactions','app_activity','key_info','meta_auto_reply_claims'
--   ]);
--
-- SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
