-- Keep recipient order stable and coordinate broadcast workers across Edge isolates.

ALTER TABLE public.wa_broadcast_recipients
  ADD COLUMN IF NOT EXISTS sequence_no integer;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY broadcast_id
      ORDER BY created_at ASC, id ASC
    )::integer AS sequence_no
  FROM public.wa_broadcast_recipients
  WHERE sequence_no IS NULL
)
UPDATE public.wa_broadcast_recipients AS recipient
SET sequence_no = ranked.sequence_no
FROM ranked
WHERE recipient.id = ranked.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_broadcast_recipients_sequence
  ON public.wa_broadcast_recipients (broadcast_id, sequence_no)
  WHERE sequence_no IS NOT NULL;

ALTER TABLE public.wa_numbers
  ADD COLUMN IF NOT EXISTS broadcast_worker_token text,
  ADD COLUMN IF NOT EXISTS broadcast_worker_broadcast_id uuid,
  ADD COLUMN IF NOT EXISTS broadcast_worker_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS next_broadcast_send_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_wa_number_broadcast_worker(
  p_number_id uuid,
  p_org_id uuid,
  p_broadcast_id uuid,
  p_worker_token text,
  p_lease_seconds integer DEFAULT 75
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_count integer := 0;
  v_lease_seconds integer := greatest(15, least(coalesce(p_lease_seconds, 75), 600));
BEGIN
  UPDATE public.wa_numbers
  SET
    broadcast_worker_token = p_worker_token,
    broadcast_worker_broadcast_id = p_broadcast_id,
    broadcast_worker_lease_until = clock_timestamp() + make_interval(secs => v_lease_seconds)
  WHERE id = p_number_id
    AND org_id = p_org_id
    AND (
      broadcast_worker_token IS NULL
      OR broadcast_worker_lease_until IS NULL
      OR broadcast_worker_lease_until <= clock_timestamp()
      OR broadcast_worker_token = p_worker_token
    );

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN v_row_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_wa_number_broadcast_worker(uuid, uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wa_number_broadcast_worker(uuid, uuid, uuid, text, integer)
  TO service_role;
