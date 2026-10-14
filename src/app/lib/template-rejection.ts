const REJECTION_REASON_SENTINELS = new Set([
  "none",
  "null",
  "undefined",
  "n/a",
  "na",
  "not available",
  "not_available",
  "not applicable",
  "not_applicable",
  "no reason",
  "no_reason",
  "-",
]);

export function normalizeRejectionReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || REJECTION_REASON_SENTINELS.has(normalized.toLowerCase())) return null;
  return normalized;
}

export function currentRejectionReason(status: unknown, value: unknown): string | null {
  if (String(status ?? "").trim().toLowerCase() !== "rejected") return null;
  return normalizeRejectionReason(value);
}
