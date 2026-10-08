-- Batch 6C-3 Partial: authoritative, bounded Dashboard aggregation.
-- All helpers are read-only and callable only by the server's service role.

CREATE OR REPLACE FUNCTION public.get_billing_total_spent(
  p_org_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT COALESCE(SUM(
    CASE ledger.type::text
      WHEN 'usage' THEN COALESCE(ledger.amount_idr, 0)
      WHEN 'refund' THEN -COALESCE(ledger.amount_idr, 0)
      ELSE 0
    END
  ), 0)::numeric
  FROM public.billing_transactions AS ledger
  WHERE ledger.org_id = p_org_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_billing_tokens_used(
  p_org_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT ABS(COALESCE(SUM(COALESCE(ledger.tokens_delta, 0)), 0))::numeric
  FROM public.billing_transactions AS ledger
  WHERE ledger.org_id = p_org_id
    AND ledger.type::text = 'usage';
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_usage_7d(
  p_org_id uuid,
  p_end_date date,
  p_time_zone text
)
RETURNS TABLE (
  usage_date date,
  tokens numeric,
  amount_idr numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF p_org_id IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'org and end date are required' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_time_zone, '')), '') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_timezone_names
       WHERE name = p_time_zone
     ) THEN
    RAISE EXCEPTION 'invalid time zone' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH requested_days AS (
    SELECT (p_end_date - day_offset)::date AS usage_date
    FROM generate_series(6, 0, -1) AS day_offset
  ), aggregated AS (
    SELECT
      (ledger.created_at AT TIME ZONE p_time_zone)::date AS usage_date,
      SUM(ABS(COALESCE(ledger.tokens_delta, 0)))::numeric AS tokens,
      SUM(COALESCE(ledger.amount_idr, 0))::numeric AS amount_idr
    FROM public.billing_transactions AS ledger
    WHERE ledger.org_id = p_org_id
      AND ledger.type::text = 'usage'
      AND ledger.created_at >= ((p_end_date - 6)::timestamp AT TIME ZONE p_time_zone)
      AND ledger.created_at < ((p_end_date + 1)::timestamp AT TIME ZONE p_time_zone)
    GROUP BY (ledger.created_at AT TIME ZONE p_time_zone)::date
  )
  SELECT
    requested_days.usage_date,
    COALESCE(aggregated.tokens, 0)::numeric,
    COALESCE(aggregated.amount_idr, 0)::numeric
  FROM requested_days
  LEFT JOIN aggregated USING (usage_date)
  ORDER BY requested_days.usage_date ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_broadcast_summary(
  p_org_id uuid,
  p_range_start timestamptz DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT COALESCE(SUM(COALESCE(broadcast.total_recipients, 0)), 0)::bigint
  FROM public.wa_broadcasts AS broadcast
  WHERE broadcast.org_id = p_org_id
    AND (p_range_start IS NULL OR broadcast.created_at >= p_range_start);
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_broadcast_calendar(
  p_org_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz
)
RETURNS TABLE (
  id uuid,
  title text,
  status text,
  total_recipients integer,
  created_at timestamptz,
  scheduled_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT
    broadcast.id,
    broadcast.title,
    broadcast.status::text,
    COALESCE(broadcast.total_recipients, 0),
    broadcast.created_at,
    broadcast.scheduled_at
  FROM public.wa_broadcasts AS broadcast
  WHERE broadcast.org_id = p_org_id
    AND (
      (
        broadcast.scheduled_at IS NOT NULL
        AND broadcast.scheduled_at >= p_range_start
        AND broadcast.scheduled_at < p_range_end
      )
      OR (
        broadcast.scheduled_at IS NULL
        AND broadcast.created_at >= p_range_start
        AND broadcast.created_at < p_range_end
      )
    )
  ORDER BY COALESCE(broadcast.scheduled_at, broadcast.created_at) DESC, broadcast.id DESC;
$function$;

-- This index serves the actual tenant-scoped scheduled calendar range query.
-- Direct broadcasts already use idx_wa_broadcasts_org_created_id from Batch 6C-2.
CREATE INDEX IF NOT EXISTS idx_wa_broadcasts_org_scheduled_id
  ON public.wa_broadcasts (org_id, scheduled_at DESC, id DESC)
  WHERE scheduled_at IS NOT NULL;

REVOKE ALL ON FUNCTION public.get_billing_total_spent(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_billing_tokens_used(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_dashboard_usage_7d(uuid, date, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_dashboard_broadcast_summary(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_dashboard_broadcast_calendar(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_billing_total_spent(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_billing_tokens_used(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_usage_7d(uuid, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_broadcast_summary(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_broadcast_calendar(uuid, timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION public.get_billing_total_spent(uuid) IS
  'Batch 6C-3 service-role helper preserving the existing usage-minus-refund totalSpent formula.';
COMMENT ON FUNCTION public.get_billing_tokens_used(uuid) IS
  'Batch 6C-3 service-role helper preserving ABS(SUM(tokens_delta)) for usage rows.';
COMMENT ON FUNCTION public.get_dashboard_usage_7d(uuid, date, text) IS
  'Batch 6C-3 service-role helper returning exactly seven local-calendar usage buckets.';
COMMENT ON FUNCTION public.get_dashboard_broadcast_summary(uuid, timestamptz) IS
  'Batch 6C-3 service-role helper summing all tenant broadcast recipients in an optional created-at range.';
COMMENT ON FUNCTION public.get_dashboard_broadcast_calendar(uuid, timestamptz, timestamptz) IS
  'Batch 6C-3 service-role helper returning only broadcasts in the requested effective calendar range.';
