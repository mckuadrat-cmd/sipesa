-- Batch 8A-1.1a: durable, atomic, set-based broadcast recipient preflight.
-- Campaign size remains capped at 500 in application/server code.

BEGIN;

ALTER TABLE public.wa_broadcasts
  ADD COLUMN IF NOT EXISTS recipient_preflight_status text,
  ADD COLUMN IF NOT EXISTS recipient_preflight_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS recipient_preflight_completed_at timestamptz;

-- Queued includes future scheduled campaigns that have not started. Campaigns
-- which are already sending, paused, or terminal must not be reset.
UPDATE public.wa_broadcasts
SET
  recipient_preflight_status = CASE
    WHEN status::text = 'queued' THEN 'pending'
    ELSE 'completed'
  END,
  recipient_preflight_completed_at = CASE
    WHEN status::text = 'queued' THEN NULL
    ELSE coalesce(recipient_preflight_completed_at, updated_at, created_at, clock_timestamp())
  END
WHERE recipient_preflight_status IS NULL;

ALTER TABLE public.wa_broadcasts
  ALTER COLUMN recipient_preflight_status SET DEFAULT 'pending',
  ALTER COLUMN recipient_preflight_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.wa_broadcasts'::regclass
      AND conname = 'wa_broadcasts_recipient_preflight_status_check'
  ) THEN
    ALTER TABLE public.wa_broadcasts
      ADD CONSTRAINT wa_broadcasts_recipient_preflight_status_check
      CHECK (recipient_preflight_status IN ('pending', 'completed'));
  END IF;
END;
$$;

