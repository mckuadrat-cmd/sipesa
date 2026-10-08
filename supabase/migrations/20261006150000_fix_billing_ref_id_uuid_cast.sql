-- Fix the Billing Core boundary when the legacy RPC transports UUID ref_id as text.
-- billing_transactions.ref_id remains uuid; external_reference remains text.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'billing_transactions'
      AND column_name = 'ref_id'
      AND udt_name = 'uuid'
  ) THEN
    RAISE EXCEPTION 'EXPECTED SCHEMA MISMATCH: public.billing_transactions.ref_id must be uuid';
  END IF;
END;
$$;

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
  v_ref_id uuid;
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

  IF nullif(trim(coalesce(p_ref_id, '')), '') IS NOT NULL THEN
    BEGIN
      v_ref_id := trim(p_ref_id)::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'ref_id harus UUID; gunakan external_reference untuk identifier text'
          USING ERRCODE = '22023';
    END;
  END IF;

  -- Cast through the real ledger column type so this remains compatible when
  -- billing_transactions.type is a text column or a PostgreSQL enum.
  v_transaction_type := p_transaction_type;

  -- Fast idempotent replay path. external_reference intentionally remains text.
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
      v_ref_id,
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
