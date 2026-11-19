export type PreflightIssue = {
  code: string;
  scope: string;
  message: string;
  rowNumber?: number;
};

export type PreflightDecisionInput = {
  blockers: PreflightIssue[];
  duplicateRisks: unknown[];
};

export type PreflightAcknowledgements = {
  duplicateRiskAcknowledged: boolean;
};

export function enforceBroadcastPreflight(
  result: PreflightDecisionInput,
  acknowledgements: PreflightAcknowledgements,
) {
  if (result.blockers.length > 0) {
    const first = result.blockers[0];
    return {
      allowed: false as const,
      code: "PREFLIGHT_BLOCKED",
      message: first.rowNumber
        ? `Pre-flight gagal pada baris ${first.rowNumber}: ${first.message}`
        : `Pre-flight gagal: ${first.message}`,
    };
  }

  if (result.duplicateRisks.length > 0 && !acknowledgements.duplicateRiskAcknowledged) {
    return {
      allowed: false as const,
      code: "DUPLICATE_RISK_ACK_REQUIRED",
      message: `${result.duplicateRisks.length} penerima memiliki pesan identik dalam 24 jam terakhir. Konfirmasi pengiriman ulang diperlukan.`,
    };
  }

  return { allowed: true as const, code: null, message: null };
}

export function normalizeIdempotencyKey(value: unknown) {
  const key = String(value ?? "").trim();
  if (!key) return null;
  if (key.length < 16 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new Error("Idempotency-Key harus 16-128 karakter dan hanya berisi huruf, angka, titik, garis bawah, titik dua, atau tanda hubung");
  }
  return key;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

export function canonicalBroadcastRequest(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export async function fingerprintBroadcastRequest(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalBroadcastRequest(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function resolveIdempotencyReplay(
  existing: { id: string; request_fingerprint?: string | null; idempotency_completed_at?: string | null } | null,
  requestFingerprint: string,
) {
  if (!existing) return { outcome: "missing" as const };
  if (!existing.request_fingerprint || existing.request_fingerprint !== requestFingerprint) {
    return { outcome: "conflict" as const, broadcastId: existing.id };
  }
  if (!existing.idempotency_completed_at) {
    return { outcome: "in_progress" as const, broadcastId: existing.id };
  }
  return { outcome: "replay" as const, broadcastId: existing.id };
}
