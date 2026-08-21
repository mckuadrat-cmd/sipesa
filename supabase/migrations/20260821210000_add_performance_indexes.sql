-- 1. Index untuk mempercepat query wa_broadcast_recipients berdasarkan broadcast_id
CREATE INDEX IF NOT EXISTS idx_wa_broadcast_recipients_broadcast_id 
ON public.wa_broadcast_recipients (broadcast_id);

-- 2. Index untuk mempercepat filter org_id pada wa_broadcast_recipients
CREATE INDEX IF NOT EXISTS idx_wa_broadcast_recipients_org_id 
ON public.wa_broadcast_recipients (org_id);

-- 3. Index untuk mempercepat query pesan chat manual/broadcast berdasarkan nomor wa & kontak
CREATE INDEX IF NOT EXISTS idx_wa_messages_number_contact 
ON public.wa_messages (number_id, contact_id);

-- 4. Index untuk mempercepat filter org_id pada wa_messages
CREATE INDEX IF NOT EXISTS idx_wa_messages_org_id 
ON public.wa_messages (org_id);

-- 5. Index untuk mempercepat pencarian pesan berdasarkan meta_message_id (webhook)
CREATE INDEX IF NOT EXISTS idx_wa_messages_meta_message_id 
ON public.wa_messages (meta_message_id);
