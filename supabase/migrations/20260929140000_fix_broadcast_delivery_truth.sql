-- Correct legacy false-positive delivery statuses.
--
-- The old worker marked a successful Meta API POST as "delivered". The initial
-- API response contains a top-level `messages` array, whereas a real delivery
-- webhook stores a status object containing the `status` field. This lets us
-- safely downgrade only rows that never received a real delivery webhook. It
-- also removes inferred "read" statuses produced by the former debug repair
-- route when the linked message still only has the initial API response.

-- Older production databases may not have this aggregate column yet, while
-- both the API and history UI already expose cancelled recipient totals.
ALTER TABLE public.wa_broadcasts
  ADD COLUMN IF NOT EXISTS total_cancelled integer NOT NULL DEFAULT 0;

UPDATE public.wa_messages
SET
  status = 'sent',
  delivered_at = NULL
WHERE direction = 'out'
  AND status = 'delivered'
  AND meta_status_payload ? 'messages'
  AND NOT (meta_status_payload ? 'status')
  AND NOT EXISTS (
    SELECT 1
    FROM public.key_info AS webhook
    WHERE webhook.key = 'webhook_status:' || wa_messages.meta_message_id
      AND webhook.value->>'status' IN ('delivered', 'read')
  );

-- The former debug route could infer "read" from a reply. If Meta's highest
-- real webhook is only delivered, restore the recipient to delivered.
UPDATE public.wa_broadcast_recipients AS recipient
SET
  status = 'delivered',
  updated_at = now()
FROM public.wa_messages AS message
JOIN public.key_info AS webhook
  ON webhook.key = 'webhook_status:' || message.meta_message_id
WHERE recipient.wa_message_id = message.id
  AND recipient.status::text = 'read'
  AND webhook.value->>'status' = 'delivered';

UPDATE public.wa_broadcast_recipients AS recipient
SET
  status = 'sent',
  updated_at = now()
FROM public.wa_messages AS message
WHERE recipient.wa_message_id = message.id
  AND recipient.status::text IN ('delivered', 'read')
  AND message.direction = 'out'
  AND message.status = 'sent'
  AND message.meta_status_payload ? 'messages'
  AND NOT (message.meta_status_payload ? 'status');

-- Rebuild denormalized campaign counters from recipient rows. This also repairs
-- campaigns that remained at 0/N + "sending" after their worker had finished.
WITH aggregate_status AS (
  SELECT
    broadcast_id,
    count(*)::integer AS total_recipients,
    count(*) FILTER (WHERE status::text IN ('sent', 'delivered', 'read'))::integer AS total_sent,
    count(*) FILTER (WHERE status::text IN ('delivered', 'read'))::integer AS total_delivered,
    count(*) FILTER (WHERE status::text = 'read')::integer AS total_read,
    count(*) FILTER (WHERE status::text = 'failed')::integer AS total_failed,
    count(*) FILTER (WHERE status::text IN ('cancelled', 'canceled'))::integer AS total_cancelled,
    count(*) FILTER (WHERE status::text IN ('pending', 'processing'))::integer AS total_pending
  FROM public.wa_broadcast_recipients
  GROUP BY broadcast_id
)
UPDATE public.wa_broadcasts AS broadcast
SET
  total_recipients = aggregate_status.total_recipients,
  total_sent = aggregate_status.total_sent,
  total_delivered = aggregate_status.total_delivered,
  total_read = aggregate_status.total_read,
  total_failed = aggregate_status.total_failed,
  total_cancelled = aggregate_status.total_cancelled,
  status = CASE
    WHEN aggregate_status.total_pending = 0
      AND aggregate_status.total_cancelled > 0
      AND aggregate_status.total_sent = 0
      AND aggregate_status.total_failed = 0
      AND broadcast.status::text IN ('queued', 'scheduled', 'sending')
      THEN 'cancelled'::public.broadcast_status
    WHEN aggregate_status.total_pending = 0
      AND broadcast.status::text IN ('queued', 'scheduled', 'sending')
      THEN 'completed'::public.broadcast_status
    ELSE broadcast.status
  END,
  finished_at = CASE
    WHEN aggregate_status.total_pending = 0
      THEN coalesce(broadcast.finished_at, now())
    ELSE broadcast.finished_at
  END,
  updated_at = now()
FROM aggregate_status
WHERE broadcast.id = aggregate_status.broadcast_id;
