export type OfficialTemplateCategory = "marketing" | "utility" | "authentication";

export function normalizeOfficialTemplateCategory(value: unknown): OfficialTemplateCategory | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["marketing", "utility", "authentication"].includes(normalized)
    ? normalized as OfficialTemplateCategory
    : null;
}

export function normalizeTemplateCategorySource(value: unknown, hasMetaTemplateId: boolean): "meta" | "local" | "needs_sync" | "unknown" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["meta", "local", "needs_sync", "unknown"].includes(normalized)) return normalized as any;
  return hasMetaTemplateId ? "unknown" : "local";
}
