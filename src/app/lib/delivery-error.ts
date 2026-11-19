export type FailureSource =
  | "META_WEBHOOK"
  | "META_SEND_RESPONSE"
  | "SIPESA_VALIDATION"
  | "SIPESA_WORKER"
  | "BILLING"
  | "DATABASE"
  | "AMBIGUOUS";

export type RetryClassification = "RETRYABLE" | "NON_RETRYABLE" | "REVIEW_REQUIRED";

export type DeliveryFailure = {
  code: string | null;
  subcode: string | null;
  title: string;
  userMessage: string;
  technicalDetails: string | null;
  type: string | null;
  fbtraceId: string | null;
  httpStatus: number | null;
  stage: string;
  source: FailureSource;
  retry: RetryClassification;
  action: string;
  acceptedByMeta: boolean | null;
};

const META_ERROR_GUIDANCE: Record<string, Pick<DeliveryFailure, "title" | "userMessage" | "retry" | "action">> = {
  "131026": {
    title: "Message undeliverable",
    userMessage: "Meta tidak berhasil menyampaikan pesan kepada penerima.",
    retry: "REVIEW_REQUIRED",
    action: "Periksa format dan riwayat penerima. Jangan melakukan retry massal tanpa evaluasi.",
  },
  "130472": {
    title: "User's number is part of an experiment",
    userMessage: "Meta membatasi pengiriman kepada penerima ini karena eksperimen platform.",
    retry: "NON_RETRYABLE",
    action: "Tidak perlu retry otomatis. Tunggu kebijakan Meta atau gunakan kanal komunikasi lain.",
  },
  "131049": {
    title: "Healthy ecosystem engagement",
    userMessage: "Meta tidak mengirim pesan ini untuk menjaga kualitas interaksi ekosistem.",
    retry: "REVIEW_REQUIRED",
    action: "Evaluasi frekuensi dan relevansi pesan sebelum mencoba pengiriman lain.",
  },
  "131053": {
    title: "Media upload error",
    userMessage: "Meta tidak dapat mengambil atau memproses media pesan.",
    retry: "REVIEW_REQUIRED",
    action: "Perbaiki akses, tipe, atau ukuran media sebelum mencoba kembali.",
  },
};

function text(value: unknown, max = 1000): string | null {
  const normalized = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return normalized ? normalized.slice(0, max) : null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceOrFallback(value: unknown, fallback: FailureSource): FailureSource {
  const normalized = String(value ?? "").toUpperCase();
  return ["META_WEBHOOK", "META_SEND_RESPONSE", "SIPESA_VALIDATION", "SIPESA_WORKER", "BILLING", "DATABASE", "AMBIGUOUS"].includes(normalized)
    ? normalized as FailureSource
    : fallback;
}

function retryOrFallback(value: unknown, fallback: RetryClassification): RetryClassification {
  const normalized = String(value ?? "").toUpperCase();
  return ["RETRYABLE", "NON_RETRYABLE", "REVIEW_REQUIRED"].includes(normalized)
    ? normalized as RetryClassification
    : fallback;
}

export function normalizeDeliveryFailure(input: any): DeliveryFailure | null {
  if (!input) return null;
  const rawPayload = input.metaStatusPayload ?? input.meta_status_payload ?? null;
  const rawError = rawPayload?.errors?.[0] ?? rawPayload?.error ?? input.errorPayload?.error ?? input.errorPayload ?? {};
  const code = text(input.errorCode ?? input.error_code ?? rawError?.code, 80);
  const guidance = code ? META_ERROR_GUIDANCE[code] : undefined;
  const legacy = text(input.errorMessage ?? input.error_message ?? input.error, 1000);
  const sourceFallback: FailureSource = rawPayload?.status === "failed" ? "META_WEBHOOK" : legacy ? "AMBIGUOUS" : "SIPESA_WORKER";
  const source = sourceOrFallback(input.failureSource ?? input.failure_source, sourceFallback);
  const retryFallback: RetryClassification = guidance?.retry
    ?? (source === "SIPESA_VALIDATION" || source === "BILLING" ? "NON_RETRYABLE" : "REVIEW_REQUIRED");
  const title = text(input.errorTitle ?? input.error_title ?? rawError?.title, 300)
    ?? guidance?.title
    ?? legacy
    ?? "Kegagalan pengiriman";
  const details = text(input.errorDetails ?? input.error_details ?? rawError?.error_data?.details, 1500);
  const providerMessage = text(rawError?.message, 1000);

  return {
    code,
    subcode: text(input.errorSubcode ?? input.error_subcode ?? rawError?.error_subcode, 80),
    title,
    userMessage: guidance?.userMessage ?? legacy ?? providerMessage ?? "Pengiriman gagal tanpa detail tambahan.",
    technicalDetails: details ?? (providerMessage && providerMessage !== title ? providerMessage : null),
    type: text(input.errorType ?? input.error_type ?? rawError?.type, 120),
    fbtraceId: text(input.errorFbtraceId ?? input.error_fbtrace_id ?? rawError?.fbtrace_id, 200),
    httpStatus: numberOrNull(input.errorHttpStatus ?? input.error_http_status),
    stage: text(input.failureStage ?? input.failure_stage, 100) ?? (source === "META_WEBHOOK" ? "delivery" : "unknown"),
    source,
    retry: retryOrFallback(input.retryClassification ?? input.retry_classification, retryFallback),
    action: guidance?.action ?? (retryFallback === "NON_RETRYABLE" ? "Perbaiki penyebab sebelum mengirim kembali." : "Periksa detail teknis sebelum menentukan retry."),
    acceptedByMeta: source === "META_WEBHOOK" ? true : source === "META_SEND_RESPONSE" || source === "SIPESA_VALIDATION" ? false : null,
  };
}

export function failureSourceLabel(source: FailureSource): string {
  return ({
    META_WEBHOOK: "Meta Webhook",
    META_SEND_RESPONSE: "Respons Meta",
    SIPESA_VALIDATION: "Validasi SIPESA",
    SIPESA_WORKER: "Worker SIPESA",
    BILLING: "Billing",
    DATABASE: "Database",
    AMBIGUOUS: "Belum pasti",
  })[source];
}

export function retryLabel(retry: RetryClassification): string {
  return retry === "RETRYABLE" ? "Dapat dicoba ulang" : retry === "NON_RETRYABLE" ? "Jangan retry" : "Perlu pemeriksaan";
}

export function deliveryFailureCsvFields(failure: DeliveryFailure | null) {
  return [
    failure?.code ?? "",
    failure?.subcode ?? "",
    failure?.title ?? "",
    failure?.userMessage ?? "",
    failure?.technicalDetails ?? "",
    failure?.type ?? "",
    failure?.fbtraceId ?? "",
    failure?.httpStatus ?? "",
    failure?.stage ?? "",
    failure ? failureSourceLabel(failure.source) : "",
    failure ? retryLabel(failure.retry) : "",
    failure?.acceptedByMeta === true ? "Ya" : failure?.acceptedByMeta === false ? "Tidak" : "Belum pasti",
    failure?.action ?? "",
  ];
}
