-- Batch 5: atomically claim due broadcasts for a server-side scheduler.

ALTER TABLE public.wa_broadcasts
  ADD COLUMN IF NOT EXISTS scheduler_claim_token text,
  ADD COLUMN IF NOT EXISTS scheduler_claim_until timestamptz,
  ADD COLUMN IF NOT EXISTS scheduler_last_claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_wa_broadcasts_scheduler_due
  ON public.wa_broadcasts (scheduled_at, created_at)
  WHERE status IN (
    'queued'::public.broadcast_status,
    'sending'::public.broadcast_status
  );

CREATE OR REPLACE FUNCTION public.claim_due_wa_broadcasts(
  p_claim_token text,
  p_limit integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 180
)
RETURNS TABLE (
  id uuid,
  org_id uuid,
  number_id uuid,
  created_by uuid,
  scheduled_at timestamptz,
  recovered_stale_claim boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 5), 25));
  v_lease_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 180), 900));
BEGIN
  IF nullif(trim(coalesce(p_claim_token, '')), '') IS NULL THEN
    RAISE EXCEPTION 'claim token wajib diisi' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      broadcast.id,
      broadcast.status::text AS previous_status,
      broadcast.scheduler_claim_until
    FROM public.wa_broadcasts AS broadcast
    WHERE (
        broadcast.status::text = 'queued'
        AND (broadcast.scheduled_at IS NULL OR broadcast.scheduled_at <= clock_timestamp())
      )
      OR (
        broadcast.status::text = 'sending'
        AND (
          broadcast.scheduler_claim_until IS NULL
          OR broadcast.scheduler_claim_until <= clock_timestamp()
        )
        AND EXISTS (
          SELECT 1
          FROM public.wa_broadcast_recipients AS recipient
          WHERE recipient.broadcast_id = broadcast.id
            AND recipient.org_id = broadcast.org_id
            AND recipient.status::text IN ('pending', 'processing')
        )
      )
    ORDER BY broadcast.scheduled_at ASC NULLS FIRST, broadcast.created_at ASC, broadcast.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ), claimed AS (
    UPDATE public.wa_broadcasts AS broadcast
    SET
      status = 'sending'::public.broadcast_status,
      scheduler_claim_token = trim(p_claim_token),
      scheduler_claim_until = clock_timestamp() + make_interval(secs => v_lease_seconds),
      scheduler_last_claimed_at = clock_timestamp(),
      started_at = coalesce(broadcast.started_at, clock_timestamp()),
      updated_at = clock_timestamp()
    FROM candidates
    WHERE broadcast.id = candidates.id
    RETURNING
      broadcast.id,
      broadcast.org_id,
      broadcast.number_id,
      broadcast.created_by,
      broadcast.scheduled_at,
      candidates.previous_status = 'sending' AS recovered_stale_claim
  )
  SELECT
    claimed.id,
    claimed.org_id,
    claimed.number_id,
    claimed.created_by,
    claimed.scheduled_at,
    claimed.recovered_stale_claim
  FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_wa_broadcasts(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_wa_broadcasts(text, integer, integer)
  TO service_role;
