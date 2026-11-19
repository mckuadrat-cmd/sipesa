-- Additive, backwards-compatible idempotency boundary for broadcast creation.
-- Legacy clients may omit the key (NULL); upgraded clients are unique per org/key.

ALTER TABLE public.wa_broadcasts
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS idempotency_completed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_broadcasts_org_idempotency_key
  ON public.wa_broadcasts (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.wa_broadcasts.idempotency_key IS
  'Client-generated stable key for one logical broadcast-create attempt; uniqueness is scoped to org_id.';
COMMENT ON COLUMN public.wa_broadcasts.request_fingerprint IS
  'Server-generated SHA-256 fingerprint used to reject reuse of an idempotency key with a different payload.';
COMMENT ON COLUMN public.wa_broadcasts.idempotency_completed_at IS
  'Set only after all recipient rows are persisted and the broadcast reaches its final initial state.';
