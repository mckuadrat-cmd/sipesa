-- SIPESA Billing Core
--
-- Gateway-independent, atomic balance mutation with database-enforced
-- idempotency. This migration intentionally does not alter pricing or payment
-- provider verification. It also does not backfill legacy ledger rows because
-- historical provider references are not complete enough to do that safely.

ALTER TABLE public.billing_transactions
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS balance_before bigint,
  ADD COLUMN IF NOT EXISTS balance_after bigint,
  ADD COLUMN IF NOT EXISTS mutation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_transactions_provider_reference
  ON public.billing_transactions (provider, external_reference)
  WHERE provider IS NOT NULL AND external_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_transactions_org_created_at
  ON public.billing_transactions (org_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.apply_billing_mutation(
  p_org_id uuid,
  p_token_delta bigint,
  p_transaction_type text,
  p_amount_idr numeric,
  p_description text,
  p_ref_type text,
  p_ref_id text,
  p_actor_user_id uuid,
  p_provider text,
  p_external_reference text,
  p_metadata jsonb,
  p_floor_at_zero boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_external_reference text := trim(coalesce(p_external_reference, ''));
  v_description text := trim(coalesce(p_description, ''));
  v_balance_before bigint;
  v_balance_after bigint;
  v_applied_delta bigint;
  v_ledger_id text;
  v_existing record;
  v_transaction_type public.billing_transactions.type%TYPE;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_token_delta IS NULL OR p_token_delta = 0 THEN
    RAISE EXCEPTION 'token_delta harus berupa bilangan bulat bukan nol' USING ERRCODE = '22023';
  END IF;

  IF v_provider = '' OR length(v_provider) > 50 THEN
    RAISE EXCEPTION 'provider wajib diisi dan maksimal 50 karakter' USING ERRCODE = '22023';
  END IF;

  IF v_external_reference = '' OR length(v_external_reference) > 255 THEN
    RAISE EXCEPTION 'external_reference wajib diisi dan maksimal 255 karakter' USING ERRCODE = '22023';
  END IF;

  IF v_description = '' THEN
    RAISE EXCEPTION 'description/reason wajib diisi' USING ERRCODE = '22023';
  END IF;

  IF p_amount_idr IS NULL OR p_amount_idr < 0 THEN
    RAISE EXCEPTION 'amount_idr tidak valid' USING ERRCODE = '22023';
  END IF;

  -- Cast through the real ledger column type so this remains compatible when
  -- billing_transactions.type is a text column or a PostgreSQL enum.
  v_transaction_type := p_transaction_type;

  -- Fast idempotent replay path. The unique index below remains the authority
  -- for concurrent requests that both pass this check.
  SELECT id, org_id, type, tokens_delta, amount_idr, balance_before, balance_after
  INTO v_existing
  FROM public.billing_transactions
  WHERE provider = v_provider
    AND external_reference = v_external_reference
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.org_id IS DISTINCT FROM p_org_id
      OR v_existing.type IS DISTINCT FROM v_transaction_type
      OR v_existing.tokens_delta IS DISTINCT FROM p_token_delta
      OR v_existing.amount_idr IS DISTINCT FROM p_amount_idr THEN
      RAISE EXCEPTION 'idempotency key sudah digunakan dengan payload finansial berbeda'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'applied', false,
      'duplicate', true,
      'ledger_id', v_existing.id,
      'requested_delta', p_token_delta,
      'applied_delta', v_existing.tokens_delta,
      'balance_before', v_existing.balance_before,
      'new_balance', v_existing.balance_after,
      'provider', v_provider,
      'external_reference', v_external_reference
    );
  END IF;

  -- Keep creation of the zero balance row in the same database transaction.
  -- Existing SIPESA code already relies on billing_balance(org_id) being a
  -- unique conflict target and on defaults for other balance columns.
  INSERT INTO public.billing_balance (org_id, tokens_balance, updated_at)
  VALUES (p_org_id, 0, now())
  ON CONFLICT (org_id) DO NOTHING;

  BEGIN
    SELECT tokens_balance::bigint
    INTO v_balance_before
    FROM public.billing_balance
    WHERE org_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'billing balance tidak ditemukan untuk org %', p_org_id;
    END IF;

    v_balance_after := v_balance_before + p_token_delta;
    IF v_balance_after < 0 THEN
      IF coalesce(p_floor_at_zero, false) THEN
        v_balance_after := 0;
      ELSE
        RAISE EXCEPTION 'saldo token tidak mencukupi' USING ERRCODE = '22003';
      END IF;
    END IF;

    v_applied_delta := v_balance_after - v_balance_before;

    UPDATE public.billing_balance
    SET tokens_balance = v_balance_after,
        updated_at = now()
    WHERE org_id = p_org_id;

    INSERT INTO public.billing_transactions (
      org_id,
      type,
      tokens_delta,
      amount_idr,
      description,
      ref_type,
      ref_id,
      created_by,
      provider,
      external_reference,
      balance_before,
      balance_after,
      mutation_metadata
    )
    VALUES (
      p_org_id,
      v_transaction_type,
      v_applied_delta,
      p_amount_idr,
      v_description,
      nullif(trim(coalesce(p_ref_type, '')), ''),
      nullif(trim(coalesce(p_ref_id, '')), ''),
      p_actor_user_id,
      v_provider,
      v_external_reference,
      v_balance_before,
      v_balance_after,
      coalesce(p_metadata, '{}'::jsonb)
    )
    RETURNING id::text INTO v_ledger_id;

    RETURN jsonb_build_object(
      'applied', true,
      'duplicate', false,
      'ledger_id', v_ledger_id,
      'requested_delta', p_token_delta,
      'applied_delta', v_applied_delta,
      'balance_before', v_balance_before,
      'new_balance', v_balance_after,
      'provider', v_provider,
      'external_reference', v_external_reference
    );
  EXCEPTION
    WHEN unique_violation THEN
      -- The nested block is a subtransaction. Its balance UPDATE is rolled
      -- back before this handler runs, so the concurrent winner is the only
      -- mutation that survives.
      SELECT id, org_id, type, tokens_delta, amount_idr, balance_before, balance_after
      INTO v_existing
      FROM public.billing_transactions
      WHERE provider = v_provider
        AND external_reference = v_external_reference
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE;
      END IF;

      IF v_existing.org_id IS DISTINCT FROM p_org_id
        OR v_existing.type IS DISTINCT FROM v_transaction_type
        OR v_existing.tokens_delta IS DISTINCT FROM p_token_delta
        OR v_existing.amount_idr IS DISTINCT FROM p_amount_idr THEN
        RAISE EXCEPTION 'idempotency key sudah digunakan dengan payload finansial berbeda'
          USING ERRCODE = '23505';
      END IF;

      RETURN jsonb_build_object(
        'applied', false,
        'duplicate', true,
        'ledger_id', v_existing.id,
        'requested_delta', p_token_delta,
        'applied_delta', v_existing.tokens_delta,
        'balance_before', v_existing.balance_before,
        'new_balance', v_existing.balance_after,
        'provider', v_provider,
        'external_reference', v_external_reference
      );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_billing_mutation(
  uuid, bigint, text, numeric, text, text, text, uuid, text, text, jsonb, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_billing_mutation(
  uuid, bigint, text, numeric, text, text, text, uuid, text, text, jsonb, boolean
) TO service_role;

CREATE OR REPLACE FUNCTION public.approve_manual_payment_with_billing(
  p_request_key text,
  p_actor_user_id uuid,
  p_actor_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request jsonb;
  v_request_id text;
  v_org_id uuid;
  v_tokens bigint;
  v_amount_idr numeric;
  v_billing_result jsonb;
  v_approved_at timestamptz := now();
BEGIN
  IF p_request_key IS NULL OR p_request_key NOT LIKE 'payment_request:%' THEN
    RAISE EXCEPTION 'payment request key tidak valid' USING ERRCODE = '22023';
  END IF;

  SELECT value
  INTO v_request
  FROM public.key_info
  WHERE key = p_request_key
  FOR UPDATE;

  IF NOT FOUND OR v_request IS NULL THEN
    RAISE EXCEPTION 'permintaan pembayaran tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  v_request_id := trim(coalesce(v_request->>'id', ''));
  IF v_request_id = '' THEN
    RAISE EXCEPTION 'payment request id tidak valid' USING ERRCODE = '22023';
  END IF;

  IF v_request->>'status' = 'approved' THEN
    SELECT jsonb_build_object(
      'applied', false,
      'duplicate', true,
      'ledger_id', id,
      'applied_delta', tokens_delta,
      'balance_before', balance_before,
      'new_balance', balance_after,
      'provider', provider,
      'external_reference', external_reference
    )
    INTO v_billing_result
    FROM public.billing_transactions
    WHERE provider = 'manual'
      AND external_reference = v_request_id
    LIMIT 1;

    RETURN jsonb_build_object(
      'approved', true,
      'duplicate', true,
      'request', v_request,
      'billing', coalesce(v_billing_result, '{}'::jsonb)
    );
  END IF;

  IF v_request->>'status' <> 'pending' THEN
    RAISE EXCEPTION 'permintaan pembayaran sudah diproses dengan status %', v_request->>'status'
      USING ERRCODE = '22023';
  END IF;

  IF coalesce(v_request->>'org_id', '') = '' THEN
    RAISE EXCEPTION 'org_id permintaan pembayaran tidak valid' USING ERRCODE = '22023';
  END IF;
  v_org_id := (v_request->>'org_id')::uuid;

  IF coalesce(v_request->>'amount_tokens', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'jumlah token permintaan pembayaran tidak valid' USING ERRCODE = '22023';
  END IF;
  v_tokens := (v_request->>'amount_tokens')::bigint;
  IF v_tokens <= 0 THEN
    RAISE EXCEPTION 'jumlah token harus lebih besar dari nol' USING ERRCODE = '22023';
  END IF;

  v_amount_idr := coalesce((v_request->>'amount_idr')::numeric, 0);
  IF v_amount_idr < 0 THEN
    RAISE EXCEPTION 'nominal pembayaran tidak valid' USING ERRCODE = '22023';
  END IF;

  v_billing_result := public.apply_billing_mutation(
    v_org_id,
    v_tokens,
    'topup',
    v_amount_idr,
    format('Top-up manual disetujui (%s token)', v_tokens),
    'manual_payment_request',
    v_request_id,
    p_actor_user_id,
    'manual',
    v_request_id,
    jsonb_build_object('request_key', p_request_key),
    false
  );

  v_request := v_request || jsonb_build_object(
    'status', 'approved',
    'approved_at', v_approved_at,
    'approved_by', p_actor_email,
    'billing_ledger_id', v_billing_result->>'ledger_id'
  );

  UPDATE public.key_info
  SET value = v_request
  WHERE key = p_request_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'gagal memperbarui permintaan pembayaran';
  END IF;

  RETURN jsonb_build_object(
    'approved', true,
    'duplicate', coalesce((v_billing_result->>'duplicate')::boolean, false),
    'request', v_request,
    'billing', v_billing_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_manual_payment_with_billing(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_manual_payment_with_billing(text, uuid, text)
  TO service_role;

-- Pre-deployment checks (read-only; intentionally not executed by migration):
--
-- 1. Legacy provider duplicates need human reconciliation before any backfill:
-- SELECT ref_type, ref_id, count(*)
-- FROM public.billing_transactions
-- WHERE ref_type IS NOT NULL AND ref_id IS NOT NULL
-- GROUP BY ref_type, ref_id
-- HAVING count(*) > 1;
--
-- 2. Approved manual requests without a canonical ledger need human review.
-- No legacy rows are deleted, merged, or silently backfilled by this migration.
