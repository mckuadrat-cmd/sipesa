-- Add columns to wa_broadcasts if they do not exist
ALTER TABLE public.wa_broadcasts ADD COLUMN IF NOT EXISTS total_delivered integer DEFAULT 0;
ALTER TABLE public.wa_broadcasts ADD COLUMN IF NOT EXISTS total_read integer DEFAULT 0;

-- 1. Helper function for status ranking
CREATE OR REPLACE FUNCTION public.wa_status_rank(status text)
RETURNS integer AS $$
BEGIN
  CASE lower(status)
    WHEN 'pending' THEN RETURN 0;
    WHEN 'queued' THEN RETURN 0;
    WHEN 'processing' THEN RETURN 10;
    WHEN 'accepted' THEN RETURN 20;
    WHEN 'sent' THEN RETURN 20;
    WHEN 'delivered' THEN RETURN 30;
    WHEN 'read' THEN RETURN 40;
    WHEN 'failed' THEN RETURN -1;
    WHEN 'cancelled' THEN RETURN -2;
    ELSE RETURN 0;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Helper function for checking transition allowance
CREATE OR REPLACE FUNCTION public.wa_status_can_transition(current_status text, new_status text)
RETURNS boolean AS $$
DECLARE
  curr_rank integer;
  new_rank integer;
  curr_lower text := lower(coalesce(current_status, 'pending'));
  new_lower text := lower(coalesce(new_status, 'pending'));
BEGIN
  -- Terminal states checks
  IF curr_lower = 'read' THEN
    RETURN false;
  END IF;
  
  IF curr_lower = 'delivered' AND new_lower != 'read' THEN
    RETURN false;
  END IF;

  IF curr_lower = 'failed' AND new_lower != 'failed' THEN
    -- failed is terminal unless explicitly retried or reset, but webhook updates shouldn't overwrite failed
    RETURN false;
  END IF;

  IF curr_lower = 'cancelled' THEN
    RETURN false;
  END IF;

  IF new_lower = 'failed' THEN
    -- failed can only replace pending, queued, processing, sent, accepted
    RETURN curr_lower IN ('pending', 'queued', 'processing', 'sent', 'accepted');
  END IF;

  IF new_lower = 'cancelled' THEN
    -- cancelled can only replace pending, queued, processing
    RETURN curr_lower IN ('pending', 'queued', 'processing');
  END IF;

  curr_rank := public.wa_status_rank(curr_lower);
  new_rank := public.wa_status_rank(new_lower);

  RETURN new_rank > curr_rank;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Atomic advance function for webhook status synchronization
CREATE OR REPLACE FUNCTION public.advance_wa_message_status(
  p_meta_message_id text,
  p_new_status text,
  p_timestamp timestamptz,
  p_error text,
  p_payload jsonb
) RETURNS jsonb AS $$
DECLARE
  v_msg_id uuid;
  v_curr_status text;
  v_broadcast_id uuid;