-- Exact SQL equivalent of normalizePhone() in server/index.ts. This function
-- is genuinely immutable: it reads no table, role, time, locale, or session
-- setting and uses ASCII-only transformations.
CREATE OR REPLACE FUNCTION public.normalize_wa_destination(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  v_raw text := btrim(coalesce(p_phone, ''));
BEGIN
  v_raw := regexp_replace(v_raw, '[^0-9+]', '', 'g');
  IF v_raw = '' THEN RETURN ''; END IF;
  IF v_raw LIKE '08%' THEN RETURN '+628' || substr(v_raw, 3); END IF;
  IF v_raw LIKE '8%' THEN RETURN '+62' || v_raw; END IF;
  IF v_raw LIKE '62%' THEN RETURN '+' || v_raw; END IF;
  IF left(v_raw, 1) <> '+' THEN RETURN '+' || v_raw; END IF;
  RETURN v_raw;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_wa_destination_reason(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  v_input text := btrim(coalesce(p_phone, ''));
  v_normalized text := public.normalize_wa_destination(p_phone);
  v_digits text;
  v_length integer;
BEGIN
  IF v_input = '' THEN RETURN 'Nomor kosong'; END IF;
  v_digits := regexp_replace(v_normalized, '[^0-9]', '', 'g');
  v_length := length(v_digits);
  IF v_digits = '' OR v_length < 9 OR v_length > 15 THEN
    RETURN format(
      'Panjang nomor (%s digit) tidak standar (minimal 9, maksimal 15 digit)',
      v_length
    );
  END IF;
  IF v_normalized !~ '^\+[1-9][0-9]{8,14}$' THEN
    RETURN 'Format E.164 tidak valid';
  END IF;
  IF v_normalized ~ '^\+?(628000|62000|00000)' THEN
    RETURN 'Nomor terindikasi nomor fiktif / dummy';
  END IF;
  RETURN NULL;
END;
$$;

-- Malformed JSON is data-invalid, not a transaction-fatal SQL exception.
CREATE OR REPLACE FUNCTION public.try_parse_broadcast_payload(p_payload text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
BEGIN
  IF p_payload IS NULL THEN RETURN NULL; END IF;
  RETURN p_payload::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_wa_broadcast_recipient_reason(
  p_phone_e164 text,
  p_message text,
  p_mode text,
  p_body_variable_count integer,
  p_requires_media boolean
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  v_reason text;
  v_payload jsonb;
  v_variables jsonb;
  v_index integer;
  v_required_count integer := greatest(coalesce(p_body_variable_count, 0), 0);
BEGIN
  v_reason := public.validate_wa_destination_reason(p_phone_e164);
  IF v_reason IS NOT NULL THEN RETURN v_reason; END IF;

  IF btrim(coalesce(p_message, '')) = '' THEN
    RETURN 'Payload recipient kosong';
  END IF;

  IF lower(coalesce(p_mode, '')) = 'template' THEN
    v_payload := public.try_parse_broadcast_payload(p_message);
    IF v_payload IS NULL OR coalesce(v_payload->>'kind', '') <> 'template_payload' THEN
      RETURN 'Payload template recipient malformed';
    END IF;

    v_variables := CASE
      WHEN jsonb_typeof(v_payload->'bodyVariables') = 'array'
        THEN v_payload->'bodyVariables'
      ELSE '[]'::jsonb
    END;

    IF v_required_count > 0 THEN
      FOR v_index IN 0..(v_required_count - 1) LOOP
        IF btrim(coalesce(v_variables->>v_index, '')) = '' THEN
          RETURN format('Variable template {{%s}} kosong', v_index + 1);
        END IF;
      END LOOP;
    END IF;

    IF coalesce(p_requires_media, false)
       AND btrim(coalesce(v_payload->>'mediaUrl', '')) = '' THEN
      RETURN 'Media header template wajib diisi';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.preflight_wa_broadcast_recipients(
  p_broadcast_id uuid,
  p_org_id uuid,
  p_body_variable_count integer DEFAULT 0,
  p_requires_media boolean DEFAULT false
)
RETURNS TABLE (
  preflight_status text,
  rejected_count integer,
  already_completed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broadcast public.wa_broadcasts%ROWTYPE;
  v_rejected_count integer := 0;
BEGIN
  SELECT *
  INTO v_broadcast
  FROM public.wa_broadcasts
  WHERE id = p_broadcast_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Broadcast tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  IF v_broadcast.recipient_preflight_status = 'completed' THEN
    RETURN QUERY SELECT 'completed'::text, 0, true;
    RETURN;
  END IF;

  IF v_broadcast.status::text IN ('cancelled', 'completed', 'failed') THEN
    UPDATE public.wa_broadcasts
    SET
      recipient_preflight_status = 'completed',
      recipient_preflight_completed_at = coalesce(recipient_preflight_completed_at, clock_timestamp()),
      updated_at = clock_timestamp()
    WHERE id = p_broadcast_id
      AND org_id = p_org_id;
    RETURN QUERY SELECT 'completed'::text, 0, false;
    RETURN;
  END IF;

  UPDATE public.wa_broadcasts
  SET recipient_preflight_started_at = coalesce(recipient_preflight_started_at, clock_timestamp())
  WHERE id = p_broadcast_id
    AND org_id = p_org_id;

  WITH evaluated AS (
    SELECT
      recipient.id,
      public.validate_wa_broadcast_recipient_reason(
        recipient.phone_e164,
        recipient.message,
        v_broadcast.mode::text,
        p_body_variable_count,
        p_requires_media
      ) AS validation_reason,
      row_number() OVER (
        PARTITION BY public.normalize_wa_destination(recipient.phone_e164)
        ORDER BY
          recipient.sequence_no ASC NULLS LAST,
          recipient.created_at ASC,
          recipient.id ASC
      ) AS duplicate_rank
    FROM public.wa_broadcast_recipients AS recipient
    WHERE recipient.broadcast_id = p_broadcast_id
      AND recipient.org_id = p_org_id
  ), rejected AS (
    UPDATE public.wa_broadcast_recipients AS recipient
    SET
      status = 'failed',
      error = 'RECIPIENT_VALIDATION_FAILED: ' ||
        CASE
          WHEN evaluated.validation_reason IS NOT NULL THEN evaluated.validation_reason
          ELSE 'Nomor duplikat dalam broadcast yang sama'
        END,
      updated_at = clock_timestamp()
    FROM evaluated
    WHERE recipient.id = evaluated.id
      AND recipient.status::text = 'pending'
      AND (
        evaluated.validation_reason IS NOT NULL
        OR evaluated.duplicate_rank > 1
      )
    RETURNING recipient.id
  )
  SELECT count(*)::integer
  INTO v_rejected_count
  FROM rejected;

  UPDATE public.wa_broadcasts
  SET
    recipient_preflight_status = 'completed',
    recipient_preflight_completed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  WHERE id = p_broadcast_id
    AND org_id = p_org_id;

  RETURN QUERY SELECT 'completed'::text, v_rejected_count, false;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_wa_destination(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_wa_destination_reason(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.try_parse_broadcast_payload(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_wa_broadcast_recipient_reason(text, text, text, integer, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preflight_wa_broadcast_recipients(uuid, uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.preflight_wa_broadcast_recipients(uuid, uuid, integer, boolean)
  TO service_role;

COMMIT;
