-- Additive metadata for delivery diagnostics and authoritative Meta category provenance.
-- Existing legacy `error` strings and `meta_status_payload` remain supported.

ALTER TABLE public.wa_messages
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_subcode text,
  ADD COLUMN IF NOT EXISTS error_title text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS error_details text,
  ADD COLUMN IF NOT EXISTS error_type text,
  ADD COLUMN IF NOT EXISTS error_fbtrace_id text,
  ADD COLUMN IF NOT EXISTS error_http_status integer,
  ADD COLUMN IF NOT EXISTS failure_stage text,
  ADD COLUMN IF NOT EXISTS failure_source text,
  ADD COLUMN IF NOT EXISTS retry_classification text;

ALTER TABLE public.wa_broadcast_recipients
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_subcode text,
  ADD COLUMN IF NOT EXISTS error_title text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS error_details text,
  ADD COLUMN IF NOT EXISTS error_type text,
  ADD COLUMN IF NOT EXISTS error_fbtrace_id text,
  ADD COLUMN IF NOT EXISTS error_http_status integer,
  ADD COLUMN IF NOT EXISTS failure_stage text,
  ADD COLUMN IF NOT EXISTS failure_source text,
  ADD COLUMN IF NOT EXISTS retry_classification text,
  ADD COLUMN IF NOT EXISTS error_payload jsonb;

ALTER TABLE public.wa_templates
  ADD COLUMN IF NOT EXISTS category_source text NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS category_synced_at timestamptz;

UPDATE public.wa_templates
SET
  category_source = 'unknown',
  category_synced_at = NULL
WHERE meta_template_id IS NOT NULL
  AND category_source = 'local';

CREATE INDEX IF NOT EXISTS idx_wa_broadcast_recipients_error_code
  ON public.wa_broadcast_recipients (org_id, error_code)
  WHERE error_code IS NOT NULL;

COMMENT ON COLUMN public.wa_broadcast_recipients.error_payload IS
  'Raw provider error fragment for server-side audit. This column must not be returned verbatim to clients.';
COMMENT ON COLUMN public.wa_templates.category_source IS
  'Category provenance: meta, local, needs_sync, or unknown.';

-- Keep the approved repeated-recipient path consistent with the new columns.
CREATE OR REPLACE FUNCTION public.preflight_wa_broadcast_recipients(
  p_broadcast_id uuid,
  p_org_id uuid,
  p_body_variable_count integer,
  p_requires_media boolean,
  p_allow_duplicates boolean
)
RETURNS TABLE (preflight_status text, rejected_count integer, already_completed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result record;
  v_restored_count integer := 0;
BEGIN
  SELECT * INTO v_result
  FROM public.preflight_wa_broadcast_recipients(
    p_broadcast_id, p_org_id, p_body_variable_count, p_requires_media
  );

  IF coalesce(p_allow_duplicates, false) THEN
    UPDATE public.wa_broadcast_recipients
    SET
      status = 'pending', error = NULL, updated_at = clock_timestamp(),
      error_code = NULL, error_subcode = NULL, error_title = NULL,
      error_message = NULL, error_details = NULL, error_type = NULL,
      error_fbtrace_id = NULL, error_http_status = NULL,
      failure_stage = NULL, failure_source = NULL,
      retry_classification = NULL, error_payload = NULL
    WHERE broadcast_id = p_broadcast_id
      AND org_id = p_org_id
      AND status::text = 'failed'
      AND error = 'RECIPIENT_VALIDATION_FAILED: Nomor duplikat dalam broadcast yang sama';
    GET DIAGNOSTICS v_restored_count = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT
    coalesce(v_result.preflight_status, 'completed')::text,
    greatest(coalesce(v_result.rejected_count, 0) - v_restored_count, 0)::integer,
    coalesce(v_result.already_completed, false)::boolean;
END;
$$;

REVOKE ALL ON FUNCTION public.preflight_wa_broadcast_recipients(uuid, uuid, integer, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preflight_wa_broadcast_recipients(uuid, uuid, integer, boolean, boolean)
  TO service_role;
