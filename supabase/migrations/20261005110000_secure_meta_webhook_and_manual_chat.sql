-- Batch 2: Meta webhook idempotency, auto-reply claims, and manual-chat state.
-- This migration does not alter payment gateways, pricing, or historical rows.

-- Fail visibly if production/staging already contains duplicate provider IDs.
-- No row is deleted or merged automatically. Reconcile duplicates manually,
-- then rerun this migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.wa_messages
    WHERE meta_message_id IS NOT NULL
      AND trim(meta_message_id) <> ''
    GROUP BY meta_message_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'duplicate wa_messages.meta_message_id ditemukan; reconciliation manual wajib sebelum unique index';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_messages_meta_message_id
  ON public.wa_messages (meta_message_id)
  WHERE meta_message_id IS NOT NULL AND trim(meta_message_id) <> '';

ALTER TABLE public.wa_messages
  ADD COLUMN IF NOT EXISTS manual_send_reference text,
  ADD COLUMN IF NOT EXISTS manual_billing_state text,
  ADD COLUMN IF NOT EXISTS manual_billing_ledger_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_messages_org_manual_send_reference
  ON public.wa_messages (org_id, manual_send_reference)
  WHERE manual_send_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.meta_auto_reply_claims (
  number_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  claim_date date NOT NULL,
  inbound_message_id text NOT NULL,
  status text NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed', 'sent', 'failed', 'skipped_existing')),
  reply_meta_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (number_id, contact_id, claim_date)
);

REVOKE ALL ON TABLE public.meta_auto_reply_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_auto_reply_claims TO service_role;

CREATE OR REPLACE FUNCTION public.claim_meta_auto_reply(
  p_number_id uuid,
  p_contact_id uuid,
  p_claim_date date,
  p_inbound_message_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF p_number_id IS NULL OR p_contact_id IS NULL OR p_claim_date IS NULL
    OR trim(coalesce(p_inbound_message_id, '')) = '' THEN
    RAISE EXCEPTION 'auto-reply claim input tidak valid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.meta_auto_reply_claims (
    number_id,
    contact_id,
    claim_date,
    inbound_message_id
  )
  VALUES (
    p_number_id,
    p_contact_id,
    p_claim_date,
    p_inbound_message_id
  )
  ON CONFLICT (number_id, contact_id, claim_date) DO UPDATE
  SET inbound_message_id = EXCLUDED.inbound_message_id,
      status = 'claimed',
      reply_meta_message_id = NULL,
      updated_at = now()
  WHERE public.meta_auto_reply_claims.status = 'failed';

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_meta_auto_reply(uuid, uuid, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_meta_auto_reply(uuid, uuid, date, text)
  TO service_role;

-- Compensate an existing debit only. This avoids granting credit when a
-- caller cannot tell whether an earlier debit RPC committed before a network
-- error. The canonical Batch 1A function still owns balance + ledger writes.
CREATE OR REPLACE FUNCTION public.compensate_billing_mutation(
  p_org_id uuid,
  p_original_provider text,
  p_external_reference text,
  p_refund_provider text,
  p_description text,
  p_ref_type text,
  p_ref_id text,
  p_actor_user_id uuid,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original record;
BEGIN
  SELECT org_id, tokens_delta, amount_idr, id
  INTO v_original
  FROM public.billing_transactions
  WHERE provider = lower(trim(coalesce(p_original_provider, '')))
    AND external_reference = trim(coalesce(p_external_reference, ''))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'applied', false,
      'duplicate', false,
      'original_missing', true,
      'provider', lower(trim(coalesce(p_refund_provider, ''))),
      'external_reference', trim(coalesce(p_external_reference, ''))
    );
  END IF;

  IF v_original.org_id IS DISTINCT FROM p_org_id OR v_original.tokens_delta >= 0 THEN
    RAISE EXCEPTION 'original billing mutation tidak valid untuk kompensasi'
      USING ERRCODE = '22023';
  END IF;

  RETURN public.apply_billing_mutation(
    p_org_id,
    -v_original.tokens_delta,
    'refund',
    v_original.amount_idr,
    p_description,
    p_ref_type,
    p_ref_id,
    p_actor_user_id,
    p_refund_provider,
    p_external_reference,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'compensates_ledger_id', v_original.id,
      'compensates_provider', p_original_provider
    ),
    false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compensate_billing_mutation(
  uuid, text, text, text, text, text, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compensate_billing_mutation(
  uuid, text, text, text, text, text, text, uuid, jsonb
) TO service_role;

-- Read-only duplicate preflight, useful before applying this migration:
-- SELECT meta_message_id, count(*), array_agg(id ORDER BY created_at)
-- FROM public.wa_messages
-- WHERE meta_message_id IS NOT NULL AND trim(meta_message_id) <> ''
-- GROUP BY meta_message_id
-- HAVING count(*) > 1;
