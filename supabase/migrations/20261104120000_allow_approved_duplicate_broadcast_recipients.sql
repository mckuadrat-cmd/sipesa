-- Allow duplicate broadcast rows only when the user explicitly approved them.
-- The canonical four-argument preflight remains available for older clients.
CREATE OR REPLACE FUNCTION public.preflight_wa_broadcast_recipients(
  p_broadcast_id uuid,
  p_org_id uuid,
  p_body_variable_count integer,
  p_requires_media boolean,
  p_allow_duplicates boolean
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
  v_result record;
  v_restored_count integer := 0;
BEGIN
  SELECT *
  INTO v_result
  FROM public.preflight_wa_broadcast_recipients(
    p_broadcast_id,
    p_org_id,
    p_body_variable_count,
    p_requires_media
  );

  IF coalesce(p_allow_duplicates, false) THEN
    UPDATE public.wa_broadcast_recipients
    SET status = 'pending', error = NULL, updated_at = clock_timestamp()
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