BEGIN
  -- Lock and select the message
  SELECT id, status INTO v_msg_id, v_curr_status
  FROM public.wa_messages
  WHERE meta_message_id = p_meta_message_id
  FOR UPDATE;
  
  IF v_msg_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Message not found');
  END IF;
  
  -- Find broadcast_id
  SELECT broadcast_id INTO v_broadcast_id
  FROM public.wa_broadcast_recipients
  WHERE wa_message_id = v_msg_id
  LIMIT 1;
  
  IF public.wa_status_can_transition(v_curr_status, p_new_status) THEN
    -- Update wa_messages
    UPDATE public.wa_messages
    SET 
      status = p_new_status,
      meta_status_payload = p_payload,
      error = CASE WHEN p_new_status = 'failed' THEN p_error ELSE error END,
      sent_at = CASE WHEN p_new_status IN ('sent', 'delivered', 'read') THEN coalesce(sent_at, p_timestamp) ELSE sent_at END,
      delivered_at = CASE WHEN p_new_status IN ('delivered', 'read') THEN coalesce(delivered_at, p_timestamp) ELSE delivered_at END,
      read_at = CASE WHEN p_new_status = 'read' THEN coalesce(read_at, p_timestamp) ELSE read_at END
    WHERE id = v_msg_id;
    
    -- Update wa_broadcast_recipients
    UPDATE public.wa_broadcast_recipients r
    SET 
      status = p_new_status,
      error = CASE WHEN p_new_status = 'failed' THEN p_error ELSE error END,
      sent_at = CASE WHEN p_new_status IN ('sent', 'delivered', 'read') THEN coalesce(sent_at, p_timestamp) ELSE sent_at END,
      updated_at = now()
    WHERE r.wa_message_id = v_msg_id AND public.wa_status_can_transition(r.status, p_new_status);
    
    RETURN jsonb_build_object(
      'success', true, 
      'action', 'ADVANCE', 
      'message_id', v_msg_id, 
      'broadcast_id', v_broadcast_id,
      'old_status', v_curr_status, 
      'new_status', p_new_status
    );
  ELSE
    RETURN jsonb_build_object(
      'success', true, 
      'action', 'IGNORE_DOWNGRADE', 
      'message_id', v_msg_id, 
      'broadcast_id', v_broadcast_id,
      'old_status', v_curr_status, 
      'new_status', p_new_status
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 4. Atomic link and advance function for background workers
CREATE OR REPLACE FUNCTION public.link_and_advance_wa_message(
  p_msg_id uuid,
  p_rec_id uuid,
  p_meta_message_id text,
  p_default_status text,
  p_default_payload jsonb
) RETURNS jsonb AS $$
DECLARE
  v_kv_val jsonb;
  v_early_status text;
  v_early_timestamp timestamptz;
  v_early_error text;
  v_early_payload jsonb;
  v_final_status text;
  v_final_timestamp timestamptz;
  v_final_error text;
  v_final_payload jsonb;
  v_curr_msg_status text;
  v_curr_rec_status text;
BEGIN
  -- Query early status in key_info
  SELECT value INTO v_kv_val
  FROM public.key_info
  WHERE key = 'webhook_status:' || p_meta_message_id
  FOR UPDATE;
  
  IF v_kv_val IS NOT NULL THEN
    v_early_status := v_kv_val->>'status';
    v_early_timestamp := (v_kv_val->>'timestamp')::timestamptz;
    v_early_error := v_kv_val->>'error';
    v_early_payload := v_kv_val->'meta_status_payload';
  END IF;

  IF v_early_status IS NOT NULL AND public.wa_status_can_transition(p_default_status, v_early_status) THEN
    v_final_status := v_early_status;
    v_final_timestamp := v_early_timestamp;
    v_final_error := v_early_error;
    v_final_payload := v_early_payload;
  ELSE
    v_final_status := p_default_status;
    v_final_timestamp := now();
    v_final_error := NULL;
    v_final_payload := p_default_payload;
  END IF;

  SELECT status INTO v_curr_msg_status FROM public.wa_messages WHERE id = p_msg_id FOR UPDATE;
  SELECT status INTO v_curr_rec_status FROM public.wa_broadcast_recipients WHERE id = p_rec_id FOR UPDATE;

  IF v_curr_msg_status IS NOT NULL THEN
    IF public.wa_status_can_transition(v_curr_msg_status, v_final_status) THEN
      UPDATE public.wa_messages
      SET
        meta_message_id = p_meta_message_id,
        status = v_final_status,
        meta_status_payload = v_final_payload,
        error = CASE WHEN v_final_status = 'failed' THEN v_final_error ELSE error END,
        sent_at = CASE WHEN v_final_status IN ('sent', 'delivered', 'read') THEN coalesce(sent_at, v_final_timestamp) ELSE sent_at END,
        delivered_at = CASE WHEN v_final_status IN ('delivered', 'read') THEN coalesce(delivered_at, v_final_timestamp) ELSE delivered_at END,
        read_at = CASE WHEN v_final_status = 'read' THEN coalesce(read_at, v_final_timestamp) ELSE read_at END
      WHERE id = p_msg_id;
    ELSE
      UPDATE public.wa_messages
      SET
        meta_message_id = p_meta_message_id,
        meta_status_payload = v_final_payload
      WHERE id = p_msg_id;
    END IF;
  END IF;

  IF v_curr_rec_status IS NOT NULL THEN
    IF public.wa_status_can_transition(v_curr_rec_status, v_final_status) THEN
      UPDATE public.wa_broadcast_recipients
      SET
        wa_message_id = p_msg_id,
        provider_message_id = p_meta_message_id,
        status = v_final_status,
        error = CASE WHEN v_final_status = 'failed' THEN v_final_error ELSE error END,
        sent_at = CASE WHEN v_final_status IN ('sent', 'delivered', 'read') THEN coalesce(sent_at, v_final_timestamp) ELSE sent_at END,
        updated_at = now()
      WHERE id = p_rec_id;
    ELSE
      UPDATE public.wa_broadcast_recipients
      SET
        wa_message_id = p_msg_id,
        provider_message_id = p_meta_message_id,
        updated_at = now()
      WHERE id = p_rec_id;
    END IF;
  END IF;

  IF v_kv_val IS NOT NULL THEN
    DELETE FROM public.key_info WHERE key = 'webhook_status:' || p_meta_message_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'linked_status', v_final_status,
    'had_early_webhook', (v_kv_val IS NOT NULL)
  );
