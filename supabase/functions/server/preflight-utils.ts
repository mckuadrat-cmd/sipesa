export type PreflightIssue = { code: string; scope: string; message: string };

const TEMPLATE_REFRESH_HINT_MS = 24 * 60 * 60 * 1000;

export function isMetaTemplateSendableStatus(status: unknown) {
  return String(status ?? "").trim().toLowerCase() === "approved";
}

export function evaluateTemplateMetadataPolicy(template: any, nowMs = Date.now()): {
  shouldRefresh: boolean;
  blockers: PreflightIssue[];
  warnings: PreflightIssue[];
} {
  const blockers: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];
  const metaTemplateId = String(template?.meta_template_id ?? "").trim();
  const source = String(template?.category_source ?? "").trim().toLowerCase();
  const syncedAtMs = Date.parse(String(template?.synced_at ?? ""));
  const hasVerifiedSnapshot = Boolean(metaTemplateId) && source === "meta" && Number.isFinite(syncedAtMs);
  const isOlderThanRefreshHint = hasVerifiedSnapshot && nowMs - syncedAtMs > TEMPLATE_REFRESH_HINT_MS;

  if (!metaTemplateId) {
    blockers.push({ code: "TEMPLATE_METADATA_UNVERIFIED", scope: "template", message: "Template belum pernah diverifikasi dari Meta." });
  }
  if (metaTemplateId && source !== "meta") {
    blockers.push({ code: "TEMPLATE_CATEGORY_NEEDS_SYNC", scope: "template", message: "Kategori resmi template belum berhasil diverifikasi dari Meta." });
  }
  if (metaTemplateId && !Number.isFinite(syncedAtMs)) {
    blockers.push({ code: "TEMPLATE_METADATA_UNVERIFIED", scope: "template", message: "Status template belum pernah diverifikasi dari Meta." });
  }
  if (isOlderThanRefreshHint) {
    warnings.push({
      code: "TEMPLATE_LATEST_STATUS_UNVERIFIED",
      scope: "template",
      message: "Status terbaru template belum dapat diverifikasi saat ini; metadata APPROVED terakhir yang diketahui tetap digunakan.",
    });
  }

  return {
    shouldRefresh: Boolean(metaTemplateId) && (!hasVerifiedSnapshot || isOlderThanRefreshHint),
    blockers,
    warnings,
  };
}

export function evaluateSenderReadiness(sender: any): PreflightIssue[] {
  if (!sender) return [{ code: "SENDER_NOT_FOUND", scope: "sender", message: "Nomor pengirim tidak ditemukan pada organisasi ini." }];
  const issues: PreflightIssue[] = [];
  if (sender.is_active === false) issues.push({ code: "SENDER_INACTIVE", scope: "sender", message: "Nomor pengirim tidak aktif." });
  if (!String(sender.phone_number_id ?? "").trim()) issues.push({ code: "PHONE_NUMBER_ID_MISSING", scope: "sender", message: "Phone Number ID belum dikonfigurasi." });
  if (!String(sender.access_token ?? "").trim()) issues.push({ code: "ACCESS_TOKEN_MISSING", scope: "sender", message: "Autentikasi backend untuk sender belum tersedia." });
  if (!String(sender.waba_id ?? "").trim()) issues.push({ code: "WABA_MISSING", scope: "sender", message: "WABA sender belum tersedia." });
  return issues;
}

export function inspectMediaReference(value: unknown): { blockers: string[]; reachabilityWarning: boolean } {
  const media = String(value ?? "").trim();
  if (!media) return { blockers: [], reachabilityWarning: false };
  // Opaque Meta media IDs are not fetched by SIPESA and remain supported.
  if (/^[A-Za-z0-9_-]+$/.test(media)) return { blockers: [], reachabilityWarning: false };
  const blockers: string[] = [];
  let parsed: URL | null = null;
  try {
    parsed = new URL(media);
  } catch {
    blockers.push("URL media tidak valid");
  }
  if (parsed && parsed.protocol !== "https:") blockers.push("URL media eksternal wajib menggunakan HTTPS");
  if (parsed?.username || parsed?.password) blockers.push("URL media tidak boleh memuat credential");
  const hostname = String(parsed?.hostname ?? "").replace(/^\[|\]$/g, "").toLowerCase();
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  const privateIpv4 = ipv4 && (() => {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) return true;
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      octets[0] >= 224;
  })();
  const privateIpv6 = hostname === "::1" || hostname === "::" || /^(fc|fd|fe8|fe9|fea|feb)/i.test(hostname) ||
    /^::ffff:(127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(hostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost") || privateIpv4 || privateIpv6) {
    blockers.push("Host media lokal, privat, link-local, multicast, atau loopback tidak diizinkan");
  }
  return { blockers: [...new Set(blockers)], reachabilityWarning: parsed?.protocol === "https:" && blockers.length === 0 };
}
