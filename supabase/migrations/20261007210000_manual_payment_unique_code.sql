-- Batch 9.1: server-generated 3-digit reconciliation code.
-- Historical rows remain NULL and are not assigned synthetic codes.

ALTER TABLE public.manual_payment_requests
  ADD COLUMN IF NOT EXISTS unique_code integer,
  ADD COLUMN IF NOT EXISTS proof_file_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.manual_payment_requests'::regclass
      AND conname = 'manual_payment_unique_code_check'
  ) THEN
    ALTER TABLE public.manual_payment_requests
      ADD CONSTRAINT manual_payment_unique_code_check
      CHECK (unique_code IS NULL OR unique_code BETWEEN 101 AND 999);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.manual_payment_requests'::regclass
      AND conname = 'manual_payment_proof_file_name_check'
  ) THEN
    ALTER TABLE public.manual_payment_requests
      ADD CONSTRAINT manual_payment_proof_file_name_check
      CHECK (proof_file_name IS NULL OR length(proof_file_name) BETWEEN 1 AND 255);
  END IF;
END;
$$;

-- Codes only need to be collision-free while a request is actionable. Once a
-- request is approved/rejected, its code may safely be reused. The server uses
-- bounded retries when this race-safe index rejects a random collision.
CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_payment_active_unique_code
  ON public.manual_payment_requests (org_id, destination_account_id, unique_code)
  WHERE unique_code IS NOT NULL AND status IN ('draft', 'submitted');

COMMENT ON COLUMN public.manual_payment_requests.unique_code IS
  'Server-generated reconciliation code only; excluded from token/credit calculation.';
