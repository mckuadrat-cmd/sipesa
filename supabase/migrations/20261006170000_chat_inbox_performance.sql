-- Batch 6B: bounded chat history and database-side conversation summaries.
-- Apply this migration before deploying the matching server Edge Function.

CREATE INDEX IF NOT EXISTS idx_wa_messages_conversation_cursor
  ON public.wa_messages (org_id, number_id, contact_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_wa_messages_unread_conversation
  ON public.wa_messages (org_id, number_id, contact_id)
  WHERE direction = 'in' AND status = 'delivered';

CREATE OR REPLACE FUNCTION public.get_wa_conversation_summaries(
  p_org_id uuid,
  p_number_id uuid
)
RETURNS TABLE (
  contact_id uuid,
  last_text text,
  last_created_at timestamptz,
  has_unread boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  WITH latest AS (
    SELECT DISTINCT ON (message.contact_id)
      message.contact_id,
      COALESCE(
        NULLIF(message.text_body, ''),
        CASE WHEN message.direction = 'out' THEN 'Pesan Keluar' ELSE 'Pesan Masuk' END
      ) AS last_text,
      message.created_at AS last_created_at
    FROM public.wa_messages AS message
    WHERE message.org_id = p_org_id
      AND message.number_id = p_number_id
      AND message.contact_id IS NOT NULL
    ORDER BY message.contact_id, message.created_at DESC, message.id DESC
  ),
  unread AS (
    SELECT message.contact_id
    FROM public.wa_messages AS message
    WHERE message.org_id = p_org_id
      AND message.number_id = p_number_id
      AND message.contact_id IS NOT NULL
      AND message.direction = 'in'
      AND message.status = 'delivered'
    GROUP BY message.contact_id
  )
  SELECT
    latest.contact_id,
    latest.last_text,
    latest.last_created_at,
    (unread.contact_id IS NOT NULL) AS has_unread
  FROM latest
  LEFT JOIN unread USING (contact_id)
  ORDER BY latest.last_created_at DESC, latest.contact_id DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_wa_conversation_summaries(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_wa_conversation_summaries(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_wa_conversation_summaries(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_wa_conversation_summaries(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.get_wa_conversation_summaries(uuid, uuid) IS
  'Batch 6B service-role helper: tenant-scoped latest message and unread state per conversation.';

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'wa_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_messages;
  END IF;
END
$block$;
