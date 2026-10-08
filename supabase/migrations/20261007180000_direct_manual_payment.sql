-- Batch 9: direct payment + manual verification.
-- This migration is intentionally gateway-independent. It preserves the
-- legacy key_info approval path while making the new relational request path
-- authoritative and idempotent through the existing Billing Core.

CREATE TABLE IF NOT EXISTS public.payment_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method text NOT NULL CHECK (method IN ('bank_transfer', 'qris_static')),
  provider_name text NOT NULL CHECK (length(trim(provider_name)) BETWEEN 1 AND 120),
  account_reference text,
  account_holder text,
  qris_object_path text,
  instructions text,
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_destinations_method_details_check CHECK (
    (method = 'bank_transfer' AND nullif(trim(account_reference), '') IS NOT NULL
      AND nullif(trim(account_holder), '') IS NOT NULL)
    OR
    (method = 'qris_static' AND nullif(trim(qris_object_path), '') IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_payment_destinations_active_order
  ON public.payment_destinations (active, display_order, created_at);

CREATE TABLE IF NOT EXISTS public.manual_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  tokens_requested bigint NOT NULL CHECK (tokens_requested > 0),
  token_price_idr numeric NOT NULL CHECK (token_price_idr > 0),
  amount_requested numeric NOT NULL CHECK (amount_requested > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('bank_transfer', 'qris_static')),
  destination_account_id uuid NOT NULL REFERENCES public.payment_destinations(id) ON DELETE RESTRICT,
  payment_reference text NOT NULL UNIQUE CHECK (length(payment_reference) BETWEEN 12 AND 40),
  proof_object_path text,
  proof_mime_type text,
  proof_size_bytes bigint CHECK (proof_size_bytes IS NULL OR proof_size_bytes BETWEEN 1 AND 5242880),
  note text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  rejection_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  billing_ledger_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_payment_proof_metadata_check CHECK (
    (proof_object_path IS NULL AND proof_mime_type IS NULL AND proof_size_bytes IS NULL)
    OR
    (proof_object_path IS NOT NULL AND proof_mime_type IS NOT NULL AND proof_size_bytes IS NOT NULL)
  ),
  CONSTRAINT manual_payment_review_state_check CHECK (
    (status = 'draft' AND submitted_at IS NULL AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR
    (status = 'submitted' AND submitted_at IS NOT NULL AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR
    (status IN ('approved', 'rejected') AND submitted_at IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT manual_payment_approval_ledger_check CHECK (
    (status = 'approved' AND billing_ledger_id IS NOT NULL)
    OR (status <> 'approved')
  ),
  CONSTRAINT manual_payment_rejection_reason_check CHECK (
    (status = 'rejected' AND nullif(trim(rejection_reason), '') IS NOT NULL)
    OR (status <> 'rejected' AND rejection_reason IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_manual_payment_requests_org_created
  ON public.manual_payment_requests (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_manual_payment_requests_review_queue
  ON public.manual_payment_requests (status, submitted_at DESC)
  WHERE status = 'submitted';

CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_payment_requests_billing_ledger
  ON public.manual_payment_requests (billing_ledger_id)
  WHERE billing_ledger_id IS NOT NULL;

ALTER TABLE public.payment_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_payment_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_destinations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.manual_payment_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.payment_destinations TO service_role;
GRANT ALL ON TABLE public.manual_payment_requests TO service_role;

-- Private buckets. Browser clients never receive unrestricted object URLs;
-- authenticated server routes proxy authorized reads.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-assets',
  'payment-assets',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

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
  v_new_request_id uuid;
  v_new_org_id uuid;
  v_new_request public.manual_payment_requests%ROWTYPE;
BEGIN
  IF p_request_key IS NULL OR p_request_key NOT LIKE 'payment_request:%' THEN
    RAISE EXCEPTION 'payment request key tidak valid' USING ERRCODE = '22023';
  END IF;

  -- New relational request path. Invalid/non-UUID legacy keys safely fall
  -- through to the backward-compatible key_info path below.
  BEGIN
    v_new_org_id := split_part(p_request_key, ':', 2)::uuid;
    v_new_request_id := split_part(p_request_key, ':', 3)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_new_org_id := NULL;
    v_new_request_id := NULL;
  END;

  IF v_new_request_id IS NOT NULL AND v_new_org_id IS NOT NULL THEN
    SELECT * INTO v_new_request
    FROM public.manual_payment_requests
    WHERE id = v_new_request_id AND org_id = v_new_org_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_new_request.status = 'approved' THEN
        SELECT jsonb_build_object(
          'applied', false,
          'duplicate', true,
          'ledger_id', id,
          'applied_delta', tokens_delta,
          'balance_before', balance_before,
          'new_balance', balance_after,
          'provider', provider,
          'external_reference', external_reference
        ) INTO v_billing_result
        FROM public.billing_transactions
        WHERE provider = 'manual' AND external_reference = v_new_request.id::text
        LIMIT 1;

        RETURN jsonb_build_object(
          'approved', true,
          'duplicate', true,
          'request', to_jsonb(v_new_request),
          'billing', coalesce(v_billing_result, '{}'::jsonb)
        );
      END IF;

      IF v_new_request.status <> 'submitted' THEN
        RAISE EXCEPTION 'permintaan pembayaran belum siap atau sudah diproses'
          USING ERRCODE = '22023';
      END IF;
      IF v_new_request.proof_object_path IS NULL THEN
        RAISE EXCEPTION 'bukti pembayaran belum tersedia' USING ERRCODE = '22023';
      END IF;

      v_billing_result := public.apply_billing_mutation(
        v_new_request.org_id,
        v_new_request.tokens_requested,
        'topup',
        v_new_request.amount_requested,
        format('Top-up manual disetujui (%s token)', v_new_request.tokens_requested),
        'manual_payment_request',
        v_new_request.id::text,
        p_actor_user_id,
        'manual',
        v_new_request.id::text,
        jsonb_build_object(
          'payment_reference', v_new_request.payment_reference,
          'reviewer_email', nullif(trim(coalesce(p_actor_email, '')), '')
        ),
        false
      );

      UPDATE public.manual_payment_requests
      SET status = 'approved',
          reviewed_at = v_approved_at,
          reviewed_by = p_actor_user_id,
          rejection_reason = NULL,
          billing_ledger_id = v_billing_result->>'ledger_id',
          updated_at = v_approved_at
      WHERE id = v_new_request.id
      RETURNING * INTO v_new_request;

      RETURN jsonb_build_object(
        'approved', true,
        'duplicate', coalesce((v_billing_result->>'duplicate')::boolean, false),
        'request', to_jsonb(v_new_request),
        'billing', v_billing_result
      );
    END IF;
  END IF;

  -- Legacy compatibility for already-created key_info requests.
  SELECT value INTO v_request
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
      'applied', false, 'duplicate', true, 'ledger_id', id,
      'applied_delta', tokens_delta, 'balance_before', balance_before,
      'new_balance', balance_after, 'provider', provider,
      'external_reference', external_reference
    ) INTO v_billing_result
    FROM public.billing_transactions
    WHERE provider = 'manual' AND external_reference = v_request_id
    LIMIT 1;

    RETURN jsonb_build_object(
      'approved', true, 'duplicate', true, 'request', v_request,
      'billing', coalesce(v_billing_result, '{}'::jsonb)
    );
  END IF;

  IF v_request->>'status' <> 'pending' THEN
    RAISE EXCEPTION 'permintaan pembayaran sudah diproses dengan status %', v_request->>'status'
      USING ERRCODE = '22023';
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
    v_org_id, v_tokens, 'topup', v_amount_idr,
    format('Top-up manual disetujui (%s token)', v_tokens),
    'manual_payment_request', v_request_id, p_actor_user_id,
    'manual', v_request_id, jsonb_build_object('request_key', p_request_key), false
  );

  v_request := v_request || jsonb_build_object(
    'status', 'approved', 'approved_at', v_approved_at,
    'approved_by', p_actor_email,
    'billing_ledger_id', v_billing_result->>'ledger_id'
  );

  UPDATE public.key_info SET value = v_request WHERE key = p_request_key;

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
