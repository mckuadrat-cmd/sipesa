-- Read-only verifier. Run manually after applying the Batch 11 migration.
SELECT
  count(*) FILTER (WHERE meta_template_id IS NOT NULL) AS meta_templates,
  count(*) FILTER (WHERE meta_template_id IS NOT NULL AND waba_id IS NULL) AS unresolved_meta_templates,
  count(*) FILTER (WHERE deleted_at IS NOT NULL) AS tombstoned_templates,
  count(*) FILTER (WHERE missing_from_meta_at IS NOT NULL) AS missing_templates
FROM public.wa_templates;

SELECT org_id, waba_id, name, language, count(*) AS duplicate_count
FROM public.wa_templates
GROUP BY org_id, waba_id, name, language
HAVING count(*) > 1
ORDER BY duplicate_count DESC, org_id, waba_id, name, language;

SELECT org_id, name, language, meta_template_id
FROM public.wa_templates
WHERE meta_template_id IS NOT NULL AND waba_id IS NULL
ORDER BY org_id, name, language;
