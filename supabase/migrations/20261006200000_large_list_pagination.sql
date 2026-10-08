-- Batch 6C-2: bounded list pagination support.
-- This migration is intentionally limited to the contact label normalization
-- required for server-side filtering and deterministic list-order indexes.

ALTER TABLE public.wa_contacts
  ADD COLUMN IF NOT EXISTS label text;

-- Preserve the existing label data whose canonical storage was a per-org JSON
-- map in key_info. Both historical key styles (with/without leading '+') are
-- accepted during the one-time backfill.
UPDATE public.wa_contacts AS contact
SET label = NULLIF(BTRIM(COALESCE(
  labels.value -> 'labels' ->> contact.phone_e164,
  labels.value -> 'labels' ->> ('+' || LTRIM(contact.phone_e164, '+'))
)), '')
FROM public.key_info AS labels
WHERE labels.key = 'contact_labels:' || contact.org_id::text
  AND contact.label IS NULL
  AND COALESCE(
    labels.value -> 'labels' ->> contact.phone_e164,
    labels.value -> 'labels' ->> ('+' || LTRIM(contact.phone_e164, '+'))
  ) IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_contacts_org_display_name_id
  ON public.wa_contacts (org_id, display_name ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_wa_contacts_org_label_display_name_id
  ON public.wa_contacts (org_id, label, display_name ASC, id ASC)
  WHERE label IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_broadcasts_org_created_id
  ON public.wa_broadcasts (org_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_wa_broadcast_recipients_page_order
  ON public.wa_broadcast_recipients
  (broadcast_id, sequence_no ASC NULLS LAST, created_at ASC, id ASC);