END;
$$ LANGUAGE plpgsql;

-- 5. Monotonic upsert helper for key_info buffer
CREATE OR REPLACE FUNCTION public.upsert_webhook_status_key_info(
  p_key text,
  p_status text,
  p_timestamp text,
  p_error text,
  p_payload jsonb
) RETURNS void AS $$
DECLARE
  existing_val jsonb;
  existing_status text;
BEGIN
  SELECT value INTO existing_val FROM public.key_info WHERE key = p_key FOR UPDATE;
  
  IF existing_val IS NOT NULL THEN
    existing_status := existing_val->>'status';
    IF public.wa_status_can_transition(existing_status, p_status) THEN
      UPDATE public.key_info
      SET value = jsonb_build_object(
        'status', p_status,
        'timestamp', p_timestamp,
        'error', p_error,
        'meta_status_payload', p_payload
      )
      WHERE key = p_key;
    END IF;
  ELSE
    INSERT INTO public.key_info (key, value)
    VALUES (p_key, jsonb_build_object(
      'status', p_status,
      'timestamp', p_timestamp,
      'error', p_error,
      'meta_status_payload', p_payload
    ));
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 6. Atomic fix stuck broadcasts function
CREATE OR REPLACE FUNCTION public.fix_stuck_broadcast(p_broadcast_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_updated_sent_count integer := 0;
  v_updated_failed_count integer := 0;
  rec record;
BEGIN
  FOR rec IN 
    SELECT id, wa_message_id, provider_message_id, status 
    FROM public.wa_broadcast_recipients
    WHERE broadcast_id = p_broadcast_id AND status IN ('pending', 'processing')
  LOOP
    IF rec.provider_message_id IS NOT NULL AND rec.provider_message_id != '' THEN
      -- Has Meta ID: try to advance to 'sent'
      IF rec.wa_message_id IS NOT NULL THEN
        UPDATE public.wa_messages
        SET status = 'sent', sent_at = coalesce(sent_at, now())
        WHERE id = rec.wa_message_id AND public.wa_status_can_transition(status, 'sent');
      END IF;
      
      UPDATE public.wa_broadcast_recipients
      SET status = 'sent', sent_at = coalesce(sent_at, now()), updated_at = now()
      WHERE id = rec.id AND public.wa_status_can_transition(status, 'sent');
      
      v_updated_sent_count := v_updated_sent_count + 1;
    ELSE
      -- No Meta ID: set to failed (truly stuck/timeout)
      IF rec.wa_message_id IS NOT NULL THEN
        UPDATE public.wa_messages
        SET status = 'failed', error = 'Stuck in processing'
        WHERE id = rec.wa_message_id AND public.wa_status_can_transition(status, 'failed');
      END IF;
      
      UPDATE public.wa_broadcast_recipients
      SET status = 'failed', error = 'Gagal terkirim (Tersangkut)', updated_at = now()
      WHERE id = rec.id AND public.wa_status_can_transition(status, 'failed');
      
      v_updated_failed_count := v_updated_failed_count + 1;
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object(
    'updated_sent', v_updated_sent_count,
    'updated_failed', v_updated_failed_count
  );
END;
$$ LANGUAGE plpgsql;

-- 7. Add wa_broadcast_recipients to realtime publication safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'wa_broadcast_recipients'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_broadcast_recipients;
  END IF;
END;
$$;

-- 8. Configure Row Level Security (RLS) policy
ALTER TABLE public.wa_broadcast_recipients ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'wa_broadcast_recipients' 
      AND policyname = 'select_wa_broadcast_recipients'
  ) THEN
    CREATE POLICY select_wa_broadcast_recipients ON public.wa_broadcast_recipients
      FOR SELECT
      TO authenticated
      USING (
        org_id = (SELECT org_id FROM public.app_users WHERE id = auth.uid())
      );
  END IF;
END;
$$;
