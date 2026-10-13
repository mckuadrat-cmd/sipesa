-- Batch 11: bind every resolved Meta template to its authoritative WABA and
-- retain provider lifecycle metadata without deleting ambiguous legacy rows.

ALTER TABLE public.wa_templates
  ADD COLUMN IF NOT EXISTS waba_id text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS quality_rating text,
  ADD COLUMN IF NOT EXISTS previous_category text,
  ADD COLUMN IF NOT EXISTS meta_status_raw text,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS missing_from_meta_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Backfill only when the owning organization has exactly one distinct WABA.
-- Organizations with zero or multiple WABAs intentionally remain unresolved.
WITH one_waba_per_org AS (
  SELECT org_id, min(waba_id) AS waba_id
  FROM public.wa_numbers
  WHERE nullif(trim(waba_id), '') IS NOT NULL
  GROUP BY org_id
  HAVING count(DISTINCT waba_id) = 1
)
UPDATE public.wa_templates AS template
SET waba_id = owner.waba_id
FROM one_waba_per_org AS owner
WHERE template.org_id = owner.org_id
  AND template.waba_id IS NULL;

-- Remove only the legacy identity constraint/index whose exact ordered key is
-- (org_id, name, language). No other unique object is touched.
DO $$
DECLARE
  constraint_name text;
  index_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'wa_templates'
      AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY key_columns.ordinality)
        FROM unnest(con.conkey) WITH ORDINALITY AS key_columns(attnum, ordinality)
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid AND att.attnum = key_columns.attnum
      ) = ARRAY['org_id', 'name', 'language']::text[]
  LOOP
    EXECUTE format('ALTER TABLE public.wa_templates DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  FOR index_name IN
    SELECT idx.relname
    FROM pg_index ind
    JOIN pg_class idx ON idx.oid = ind.indexrelid
    JOIN pg_class rel ON rel.oid = ind.indrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'wa_templates'
      AND ind.indisunique
      AND ind.indpred IS NULL
      AND NOT ind.indisprimary
      AND (
        SELECT array_agg(att.attname::text ORDER BY key_columns.ordinality)
        FROM unnest(ind.indkey::smallint[]) WITH ORDINALITY AS key_columns(attnum, ordinality)
        JOIN pg_attribute att
          ON att.attrelid = ind.indrelid AND att.attnum = key_columns.attnum
      ) = ARRAY['org_id', 'name', 'language']::text[]
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', index_name);
  END LOOP;
END $$;

ALTER TABLE public.wa_templates
  ADD CONSTRAINT wa_templates_org_waba_name_language_key
  UNIQUE (org_id, waba_id, name, language);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_templates_unresolved_identity
  ON public.wa_templates (org_id, name, language)
  WHERE waba_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_templates_meta_identity
  ON public.wa_templates (org_id, waba_id, meta_template_id)
  WHERE meta_template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_templates_default_order
  ON public.wa_templates (org_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_wa_templates_waba_status
  ON public.wa_templates (org_id, waba_id, status)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.wa_templates.waba_id IS
  'Authoritative Meta WhatsApp Business Account owner. NULL means legacy ownership is unresolved and sending is blocked.';
COMMENT ON COLUMN public.wa_templates.meta_status_raw IS
  'Last raw status received from Meta; normalized lifecycle remains in status.';

