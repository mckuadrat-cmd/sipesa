// @ts-nocheck
import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs";
import { verifyMetaWebhookSignature } from "./meta-webhook-security.js";

// ===== Helpers =====
function waStatusRank(status?: string | null): number {
  switch (String(status || "").toLowerCase().trim()) {
    case "pending": return 0;
    case "queued": return 0;
    case "processing": return 10;
    case "accepted": return 20;
    case "sent": return 20;
    case "delivered": return 30;
    case "read": return 40;
    case "failed": return -1;
    case "cancelled": return -2;
    default: return 0;
  }
}

function waStatusCanTransition(currentStatus?: string | null, newStatus?: string | null): boolean {
  const current = String(currentStatus || "pending").toLowerCase().trim();
  const next = String(newStatus || "pending").toLowerCase().trim();

  if (current === "read" || current === "cancelled" || current === "canceled") return false;
  if (current === "delivered") return next === "read";
  if (current === "failed") return false;
  if (next === "failed") {
    return ["pending", "queued", "processing", "accepted", "sent"].includes(current);
  }
  if (next === "cancelled" || next === "canceled") {
    return ["pending", "queued", "processing"].includes(current);
  }

  return waStatusRank(next) > waStatusRank(current);
}

// ===== Env =====
type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  META_GRAPH_VERSION?: string;
  META_APP_SECRET?: string;
  BROADCAST_SCHEDULER_SECRET?: string;
  SUPERADMIN_USER_ID?: string;
  SUPERADMIN_EMAIL?: string;
};

const API_PREFIX = "";
const SESSION_HEADER = "x-sipesa-session";
const SCHEDULER_HEADER = "x-sipesa-scheduler-secret";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "apikey", SESSION_HEADER, "x-worker-secret", SCHEDULER_HEADER],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: [SESSION_HEADER],
  }),
);

app.use("*", logger());

// ===== Supabase admin client =====
function sb() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum terpasang");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ===== Utils =====
function jsonOk(data: unknown) {
  return { success: true, data };
}

function jsonFail(error: unknown) {
  return {
    success: false,
    error: typeof error === "string" ? error : error instanceof Error ? error.message : String(error),
  };
}

function normalizeEmail(email: unknown) {
  return String(email ?? "").trim().toLowerCase();
}

const PAYMENT_PROOF_BUCKET = "payment-proofs";
const PAYMENT_ASSET_BUCKET = "payment-assets";
const PAYMENT_PROOF_MAX_BYTES = 5 * 1024 * 1024;
const PAYMENT_UNIQUE_CODE_MIN = 101;
const PAYMENT_UNIQUE_CODE_MAX = 999;
const PAYMENT_UNIQUE_CODE_ATTEMPTS = 16;
const PAYMENT_PROOF_MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
]);

function paymentStatusLabel(status: unknown) {
  switch (String(status || "").toLowerCase()) {
    case "draft": return "Menunggu Bukti Pembayaran";
    case "submitted": return "Menunggu Verifikasi";
    case "approved": return "Disetujui";
    case "rejected": return "Ditolak";
    default: return "Status Tidak Dikenal";
  }
}

function paymentRequestDto(row: any) {
  const destination = Array.isArray(row?.destination) ? row.destination[0] : row?.destination;
  const organization = Array.isArray(row?.organization) ? row.organization[0] : row?.organization;
  const requester = Array.isArray(row?.requester) ? row.requester[0] : row?.requester;
  const baseAmount = Number(row.amount_requested ?? row.amount_idr ?? 0);
  const rawUniqueCode = Number(row.unique_code);
  const uniqueCode = Number.isInteger(rawUniqueCode)
    && rawUniqueCode >= PAYMENT_UNIQUE_CODE_MIN
    && rawUniqueCode <= PAYMENT_UNIQUE_CODE_MAX
    ? rawUniqueCode
    : null;
  return {
    id: row.id,
    org_id: row.org_id,
    org_name: organization?.name ?? row.org_name ?? null,
    requested_by: row.requested_by,
    created_by_email: requester?.email ?? row.created_by_email ?? null,
    amount_tokens: Number(row.tokens_requested ?? row.amount_tokens ?? 0),
    amount_idr: baseAmount,
    base_amount: baseAmount,
    amount_requested: baseAmount,
    unique_code: uniqueCode,
    transfer_amount: baseAmount + (uniqueCode ?? 0),
    token_price_idr: Number(row.token_price_idr ?? 0),
    payment_method: row.payment_method,
    payment_reference: row.payment_reference ?? row.id,
    destination: destination ? {
      id: destination.id,
      method: destination.method,
      provider_name: destination.provider_name,
      account_reference: destination.account_reference,
      account_holder: destination.account_holder,
      has_qris: Boolean(destination.qris_object_path),
      instructions: destination.instructions,
    } : null,
    proof_available: Boolean(row.proof_object_path ?? row.receipt_url),
    proof_mime_type: row.proof_mime_type ?? null,
    proof_size_bytes: row.proof_size_bytes == null ? null : Number(row.proof_size_bytes),
    proof_file_name: row.proof_file_name ?? null,
    note: row.note ?? null,
    status: row.status,
    status_label: paymentStatusLabel(row.status),
    rejection_reason: row.rejection_reason ?? row.notes ?? null,
    submitted_at: row.submitted_at ?? row.created_at ?? null,
    reviewed_at: row.reviewed_at ?? row.approved_at ?? null,
    reviewed_by: row.reviewed_by ?? row.approved_by ?? null,
    billing_ledger_id: row.billing_ledger_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
  };
}

function generatePaymentUniqueCode() {
  const values = new Uint16Array(1);
  crypto.getRandomValues(values);
  const range = PAYMENT_UNIQUE_CODE_MAX - PAYMENT_UNIQUE_CODE_MIN + 1;
  return PAYMENT_UNIQUE_CODE_MIN + (values[0] % range);
}

function safePaymentProofFileName(value: unknown) {
  const sanitized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);
  return sanitized || "bukti-pembayaran";
}

function legacyPaymentRequestDto(value: any) {
  const legacyStatus = value?.status === "pending" ? "submitted" : value?.status;
  return paymentRequestDto({
    ...value,
    tokens_requested: value?.amount_tokens,
    amount_requested: value?.amount_idr,
    payment_method: "manual_legacy",
    payment_reference: value?.id,
    proof_object_path: value?.receipt_url ? "legacy-inline" : null,
    proof_mime_type: String(value?.receipt_url || "").match(/^data:([^;,]+)/)?.[1] ?? null,
    status: legacyStatus,
    rejection_reason: value?.notes,
    submitted_at: value?.created_at,
    reviewed_at: value?.approved_at,
    reviewed_by: value?.approved_by,
  });
}

function decodeLegacyDataUrl(value: unknown) {
  const match = String(value || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !PAYMENT_PROOF_MIME_EXTENSIONS.has(match[1])) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.byteLength > PAYMENT_PROOF_MAX_BYTES) return null;
  return { mime: match[1], bytes };
}

function normalizePhone(phone: unknown) {
  let raw = String(phone ?? "").trim();
  raw = raw.replace(/[^\d+]/g, "");

  if (!raw) return "";
  if (raw.startsWith("08")) return `+628${raw.slice(2)}`;
  if (raw.startsWith("8")) return `+62${raw}`;
  if (raw.startsWith("62")) return `+${raw}`;
  if (!raw.startsWith("+")) return `+${raw}`;
  return raw;
}

function validatePhoneDestination(phone: unknown) {
  const input = String(phone ?? "").trim();
  const normalized = normalizePhone(input);
  const digitsOnly = normalized.replace(/\D/g, "");

  if (!input) {
    return { input, normalized: "", valid: false, reason: "Nomor kosong" };
  }
  if (!digitsOnly || digitsOnly.length < 9 || digitsOnly.length > 15) {
    return {
      input,
      normalized,
      valid: false,
      reason: `Panjang nomor (${digitsOnly.length} digit) tidak standar (minimal 9, maksimal 15 digit)`,
    };
  }
  if (!/^\+[1-9]\d{8,14}$/.test(normalized)) {
    return { input, normalized, valid: false, reason: "Format E.164 tidak valid" };
  }
  if (/^\+?(628000|62000|00000)/.test(normalized)) {
    return { input, normalized, valid: false, reason: "Nomor terindikasi nomor fiktif / dummy" };
  }
  return { input, normalized, valid: true, reason: null };
}

function getTemplateSendRequirements(template: any) {
  const components = Array.isArray(template?.components) ? template.components : [];
  const body = components.find((item: any) => String(item?.type || "").toUpperCase() === "BODY");
  const bodyText = String(body?.text || "");
  const indexes = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  const bodyVariableCount = indexes.length > 0 ? Math.max(...indexes) : 0;
  const header = components.find((item: any) => String(item?.type || "").toUpperCase() === "HEADER");
  const headerFormat = String(header?.format || "").toUpperCase();
  return {
    bodyVariableCount,
    requiresMedia: ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat),
  };
}

function logContactsRouteFailure(
  stage: string,
  error: any,
  context: {
    numberId: string;
    orgId?: string | null;
    summaryCount?: number | null;
    contactIdCount?: number | null;
    batchIndex?: number | null;
    batchCount?: number | null;
    batchSize?: number | null;
  },
) {
  const diagnosticText = (value: unknown) => {
    if (value === undefined || value === null || value === "") return null;
    return String(value).slice(0, 2000);
  };

  console.error("[CONTACTS] request failed", {
    stage,
    code: diagnosticText(error?.code) ?? "UNKNOWN",
    message: diagnosticText(error?.message ?? error) ?? "Unknown error",
    details: diagnosticText(error?.details),
    hint: diagnosticText(error?.hint),
    numberId: context.numberId,
    orgId: context.orgId ?? null,
    summaryCount: context.summaryCount ?? null,
    contactIdCount: context.contactIdCount ?? null,
    batchIndex: context.batchIndex ?? null,
    batchCount: context.batchCount ?? null,
    batchSize: context.batchSize ?? null,
  });
}

const CONTACT_DETAILS_BATCH_SIZE = 100;
const CONTACT_DETAILS_BATCH_CONCURRENCY = 4;
const BROADCAST_MAX_RECIPIENTS = 5000;
const BROADCAST_CONTACT_VALIDATION_BATCH_SIZE = 100;
const BROADCAST_CONTACT_VALIDATION_CONCURRENCY = 4;
const BROADCAST_RECIPIENT_INSERT_BATCH_SIZE = 100;
const CONTACT_LIST_DEFAULT_PAGE_SIZE = 10;
const CONTACT_LIST_MAX_PAGE_SIZE = 100;
const CONTACT_IMPORT_PREFLIGHT_MAX_CONTACTS = 100;
const BROADCAST_HISTORY_DEFAULT_PAGE_SIZE = 10;
const BROADCAST_HISTORY_MAX_PAGE_SIZE = 50;
const BROADCAST_RECIPIENT_DEFAULT_PAGE_SIZE = 50;
const BROADCAST_RECIPIENT_MAX_PAGE_SIZE = 100;
const DASHBOARD_CALENDAR_MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000;

function parseListPagination(c: any, defaultPageSize: number, maxPageSize: number) {
  const requestedPage = Number(c.req.query("page") ?? 1);
  const requestedPageSize = Number(c.req.query("pageSize") ?? defaultPageSize);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = Number.isInteger(requestedPageSize)
    ? Math.min(Math.max(requestedPageSize, 1), maxPageSize)
    : defaultPageSize;
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}

function safeListSearch(value: unknown, maxLength = 100) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength)
    .replace(/[,%.()"\\]/g, " ")
    .replace(/\s+/g, " ");
}

function pagedPayload<T>(items: T[], count: number | null, page: number, pageSize: number) {
  const total = Number(count ?? 0);
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size));
  }
  return chunks;
}

function parseScheduledAt(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { value: null, error: null };
  }
  const raw = String(value).trim();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    return { value: null, error: "scheduledAt wajib menyertakan timezone/offset eksplisit" };
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) {
    return { value: null, error: "scheduledAt tidak valid" };
  }
  if (timestamp <= Date.now()) {
    return { value: null, error: "scheduledAt harus berada di masa depan" };
  }
  return { value: new Date(timestamp).toISOString(), error: null };
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let diff = a.length ^ b.length;
  const maxLength = Math.max(a.length, b.length);
  for (let index = 0; index < maxLength; index++) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

function renderTemplate(text: string, vars: Record<string, string>) {
  return String(text ?? "").replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

function parseTemplateRecipientPayload(raw: unknown) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as {
      kind?: string;
      vars?: Record<string, string>;
      bodyVariables?: string[];
      mediaUrl?: string;
      fileName?: string;
      rowNumber?: number;
    };
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function graphVersion() {
  return Deno.env.get("META_GRAPH_VERSION") || "v25.0";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function metaFetch(path: string, accessToken: string, init?: RequestInit) {
  const url = `https://graph.facebook.com/${graphVersion()}/${path}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });

  const raw = await res.text();
  let data: any = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { raw };
  }

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      `Meta API error ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

async function testMetaNumber(accessToken: string, phoneNumberId: string) {
  return await metaFetch(phoneNumberId, accessToken, { method: "GET" });
}

async function sendMetaTextMessage(opts: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
}) {
  return await metaFetch(`${opts.phoneNumberId}/messages`, opts.accessToken, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: opts.to,
      type: "text",
      text: {
        preview_url: false,
        body: opts.text,
      },
    }),
  });
}

async function sendMetaTemplateMessage(opts: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  language: string;
  bodyVariables: string[];
  header?:
    | { format: "IMAGE"; link: string }
    | { format: "VIDEO"; link: string }
    | { format: "DOCUMENT"; link: string; filename?: string }
    | null;
}) {
  const components: any[] = [];

  if (opts.header?.link) {
    if (opts.header.format === "IMAGE") {
      components.push({
        type: "header",
        parameters: [{ type: "image", image: { link: opts.header.link } }],
      });
    }
    if (opts.header.format === "VIDEO") {
      components.push({
        type: "header",
        parameters: [{ type: "video", video: { link: opts.header.link } }],
      });
    }
    if (opts.header.format === "DOCUMENT") {
      components.push({
        type: "header",
        parameters: [{
          type: "document",
          document: {
            link: opts.header.link,
            ...(opts.header.filename ? { filename: opts.header.filename } : {}),
          },
        }],
      });
    }
  }

  if (opts.bodyVariables.length) {
    components.push({
      type: "body",
      parameters: opts.bodyVariables.map((text) => ({
        type: "text",
        text,
      })),
    });
  }

  return await metaFetch(`${opts.phoneNumberId}/messages`, opts.accessToken, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: opts.to,
      type: "template",
      template: {
        name: opts.templateName,
        language: { code: opts.language || "id" },
        components,
      },
    }),
  });
}

type BillingMutationInput = {
  orgId: string;
  tokenDelta: number;
  transactionType: "topup" | "usage" | "adjustment" | "refund";
  amountIdr: number;
  description: string;
  refType?: string | null;
  // Relational ledger reference. When present this must be a UUID; arbitrary
  // provider/idempotency identifiers belong in externalReference instead.
  refId?: string | null;
  actorUserId?: string | null;
  provider: string;
  externalReference: string;
  metadata?: Record<string, unknown>;
  floorAtZero?: boolean;
};

async function applyBillingMutation(input: BillingMutationInput) {
  const supa = sb();
  const { data, error } = await supa.rpc("apply_billing_mutation", {
    p_org_id: input.orgId,
    p_token_delta: input.tokenDelta,
    p_transaction_type: input.transactionType,
    p_amount_idr: input.amountIdr,
    p_description: input.description,
    p_ref_type: input.refType ?? null,
    p_ref_id: input.refId ?? null,
    p_actor_user_id: input.actorUserId ?? null,
    p_provider: input.provider,
    p_external_reference: input.externalReference,
    p_metadata: input.metadata ?? {},
    p_floor_at_zero: input.floorAtZero ?? false,
  });

  if (error) throw error;
  return data;
}

function requireUuidBillingReference(value: string, fieldName: string): string {
  const normalized = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`${fieldName} harus UUID valid`);
  }
  return normalized;
}

function requireCanonicalTokenPrice(value: unknown, orgId: string): number {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Harga token canonical tidak valid untuk organisasi ${orgId}`);
  }
  return price;
}

async function getCanonicalTokenPrice(supa: any, orgId: string): Promise<number> {
  const { data, error } = await supa
    .from("billing_balance")
    .select("token_price_idr")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error(`Konfigurasi billing tidak ditemukan untuk organisasi ${orgId}`);
  return requireCanonicalTokenPrice(data.token_price_idr, orgId);
}

async function getCanonicalOrOriginalUsagePrice(
  supa: any,
  orgId: string,
  provider: string,
  externalReference: string,
): Promise<number> {
  const { data: existing, error } = await supa
    .from("billing_transactions")
    .select("amount_idr")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .eq("external_reference", externalReference)
    .maybeSingle();

  if (error) throw error;
  if (existing) return requireCanonicalTokenPrice(existing.amount_idr, orgId);
  return await getCanonicalTokenPrice(supa, orgId);
}

async function consumeBroadcastToken(input: {
  orgId: string;
  recipientId: string;
  broadcastId: string;
  broadcastTitle: string;
  phone: string;
  actorUserId?: string | null;
}) {
  try {
    const supa = sb();
    const recipientReference = requireUuidBillingReference(input.recipientId, "recipientId");
    const broadcastReference = requireUuidBillingReference(input.broadcastId, "broadcastId");
    const tokenPrice = await getCanonicalOrOriginalUsagePrice(
      supa,
      input.orgId,
      "broadcast_usage",
      recipientReference,
    );
    const result = await applyBillingMutation({
      orgId: input.orgId,
      tokenDelta: -1,
      transactionType: "usage",
      amountIdr: tokenPrice,
      description: `Pemakaian token broadcast: ${input.broadcastTitle} -> ${input.phone}`,
      refType: "broadcast_recipient",
      refId: recipientReference,
      actorUserId: input.actorUserId,
      provider: "broadcast_usage",
      externalReference: recipientReference,
      metadata: {
        broadcast_id: broadcastReference,
        recipient_id: recipientReference,
        phone_e164: input.phone,
        token_price_idr: tokenPrice,
      },
    });

    return {
      success: true,
      remaining: Number(result?.new_balance ?? 0),
      message: "Token berhasil digunakan",
      duplicate: Boolean(result?.duplicate),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("saldo token tidak mencukupi")) {
      return { success: false, remaining: 0, message, duplicate: false };
    }
    throw error;
  }
}

function normalizeUsername(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

async function syncMetaTemplatesForNumber(params: {
  orgId: string;
  userId?: string | null;
  wabaId: string;
  accessToken: string;
}) {
  const supa = sb();

  const url = `https://graph.facebook.com/${graphVersion()}/${params.wabaId}/message_templates`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error?.message || "Gagal mengambil template dari Meta");
  }

  const items = Array.isArray(json?.data) ? json.data : [];

  for (const tpl of items) {
    await supa.from("wa_templates").upsert(
      {
        org_id: params.orgId,
        name: String(tpl.name ?? "").trim().toLowerCase(),
        category: String(tpl.category ?? "marketing").toLowerCase(),
        language: String(tpl.language ?? "id"),
        status: String(tpl.status ?? "pending").toLowerCase(),
        components: tpl.components ?? [],
        meta_template_id: tpl.id ?? null,
      },
      {
        onConflict: "org_id,name,language",
      },
    );
  }

  if (params.userId) {
    await supa.from("app_activity").insert({
      org_id: params.orgId,
      actor_user_id: params.userId,
      type: "template_sync",
      message: `Sync template Meta: ${items.length} template`,
      meta: { waba_id: params.wabaId, total: items.length },
    });
  }

  return {
    total: items.length,
    templates: items,
  };
}

// ===== Auth middleware =====
async function requireAuth(c: any, next: any) {
  try {
    const token =
      c.req.header(SESSION_HEADER) ||
      c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json(jsonFail("Missing session token"), 401);

    const supa = sb();

    const { data: { user: authUser }, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !authUser) {
      return c.json(jsonFail("Sesi Anda tidak valid. Silakan masuk kembali."), 401);
    }

    const { data: user, error: userErr } = await supa
      .from("app_users")
      .select("id, org_id, email, full_name, role, is_active")
      .eq("id", authUser.id)
      .maybeSingle();

    if (userErr) return c.json(jsonFail(userErr.message), 500);
    if (!user) return c.json(jsonFail("Profil pengguna tidak ditemukan"), 401);
    const reqUrl = new URL(c.req.url);
    const isSessionRoute = reqUrl.pathname.endsWith("/auth/session") || reqUrl.pathname.endsWith("/auth/logout");

    if (!user.is_active && !isSessionRoute) {
      return c.json(jsonFail("Akun Anda dinonaktifkan. Silakan hubungi admin."), 403);
    }

    const org_id = user.org_id;
    const email = user.email;
    const name = user.full_name;
    const role = String(user.role || "").toLowerCase();

    if (!org_id) {
      return c.json(jsonFail("Profil pengguna tidak memiliki organisasi yang valid"), 403);
    }

    const authUserObj: any = {
      id: user.id,
      auth_user_id: authUser.id,
      auth_email: normalizeEmail(authUser.email),
      org_id,
      email,
      name,
      full_name: name,
      role,
      status: user.is_active ? "active" : "inactive",
      is_active: user.is_active,
      wa_number: authUser.user_metadata?.wa_number || "",
    };

    if (email?.toLowerCase() === "mckuadratid@gmail.com") {
      authUserObj.orgName = "Superadmin Portal";
      authUserObj.org_name = "Superadmin Portal";
    }

    c.set("authUser", authUserObj);

    c.set("sessionToken", token);
    await next();
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
}

const ORG_ADMIN_ROLES = new Set(["owner", "admin"]);

async function requireOrgAdmin(c: any, next: any) {
  const user = c.get("authUser");
  if (!user?.org_id || !ORG_ADMIN_ROLES.has(String(user.role || "").toLowerCase())) {
    return c.json(jsonFail("Aksi ini hanya dapat dilakukan admin organisasi"), 403);
  }
  await next();
}

// ===== Health =====
app.get(`${API_PREFIX}/`, (c) => {
  return c.json(
    jsonOk({
      status: "ok",
      message: "SIPESA API running",
      graphVersion: graphVersion(),
    }),
  );
});


// ===== AUTH =====
app.post(`${API_PREFIX}/auth/signup`, (c) => {
  return c.json(
    jsonFail("Registrasi langsung tidak didukung melalui API ini. Silakan gunakan Supabase Auth SDK di frontend."),
    400,
  );
});

app.post(`${API_PREFIX}/auth/login`, async (c) => {
  try {
    const body = await c.req.json();

    const identifier = String(body.email ?? body.identifier ?? "").trim();
    const password = String(body.password ?? "");

    if (!identifier || !password) {
      return c.json(jsonFail("Email/username dan password wajib diisi"), 400);
    }

    const supa = sb();

    const normalizedEmail = normalizeEmail(identifier);
    const normalizedUser = normalizeUsername(identifier);

    // Cari user di app_users berdasarkan email atau username
    const { data: userProfile, error: dbErr } = await supa
      .from("app_users")
      .select("id, org_id, email, username, full_name, role, is_active")
      .or(`email.ilike.${normalizedEmail},username.ilike.${normalizedUser}`)
      .maybeSingle();

    if (dbErr) {
      return c.json(jsonFail("Gagal masuk. Terjadi gangguan pada sistem database. Silakan coba lagi."), 500);
    }

    if (!userProfile) {
      return c.json(jsonFail("Email/username atau password salah"), 401);
    }



    // Login via Supabase Auth
    const { data: authSession, error: authErr } = await supa.auth.signInWithPassword({
      email: userProfile.email,
      password: password,
    });

    if (authErr) {
      const msg = authErr.message.toLowerCase();
      if (msg.includes("confirm") || msg.includes("verify") || msg.includes("active")) {
        return c.json(jsonFail("Akun Anda belum aktif. Silakan verifikasi email Anda terlebih dahulu."), 403);
      }
      return c.json(jsonFail("Email/username atau password salah"), 401);
    }

    const sessionToken = authSession.session?.access_token;
    if (!sessionToken) {
      return c.json(jsonFail("Sesi login gagal dibuat. Silakan coba lagi."), 500);
    }

    // Update last login
    const { error: lastLoginErr } = await supa
      .from("app_users")
      .update({ last_login_at: nowIso() })
      .eq("id", userProfile.id);

    if (lastLoginErr) {
      console.warn("last_login_at update failed:", lastLoginErr.message);
    }

    const { data: org } = await supa
      .from("orgs")
      .select("name")
      .eq("id", userProfile.org_id)
      .maybeSingle();

    let finalOrgId = userProfile.org_id;
    let finalOrgName = org?.name ?? null;

    if (userProfile.email?.toLowerCase() === "mckuadratid@gmail.com") {
      finalOrgName = "Superadmin Portal";
    }

    await supa.from("app_activity").insert({
      org_id: finalOrgId,
      actor_user_id: userProfile.id,
      type: "login",
      message: "User login",
      meta: {
        email: userProfile.email,
        username: userProfile.username,
      },
    });

    return c.json(
      jsonOk({
        user: {
          id: userProfile.id,
          org_id: finalOrgId,
          email: userProfile.email,
          username: userProfile.username,
          name: userProfile.full_name,
          role: userProfile.role,
          status: userProfile.is_active ? "active" : "inactive",
          orgName: finalOrgName,
        },
        token: sessionToken,
      }),
    );
  } catch (e) {
    return c.json(jsonFail("Gagal masuk. Terjadi kesalahan tak terduga."), 500);
  }
});

app.get(`${API_PREFIX}/auth/session`, requireAuth, async (c) => {
  return c.json(jsonOk(c.get("authUser")));
});

app.post(`${API_PREFIX}/auth/logout`, requireAuth, async (c) => {
  try {
    const supa = sb();
    const token = c.get("sessionToken");
    await supa.auth.admin.signOut(token);
    return c.json(jsonOk(true));
  } catch (e) {
    return c.json(jsonOk(true));
  }
});

// ===== NUMBERS =====
app.get(`${API_PREFIX}/numbers`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const { data, error } = await supa
      .from("wa_numbers")
      .select("*")
      .eq("org_id", user.org_id)
      .order("created_at", { ascending: false });

    if (error) return c.json(jsonFail(error.message), 500);

    // Fetch count of unread messages (direction = "in" and status = "delivered") grouped by number_id
    const { data: unreadMessages, error: countErr } = await supa
      .from("wa_messages")
      .select("number_id")
      .eq("org_id", user.org_id)
      .eq("direction", "in")
      .eq("status", "delivered");

    const unreadCountsMap: Record<string, number> = {};
    if (Array.isArray(unreadMessages)) {
      for (const m of unreadMessages) {
        if (m.number_id) {
          unreadCountsMap[m.number_id] = (unreadCountsMap[m.number_id] || 0) + 1;
        }
      }
    }

    // Fetch per-number auto reply settings from key_info
    const { data: numberAutoReplyRows } = await supa
      .from("key_info")
      .select("key, value")
      .like("key", "autoreply_num_%");

    const numberAutoRepliesMap: Record<string, { autoReplyEnabled: boolean; autoReplyMessage: string }> = {};
    if (Array.isArray(numberAutoReplyRows)) {
      for (const item of numberAutoReplyRows) {
        const numId = String(item.key || "").replace("autoreply_num_", "");
        if (numId && item.value) {
          numberAutoRepliesMap[numId] = {
            autoReplyEnabled: item.value.autoReplyEnabled !== false,
            autoReplyMessage:
              item.value.autoReplyMessage ||
              "Nomor ini hanya digunakan untuk pengiriman broadcast. Apabila Anda membutuhkan informasi lebih lanjut, silakan hubungi Customer Service kami.",
          };
        }
      }
    }

    const defaultMsg = "Nomor ini hanya digunakan untuk pengiriman broadcast. Apabila Anda membutuhkan informasi lebih lanjut, silakan hubungi Customer Service kami.";

    const mapped = (data ?? []).map((r: any) => ({
      id: r.id,
      number: r.phone_e164 ?? "",
      name: r.label ?? "Nomor WA",
      status: r.is_active ? "active" : "inactive",
      unreadCount: unreadCountsMap[r.id] || 0,
      lastActivity: r.updated_at ?? r.created_at ?? nowIso(),
      businessId: r.business_id ?? null,
      wabaId: r.waba_id ?? null,
      phoneNumberId: r.phone_number_id ?? null,
      hasAccessToken: !!r.access_token,
      autoReplyEnabled: numberAutoRepliesMap[r.id]?.autoReplyEnabled ?? true,
      autoReplyMessage: numberAutoRepliesMap[r.id]?.autoReplyMessage || defaultMsg,
    }));

    return c.json(jsonOk(mapped));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/numbers`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const body = await c.req.json();
    const supa = sb();

    const row = {
      org_id: user.org_id,
      label: String(body.name ?? body.label ?? "Nomor WA").trim(),
      phone_e164: normalizePhone(body.number ?? body.phone_e164),
      business_id: String(body.businessId ?? "").trim() || null,
      waba_id: String(body.wabaId ?? "").trim() || null,
      phone_number_id: String(body.phoneNumberId ?? "").trim() || null,
      access_token: String(body.accessToken ?? "").trim() || null,
      is_active: true,
    };

    if (!row.phone_e164) return c.json(jsonFail("Nomor wajib diisi"), 400);
    if (!row.phone_number_id) return c.json(jsonFail("Phone Number ID wajib"), 400);
    if (!row.access_token) return c.json(jsonFail("Access Token wajib"), 400);

    await testMetaNumber(row.access_token, row.phone_number_id);

    const { data, error } = await supa
      .from("wa_numbers")
      .insert(row)
      .select("*")
      .single();

    if (error) return c.json(jsonFail(error.message), 500);

    let syncResult: { total: number } | null = null;

    if (data.waba_id && data.access_token) {
      try {
        const synced = await syncMetaTemplatesForNumber({
          orgId: user.org_id,
          userId: user.id,
          wabaId: data.waba_id,
          accessToken: data.access_token,
        });
        syncResult = { total: synced.total };
      } catch (syncErr) {
        console.warn("Auto sync template failed:", syncErr);
      }
    }

    await supa.from("app_activity").insert({
      org_id: user.org_id,
      actor_user_id: user.id,
      type: "number_connected",
      message: `Nomor WA ditambahkan: ${row.phone_e164}`,
      meta: { number_id: data.id },
    });

    return c.json(
      jsonOk({
        id: data.id,
        number: data.phone_e164,
        name: data.label,
        status: data.is_active ? "active" : "inactive",
        unreadCount: 0,
        lastActivity: data.updated_at ?? data.created_at,
        businessId: data.business_id ?? null,
        wabaId: data.waba_id ?? null,
        phoneNumberId: data.phone_number_id ?? null,
        syncedTemplates: syncResult?.total ?? 0,
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/numbers/:id/test`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const id = c.req.param("id");
    const supa = sb();

    const { data: row, error } = await supa
      .from("wa_numbers")
      .select("*")
      .eq("org_id", user.org_id)
      .eq("id", id)
      .maybeSingle();

    if (error) return c.json(jsonFail(error.message), 500);
    if (!row) return c.json(jsonFail("Nomor tidak ditemukan"), 404);
    if (!row.access_token || !row.phone_number_id) {
      return c.json(jsonFail("Nomor belum lengkap: access_token / phone_number_id kosong"), 400);
    }

    const meta = await testMetaNumber(row.access_token, row.phone_number_id);
    return c.json(jsonOk({ connected: true, meta }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/numbers/validate`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const body = await c.req.json();
    const numberId = body.numberId;
    const phones = body.phones;
    const supa = sb();

    if (!Array.isArray(phones) || phones.length === 0) {
      return c.json(jsonFail("Daftar nomor telepon wajib diisi"), 400);
    }

    let waNumberRow = null;
    if (numberId) {
      const { data } = await supa
        .from("wa_numbers")
        .select("*")
        .eq("org_id", user.org_id)
        .eq("id", numberId)
        .maybeSingle();
      waNumberRow = data;
    }

    const formattedNumbers: Array<{
      input: string;
      normalized: string;
      formatValid: boolean;
      formatReason?: string;
    }> = [];

    for (const rawPhone of phones) {
      const validation = validatePhoneDestination(rawPhone);

      formattedNumbers.push({
        input: validation.input,
        normalized: validation.normalized,
        formatValid: validation.valid,
        formatReason: validation.reason ?? undefined,
      });
    }

    let checkedWithMeta = false;
    let metaError: string | null = null;
    const metaResultsMap: Record<string, { waExists: boolean | null; waStatus: string; waId?: string }> = {};

    if (waNumberRow?.access_token && waNumberRow?.phone_number_id) {
      try {
        const validPhonesToCheck = formattedNumbers
          .filter((n) => n.formatValid)
          .map((n) => n.normalized);

        if (validPhonesToCheck.length > 0) {
          const chunkSize = 50;
          for (let i = 0; i < validPhonesToCheck.length; i += chunkSize) {
            const chunk = validPhonesToCheck.slice(i, i + chunkSize);
            try {
              const res = await metaFetch(`${waNumberRow.phone_number_id}/contacts`, waNumberRow.access_token, {
                method: "POST",
                body: JSON.stringify({
                  blocking: "wait",
                  contacts: chunk,
                  force_check: true,
                }),
              });

              const contactsData = Array.isArray(res?.data) ? res.data : (Array.isArray(res?.contacts) ? res.contacts : []);
              if (contactsData.length > 0) {
                checkedWithMeta = true;
                for (const item of contactsData) {
                  const inputNum = String(item.input || "").trim();
                  const normKey = inputNum.startsWith("+") ? inputNum : `+${inputNum}`;
                  const status = String(item.status || "").toLowerCase();
                  if (status === "valid") {
                    metaResultsMap[normKey] = {
                      waExists: true,
                      waStatus: "valid",
                      waId: item.wa_id,
                    };
                  } else if (status === "invalid" || status === "failed") {
                    metaResultsMap[normKey] = {
                      waExists: false,
                      waStatus: "invalid",
                    };
                  } else {
                    metaResultsMap[normKey] = {
                      waExists: null,
                      waStatus: status || "unknown",
                    };
                  }
                }
              }
            } catch (chunkErr: any) {
              console.warn("Meta contacts check error for chunk:", chunkErr.message);
              metaError = chunkErr.message || "Meta API error";
            }
          }
        }
      } catch (err: any) {
        console.warn("Meta contacts check total error:", err.message);
        metaError = err.message || "Gagal menghubungi Meta API";
      }
    }

    const results = formattedNumbers.map((item) => {
      const metaInfo = metaResultsMap[item.normalized];
      let waExists = metaInfo ? metaInfo.waExists : null;
      let waStatus = metaInfo ? metaInfo.waStatus : "unknown";

      if (!item.formatValid) {
        waExists = false;
        waStatus = "invalid_format";
      }

      return {
        input: item.input,
        normalized: item.normalized,
        formatValid: item.formatValid,
        formatReason: item.formatReason,
        waExists,
        waStatus,
      };
    });

    let userFriendlyMetaError = metaError;
    if (metaError && /unsupported post request|does not exist|permission|not support/i.test(metaError)) {
      userFriendlyMetaError = "Akun WhatsApp Cloud API ini tidak diizinkan Meta untuk cek status nomor aktif secara massal via API. Namun validasi format & duplikat lokal tetap 100% aktif & akurat.";
    }

    return c.json(
      jsonOk({
        checkedWithMeta,
        metaError: userFriendlyMetaError,
        results,
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/numbers/:numberId/contacts`, requireAuth, async (c) => {
  const numberId = c.req.param("numberId");
  let stage = "resolve_auth_context";
  let orgId: string | null = null;
  let summaryCount: number | null = null;
  let contactIdCount: number | null = null;

  try {
    const user = c.get("authUser");
    orgId = user?.org_id ?? null;
    const supa = sb();

    // Aggregate latest-message and unread state inside Postgres. This avoids
    // transferring/scanning up to 20,000 messages twice in every Edge request.
    stage = "conversation_summary_rpc";
    const { data: summaries, error: summaryError } = await supa.rpc(
      "get_wa_conversation_summaries",
      { p_org_id: user.org_id, p_number_id: numberId },
    );

    if (summaryError) {
      logContactsRouteFailure(stage, summaryError, { numberId, orgId });
      return c.json(jsonFail(summaryError.message), 500);
    }

    summaryCount = Array.isArray(summaries) ? summaries.length : null;

    const contactIds = [...new Set(
      (summaries ?? []).map((row: any) => String(row.contact_id || "")).filter(Boolean),
    )];
    contactIdCount = contactIds.length;

    if (contactIds.length === 0) {
      return c.json(jsonOk([]));
    }

    // 2. Keep each PostgREST URL bounded. Sending hundreds of UUIDs through a
    // single .in() filter can exceed the request-line limit before PostgREST
    // gets a chance to execute the query.
    stage = "contact_details_query";
    const contactIdBatches = chunkValues(contactIds, CONTACT_DETAILS_BATCH_SIZE);
    const contacts: any[] = [];

    for (
      let waveStart = 0;
      waveStart < contactIdBatches.length;
      waveStart += CONTACT_DETAILS_BATCH_CONCURRENCY
    ) {
      const wave = contactIdBatches.slice(
        waveStart,
        waveStart + CONTACT_DETAILS_BATCH_CONCURRENCY,
      );
      const results = await Promise.all(wave.map(async (batch, waveIndex) => {
        const batchIndex = waveStart + waveIndex;
        const result = await supa
          .from("wa_contacts")
          .select("*")
          .eq("org_id", user.org_id)
          .in("id", batch);
        return { ...result, batchIndex, batchSize: batch.length };
      }));

      for (const result of results) {
        if (result.error) {
          logContactsRouteFailure(stage, result.error, {
            numberId,
            orgId,
            summaryCount,
            contactIdCount,
            batchIndex: result.batchIndex,
            batchCount: contactIdBatches.length,
            batchSize: result.batchSize,
          });
          return c.json(jsonFail(result.error.message), 500);
        }
        contacts.push(...(result.data ?? []));
      }
    }

    stage = "map_contact_response";
    const contactsById = new Map(
      contacts.map((contact: any) => [String(contact.id), contact]),
    );

    // The RPC already orders by latest message. Mapping in summary order keeps
    // that ordering stable regardless of batch response order.
    const mapped = (summaries ?? []).flatMap((summary: any) => {
      const contact: any = contactsById.get(String(summary.contact_id));
      if (!contact) return [];
      return [{
        id: contact.id,
        name: contact.display_name || contact.phone_e164 || "Kontak",
        phone: contact.phone_e164 ?? "",
        lastMessage: summary.last_text ?? "",
        timestamp: summary.last_created_at
          ?? contact.last_message_at
          ?? contact.updated_at
          ?? contact.created_at
          ?? nowIso(),
        unread: summary.has_unread === true,
      }];
    });

    return c.json(jsonOk(mapped));
  } catch (e) {
    logContactsRouteFailure(stage, e, {
      numberId,
      orgId,
      summaryCount,
      contactIdCount,
    });
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/media/:mediaId`, requireAuth, async (c) => {
  try {
    const mediaId = c.req.param("mediaId");
    const numberId = c.req.query("numberId");
    const user = c.get("authUser");

    if (!numberId) {
      return c.json(jsonFail("numberId wajib"), 400);
    }
    if (!/^\d{1,64}$/.test(mediaId)) {
      return c.json(jsonFail("Media tidak ditemukan"), 404);
    }

    const supa = sb();

    // A provider media id is not an authorization credential. Prove the
    // requested media belongs to a message in this tenant and WABA number.
    const { data: ownedMessage, error: messageError } = await supa
      .from("wa_messages")
      .select("id")
      .eq("org_id", user.org_id)
      .eq("number_id", numberId)
      .or([
        `payload->>id.eq.${mediaId}`,
        `payload->image->>id.eq.${mediaId}`,
        `payload->document->>id.eq.${mediaId}`,
        `payload->sticker->>id.eq.${mediaId}`,
        `payload->video->>id.eq.${mediaId}`,
        `payload->audio->>id.eq.${mediaId}`,
        `payload->voice->>id.eq.${mediaId}`,
      ].join(","))
      .limit(1)
      .maybeSingle();

    if (messageError || !ownedMessage) {
      return c.json(jsonFail("Media tidak ditemukan"), 404);
    }

    const { data: numberRow, error } = await supa
      .from("wa_numbers")
      .select("access_token")
      .eq("id", numberId)
      .eq("org_id", user.org_id)
      .maybeSingle();

    if (error || !numberRow || !numberRow.access_token) {
      return c.json(jsonFail("Nomor WA tidak valid atau token tidak ditemukan"), 404);
    }

    const accessToken = numberRow.access_token;

    // 1. Get media info from Meta Graph API
    const metaMediaRes = await fetch(`https://graph.facebook.com/${graphVersion()}/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!metaMediaRes.ok) {
      const errText = await metaMediaRes.text();
      console.error("Meta media info error:", errText);
      return c.json(jsonFail("Gagal mengambil info media dari Meta"), metaMediaRes.status);
    }

    const mediaInfo = await metaMediaRes.json();
    const downloadUrl = mediaInfo.url;
    const mimeType = mediaInfo.mime_type || "image/jpeg";

    if (!downloadUrl) {
      return c.json(jsonFail("URL download media tidak ditemukan"), 404);
    }

    // 2. Download file media binary
    const fileRes = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "curl/7.64.1",
      },
    });

    if (!fileRes.ok) {
      return c.json(jsonFail("Gagal mengunduh file media dari Meta"), fileRes.status);
    }

    // 3. Return file binary
    const arrayBuffer = await fileRes.arrayBuffer();
    return c.body(arrayBuffer, 200, {
      "Content-Type": mimeType,
      "Cache-Control": "private, no-store",
    });
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// GET one bounded page of organization contacts.
app.get(`${API_PREFIX}/contacts`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const { page, pageSize, from, to } = parseListPagination(c, CONTACT_LIST_DEFAULT_PAGE_SIZE, CONTACT_LIST_MAX_PAGE_SIZE);
    const search = safeListSearch(c.req.query("search"));
    const label = safeListSearch(c.req.query("label"));

    let query = supa
      .from("wa_contacts")
      .select("id, display_name, phone_e164, label, created_at, updated_at", { count: "exact" })
      .eq("org_id", user.org_id);

    if (search) query = query.or(`display_name.ilike.%${search}%,phone_e164.ilike.%${search}%,label.ilike.%${search}%`);
    if (label) query = query.eq("label", label);

    const { data, error, count } = await query
      .order("display_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) return c.json(jsonFail(error.message), 500);

    const mapped = (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.display_name || r.phone_e164 || "Kontak",
      phone: r.phone_e164 ?? "",
      label: r.label ?? "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return c.json(jsonOk(pagedPayload(mapped, count, page, pageSize)));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// POST a bounded, read-only contact-import preflight for the authenticated organization.
app.post(`${API_PREFIX}/contacts/import/preflight`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const body = await c.req.json();
    const contacts = body?.contacts;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return c.json(jsonFail("Daftar kontak wajib diisi"), 400);
    }
    if (contacts.length > CONTACT_IMPORT_PREFLIGHT_MAX_CONTACTS) {
      return c.json(
        jsonFail(`Maksimal ${CONTACT_IMPORT_PREFLIGHT_MAX_CONTACTS} kontak per pemeriksaan impor`),
        413,
      );
    }

    const hasInvalidRowId = contacts.some((contact: any) => {
      const rowId = contact?.rowId;
      return !(
        typeof rowId === "string" ||
        (typeof rowId === "number" && Number.isFinite(rowId))
      );
    });
    if (hasInvalidRowId) {
      return c.json(jsonFail("Setiap kontak wajib memiliki rowId berupa teks atau angka"), 400);
    }

    const seenPhones = new Set<string>();
    const classified = contacts.map((contact: any) => {
      const validation = validatePhoneDestination(contact?.phone);
      const duplicateWithinImport = validation.normalized !== "" && seenPhones.has(validation.normalized);
      if (validation.normalized !== "") seenPhones.add(validation.normalized);

      return {
        rowId: contact.rowId as string | number,
        normalizedPhone: validation.normalized,
        valid: validation.valid,
        invalidReason: validation.reason,
        duplicateWithinImport,
      };
    });

    const uniqueValidPhones = [...new Set(
      classified
        .filter((result) => result.valid)
        .map((result) => result.normalizedPhone),
    )];

    const existingByPhone = new Map<string, string>();
    if (uniqueValidPhones.length > 0) {
      const supa = sb();
      const { data: existingContacts, error: lookupError } = await supa
        .from("wa_contacts")
        .select("id, phone_e164")
        .eq("org_id", user.org_id)
        .in("phone_e164", uniqueValidPhones);

      if (lookupError) {
        console.error("[CONTACT_IMPORT_PREFLIGHT] organization duplicate lookup failed", {
          code: lookupError.code ?? "UNKNOWN",
          message: lookupError.message ?? "Unknown error",
          orgId: user.org_id,
          contactCount: contacts.length,
          lookupCount: uniqueValidPhones.length,
        });
        return c.json(jsonFail("Pemeriksaan duplikat kontak belum dapat dilakukan. Silakan coba lagi."), 500);
      }

      for (const existing of existingContacts ?? []) {
        if (existing?.phone_e164 && existing?.id) {
          existingByPhone.set(String(existing.phone_e164), String(existing.id));
        }
      }
    }

    const results = classified.map((result) => {
      const existingContactId = result.valid
        ? existingByPhone.get(result.normalizedPhone) ?? null
        : null;
      return {
        ...result,
        existingOrganizationDuplicate: existingContactId !== null,
        existingContactId,
      };
    });

    return c.json(jsonOk({
      results,
      summary: {
        total: results.length,
        validNew: results.filter((result) => (
          result.valid &&
          !result.duplicateWithinImport &&
          !result.existingOrganizationDuplicate
        )).length,
        invalid: results.filter((result) => !result.valid).length,
        duplicateWithinImport: results.filter((result) => result.duplicateWithinImport).length,
        existingOrganizationDuplicate: results.filter((result) => result.existingOrganizationDuplicate).length,
      },
    }));
  } catch (error) {
    console.error("[CONTACT_IMPORT_PREFLIGHT] request failed", {
      code: (error as any)?.code ?? "UNKNOWN",
      message: (error as any)?.message ?? "Unknown error",
    });
    return c.json(jsonFail("Pemeriksaan impor kontak belum dapat dilakukan. Silakan coba lagi."), 500);
  }
});

// POST create contact
app.post(`${API_PREFIX}/contacts`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const body = await c.req.json();
    const supa = sb();

    const name = String(body.name ?? "").trim();
    const phone = normalizePhone(body.phone);
    const label = safeListSearch(body.label, 80) || null;

    if (!name) return c.json(jsonFail("Nama kontak harus diisi"), 400);
    if (!phone) return c.json(jsonFail("Nomor telepon harus diisi"), 400);

    const { data: existing, error: existingError } = await supa
      .from("wa_contacts")
      .select("*")
      .eq("org_id", user.org_id)
      .eq("phone_e164", phone)
      .maybeSingle();

    if (existingError) {
      console.error("[CONTACT_CREATE] duplicate lookup failed", {
        code: existingError.code ?? "UNKNOWN",
        message: existingError.message ?? "Unknown error",
        orgId: user.org_id,
      });
      return c.json(jsonFail("Kontak belum dapat diperiksa. Silakan coba lagi."), 500);
    }

    if (existing) {
      let contact = existing;
      if (label !== null && existing.label !== label) {
        const { data: updated, error: updateLabelError } = await supa
          .from("wa_contacts")
          .update({ label, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .eq("org_id", user.org_id)
          .select("*")
          .single();
        if (updateLabelError) return c.json(jsonFail(updateLabelError.message), 500);
        contact = updated;
      }
      return c.json(jsonOk({
        id: contact.id,
        name: contact.display_name,
        phone: contact.phone_e164,
        label: contact.label ?? "",
        createdAt: contact.created_at,
      }));
    }

    const { data, error } = await supa
      .from("wa_contacts")
      .insert({
        org_id: user.org_id,
        display_name: name,
        phone_e164: phone,
        label,
      })
      .select("*")
      .single();

    if (error?.code === "23505") {
      const { data: racedExisting, error: racedLookupError } = await supa
        .from("wa_contacts")
        .select("id, display_name, phone_e164, label, created_at")
        .eq("org_id", user.org_id)
        .eq("phone_e164", phone)
        .maybeSingle();

      if (racedExisting && !racedLookupError) {
        return c.json(jsonOk({
          id: racedExisting.id,
          name: racedExisting.display_name,
          phone: racedExisting.phone_e164,
          label: racedExisting.label ?? "",
          createdAt: racedExisting.created_at,
        }));
      }

      console.error("[CONTACT_CREATE] unique race could not be resolved", {
        code: racedLookupError?.code ?? error.code,
        message: racedLookupError?.message ?? error.message,
        orgId: user.org_id,
      });
      return c.json(jsonFail("Nomor telepon sudah terdaftar di organisasi ini."), 409);
    }
    if (error) {
      console.error("[CONTACT_CREATE] insert failed", {
        code: error.code ?? "UNKNOWN",
        message: error.message ?? "Unknown error",
        orgId: user.org_id,
      });
      return c.json(jsonFail("Kontak belum dapat disimpan. Silakan coba lagi."), 500);
    }

    return c.json(jsonOk({
      id: data.id,
      name: data.display_name,
      phone: data.phone_e164,
      label: data.label ?? "",
      createdAt: data.created_at,
    }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// PUT update contact
app.put(`${API_PREFIX}/contacts/:id`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const id = c.req.param("id");
    const body = await c.req.json();
    const supa = sb();

    const name = String(body.name ?? "").trim();
    const phone = normalizePhone(body.phone);
    const label = safeListSearch(body.label, 80) || null;

    if (!name) return c.json(jsonFail("Nama kontak harus diisi"), 400);
    if (!phone) return c.json(jsonFail("Nomor telepon harus diisi"), 400);

    const { data, error } = await supa
      .from("wa_contacts")
      .update({
        display_name: name,
        phone_e164: phone,
        label,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("org_id", user.org_id)
      .select("*")
      .single();

    if (error) return c.json(jsonFail(error.message), 500);

    return c.json(jsonOk({
      id: data.id,
      name: data.display_name,
      phone: data.phone_e164,
      label: data.label ?? "",
      updatedAt: data.updated_at,
    }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// DELETE contact
app.delete(`${API_PREFIX}/contacts/:id`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const id = c.req.param("id");
    const supa = sb();

    const { error } = await supa
      .from("wa_contacts")
      .delete()
      .eq("id", id)
      .eq("org_id", user.org_id);

    if (error) return c.json(jsonFail(error.message), 500);

    return c.json(jsonOk({ success: true }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/templates/sync-default`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const { data: numberRow, error } = await supa
      .from("wa_numbers")
      .select("*")
      .eq("org_id", user.org_id)
      .not("waba_id", "is", null)
      .not("access_token", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) return c.json(jsonFail(error.message), 500);
    if (!numberRow) return c.json(jsonFail("Belum ada nomor/WABA aktif untuk sync template"), 404);

    const result = await syncMetaTemplatesForNumber({
      orgId: user.org_id,
      userId: user.id,
      wabaId: String(numberRow.waba_id),
      accessToken: String(numberRow.access_token),
    });

    return c.json(
      jsonOk({
        total: result.total,
        wabaId: numberRow.waba_id,
        sourceNumberId: numberRow.id,
      })
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// ===== MESSAGES =====
app.get(`${API_PREFIX}/numbers/:numberId/contacts/:contactId/message-statuses`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const numberId = c.req.param("numberId");
    const contactId = c.req.param("contactId");
    const ids = String(c.req.query("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (ids.length === 0 || ids.length > 50 || ids.some((id) => !uuidPattern.test(id))) {
      return c.json(jsonFail("Daftar message id tidak valid"), 400);
    }

    const { data, error } = await sb()
      .from("wa_messages")
      .select("id, status")
      .eq("org_id", user.org_id)
      .eq("number_id", numberId)
      .eq("contact_id", contactId)
      .in("id", ids);

    if (error) return c.json(jsonFail(error.message), 500);
    return c.json(jsonOk(data ?? []));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/numbers/:numberId/contacts/:contactId/messages`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const numberId = c.req.param("numberId");
    const contactId = c.req.param("contactId");
    const requestedLimit = Number(c.req.query("limit") ?? 50);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const beforeCreatedAt = c.req.query("beforeCreatedAt");
    const beforeId = c.req.query("beforeId");
    const afterCreatedAt = c.req.query("afterCreatedAt");
    const afterId = c.req.query("afterId");
    const supa = sb();

    const hasBefore = Boolean(beforeCreatedAt || beforeId);
    const hasAfter = Boolean(afterCreatedAt || afterId);
    if ((hasBefore && hasAfter) || (hasBefore && (!beforeCreatedAt || !beforeId)) || (hasAfter && (!afterCreatedAt || !afterId))) {
      return c.json(jsonFail("Cursor message tidak valid"), 400);
    }

    const cursorCreatedAt = beforeCreatedAt || afterCreatedAt;
    const cursorId = beforeId || afterId;
    if (cursorCreatedAt && (!Number.isFinite(Date.parse(cursorCreatedAt)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(cursorId)))) {
      return c.json(jsonFail("Cursor message tidak valid"), 400);
    }
    const normalizedCursorCreatedAt = cursorCreatedAt
      ? new Date(cursorCreatedAt).toISOString()
      : null;

    let query = supa
      .from("wa_messages")
      .select("*")
      .eq("org_id", user.org_id)
      .eq("number_id", numberId)
      .eq("contact_id", contactId);

    if (hasBefore) {
      query = query.or(`created_at.lt.${normalizedCursorCreatedAt},and(created_at.eq.${normalizedCursorCreatedAt},id.lt.${beforeId})`);
    } else if (hasAfter) {
      query = query.or(`created_at.gt.${normalizedCursorCreatedAt},and(created_at.eq.${normalizedCursorCreatedAt},id.gt.${afterId})`);
    }

    const ascending = hasAfter;
    const { data, error } = await query
      .order("created_at", { ascending })
      .order("id", { ascending })
      .limit(limit + 1);

    if (error) return c.json(jsonFail(error.message), 500);

    const hasMore = (data ?? []).length > limit;
    const pageRows = (data ?? []).slice(0, limit);
    if (!ascending) pageRows.reverse();

    const mapped = pageRows.map((r: any) => ({
      id: r.id,
      content: r.text_body ?? "",
      sender: r.direction === "out" ? "user" : "contact",
      timestamp: r.created_at ?? nowIso(),
      status: r.status,
      messageType: r.message_type || "text",
      payload: r.payload || null,
      contactName: undefined,
    }));

    const oldest = pageRows[0];
    const latest = pageRows[pageRows.length - 1];
    return c.json(jsonOk({
      messages: mapped,
      hasMore,
      olderCursor: oldest ? { createdAt: oldest.created_at, id: oldest.id } : null,
      latestCursor: latest ? { createdAt: latest.created_at, id: latest.id } : null,
    }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/numbers/:numberId/contacts/:contactId/read`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const numberId = c.req.param("numberId");
    const contactId = c.req.param("contactId");
    const supa = sb();

    // Explicit and idempotent: only unread inbound messages can advance to
    // read. Delivered/read status from provider webhooks can never regress.
    const { data, error } = await supa
      .from("wa_messages")
      .update({ status: "read", read_at: nowIso() })
      .eq("org_id", user.org_id)
      .eq("number_id", numberId)
      .eq("contact_id", contactId)
      .eq("direction", "in")
      .eq("status", "delivered")
      .select("id");

    if (error) return c.json(jsonFail(error.message), 500);
    return c.json(jsonOk({
      message: "Percakapan telah ditandai sebagai dibaca",
      updatedCount: data?.length ?? 0,
    }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/numbers/:numberId/read-all`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const numberId = c.req.param("numberId");
    const body = await c.req.json().catch(() => ({}));
    const contactIds = Array.isArray(body.contactIds) ? body.contactIds : null;
    const supa = sb();

    let query = supa
      .from("wa_messages")
      .update({ status: "read", read_at: nowIso() })
      .eq("org_id", user.org_id)
      .eq("number_id", numberId)
      .eq("direction", "in")
      .eq("status", "delivered");

    if (contactIds && contactIds.length > 0) {
      query = query.in("contact_id", contactIds);
    }

    const { error } = await query;
    if (error) return c.json(jsonFail(error.message), 500);

    return c.json(jsonOk({ message: "Pesan telah ditandai sebagai dibaca" }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/numbers/:numberId/delete-conversations`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const numberId = c.req.param("numberId");
    const body = await c.req.json().catch(() => ({}));
    const contactIds = Array.isArray(body.contactIds) ? body.contactIds : [];
    const deleteAll = body.all === true;

    if (contactIds.length === 0 && !deleteAll) {
      return c.json(jsonFail("contactIds atau all wajib diisi"), 400);
    }

    const supa = sb();

    let query = supa
      .from("wa_messages")
      .delete()
      .eq("org_id", user.org_id)
      .eq("number_id", numberId);

    if (!deleteAll) {
      query = query.in("contact_id", contactIds);
    }

    const { error } = await query;
    if (error) return c.json(jsonFail(error.message), 500);

    return c.json(jsonOk({ message: "Percakapan telah berhasil dihapus" }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/numbers/:numberId/contacts/:contactId/messages`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const numberId = c.req.param("numberId");
    const contactId = c.req.param("contactId");
    const body = await c.req.json();
    const manualSendReference = String(
      body.idempotencyKey ?? c.req.header("idempotency-key") ?? "",
    ).trim();

    if (!/^[A-Za-z0-9_-]{16,128}$/.test(manualSendReference)) {
      return c.json(jsonFail("Idempotency key pengiriman wajib dan tidak valid"), 400);
    }

    const isTemplate = body.messageType === "template" || !!body.templateName;
    const templateName = String(body.templateName ?? "").trim();
    const language = String(body.language ?? "id").trim();
    const bodyVariables = Array.isArray(body.bodyVariables)
      ? body.bodyVariables.map((value: any) => String(value ?? ""))
      : [];
    const content = String(
      body.content ?? body.message ?? body.text ?? (isTemplate ? `[Template: ${templateName}]` : ""),
    ).trim();

    if (!content && !isTemplate) return c.json(jsonFail("Pesan tidak boleh kosong"), 400);

    const supa = sb();
    const { data: numberRow, error: numberErr } = await supa
      .from("wa_numbers")
      .select("*")
      .eq("org_id", user.org_id)
      .eq("id", numberId)
      .maybeSingle();

    if (numberErr) return c.json(jsonFail(numberErr.message), 500);
    if (!numberRow) return c.json(jsonFail("Nomor tidak ditemukan"), 404);

    const { data: contact, error: contactErr } = await supa
      .from("wa_contacts")
      .select("*")
      .eq("org_id", user.org_id)
      .eq("id", contactId)
      .maybeSingle();

    if (contactErr) return c.json(jsonFail(contactErr.message), 500);
    if (!contact) return c.json(jsonFail("Kontak tidak ditemukan"), 404);
    if (!numberRow.access_token || !numberRow.phone_number_id) {
      return c.json(jsonFail("Nomor WA belum terkoneksi lengkap ke Meta"), 400);
    }

    const readBalance = async () => {
      const { data } = await supa
        .from("billing_balance")
        .select("tokens_balance")
        .eq("org_id", user.org_id)
        .maybeSingle();
      return data ? Number(data.tokens_balance ?? 0) : null;
    };

    const refundPaidSend = async (messageId: string) => {
      const { data, error } = await supa.rpc("compensate_billing_mutation", {
        p_org_id: user.org_id,
        p_original_provider: "manual_chat_debit",
        p_external_reference: manualSendReference,
        p_refund_provider: "manual_chat_refund",
        p_description: `Kompensasi chat manual yang ditolak Meta (${messageId})`,
        p_ref_type: "manual_message",
        p_ref_id: messageId,
        p_actor_user_id: user.id,
        p_metadata: { message_id: messageId, manual_send_reference: manualSendReference },
      });
      if (error) throw error;
      return data;
    };

    const existingResult = async (existing: any) => {
      const sameLogicalPayload =
        existing.number_id === numberId &&
        existing.contact_id === contactId &&
        existing.text_body === content &&
        existing.message_type === (isTemplate ? "template" : "text") &&
        String(existing.payload?.templateName ?? "") === templateName;

      if (!sameLogicalPayload) {
        return c.json({
          success: false,
          error: "Idempotency key sudah digunakan untuk payload berbeda",
          code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
          retryable: false,
        }, 409);
      }

      if (existing.meta_message_id || ["sent", "delivered", "read"].includes(existing.status)) {
        return c.json(jsonOk({
          id: existing.id,
          content: existing.text_body,
          sender: "user",
          timestamp: existing.sent_at || existing.created_at,
          status: existing.status,
          outcome: "accepted",
          duplicate: true,
          metaMessageId: existing.meta_message_id,
          billingState: existing.manual_billing_state,
          tokensRemaining: await readBalance(),
        }));
      }

      if (existing.status === "failed") {
        if (existing.manual_billing_state === "compensation_pending") {
          try {
            const refund = await refundPaidSend(existing.id);
            if (refund?.original_missing) {
              return c.json({
                success: false,
                error: "Pengiriman gagal dan status debit sebelumnya masih ambigu",
                code: "COMPENSATION_PENDING",
                retryable: true,
              }, 503);
            }
            await supa
              .from("wa_messages")
              .update({
                manual_billing_state: "refunded",
                manual_billing_ledger_id: refund?.ledger_id ?? existing.manual_billing_ledger_id,
              })
              .eq("id", existing.id);
          } catch (refundError) {
            return c.json({
              success: false,
              error: "Pengiriman gagal dan kompensasi billing masih perlu rekonsiliasi",
              code: "COMPENSATION_PENDING",
              retryable: true,
            }, 503);
          }
        }
        return c.json({
          success: false,
          error: "Percobaan pengiriman sebelumnya ditolak Meta",
          code: "META_REJECTED",
          retryable: false,
        }, 409);
      }

      return c.json(jsonOk({
        id: existing.id,
        content: existing.text_body,
        sender: "user",
        timestamp: existing.created_at,
        status: "processing",
        outcome: "processing",
        duplicate: true,
        metaMessageId: null,
        billingState: existing.manual_billing_state,
        tokensRemaining: await readBalance(),
      }));
    };

    const { data: existingMessage, error: existingErr } = await supa
      .from("wa_messages")
      .select("*")
      .eq("org_id", user.org_id)
      .eq("manual_send_reference", manualSendReference)
      .maybeSingle();

    if (existingErr) return c.json(jsonFail(existingErr.message), 500);
    if (existingMessage) return await existingResult(existingMessage);

    // Preserve the existing 24-hour customer-service-window business rule.
    const { data: lastIncomingMsg, error: incomingErr } = await supa
      .from("wa_messages")
      .select("created_at")
      .eq("org_id", user.org_id)
      .eq("number_id", numberId)
      .eq("contact_id", contactId)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (incomingErr) return c.json(jsonFail(incomingErr.message), 500);
    const isWithin24Hours = lastIncomingMsg?.created_at
      ? (Date.now() - new Date(lastIncomingMsg.created_at).getTime()) <= 24 * 60 * 60 * 1000
      : false;
    const requiresBilling = !isWithin24Hours;
    const manualChatTokenPrice = requiresBilling
      ? await getCanonicalTokenPrice(supa, user.org_id)
      : 0;

    const { data: msg, error: messageInsertErr } = await supa
      .from("wa_messages")
      .insert({
        org_id: user.org_id,
        number_id: numberId,
        contact_id: contactId,
        direction: "out",
        status: "processing",
        message_type: isTemplate ? "template" : "text",
        text_body: content,
        payload: {
          source: "manual",
          isTemplate,
          templateName,
          bodyVariables,
          manual_send_reference: manualSendReference,
          free_window: isWithin24Hours,
        },
        manual_send_reference: manualSendReference,
        manual_billing_state: requiresBilling ? "pending" : "not_required",
      })
      .select("*")
      .single();

    if (messageInsertErr) {
      if (messageInsertErr.code === "23505") {
        const { data: racedMessage } = await supa
          .from("wa_messages")
          .select("*")
          .eq("org_id", user.org_id)
          .eq("manual_send_reference", manualSendReference)
          .maybeSingle();
        if (racedMessage) return await existingResult(racedMessage);
      }
      return c.json(jsonFail(messageInsertErr.message), 500);
    }

    let tokensRemaining = await readBalance();
    let debitResult: any = null;
    if (requiresBilling) {
      try {
        debitResult = await applyBillingMutation({
          orgId: user.org_id,
          tokenDelta: -1,
          transactionType: "usage",
          amountIdr: manualChatTokenPrice,
          description: `Pemakaian token chat manual ke ${contact.phone_e164}`,
          refType: "manual_message",
          refId: msg.id,
          actorUserId: user.id,
          provider: "manual_chat_debit",
          externalReference: manualSendReference,
          metadata: {
            message_id: msg.id,
            manual_send_reference: manualSendReference,
            token_price_idr: manualChatTokenPrice,
          },
        });
        tokensRemaining = Number(debitResult?.new_balance ?? tokensRemaining ?? 0);
      } catch (billingError) {
        const billingMessage = (billingError as any)?.message || String(billingError);
        const insufficientBalance = billingMessage.toLowerCase().includes("saldo token tidak mencukupi");
        let billingState = insufficientBalance ? "insufficient_balance" : "compensation_pending";
        let retryable = !insufficientBalance;
        let compensationLedgerId: string | null = null;

        // The debit response can be ambiguous when a database/network error is
        // returned after commit. Compensate only when the original debit ledger
        // actually exists; the database RPC never grants a refund otherwise.
        if (!insufficientBalance) {
          try {
            const compensation = await refundPaidSend(msg.id);
            if (!compensation?.original_missing) {
              billingState = "refunded";
              retryable = false;
              compensationLedgerId = compensation?.ledger_id ?? null;
              tokensRemaining = Number(compensation?.new_balance ?? tokensRemaining ?? 0);
            }
          } catch {
            billingState = "compensation_pending";
            retryable = true;
          }
        }

        await supa
          .from("wa_messages")
          .update({
            status: "failed",
            error: billingMessage,
            manual_billing_state: billingState,
            manual_billing_ledger_id: compensationLedgerId,
          })
          .eq("id", msg.id);
        return c.json({
          success: false,
          error: insufficientBalance
            ? "Token tidak cukup"
            : retryable
              ? "Billing gagal dan kompensasi perlu rekonsiliasi"
              : "Billing gagal sebelum pengiriman",
          code: insufficientBalance
            ? "INSUFFICIENT_BALANCE"
            : retryable
              ? "COMPENSATION_PENDING"
              : "BILLING_DEBIT_FAILED",
          retryable,
        }, insufficientBalance ? 400 : 503);
      }

      const { error: debitStateErr } = await supa
        .from("wa_messages")
        .update({
          manual_billing_state: "debited",
          manual_billing_ledger_id: debitResult?.ledger_id ?? null,
        })
        .eq("id", msg.id);

      if (debitStateErr) {
        let compensationPending = false;
        try {
          await refundPaidSend(msg.id);
          await supa
            .from("wa_messages")
            .update({ status: "failed", manual_billing_state: "refunded", error: "Billing state persistence failed" })
            .eq("id", msg.id);
        } catch {
          compensationPending = true;
          await supa
            .from("wa_messages")
            .update({ status: "failed", manual_billing_state: "compensation_pending", error: "Billing reconciliation required" })
            .eq("id", msg.id);
        }
        return c.json({
          success: false,
          error: compensationPending
            ? "Billing tidak dapat dipersistenkan dan kompensasi perlu rekonsiliasi"
            : "Billing tidak dapat dipersistenkan; pesan tidak dikirim",
          code: compensationPending ? "COMPENSATION_PENDING" : "BILLING_STATE_FAILED",
          retryable: compensationPending,
        }, 503);
      }
    }

    let metaRes: any;
    try {
      metaRes = isTemplate && templateName
        ? await sendMetaTemplateMessage({
            phoneNumberId: numberRow.phone_number_id,
            accessToken: numberRow.access_token,
            to: contact.phone_e164,
            templateName,
            language,
            bodyVariables,
            header: body.header || null,
          })
        : await sendMetaTextMessage({
            phoneNumberId: numberRow.phone_number_id,
            accessToken: numberRow.access_token,
            to: contact.phone_e164,
            text: content,
          });

      if (!metaRes?.messages?.[0]?.id) {
        throw new Error("Meta tidak mengembalikan message_id");
      }
    } catch (metaError) {
      const message = metaError instanceof Error ? metaError.message : String(metaError);
      let billingState = requiresBilling ? "compensation_pending" : "not_required";
      let refundLedgerId: string | null = null;

      if (requiresBilling) {
        try {
          const refundResult = await refundPaidSend(msg.id);
          billingState = "refunded";
          refundLedgerId = refundResult?.ledger_id ?? null;
          tokensRemaining = Number(refundResult?.new_balance ?? tokensRemaining ?? 0);
        } catch (refundError) {
          console.error("Manual chat compensation failed; reconciliation required.", {
            messageId: msg.id,
            manualSendReference,
            error: (refundError as any)?.message || "unknown",
          });
        }
      }

      await supa
        .from("wa_messages")
        .update({
          status: "failed",
          error: message,
          manual_billing_state: billingState,
          manual_billing_ledger_id: refundLedgerId ?? debitResult?.ledger_id ?? null,
        })
        .eq("id", msg.id);

      return c.json({
        success: false,
        error: billingState === "compensation_pending"
          ? "Meta menolak pengiriman dan kompensasi billing perlu rekonsiliasi"
          : message,
        code: billingState === "compensation_pending" ? "COMPENSATION_PENDING" : "META_REJECTED",
        retryable: billingState === "compensation_pending",
      }, billingState === "compensation_pending" ? 503 : 400);
    }

    const metaMessageId = metaRes.messages[0].id;
    const acceptedAt = nowIso();
    const { error: acceptedUpdateErr } = await supa
      .from("wa_messages")
      .update({
        status: "sent",
        meta_message_id: metaMessageId,
        meta_status_payload: metaRes,
        sent_at: acceptedAt,
      })
      .eq("id", msg.id);

    const reconciliationRequired = Boolean(acceptedUpdateErr);
    if (acceptedUpdateErr) {
      console.error("Manual chat accepted by Meta but local status update failed.", {
        messageId: msg.id,
        metaMessageId,
        manualSendReference,
        errorCode: acceptedUpdateErr.code || "unknown",
      });
    }

    // These are secondary local effects. Their failure must never rewrite a
    // Meta-accepted send to failed or invite a duplicate user retry.
    const { error: contactUpdateErr } = await supa
      .from("wa_contacts")
      .update({ last_message_at: acceptedAt })
      .eq("id", contactId)
      .eq("org_id", user.org_id);
    if (contactUpdateErr) {
      console.error("Manual chat contact timestamp update failed.", {
        messageId: msg.id,
        errorCode: contactUpdateErr.code || "unknown",
      });
    }

    const { error: activityErr } = await supa.from("app_activity").insert({
      org_id: user.org_id,
      actor_user_id: user.id,
      type: reconciliationRequired ? "message_sent_reconciliation_required" : "message_sent",
      message: reconciliationRequired
        ? "Pesan diterima Meta; sinkronisasi status lokal diperlukan"
        : "Pesan manual diterima Meta",
      meta: { message_id: msg.id, number_id: numberId, contact_id: contactId, meta_message_id: metaMessageId },
    });
    if (activityErr) {
      console.error("Manual chat activity logging failed after Meta acceptance.", {
        messageId: msg.id,
        metaMessageId,
        errorCode: activityErr.code || "unknown",
      });
    }

    return c.json(jsonOk({
      id: msg.id,
      content,
      sender: "user",
      timestamp: acceptedAt,
      status: "sent",
      outcome: reconciliationRequired ? "accepted_reconciliation_required" : "accepted",
      reconciliationRequired,
      duplicate: false,
      metaMessageId,
      billingState: requiresBilling ? "debited" : "not_required",
      tokensRemaining,
    }));
  } catch (e) {
    return c.json({
      ...jsonFail(e),
      code: "MANUAL_SEND_UNKNOWN",
      retryable: true,
    }, 500);
  }
});

function normalizeTemplateStatus(status: unknown) {
  return String(status ?? "draft").toLowerCase();
}

function buildTemplateComponentsFromPayload(body: any) {
  if (Array.isArray(body.components) && body.components.length > 0) {
    return body.components;
  }

  const components: any[] = [];

  const headerType = String(body.headerType ?? "none").toLowerCase();
  const headerText = String(body.headerText ?? "").trim();
  const content = String(body.content ?? body.body ?? "").trim();
  const footerText = String(body.footerText ?? "").trim();

  const rawButtons = Array.isArray(body.buttons) ? body.buttons : [];
  const buttons = rawButtons
    .map((b: any) => String(typeof b === "string" ? b : b?.text ?? "").trim())
    .filter(Boolean);

  if (headerType === "text" && headerText) {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: headerText,
    });
  }

  if (headerType === "image") {
    components.push({
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: ["sample-image"] },
    });
  }

  if (headerType === "video") {
    components.push({
      type: "HEADER",
      format: "VIDEO",
      example: { header_handle: ["sample-video"] },
    });
  }

  if (headerType === "document") {
    components.push({
      type: "HEADER",
      format: "DOCUMENT",
      example: { header_handle: ["sample-document"] },
    });
  }

  if (headerType === "location") {
    components.push({
      type: "HEADER",
      format: "LOCATION",
    });
  }

  components.push({
    type: "BODY",
    text: content,
  });

  if (footerText) {
    components.push({
      type: "FOOTER",
      text: footerText,
    });
  }

  if (buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: buttons.map((text: string) => ({
        type: "QUICK_REPLY",
        text,
      })),
    });
  }

  return components;
}

function extractTemplateMeta(components: any) {
  let content = "";
  let headerType = "none";
  let headerText = "";
  let footerText = "";
  let buttons: Array<{ type: "QUICK_REPLY"; text: string }> = [];

  if (Array.isArray(components)) {
    const header = components.find((c: any) => String(c?.type ?? "").toUpperCase() === "HEADER");
    const body = components.find((c: any) => String(c?.type ?? "").toUpperCase() === "BODY");
    const footer = components.find((c: any) => String(c?.type ?? "").toUpperCase() === "FOOTER");
    const btns = components.find((c: any) => String(c?.type ?? "").toUpperCase() === "BUTTONS");

    if (body?.text) content = String(body.text);

    if (header) {
      const fmt = String(header?.format ?? "").toLowerCase();
      if (fmt === "text") {
        headerType = "text";
        headerText = String(header?.text ?? "");
      } else if (["image", "video", "document", "location"].includes(fmt)) {
        headerType = fmt;
      }
    }

    if (footer?.text) footerText = String(footer.text);

    if (Array.isArray(btns?.buttons)) {
      buttons = btns.buttons
        .filter((b: any) => String(b?.type ?? "").toUpperCase() === "QUICK_REPLY")
        .map((b: any) => ({
          type: "QUICK_REPLY",
          text: String(b?.text ?? ""),
        }));
    }
  }

  const variableMatches = [...content.matchAll(/\{\{(\d+)\}\}/g)].map((m) => `{{${m[1]}}}`);
  const variables = [...new Set(variableMatches)];

  return {
    content,
    variables,
    headerType,
    headerText,
    footerText,
    buttons,
  };
}

// ===== TEMPLATE HELPERS =====
app.get(`${API_PREFIX}/templates`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const { data, error } = await supa
    .from("wa_templates")
    .select("*")
    .eq("org_id", user.org_id)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

    if (error) return c.json(jsonFail(error.message), 500);

    const mapped = (data ?? []).map((row: any) => {
      const meta = extractTemplateMeta(row.components);

      return {
        id: row.id,
        name: row.name,
        category: row.category ?? "marketing",
        language: row.language ?? "id",
        status: normalizeTemplateStatus(row.status),
        components: row.components ?? [],
        metaTemplateId: row.meta_template_id ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at ?? row.created_at,
        content: meta.content,
        variables: meta.variables,
        headerType: meta.headerType,
        headerText: meta.headerText,
        footerText: meta.footerText,
        buttons: meta.buttons,
      };
    });

    return c.json(jsonOk(mapped));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/templates/upload-sample`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const body = await c.req.parseBody();
    const file = body.file;

    if (!file || !(file instanceof File)) {
      return c.json(jsonFail("File wajib diunggah"), 400);
    }

    if (file.size > 5 * 1024 * 1024) {
      return c.json(jsonFail("Ukuran file contoh maksimal 5MB"), 400);
    }

    const fileName = file.name;
    const fileType = file.type;
    const fileLength = file.size;
    const fileBytes = new Uint8Array(await file.arrayBuffer());

    const supa = sb();
    const { data: numberRow, error: numErr } = await supa
      .from("wa_numbers")
      .select("*")
      .eq("org_id", user.org_id)
      .not("waba_id", "is", null)
      .not("access_token", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (numErr) return c.json(jsonFail(numErr.message), 500);
    if (!numberRow) return c.json(jsonFail("Belum ada nomor WABA aktif untuk mengunggah media contoh ke Meta"), 400);

    const accessToken = numberRow.access_token;

    // 1. Dapatkan App ID dari Meta
    const appRes = await fetch(`https://graph.facebook.com/v25.0/app?access_token=${accessToken}`);
    if (!appRes.ok) {
      const err = await appRes.json();
      return c.json(jsonFail(err?.error?.message || "Gagal mendapatkan App ID dari Meta"), 400);
    }
    const appData = await appRes.json();
    const appId = appData.id;

    // 2. Buat sesi upload
    const uploadInitRes = await fetch(
      `https://graph.facebook.com/v25.0/${appId}/uploads?file_name=${encodeURIComponent(fileName)}&file_length=${fileLength}&file_type=${encodeURIComponent(fileType)}&access_token=${accessToken}`,
      { method: "POST" }
    );
    if (!uploadInitRes.ok) {
      const err = await uploadInitRes.json();
      return c.json(jsonFail(err?.error?.message || "Gagal membuat sesi upload di Meta"), 400);
    }
    const uploadInitData = await uploadInitRes.json();
    const sessionId = uploadInitData.id;

    // 3. Upload file binary
    const uploadRes = await fetch(
      `https://graph.facebook.com/v25.0/${sessionId}`,
      {
        method: "POST",
        headers: {
          "Authorization": `OAuth ${accessToken}`,
          "file_offset": "0",
          "Content-Type": "application/octet-stream",
        },
        body: fileBytes,
      }
    );
    if (!uploadRes.ok) {
      const err = await uploadRes.json();
      return c.json(jsonFail(err?.error?.message || "Gagal mengunggah file ke Meta"), 400);
    }
    const uploadData = await uploadRes.json();
    const handle = uploadData.h;

    return c.json(jsonOk({ handle, fileName }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/templates`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const body = await c.req.json();

    const name = String(body.name ?? "").trim().toLowerCase();
    const category = String(body.category ?? "marketing").trim().toLowerCase();
    const language = String(body.language ?? "id").trim();
    const content = String(body.content ?? body.body ?? "").trim();

    if (!name) return c.json(jsonFail("Nama template wajib"), 400);
    if (!/^[a-z0-9_]+$/.test(name)) {
      return c.json(jsonFail("Nama template hanya boleh huruf kecil, angka, dan underscore"), 400);
    }
    if (!content) return c.json(jsonFail("Konten template wajib"), 400);

    const components = buildTemplateComponentsFromPayload(body);

    const { data, error } = await supa
      .from("wa_templates")
      .insert({
        org_id: user.org_id,
        name,
        category,
        language,
        status: "draft",
        components,
        meta_template_id: null,
      })
      .select("*")
      .single();

    if (error) return c.json(jsonFail(error.message), 500);

    await supa.from("app_activity").insert({
      org_id: user.org_id,
      actor_user_id: user.id,
      type: "template_created",
      message: `Template dibuat: ${name}`,
      meta: { template_id: data.id },
    });

    const meta = extractTemplateMeta(data.components);

    return c.json(
      jsonOk({
        id: data.id,
        name: data.name,
        category: data.category,
        language: data.language,
        status: normalizeTemplateStatus(data.status),
        components: data.components,
        metaTemplateId: data.meta_template_id,
        createdAt: data.created_at,
        content: meta.content,
        variables: meta.variables,
        headerType: meta.headerType,
        headerText: meta.headerText,
        footerText: meta.footerText,
        buttons: meta.buttons,
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.put(`${API_PREFIX}/templates/:id`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const id = c.req.param("id");
    const body = await c.req.json();

    const name = String(body.name ?? "").trim().toLowerCase();
    const category = String(body.category ?? "marketing").trim().toLowerCase();
    const language = String(body.language ?? "id").trim();
    const content = String(body.content ?? body.body ?? "").trim();

    if (!name) return c.json(jsonFail("Nama template wajib"), 400);
    if (!/^[a-z0-9_]+$/.test(name)) {
      return c.json(jsonFail("Nama template hanya boleh huruf kecil, angka, dan underscore"), 400);
    }
    if (!content) return c.json(jsonFail("Konten template wajib"), 400);

    const { data: existing, error: exErr } = await supa
      .from("wa_templates")
      .select("*")
      .eq("org_id", user.org_id)
      .eq("id", id)
      .maybeSingle();

    if (exErr) return c.json(jsonFail(exErr.message), 500);
    if (!existing) return c.json(jsonFail("Template tidak ditemukan"), 404);

    const components = buildTemplateComponentsFromPayload(body);

    if (existing.meta_template_id) {
      const { data: numberRow, error: numErr } = await supa
        .from("wa_numbers")
        .select("*")
        .eq("org_id", user.org_id)
        .not("waba_id", "is", null)
        .not("access_token", "is", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (numErr) return c.json(jsonFail(numErr.message), 500);
      if (!numberRow) return c.json(jsonFail("Belum ada WABA aktif untuk mengedit template di Meta"), 404);

      const wabaId = String(numberRow.waba_id ?? "").trim();
      const accessToken = String(numberRow.access_token ?? "").trim();

      if (!wabaId) return c.json(jsonFail("WABA ID kosong"), 400);
      if (!accessToken) return c.json(jsonFail("Access Token kosong"), 400);

      // Format components for Meta
      const formattedComponents = components.map((comp: any) => {
        const newComp = { ...comp };
        newComp.type = String(newComp.type).toUpperCase();
        
        if ("example_values" in newComp) {
          delete newComp.example_values;
        }
        
        if (newComp.type === "BODY") {
          const bodyText = String(newComp.text || "");
          const matches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
          if (matches.length > 0) {
            const maxIndex = Math.max(...matches);
            const bodyTextExamples: string[] = [];
            const sourceExamples = comp.example_values || comp.examples || {};
            
            for (let idx = 1; idx <= maxIndex; idx++) {
              const val = sourceExamples[idx] || sourceExamples[String(idx)] || `Sample ${idx}`;
              bodyTextExamples.push(String(val));
            }
            
            newComp.example = {
              body_text: [bodyTextExamples]
            };
          } else {
            delete newComp.example;
          }
        }
        
        if (newComp.type === "HEADER" && newComp.example) {
          const example = { ...newComp.example };
          const cleanExample: any = {};
          if (example.header_handle) {
            cleanExample.header_handle = example.header_handle;
          } else if (example.header_text) {
            cleanExample.header_text = example.header_text;
          }
          newComp.example = cleanExample;
        }
        
        return newComp;
      });

      const payload = {
        components: formattedComponents,
        category: category.toUpperCase(),
      };

      const res = await fetch(
        `https://graph.facebook.com/${graphVersion()}/${existing.meta_template_id}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        }
      );

      const json = await res.json();
      if (!res.ok) {
        return c.json(jsonFail(json?.error?.message || "Gagal mengupdate template di Meta"), 400);
      }
    }

    const { data, error } = await supa
      .from("wa_templates")
      .update({
        name,
        category,
        language,
        components,
        status: existing.meta_template_id ? "pending" : normalizeTemplateStatus(existing.status || "draft"),
        updated_at: nowIso(),
      })
      .eq("org_id", user.org_id)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return c.json(jsonFail(error.message), 500);

    await supa.from("app_activity").insert({
      org_id: user.org_id,
      actor_user_id: user.id,
      type: "template_updated",
      message: `Template diupdate: ${name}`,
      meta: { template_id: data.id },
    });

    const meta = extractTemplateMeta(data.components);

    return c.json(
      jsonOk({
        id: data.id,
        name: data.name,
        category: data.category,
        language: data.language,
        status: normalizeTemplateStatus(data.status),
        components: data.components,
        metaTemplateId: data.meta_template_id,
        createdAt: data.created_at,
        content: meta.content,
        variables: meta.variables,
        headerType: meta.headerType,
        headerText: meta.headerText,
        footerText: meta.footerText,
        buttons: meta.buttons,
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.delete(`${API_PREFIX}/templates/:id`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const id = c.req.param("id");

    const { data: existing, error: exErr } = await supa
      .from("wa_templates")
      .select("id, name")
      .eq("org_id", user.org_id)
      .eq("id", id)
      .maybeSingle();

    if (exErr) return c.json(jsonFail(exErr.message), 500);
    if (!existing) return c.json(jsonFail("Template tidak ditemukan"), 404);

    // Try to delete from Meta if we have WABA credentials
    const { data: numberRow } = await supa
      .from("wa_numbers")
      .select("*")
      .eq("org_id", user.org_id)
      .not("waba_id", "is", null)
      .not("access_token", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (numberRow) {
      const wabaId = String(numberRow.waba_id ?? "").trim();
      const accessToken = String(numberRow.access_token ?? "").trim();
      if (wabaId && accessToken) {
        try {
          const deleteUrl = `https://graph.facebook.com/${graphVersion()}/${wabaId}/message_templates?name=${encodeURIComponent(existing.name)}`;
          const metaRes = await fetch(deleteUrl, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });
          const metaJson = await metaRes.json();
          console.log("Meta delete template response:", metaJson);
        } catch (metaErr) {
          console.error("Failed to delete template from Meta:", metaErr);
        }
      }
    }

    const { error } = await supa
      .from("wa_templates")
      .delete()
      .eq("org_id", user.org_id)
      .eq("id", id);

    if (error) return c.json(jsonFail(error.message), 500);

    await supa.from("app_activity").insert({
      org_id: user.org_id,
      actor_user_id: user.id,
      type: "template_deleted",
      message: `Template dihapus: ${existing.name}`,
      meta: { template_id: existing.id },
    });

    return c.json(jsonOk({ deleted: true, id }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/templates/sync`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const body = await c.req.json();

    const wabaId = String(body.wabaId ?? "").trim();
    const accessToken = String(body.accessToken ?? "").trim();

    if (!wabaId) return c.json(jsonFail("wabaId wajib"), 400);
    if (!accessToken) return c.json(jsonFail("accessToken wajib"), 400);

    const url = `https://graph.facebook.com/${graphVersion()}/${wabaId}/message_templates`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const json = await res.json();

    if (!res.ok) {
      return c.json(jsonFail(json?.error?.message || "Gagal mengambil template dari Meta"), 400);
    }

    const items = Array.isArray(json?.data) ? json.data : [];

    for (const tpl of items) {
      await supa.from("wa_templates").upsert(
        {
          org_id: user.org_id,
          name: String(tpl.name ?? "").trim().toLowerCase(),
          category: String(tpl.category ?? "marketing").toLowerCase(),
          language: String(tpl.language ?? "id"),
          status: normalizeTemplateStatus(tpl.status),
          components: tpl.components ?? [],
          meta_template_id: tpl.id ?? null,
        },
        {
          onConflict: "org_id,name,language",
        },
      );
    }

    await supa.from("app_activity").insert({
      org_id: user.org_id,
      actor_user_id: user.id,
      type: "template_sync",
      message: `Sync template Meta: ${items.length} template`,
      meta: { waba_id: wabaId, total: items.length },
    });

    return c.json(jsonOk({ total: items.length, templates: items }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/templates/:id/push-meta`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const id = c.req.param("id");

    const { data: tpl, error: tplErr } = await supa
      .from("wa_templates")
      .select("*")
      .eq("org_id", user.org_id)
      .eq("id", id)
      .maybeSingle();

    if (tplErr) return c.json(jsonFail(tplErr.message), 500);
    if (!tpl) return c.json(jsonFail("Template tidak ditemukan"), 404);

    const { data: numberRow, error: numErr } = await supa
      .from("wa_numbers")
      .select("*")
      .eq("org_id", user.org_id)
      .not("waba_id", "is", null)
      .not("access_token", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (numErr) return c.json(jsonFail(numErr.message), 500);
    if (!numberRow) return c.json(jsonFail("Belum ada WABA aktif untuk submit template"), 404);

    const wabaId = String(numberRow.waba_id ?? "").trim();
    const accessToken = String(numberRow.access_token ?? "").trim();

    if (!wabaId) return c.json(jsonFail("WABA ID kosong"), 400);
    if (!accessToken) return c.json(jsonFail("Access Token kosong"), 400);

    const rawComponents = Array.isArray(tpl.components) ? tpl.components : [];
    const formattedComponents = rawComponents.map((comp: any) => {
      const newComp = { ...comp };
      newComp.type = String(newComp.type).toUpperCase();
      
      if ("example_values" in newComp) {
        delete newComp.example_values;
      }
      
      if (newComp.type === "BODY") {
        const bodyText = String(newComp.text || "");
        const matches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
        if (matches.length > 0) {
          const maxIndex = Math.max(...matches);
          const bodyTextExamples: string[] = [];
          const sourceExamples = comp.example_values || comp.examples || {};
          
          for (let idx = 1; idx <= maxIndex; idx++) {
            const val = sourceExamples[idx] || sourceExamples[String(idx)] || `Sample ${idx}`;
            bodyTextExamples.push(String(val));
          }
          
          newComp.example = {
            body_text: [bodyTextExamples]
          };
        } else {
          delete newComp.example;
        }
      }
      
      if (newComp.type === "HEADER" && newComp.example) {
        const example = { ...newComp.example };
        const cleanExample: any = {};
        if (example.header_handle) {
          cleanExample.header_handle = example.header_handle;
        } else if (example.header_text) {
          cleanExample.header_text = example.header_text;
        }
        newComp.example = cleanExample;
      }
      
      return newComp;
    });

    const payload = {
      name: tpl.name,
      category: String(tpl.category ?? "marketing").toUpperCase(),
      language: tpl.language || "id",
      components: formattedComponents,
    };

    const res = await fetch(
      `https://graph.facebook.com/${graphVersion()}/${wabaId}/message_templates`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      }
    );

    const json = await res.json();

    if (!res.ok) {
      return c.json(jsonFail(json?.error?.message || "Gagal submit template ke Meta"), 400);
    }

    const { error: updErr } = await supa
      .from("wa_templates")
      .update({
        meta_template_id: json?.id ?? null,
        status: normalizeTemplateStatus(json?.status ?? "pending"),
        updated_at: nowIso(),
      })
      .eq("org_id", user.org_id)
      .eq("id", id);

    if (updErr) return c.json(jsonFail(updErr.message), 500);

    await supa.from("app_activity").insert({
      org_id: user.org_id,
      actor_user_id: user.id,
      type: "template_push_meta",
      message: `Template disubmit ke Meta: ${tpl.name}`,
      meta: {
        template_id: tpl.id,
        number_id: numberRow.id,
        waba_id: wabaId,
        meta_template_id: json?.id ?? null,
        meta_status: json?.status ?? "pending",
      },
    });

    return c.json(
      jsonOk({
        id: tpl.id,
        metaTemplateId: json?.id ?? null,
        status: normalizeTemplateStatus(json?.status ?? "pending"),
        raw: json,
      })
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// ===== BILLING =====
app.get(`${API_PREFIX}/billing`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const { data: balance, error: balErr } = await supa
      .from("billing_balance")
      .select("tokens_balance, token_price_idr")
      .eq("org_id", user.org_id)
      .maybeSingle();

    if (balErr) return c.json(jsonFail(balErr.message), 500);
    if (!balance) return c.json(jsonFail("Konfigurasi billing organisasi tidak ditemukan"), 500);
    const tokenPrice = requireCanonicalTokenPrice(balance.token_price_idr, user.org_id);

    const { data: totalSpentValue, error: txErr } = await supa.rpc(
      "get_billing_total_spent",
      { p_org_id: user.org_id },
    );

    if (txErr) return c.json(jsonFail(txErr.message), 500);
    const totalSpent = Number(totalSpentValue ?? 0);

    return c.json(
      jsonOk({
        currentTokens: Number(balance?.tokens_balance ?? 0),
        totalSpent,
        tokenPrice,
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/billing/transactions`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const { data, error } = await supa
      .from("billing_transactions")
      .select("*")
      .eq("org_id", user.org_id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return c.json(jsonFail(error.message), 500);

    const mapped = (data ?? []).map((r: any) => ({
      id: r.id,
      type: r.type,
      amount: Math.abs(Number(r.tokens_delta ?? 0)),
      date: r.created_at,
      description: r.description ?? (r.type === "topup" ? "Top-up token" : "Pemakaian token"),
    }));

    // Fetch Midtrans records from key_info
    const { data: midtransTxRows } = await supa
      .from("key_info")
      .select("key, value")
      .like("key", "midtrans_tx:%");

    const midtransTxs = (midtransTxRows ?? [])
      .map((r: any) => r.value)
      .filter((v: any) => v && v.org_id === user.org_id);

    const mappedMidtrans = midtransTxs.map((tx: any) => {
      let status = "pending";
      if (tx.status === "settlement" || tx.status === "capture" || tx.status === "success") {
        status = "success";
      } else if (["expire", "cancel", "deny", "failed"].includes(tx.status)) {
        status = "failed";
      }

      return {
        id: tx.id,
        type: "midtrans",
        amount: tx.amount_tokens,
        amount_idr: tx.amount_idr,
        date: tx.created_at,
        description: `Top-up otomatis (${tx.amount_tokens} token)`,
        status,
        snap_token: tx.snap_token,
        snap_url: tx.snap_url,
      };
    });

    // Merge both lists
    const allTx = [...mapped, ...mappedMidtrans];
    allTx.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return c.json(jsonOk(allTx));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// ===== STATS =====
app.get(`${API_PREFIX}/stats`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const { count: totalMessages, error: msgErr } = await supa
      .from("wa_messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", user.org_id)
      .eq("direction", "out");

    if (msgErr) return c.json(jsonFail(msgErr.message), 500);

    const { count: totalContacts, error: contactErr } = await supa
      .from("wa_contacts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", user.org_id);

    if (contactErr) return c.json(jsonFail(contactErr.message), 500);

    const { count: totalNumbers, error: numberErr } = await supa
      .from("wa_numbers")
      .select("id", { count: "exact", head: true })
      .eq("org_id", user.org_id)
      .eq("is_active", true);

    if (numberErr) return c.json(jsonFail(numberErr.message), 500);

    const { data: balance, error: balErr } = await supa
      .from("billing_balance")
      .select("tokens_balance")
      .eq("org_id", user.org_id)
      .maybeSingle();

    if (balErr) return c.json(jsonFail(balErr.message), 500);

    const { data: tokensUsedValue, error: usageErr } = await supa.rpc(
      "get_billing_tokens_used",
      { p_org_id: user.org_id },
    );

    if (usageErr) return c.json(jsonFail(usageErr.message), 500);
    const tokensUsed = Number(tokensUsedValue ?? 0);

    return c.json(
      jsonOk({
        totalMessages: totalMessages ?? 0,
        totalContacts: totalContacts ?? 0,
        tokensRemaining: Number(balance?.tokens_balance ?? 0),
        tokensUsed,
        activeNumbers: totalNumbers ?? 0,
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/dashboard/activity`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const { data, error } = await supa
      .from("app_activity")
      .select("id, type, message, meta, created_at")
      .eq("org_id", user.org_id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) return c.json(jsonFail(error.message), 500);

    return c.json(jsonOk(data ?? []));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/dashboard/usage-7d`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const endDate = String(c.req.query("endDate") ?? "").trim();
    const timeZone = String(c.req.query("timeZone") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(Date.parse(`${endDate}T00:00:00Z`))) {
      return c.json(jsonFail("endDate tidak valid"), 400);
    }
    if (!timeZone || timeZone.length > 100 || !/^[A-Za-z0-9_+\-/]+$/.test(timeZone)) {
      return c.json(jsonFail("timeZone tidak valid"), 400);
    }

    const { data, error } = await supa.rpc("get_dashboard_usage_7d", {
      p_org_id: user.org_id,
      p_end_date: endDate,
      p_time_zone: timeZone,
    });

    if (error) return c.json(jsonFail(error.message), 500);

    const result = (data ?? []).map((row: any) => ({
      date: row.usage_date,
      tokens: Number(row.tokens ?? 0),
      amountIdr: Number(row.amount_idr ?? 0),
    }));

    return c.json(jsonOk(result));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/dashboard/broadcast-summary`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const rawRangeStart = String(c.req.query("rangeStart") ?? "").trim();
    const rangeStart = rawRangeStart && Number.isFinite(Date.parse(rawRangeStart))
      ? new Date(rawRangeStart).toISOString()
      : null;
    if (rawRangeStart && !rangeStart) return c.json(jsonFail("rangeStart tidak valid"), 400);

    const { data: totalRecipientsValue, error: summaryError } = await supa.rpc(
      "get_dashboard_broadcast_summary",
      { p_org_id: user.org_id, p_range_start: rangeStart },
    );
    if (summaryError) return c.json(jsonFail(summaryError.message), 500);

    let recentQuery = supa
      .from("wa_broadcasts")
      .select("id, title, status, total_recipients, created_at, scheduled_at")
      .eq("org_id", user.org_id);
    if (rangeStart) recentQuery = recentQuery.gte("created_at", rangeStart);
    const { data: recentRows, error: recentError } = await recentQuery
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(3);
    if (recentError) return c.json(jsonFail(recentError.message), 500);

    return c.json(jsonOk({
      totalRecipients: Number(totalRecipientsValue ?? 0),
      recent: (recentRows ?? []).map((row: any) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        totalRecipients: Number(row.total_recipients ?? 0),
        createdAt: row.created_at,
        scheduledAt: row.scheduled_at,
      })),
    }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/dashboard/broadcast-calendar`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const rawFrom = String(c.req.query("from") ?? "").trim();
    const rawTo = String(c.req.query("to") ?? "").trim();
    const fromMs = Date.parse(rawFrom);
    const toMs = Date.parse(rawTo);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      return c.json(jsonFail("Rentang kalender tidak valid"), 400);
    }
    if (toMs - fromMs > DASHBOARD_CALENDAR_MAX_RANGE_MS) {
      return c.json(jsonFail("Rentang kalender maksimal 62 hari"), 400);
    }

    const { data, error } = await sb().rpc("get_dashboard_broadcast_calendar", {
      p_org_id: user.org_id,
      p_range_start: new Date(fromMs).toISOString(),
      p_range_end: new Date(toMs).toISOString(),
    });
    if (error) return c.json(jsonFail(error.message), 500);

    return c.json(jsonOk((data ?? []).map((row: any) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      totalRecipients: Number(row.total_recipients ?? 0),
      createdAt: row.created_at,
      scheduledAt: row.scheduled_at,
    }))));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// ===== INIT =====
app.post(`${API_PREFIX}/init`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const { data: bal, error: balErr } = await supa
      .from("billing_balance")
      .select("org_id")
      .eq("org_id", user.org_id)
      .maybeSingle();

    if (balErr) return c.json(jsonFail(balErr.message), 500);

    if (!bal) {
      const { error: insertErr } = await supa.from("billing_balance").insert({
        org_id: user.org_id,
        tokens_balance: 0,
      });

      if (insertErr) return c.json(jsonFail(insertErr.message), 500);
    }

    return c.json(jsonOk(true));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// ===== BROADCASTS =====
app.get(`${API_PREFIX}/broadcasts`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const { page, pageSize, from, to } = parseListPagination(c, BROADCAST_HISTORY_DEFAULT_PAGE_SIZE, BROADCAST_HISTORY_MAX_PAGE_SIZE);
    const search = safeListSearch(c.req.query("search"));
    const status = safeListSearch(c.req.query("status"));
    const numberId = safeListSearch(c.req.query("numberId"));
    const dateFrom = c.req.query("dateFrom");
    const dateTo = c.req.query("dateTo");

    let query = supa
      .from("wa_broadcasts")
      .select("id, title, status, total_recipients, total_sent, total_delivered, total_read, total_failed, total_cancelled, created_at, scheduled_at, started_at, finished_at, mode, template_id, number_id, text_body, wa_numbers(phone_e164, label)", { count: "exact" })
      .eq("org_id", user.org_id);

    if (search) {
      const { data: matchingNumbers, error: matchingNumbersError } = await supa
        .from("wa_numbers")
        .select("id")
        .eq("org_id", user.org_id)
        .or(`phone_e164.ilike.%${search}%,label.ilike.%${search}%`);
      if (matchingNumbersError) return c.json(jsonFail(matchingNumbersError.message), 500);
      const numberIds = (matchingNumbers ?? []).map((row: any) => row.id);
      const numberClause = numberIds.length ? `,number_id.in.(${numberIds.join(",")})` : "";
      query = query.or(`title.ilike.%${search}%,text_body.ilike.%${search}%${numberClause}`);
    }
    if (status) query = query.eq("status", status);
    if (numberId) query = query.eq("number_id", numberId);
    const fromIso = dateFrom && Number.isFinite(Date.parse(dateFrom)) ? new Date(dateFrom).toISOString() : null;
    const toIso = dateTo && Number.isFinite(Date.parse(dateTo)) ? new Date(dateTo).toISOString() : null;
    if (fromIso || toIso) {
      const scheduledParts = [fromIso ? `scheduled_at.gte.${fromIso}` : null, toIso ? `scheduled_at.lte.${toIso}` : null].filter(Boolean);
      const createdParts = ["scheduled_at.is.null", fromIso ? `created_at.gte.${fromIso}` : null, toIso ? `created_at.lte.${toIso}` : null].filter(Boolean);
      query = query.or(`and(${scheduledParts.join(",")}),and(${createdParts.join(",")})`);
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) return c.json(jsonFail(error.message), 500);

    const mapped = (data ?? []).map((r: any) => {
      const waNumObj = r.wa_numbers;
      const phone = waNumObj?.phone_e164 ? normalizePhone(waNumObj.phone_e164) : "";
      const label = waNumObj?.label || "";
      const senderText = phone && label ? `${phone} — ${label}` : phone || label || "Nomor WA";

      return {
        id: r.id,
        title: r.title,
        message: r.text_body ?? "",
        status: r.status,
        totalRecipients: r.total_recipients ?? 0,
        totalSent: r.total_sent ?? 0,
        totalFailed: r.total_failed ?? 0,
        cancelled: r.total_cancelled ?? 0,
        sent: Math.max(0, Number(r.total_sent ?? 0) - Number(r.total_delivered ?? 0)),
        delivered: Math.max(0, Number(r.total_delivered ?? 0) - Number(r.total_read ?? 0)),
        read: Number(r.total_read ?? 0),
        failed: Number(r.total_failed ?? 0),
        createdAt: r.created_at,
        scheduledAt: r.scheduled_at,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        mode: r.mode ?? "text",
        templateId: r.template_id ?? null,
        numberId: r.number_id,
        numberName: senderText,
      };
    });

    const { data: senderRows, error: senderError } = await supa
      .from("wa_numbers")
      .select("id, phone_e164, label")
      .eq("org_id", user.org_id)
      .order("created_at", { ascending: true });
    if (senderError) return c.json(jsonFail(senderError.message), 500);

    return c.json(jsonOk({
      ...pagedPayload(mapped, count, page, pageSize),
      senderOptions: (senderRows ?? []).map((row: any) => ({
        id: row.id,
        name: row.phone_e164 && row.label
          ? `${normalizePhone(row.phone_e164)} — ${row.label}`
          : normalizePhone(row.phone_e164) || row.label || "Nomor WA",
      })),
    }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/broadcasts`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const body = await c.req.json();
    const supa = sb();

    const title = String(body.title ?? "").trim();
    const numberId = String(body.numberId ?? "").trim();
    const message = String(body.message ?? "").trim();
    const recipients = Array.isArray(body.recipients) ? body.recipients : [];
    const mode = String(body.mode ?? "text").trim();
    const templateId = body.templateId ?? null;
    const templateVariables = body.templateVariables ?? null;
    const schedule = parseScheduledAt(body.scheduledAt ?? null);
    const scheduledAt = schedule.value;

    if (!title) return c.json(jsonFail("title wajib"), 400);
    if (!numberId) return c.json(jsonFail("numberId wajib"), 400);
    if (recipients.length === 0) return c.json(jsonFail("recipients wajib"), 400);
    if (!['text', 'template'].includes(mode)) return c.json(jsonFail("mode broadcast tidak valid"), 400);
    if (mode === "text" && !message) return c.json(jsonFail("message wajib"), 400);
    if (schedule.error) return c.json(jsonFail(schedule.error), 400);

    const { data: numberRow, error: numberErr } = await supa
      .from("wa_numbers")
      .select("*")
      .eq("id", numberId)
      .eq("org_id", user.org_id)
      .maybeSingle();

    if (numberErr) return c.json(jsonFail(numberErr.message), 500);
    if (!numberRow) return c.json(jsonFail("Nomor tidak ditemukan"), 404);

    let templateRow: any = null;
    if (mode === "template") {
      if (!templateId) return c.json(jsonFail("templateId wajib"), 400);
      const { data: template, error: templateErr } = await supa
        .from("wa_templates")
        .select("*")
        .eq("id", templateId)
        .eq("org_id", user.org_id)
        .maybeSingle();
      if (templateErr) return c.json(jsonFail(templateErr.message), 500);
      if (!template) return c.json(jsonFail("Template tidak ditemukan"), 404);
      templateRow = template;
    }

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const requestedContactIds = [...new Set(
      recipients
        .map((recipient: any) => String(recipient?.contactId ?? "").trim())
        .filter((id: string) => uuidPattern.test(id)),
    )];
    const ownedContactIds = new Set<string>();
    if (requestedContactIds.length > 0) {
      const validationBatches = chunkValues(
        requestedContactIds,
        BROADCAST_CONTACT_VALIDATION_BATCH_SIZE,
      );

      for (
        let waveStart = 0;
        waveStart < validationBatches.length;
        waveStart += BROADCAST_CONTACT_VALIDATION_CONCURRENCY
      ) {
        const wave = validationBatches.slice(
          waveStart,
          waveStart + BROADCAST_CONTACT_VALIDATION_CONCURRENCY,
        );
        const results = await Promise.all(wave.map((batch) =>
          supa
            .from("wa_contacts")
            .select("id")
            .eq("org_id", user.org_id)
            .in("id", batch)
        ));

        for (const result of results) {
          if (result.error) return c.json(jsonFail(result.error.message), 500);
          for (const contact of result.data ?? []) ownedContactIds.add(String(contact.id));
        }
      }
    }

    const templateRequirements = getTemplateSendRequirements(templateRow);
    const seenPhones = new Set<string>();
    const preparedRecipients = recipients.map((rawRecipient: any, recipientIndex: number) => {
      const recipient = rawRecipient && typeof rawRecipient === "object" ? rawRecipient : {};
      const phoneValidation = validatePhoneDestination(recipient.phone);
      const phone = phoneValidation.normalized;
      const name = String(recipient.name ?? "").trim();
      const rawVars = recipient.vars;
      const vars = rawVars && typeof rawVars === "object" && !Array.isArray(rawVars) ? rawVars : {};
      const indexedVariables = new Map<number, string>();
      for (const [key, value] of Object.entries(vars)) {
        const match = /^var(\d+)$/i.exec(key);
        if (match) indexedVariables.set(Number(match[1]), String(value ?? "").trim());
      }
      const highestVariableIndex = Math.max(
        templateRequirements.bodyVariableCount,
        0,
        ...indexedVariables.keys(),
      );
      const bodyVariables = Array.from(
        { length: highestVariableIndex },
        (_, index) => indexedVariables.get(index + 1) ?? "",
      );
      const mediaUrl = String(recipient.mediaUrl ?? "").trim();
      const fileName = String(recipient.fileName ?? "").trim();
      const contactId = String(recipient.contactId ?? "").trim();
      const rejectionReasons: string[] = [];

      if (!rawRecipient || typeof rawRecipient !== "object") rejectionReasons.push("Baris recipient malformed");
      if (!phoneValidation.valid) rejectionReasons.push(String(phoneValidation.reason));
      if (phone && seenPhones.has(phone)) rejectionReasons.push("Nomor duplikat dalam broadcast yang sama");
      if (phone) seenPhones.add(phone);
      if (contactId && (!uuidPattern.test(contactId) || !ownedContactIds.has(contactId))) {
        rejectionReasons.push("Contact tidak ditemukan pada organisasi ini");
      }
      if (mode === "template" && (!rawVars || typeof rawVars !== "object" || Array.isArray(rawVars))) {
        rejectionReasons.push("Data variable template malformed");
      }
      if (mode === "template") {
        for (let index = 0; index < templateRequirements.bodyVariableCount; index++) {
          if (!String(bodyVariables[index] ?? "").trim()) {
            rejectionReasons.push(`Variable template {{${index + 1}}} kosong`);
          }
        }
        if (templateRequirements.requiresMedia && !mediaUrl) {
          rejectionReasons.push("Media header template wajib diisi");
        }
      }

      const finalMessage = mode === "text"
        ? renderTemplate(message, { name, ...vars })
        : JSON.stringify({
            kind: "template_payload",
            vars,
            bodyVariables,
            mediaUrl,
            fileName,
            rowNumber: recipient.rowNumber ?? null,
          });
      if (!String(finalMessage).trim()) rejectionReasons.push("Payload recipient kosong");

      return {
        contact_id: contactId && ownedContactIds.has(contactId) ? contactId : null,
        phone_e164: phone,
        recipient_name: name || null,
        message: finalMessage,
        status: rejectionReasons.length === 0 ? "pending" : "failed",
        error: rejectionReasons.length === 0
          ? null
          : `RECIPIENT_VALIDATION_FAILED: ${rejectionReasons.join("; ")}`,
        sequence_no: recipientIndex + 1,
      };
    });
    const validRecipientCount = preparedRecipients.filter((recipient: any) => recipient.status === "pending").length;
    const rejectedRecipientCount = preparedRecipients.length - validRecipientCount;
    if (validRecipientCount > BROADCAST_MAX_RECIPIENTS) {
      const excess = validRecipientCount - BROADCAST_MAX_RECIPIENTS;
      const formatCount = (value: number) => new Intl.NumberFormat("id-ID").format(value);
      return c.json(
        jsonFail(
          `Maksimal ${formatCount(BROADCAST_MAX_RECIPIENTS)} penerima dalam satu broadcast. Saat ini terdapat ${formatCount(validRecipientCount)} penerima valid. Kurangi ${formatCount(excess)} penerima untuk melanjutkan.`,
        ),
        413,
      );
    }
    const finalBroadcastStatus = validRecipientCount === 0 ? "failed" : "queued";

    const { data: createdBroadcast, error: bErr } = await supa
      .from("wa_broadcasts")
      .insert({
        org_id: user.org_id,
        number_id: numberId,
        title,
        // The deployed broadcast_status enum has no `scheduled` value.
        // scheduled_at is the authoritative due-time discriminator for queued work.
        // Keep an immediate broadcast ineligible for scheduler/worker claims
        // until every recipient chunk has been persisted successfully.
        status: validRecipientCount === 0 ? "failed" : "paused",
        mode,
        template_id: templateId,
        template_variables: templateVariables,
        text_body: mode === "text" ? message : null,
        total_recipients: recipients.length,
        total_sent: 0,
        total_failed: 0,
        scheduled_at: scheduledAt,
        created_by: user.id,
      })
      .select("*")
      .single();

    if (bErr) return c.json(jsonFail(bErr.message), 500);
    let broadcast = createdBroadcast;

    const recipientRows = preparedRecipients.map((recipient: any) => ({
        org_id: user.org_id,
        broadcast_id: broadcast.id,
        ...recipient,
      }));

    const recipientInsertBatches = chunkValues(
      recipientRows,
      BROADCAST_RECIPIENT_INSERT_BATCH_SIZE,
    );
    for (const recipientBatch of recipientInsertBatches) {
      const { error: recErr } = await supa
        .from("wa_broadcast_recipients")
        .insert(recipientBatch);
      if (recErr) return c.json(jsonFail(recErr.message), 500);
    }

    if (validRecipientCount > 0) {
      const { data: queuedBroadcast, error: queueErr } = await supa
        .from("wa_broadcasts")
        .update({ status: finalBroadcastStatus })
        .eq("id", broadcast.id)
        .eq("org_id", user.org_id)
        .eq("status", "paused")
        .select("*")
        .single();
      if (queueErr) return c.json(jsonFail(queueErr.message), 500);
      broadcast = queuedBroadcast;
    }

    // Auto-trigger background worker if not scheduled
    if (!scheduledAt && validRecipientCount > 0) {
      const baseUrl = new URL(c.req.url).origin;
      const sessionToken = c.get("sessionToken");
      runBroadcastWorkerInBackground(supa, user.org_id, user.id, broadcast.id, sessionToken, baseUrl, c);
    }

    await supa.from("app_activity").insert({
      org_id: user.org_id,
      actor_user_id: user.id,
      type: "broadcast_created",
      message: `Broadcast dibuat: ${title}`,
      meta: {
        broadcast_id: broadcast.id,
        total_recipients: recipients.length,
        valid_recipients: validRecipientCount,
        rejected_recipients: rejectedRecipientCount,
        scheduled_at: scheduledAt,
        mode,
      },
    });

    return c.json(
      jsonOk({
        id: broadcast.id,
        title: broadcast.title,
        status: broadcast.status,
        totalRecipients: recipients.length,
        validRecipients: validRecipientCount,
        rejectedRecipients: rejectedRecipientCount,
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/broadcasts/:id/recipients`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const id = c.req.param("id");
    const supa = sb();
    const { page, pageSize, from, to } = parseListPagination(c, BROADCAST_RECIPIENT_DEFAULT_PAGE_SIZE, BROADCAST_RECIPIENT_MAX_PAGE_SIZE);
    const search = safeListSearch(c.req.query("search"));
    const status = safeListSearch(c.req.query("status"));

    let query = supa
      .from("wa_broadcast_recipients")
      .select("id, broadcast_id, recipient_name, phone_e164, status, sent_at, updated_at, created_at, error, sequence_no, wa_messages(status)", { count: "exact" })
      .eq("org_id", user.org_id)
      .eq("broadcast_id", id);

    if (search) query = query.or(`recipient_name.ilike.%${search}%,phone_e164.ilike.%${search}%`);
    if (status) {
      if (status === "sent") query = query.in("status", ["accepted", "processing", "sent", "delivered", "read"]);
      else query = query.eq("status", status);
    }

    const { data: recipients, error: recErr, count } = await query
      .order("sequence_no", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (recErr) return c.json(jsonFail(recErr.message), 500);

    const mapped = (recipients ?? []).map((r: any) => {
      const msgStatus = r.wa_messages?.status;
      const recStatus = r.status;
      
      let finalStatus = recStatus || "pending";
      if (recStatus !== "failed" && recStatus !== "cancelled" && msgStatus && waStatusRank(msgStatus) > waStatusRank(finalStatus)) {
        finalStatus = msgStatus;
      }
      
      const { wa_messages, ...rest } = r;
      return {
        ...rest,
        status: finalStatus,
      };
    });

    return c.json(jsonOk(pagedPayload(mapped, count, page, pageSize)));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/broadcasts/:id/stats`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const id = c.req.param("id");
    const supa = sb();

    const { data: b, error: bErr } = await supa
      .from("wa_broadcasts")
      .select("id, title, status, total_recipients, total_sent, total_delivered, total_read, total_failed, started_at, finished_at, number_id, text_body")
      .eq("org_id", user.org_id)
      .eq("id", id)
      .maybeSingle();

    if (bErr) return c.json(jsonFail(bErr.message), 500);
    if (!b) return c.json(jsonFail("Broadcast tidak ditemukan"), 404);

    let senderNumber = "";
    let senderName = "";
    if (b.number_id) {
      const { data: numData } = await supa
        .from("wa_numbers")
        .select("phone_e164, label")
        .eq("id", b.number_id)
        .maybeSingle();
      if (numData) {
        senderNumber = numData.phone_e164 ?? "";
        senderName = numData.label ?? "";
      }
    }

    const processed = Number(b.total_sent ?? 0) + Number(b.total_failed ?? 0);
    const total = Number(b.total_recipients ?? 0);
    const progress = total > 0 ? Math.round((processed / total) * 100) : 0;

    return c.json(
      jsonOk({
        id: b.id,
        title: b.title,
        status: b.status,
        totalRecipients: total,
        totalSent: Number(b.total_sent ?? 0),
        totalFailed: Number(b.total_failed ?? 0),
        sent: Math.max(0, Number(b.total_sent ?? 0) - Number(b.total_delivered ?? 0)),
        delivered: Math.max(0, Number(b.total_delivered ?? 0) - Number(b.total_read ?? 0)),
        read: Number(b.total_read ?? 0),
        failed: Number(b.total_failed ?? 0),
        progress,
        startedAt: b.started_at,
        finishedAt: b.finished_at,
        senderNumber,
        senderName,
        textBody: b.text_body,
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/broadcasts/:id/cancel`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const id = c.req.param("id");
    const supa = sb();

    const { data: existing, error: existingErr } = await supa
      .from("wa_broadcasts")
      .select("id, status, title, started_at")
      .eq("org_id", user.org_id)
      .eq("id", id)
      .maybeSingle();

    if (existingErr) return c.json(jsonFail(existingErr.message), 500);
    if (!existing) return c.json(jsonFail("Broadcast tidak ditemukan"), 404);

    if (existing.status === "cancelled") {
      if (!existing.started_at) {
        return c.json(jsonFail("Broadcast ini tidak dibatalkan dari proses pengiriman aktif"), 409);
      }

      const { error: retryRecErr } = await supa
        .from("wa_broadcast_recipients")
        .update({ status: "cancelled", updated_at: nowIso() })
        .eq("org_id", user.org_id)
        .eq("broadcast_id", existing.id)
        .eq("status", "pending");
      if (retryRecErr) return c.json(jsonFail(retryRecErr.message), 500);

      await recalculateBroadcastStats(supa, existing.id, user.org_id);

      return c.json(jsonOk({ success: true, duplicate: true, status: "cancelled" }));
    }

    if (existing.status !== "sending" || !existing.started_at) {
      return c.json(jsonFail("Hanya broadcast yang sedang berjalan yang dapat dihentikan melalui endpoint ini"), 409);
    }

    const cancelledAt = nowIso();
    const { data: cancelled, error: cancelErr } = await supa
      .from("wa_broadcasts")
      .update({
        status: "cancelled",
        finished_at: cancelledAt,
        updated_at: cancelledAt,
      })
      .eq("org_id", user.org_id)
      .eq("id", existing.id)
      .eq("status", "sending")
      .not("started_at", "is", null)
      .select("id, status, title")
      .maybeSingle();

    if (cancelErr) return c.json(jsonFail(cancelErr.message), 500);
    if (!cancelled) {
      const { data: current, error: currentErr } = await supa
        .from("wa_broadcasts")
        .select("status, started_at")
        .eq("org_id", user.org_id)
        .eq("id", existing.id)
        .maybeSingle();

      if (currentErr) return c.json(jsonFail(currentErr.message), 500);
      if (current?.status === "cancelled" && current?.started_at) {
        const { error: retryRecErr } = await supa
          .from("wa_broadcast_recipients")
          .update({ status: "cancelled", updated_at: nowIso() })
          .eq("org_id", user.org_id)
          .eq("broadcast_id", existing.id)
          .eq("status", "pending");
        if (retryRecErr) return c.json(jsonFail(retryRecErr.message), 500);
        await recalculateBroadcastStats(supa, existing.id, user.org_id);
        return c.json(jsonOk({ success: true, duplicate: true, status: "cancelled" }));
      }
      return c.json(jsonFail("Broadcast sudah tidak berada dalam state sending yang dapat dihentikan"), 409);
    }

    // pending is the cancellation boundary. A processing recipient already
    // owns the in-flight send and must finish through the existing billing /
    // Meta compensation lifecycle; terminal recipients are never rewritten.
    const { error: recErr } = await supa
      .from("wa_broadcast_recipients")
      .update({ status: "cancelled", updated_at: cancelledAt })
      .eq("org_id", user.org_id)
      .eq("broadcast_id", cancelled.id)
      .eq("status", "pending");
    if (recErr) return c.json(jsonFail(recErr.message), 500);

    await recalculateBroadcastStats(supa, cancelled.id, user.org_id);

    await supa.from("app_activity").insert({
      org_id: user.org_id,
      actor_user_id: user.id,
      type: "broadcast_sending_cancelled",
      message: `Menghentikan sisa pengiriman broadcast: ${cancelled.title || id}`,
      meta: { broadcast_id: cancelled.id },
    });

    return c.json(jsonOk({ success: true, duplicate: false, status: "cancelled" }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// Cancel a scheduled broadcast before processing starts. This remains separate
// from active cancellation so each lifecycle boundary is enforced atomically.
app.post(`${API_PREFIX}/broadcasts/:id/cancel-schedule`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const id = c.req.param("id");
    const supa = sb();

    const { data: existing, error: existingErr } = await supa
      .from("wa_broadcasts")
      .select("id, status, title, scheduled_at, started_at")
      .eq("org_id", user.org_id)
      .eq("id", id)
      .maybeSingle();

    if (existingErr) return c.json(jsonFail(existingErr.message), 500);
    if (!existing) return c.json(jsonFail("Broadcast tidak ditemukan"), 404);

    if (existing.status === "cancelled") {
      if (!existing.scheduled_at || existing.started_at) {
        return c.json(jsonFail("Broadcast ini bukan jadwal yang dibatalkan sebelum pemrosesan dimulai"), 409);
      }

      // A retry also reconciles pending recipients in case the first request
      // committed the broadcast state but lost the following recipient update.
      const { error: retryRecErr } = await supa
        .from("wa_broadcast_recipients")
        .update({
          status: "cancelled",
          updated_at: nowIso(),
        })
        .eq("org_id", user.org_id)
        .eq("broadcast_id", existing.id)
        .eq("status", "pending");
      if (retryRecErr) return c.json(jsonFail(retryRecErr.message), 500);

      await recalculateBroadcastStats(supa, existing.id, user.org_id);

      return c.json(jsonOk({ success: true, duplicate: true, status: "cancelled" }));
    }

    if (!existing.scheduled_at || existing.status !== "queued" || existing.started_at) {
      return c.json(jsonFail("Hanya broadcast terjadwal yang belum mulai diproses yang dapat dibatalkan"), 409);
    }

    const cancelledAt = nowIso();
    const { data: cancelled, error: cancelErr } = await supa
      .from("wa_broadcasts")
      .update({
        status: "cancelled",
        finished_at: cancelledAt,
        updated_at: cancelledAt,
      })
      .eq("org_id", user.org_id)
      .eq("id", existing.id)
      .eq("status", "queued")
      .not("scheduled_at", "is", null)
      .is("started_at", null)
      .select("id, status, title")
      .maybeSingle();

    if (cancelErr) return c.json(jsonFail(cancelErr.message), 500);

    // The scheduler may have won the atomic status race after the initial read.
    // Re-read only to distinguish an idempotent retry from an already-started job.
    if (!cancelled) {
      const { data: current, error: currentErr } = await supa
        .from("wa_broadcasts")
        .select("status, started_at")
        .eq("org_id", user.org_id)
        .eq("id", existing.id)
        .maybeSingle();

      if (currentErr) return c.json(jsonFail(currentErr.message), 500);
      if (current?.status === "cancelled" && !current?.started_at) {
        const { error: retryRecErr } = await supa
          .from("wa_broadcast_recipients")
          .update({ status: "cancelled", updated_at: nowIso() })
          .eq("org_id", user.org_id)
          .eq("broadcast_id", existing.id)
          .eq("status", "pending");
        if (retryRecErr) return c.json(jsonFail(retryRecErr.message), 500);
        await recalculateBroadcastStats(supa, existing.id, user.org_id);
        return c.json(jsonOk({ success: true, duplicate: true, status: "cancelled" }));
      }

      return c.json(jsonFail("Broadcast sudah mulai diproses dan tidak dapat dibatalkan"), 409);
    }

    const { error: recErr } = await supa
      .from("wa_broadcast_recipients")
      .update({
        status: "cancelled",
        updated_at: cancelledAt,
      })
      .eq("org_id", user.org_id)
      .eq("broadcast_id", cancelled.id)
      .eq("status", "pending");

    if (recErr) return c.json(jsonFail(recErr.message), 500);

    await recalculateBroadcastStats(supa, cancelled.id, user.org_id);

    await supa.from("app_activity").insert({
      org_id: user.org_id,
      actor_user_id: user.id,
      type: "broadcast_schedule_cancelled",
      message: `Membatalkan jadwal broadcast: ${cancelled.title || id}`,
      meta: { broadcast_id: cancelled.id },
    });

    return c.json(jsonOk({ success: true, duplicate: false, status: "cancelled" }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/broadcasts/delete`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const body = await c.req.json();
    const supa = sb();

    const ids = Array.isArray(body.ids)
      ? Array.from(new Set(body.ids.map((value: unknown) => String(value || "").trim()).filter(Boolean)))
      : [];
    const deleteAll = body.all === true;

    if (ids.length === 0 && !deleteAll) {
      return c.json(jsonFail("ID broadcast wajib diisi"), 400);
    }

    if (deleteAll) {
      return c.json(jsonFail("Hapus semua dinonaktifkan agar broadcast aktif tidak terhapus"), 409);
    } else {
      const { data: selectedBroadcasts, error: selectedErr } = await supa
        .from("wa_broadcasts")
        .select("id, status")
        .eq("org_id", user.org_id)
        .in("id", ids);
      if (selectedErr) return c.json(jsonFail(selectedErr.message), 500);

      if ((selectedBroadcasts ?? []).length !== ids.length) {
        return c.json(jsonFail("Satu atau lebih broadcast tidak ditemukan"), 404);
      }

      const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
      const containsActive = (selectedBroadcasts ?? []).some(
        (broadcast: any) => !terminalStatuses.has(String(broadcast.status || "").toLowerCase()),
      );
      if (containsActive) {
        return c.json(jsonFail("Broadcast Pending, Sending, atau Dijeda harus dibatalkan/diselesaikan sebelum dihapus"), 409);
      }

      const { error: recErr } = await supa
        .from("wa_broadcast_recipients")
        .delete()
        .eq("org_id", user.org_id)
        .in("broadcast_id", ids);

      if (recErr) return c.json(jsonFail(recErr.message), 500);

      const { error: bErr } = await supa
        .from("wa_broadcasts")
        .delete()
        .eq("org_id", user.org_id)
        .in("id", ids);

      if (bErr) return c.json(jsonFail(bErr.message), 500);

      await supa.from("app_activity").insert({
        org_id: user.org_id,
        actor_user_id: user.id,
        type: "broadcasts_deleted_selected",
        message: `Menghapus ${ids.length} riwayat broadcast`,
        meta: { ids },
      });
    }

    return c.json(jsonOk({ success: true }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// ===== JOBS / WORKER =====
const activeWorkers = new Set<string>();

async function recoverStaleProcessingRecipients(supa: any, broadcastId: string) {
  const staleBefore = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  // A provider id proves Meta accepted the request before the old worker died.
  await supa
    .from("wa_broadcast_recipients")
    .update({ status: "sent", error: null, updated_at: nowIso() })
    .eq("broadcast_id", broadcastId)
    .eq("status", "processing")
    .lt("updated_at", staleBefore)
    .not("provider_message_id", "is", null);

  // Without a provider id delivery is ambiguous. Mark it failed rather than
  // retrying automatically and risking a duplicate WhatsApp message.
  await supa
    .from("wa_broadcast_recipients")
    .update({
      status: "failed",
      error: "Worker terhenti sebelum konfirmasi Meta; tidak dikirim ulang otomatis",
      updated_at: nowIso(),
    })
    .eq("broadcast_id", broadcastId)
    .eq("status", "processing")
    .lt("updated_at", staleBefore)
    .is("provider_message_id", null);
}

async function recoverCancelledBroadcastProcessingRecipients(supa: any) {
  const staleBefore = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: staleRows, error: staleErr } = await supa
    .from("wa_broadcast_recipients")
    .select("broadcast_id")
    .eq("status", "processing")
    .lt("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(100);

  if (staleErr) {
    console.warn("[SCHEDULER] Failed to inspect stale cancelled recipients:", staleErr.message);
    return;
  }

  const broadcastIds = Array.from(new Set((staleRows ?? []).map((row: any) => String(row.broadcast_id))));
  if (broadcastIds.length === 0) return;

  const { data: cancelledBroadcasts, error: cancelledErr } = await supa
    .from("wa_broadcasts")
    .select("id")
    .in("id", broadcastIds)
    .eq("status", "cancelled");

  if (cancelledErr) {
    console.warn("[SCHEDULER] Failed to inspect cancelled broadcasts:", cancelledErr.message);
    return;
  }

  for (const broadcast of cancelledBroadcasts ?? []) {
    await recoverStaleProcessingRecipients(supa, broadcast.id);
    await recalculateBroadcastStats(supa, broadcast.id);
  }
}

async function runBroadcastWorker(
  supa: any,
  orgId: string,
  actorUserId: string | null,
  broadcastId: string,
  sessionToken?: string,
  baseUrl?: string,
  c?: any
) {
  if (activeWorkers.has(broadcastId)) {
    console.log(`[WORKER] Worker for broadcast ${broadcastId} is already running. Skipping.`);
    return;
  }
  activeWorkers.add(broadcastId);
  const workerToken = crypto.randomUUID();
  let workerNumberId: string | null = null;
  let leaseClaimed = false;
  console.log(`[WORKER] Background worker started for broadcast ${broadcastId}`);

  try {
    const { data: broadcast, error: bErr } = await supa
      .from("wa_broadcasts")
      .select("*")
      .eq("id", broadcastId)
      .maybeSingle();

    if (bErr || !broadcast) {
      console.error(`[WORKER] Broadcast ${broadcastId} not found or query error:`, bErr);
      return;
    }

    if (broadcast.org_id !== orgId) {
      console.error(`[WORKER] Organization mismatch for broadcast ${broadcastId}`);
      return;
    }

    const broadcastStatus = String(broadcast.status || "").toLowerCase();
    const scheduledTimestamp = broadcast.scheduled_at ? new Date(broadcast.scheduled_at).getTime() : null;
    if (scheduledTimestamp !== null && scheduledTimestamp > Date.now()) {
      console.log(`[WORKER] Broadcast ${broadcastId} is scheduled for the future. Skipping.`);
      return;
    }
    if (!["queued", "sending"].includes(broadcastStatus)) {
      console.log(`[WORKER] Broadcast ${broadcastId} is ${broadcastStatus || "unknown"}. Skipping.`);
      return;
    }

    await recoverStaleProcessingRecipients(supa, broadcastId);

    if (broadcastStatus === "queued") {
      const { data: startedBroadcast, error: startErr } = await supa
        .from("wa_broadcasts")
        .update({ status: "sending", started_at: broadcast.started_at ?? nowIso(), updated_at: nowIso() })
        .eq("id", broadcastId)
        .eq("org_id", orgId)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (startErr || !startedBroadcast) {
        console.log(`[WORKER] Broadcast ${broadcastId} changed state before execution. Skipping.`);
        return;
      }
    }

    const { data: numberRow, error: numberErr } = await supa
      .from("wa_numbers")
      .select("*")
      .eq("id", broadcast.number_id)
      .eq("org_id", orgId)
      .maybeSingle();

    if (numberErr || !numberRow || !numberRow.access_token || !numberRow.phone_number_id) {
      console.error(`[WORKER] Sender number config invalid for broadcast ${broadcastId}`);
      await supa
        .from("wa_broadcasts")
        .update({ status: "failed", error: "Nomor pengirim tidak valid/lengkap", updated_at: nowIso() })
        .eq("id", broadcastId);
      return;
    }

    const { data: org } = await supa
      .from("orgs")
      .select("send_delay_ms")
      .eq("id", orgId)
      .maybeSingle();

    const orgDelayMs = Math.max(0, Number(org?.send_delay_ms ?? 300));
    const leaseSeconds = Math.min(600, Math.max(75, Math.ceil(orgDelayMs / 1000) + 30));

    const { data: didClaimLease, error: leaseErr } = await supa.rpc(
      "claim_wa_number_broadcast_worker",
      {
        p_number_id: broadcast.number_id,
        p_org_id: orgId,
        p_broadcast_id: broadcastId,
        p_worker_token: workerToken,
        p_lease_seconds: leaseSeconds,
      },
    );

    if (leaseErr) {
      console.error(`[WORKER] Could not claim database worker lease for ${broadcastId}:`, leaseErr);
      return;
    }

    if (!didClaimLease) {
      console.log(`[WORKER] Sender ${broadcast.number_id} is already handled by another worker.`);
      return;
    }

    workerNumberId = broadcast.number_id;
    leaseClaimed = true;

    let broadcastTemplate: any = null;
    if (broadcast.mode === "template") {
      const { data: template, error: templateErr } = await supa
        .from("wa_templates")
        .select("*")
        .eq("id", broadcast.template_id)
        .maybeSingle();

      if (templateErr || !template) {
        await supa
          .from("wa_broadcasts")
          .update({ status: "failed", error: "Template tidak ditemukan", updated_at: nowIso() })
          .eq("id", broadcastId);
        return;
      }
      broadcastTemplate = template;
    }

    // Preflight is an atomic, service-role-only database operation. A completed
    // campaign takes the application fast path and never asks PostgreSQL to
    // scan recipient validation data again.
    if (broadcast.recipient_preflight_status !== "completed") {
      const requirements = getTemplateSendRequirements(broadcastTemplate);
      const { data: preflightRows, error: preflightErr } = await supa.rpc(
        "preflight_wa_broadcast_recipients",
        {
          p_broadcast_id: broadcastId,
          p_org_id: orgId,
          p_body_variable_count: requirements.bodyVariableCount,
          p_requires_media: requirements.requiresMedia,
        },
      );

      if (preflightErr) {
        console.error(`[WORKER] Recipient preflight failed for ${broadcastId}:`, preflightErr);
        return;
      }

      const preflightResult = Array.isArray(preflightRows) ? preflightRows[0] : preflightRows;
      if (preflightResult?.preflight_status !== "completed") {
        console.error(`[WORKER] Recipient preflight did not complete for ${broadcastId}`);
        return;
      }
    }

    // Cancellation can serialize behind the RPC's broadcast-row lock. Always
    // re-read authoritative lifecycle and durable preflight state before the
    // first recipient claim, billing debit, or Meta request.
    const { data: postPreflightBroadcast, error: postPreflightErr } = await supa
      .from("wa_broadcasts")
      .select("status, recipient_preflight_status")
      .eq("id", broadcastId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (postPreflightErr || !postPreflightBroadcast) {
      console.error(`[WORKER] Could not refresh broadcast ${broadcastId} after preflight:`, postPreflightErr);
      return;
    }

    if (
      postPreflightBroadcast.status !== "sending" ||
      postPreflightBroadcast.recipient_preflight_status !== "completed"
    ) {
      console.log(
        `[WORKER] Broadcast ${broadcastId} is ${postPreflightBroadcast.status} after preflight. Skipping sends.`,
      );
      return;
    }

    let processedThisRun = 0;
    const MAX_PROCESS_PER_RUN = 50;
    const workerStartTime = Date.now();
    const MAX_RUN_TIME_MS = 40000;

    while (processedThisRun < MAX_PROCESS_PER_RUN && (Date.now() - workerStartTime) < MAX_RUN_TIME_MS) {
      const [{ data: currentBroadcast }, { data: leaseRow }] = await Promise.all([
        supa
          .from("wa_broadcasts")
          .select("status")
          .eq("id", broadcastId)
          .maybeSingle(),
        supa
          .from("wa_numbers")
          .select("broadcast_worker_token, broadcast_worker_lease_until, next_broadcast_send_at")
          .eq("id", broadcast.number_id)
          .eq("org_id", orgId)
          .maybeSingle(),
      ]);

      if (currentBroadcast?.status !== "sending") {
        console.log(`[WORKER] Broadcast ${broadcastId} is ${currentBroadcast?.status}. Stopping worker.`);
        break;
      }

      if (
        !leaseRow ||
        leaseRow.broadcast_worker_token !== workerToken ||
        !leaseRow.broadcast_worker_lease_until ||
        new Date(leaseRow.broadcast_worker_lease_until).getTime() <= Date.now()
      ) {
        console.log(`[WORKER] Database lease for ${broadcastId} is no longer owned by this worker.`);
        break;
      }

      const nextAllowedAt = leaseRow.next_broadcast_send_at
        ? new Date(leaseRow.next_broadcast_send_at).getTime()
        : 0;
      const remainingDelayMs = Math.max(0, nextAllowedAt - Date.now());

      if (remainingDelayMs > 0) {
        await sleep(remainingDelayMs);
      }

      const gateStartedAt = Date.now();
      const leaseUntil = new Date(gateStartedAt + leaseSeconds * 1000).toISOString();
      const { data: renewedLease, error: renewErr } = await supa
        .from("wa_numbers")
        .update({
          broadcast_worker_lease_until: leaseUntil,
        })
        .eq("id", broadcast.number_id)
        .eq("org_id", orgId)
        .eq("broadcast_worker_token", workerToken)
        .gt("broadcast_worker_lease_until", nowIso())
        .select("id")
        .maybeSingle();

      if (renewErr || !renewedLease) {
        console.warn(`[WORKER] Failed to renew sender lease for ${broadcastId}. Stopping.`);
        break;
      }

      const { data: statusAfterWait } = await supa
        .from("wa_broadcasts")
        .select("status")
        .eq("id", broadcastId)
        .maybeSingle();

      if (statusAfterWait?.status !== "sending") {
        break;
      }

      const { data: recipients, error: rErr } = await supa
        .from("wa_broadcast_recipients")
        .select("*")
        .eq("broadcast_id", broadcastId)
        .eq("status", "pending")
        .order("sequence_no", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(1);

      if (rErr) {
        console.error(`[WORKER] Error fetching next recipient for ${broadcastId}:`, rErr);
        break;
      }

      const rec = recipients?.[0];
      if (!rec) {
        break;
      }

      const { data: claimedRec, error: claimErr } = await supa
        .from("wa_broadcast_recipients")
        .update({ status: "processing", updated_at: nowIso() })
        .eq("id", rec.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (claimErr || !claimedRec) {
        console.warn(`[WORKER] Recipient ${rec.phone_e164} already claimed/processed concurrently. Skipping.`);
        continue;
      }

      const tokenResult = await consumeBroadcastToken({
        orgId,
        recipientId: rec.id,
        broadcastId,
        broadcastTitle: broadcast.title,
        phone: rec.phone_e164,
        actorUserId,
      });
      if (!tokenResult.success) {
        console.warn(`[WORKER] Out of tokens for org ${orgId}. Pausing broadcast ${broadcastId}.`);
        await supa
          .from("wa_broadcasts")
          .update({ status: "paused", updated_at: nowIso() })
          .eq("id", broadcastId);

        await supa.from("app_activity").insert({
          org_id: orgId,
          actor_user_id: actorUserId,
          type: "broadcast_paused",
          message: `Broadcast dijeda (Token habis): ${broadcast.title}`,
          meta: { broadcast_id: broadcastId },
        });
        break;
      }

      let sendAttemptStartedAt: number | null = null;

      try {
        const { data: msg, error: msgErr } = await supa
          .from("wa_messages")
          .insert({
            org_id: orgId,
            number_id: broadcast.number_id,
            contact_id: rec.contact_id,
            direction: "out",
            status: "queued",
            message_type: broadcast.mode === "template" ? "template" : "text",
            text_body: broadcast.mode === "text" ? rec.message : null,
            payload: {
              source: "broadcast_worker",
              broadcast_id: broadcastId,
              recipient_id: rec.id,
              phone_e164: rec.phone_e164,
            },
          })
          .select("*")
          .single();

        if (msgErr) throw new Error(msgErr.message);

        let metaRes: any = null;

        if (broadcast.mode === "template") {
          const tpl = broadcastTemplate;

          const recipientPayload = parseTemplateRecipientPayload(rec.message);
          const vars = Array.isArray(recipientPayload?.bodyVariables)
            ? recipientPayload.bodyVariables.map((x: any) => String(x ?? ""))
            : Array.isArray(broadcast.template_variables?.body)
            ? broadcast.template_variables.body.map((x: any) => String(x ?? ""))
            : [];

          const bodyComp = Array.isArray(tpl.components)
            ? tpl.components.find((x: any) => String(x?.type || "").toUpperCase() === "BODY")
            : null;
          const bodyText = String(bodyComp?.text || "");
          const variableMatches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
          const bodyVariablesCount = variableMatches.length > 0 ? Math.max(...variableMatches) : 0;
          const slicedVars = Array.from({ length: bodyVariablesCount }, (_, i) => vars[i] ?? "");

          const headerComp = Array.isArray(tpl.components)
            ? tpl.components.find((x: any) => String(x?.type || "").toUpperCase() === "HEADER")
            : null;
          const headerFormat = String(headerComp?.format || "").toUpperCase();
          const mediaUrl = String(recipientPayload?.mediaUrl || "").trim();
          const fileName = String(recipientPayload?.fileName || "").trim();

          let header: any = null;
          if (headerFormat === "IMAGE" && mediaUrl) header = { format: "IMAGE", link: mediaUrl };
          if (headerFormat === "VIDEO" && mediaUrl) header = { format: "VIDEO", link: mediaUrl };
          if (headerFormat === "DOCUMENT" && mediaUrl) header = { format: "DOCUMENT", link: mediaUrl, filename: fileName || undefined };

          if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat) && !mediaUrl) {
            throw new Error(`Media header wajib untuk template ${tpl.name} di nomor ${rec.phone_e164}`);
          }

          sendAttemptStartedAt = Date.now();
          metaRes = await sendMetaTemplateMessage({
            phoneNumberId: numberRow.phone_number_id,
            accessToken: numberRow.access_token,
            to: rec.phone_e164,
            templateName: tpl.name,
            language: tpl.language || "id",
            bodyVariables: slicedVars,
            header,
          });
        } else {
          sendAttemptStartedAt = Date.now();
          metaRes = await sendMetaTextMessage({
            phoneNumberId: numberRow.phone_number_id,
            accessToken: numberRow.access_token,
            to: rec.phone_e164,
            text: rec.message,
          });
        }

        const metaMessageId = metaRes?.messages?.[0]?.id ?? null;

        if (!metaMessageId) {
          throw new Error("Meta tidak mengembalikan message_id");
        }

        const { data: rpcRes, error: rpcErr } = await supa.rpc("link_and_advance_wa_message", {
          p_msg_id: msg.id,
          p_rec_id: rec.id,
          p_meta_message_id: metaMessageId,
          // A successful POST to Meta only means the message was accepted for
          // delivery. Delivered/read must exclusively come from Meta webhooks.
          p_default_status: "sent",
          p_default_payload: metaRes,
        });

        if (rpcErr) {
          console.error(`[WORKER] link_and_advance_wa_message failed:`, rpcErr);
          await supa
            .from("wa_messages")
            .update({
              status: "sent",
              meta_message_id: metaMessageId,
              meta_status_payload: metaRes,
              sent_at: nowIso(),
            })
            .eq("id", msg.id);
          await supa
            .from("wa_broadcast_recipients")
            .update({
              status: "sent",
              sent_at: nowIso(),
              updated_at: nowIso(),
              wa_message_id: msg.id,
              provider_message_id: metaMessageId,
            })
            .eq("id", rec.id);
        }

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[WORKER] Recipient ${rec.phone_e164} send error:`, message);

        await supa
          .from("wa_broadcast_recipients")
          .update({
            status: "failed",
            error: message,
            updated_at: nowIso(),
          })
          .eq("id", rec.id);

      }

      if (sendAttemptStartedAt !== null) {
        await supa
          .from("wa_numbers")
          .update({
            next_broadcast_send_at: new Date(sendAttemptStartedAt + orgDelayMs).toISOString(),
          })
          .eq("id", broadcast.number_id)
          .eq("org_id", orgId)
          .eq("broadcast_worker_token", workerToken);
      }

      // Recipient rows drive the realtime UI. Recalculate the denormalized
      // campaign summary periodically instead of scanning all recipients after
      // every single send.
      if ((processedThisRun + 1) % 10 === 0) {
        await recalculateBroadcastStats(supa, broadcastId, orgId);
      }

      processedThisRun++;
    }
  } catch (err) {
    console.error(`[WORKER] Fatal error in worker for broadcast ${broadcastId}:`, err);
  } finally {
    activeWorkers.delete(broadcastId);

    if (leaseClaimed && workerNumberId) {
      await supa
        .from("wa_numbers")
        .update({
          broadcast_worker_token: null,
          broadcast_worker_broadcast_id: null,
          broadcast_worker_lease_until: null,
        })
        .eq("id", workerNumberId)
        .eq("org_id", orgId)
        .eq("broadcast_worker_token", workerToken);
    }

    console.log(`[WORKER] Background worker finished for broadcast ${broadcastId}. Recalculating stats.`);
    await recalculateBroadcastStats(supa, broadcastId);

    // Chain retrigger check: check if there are still pending recipients
    const { count, error: countErr } = await supa
      .from("wa_broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", broadcastId)
      .eq("status", "pending");

    if (leaseClaimed) {
      const pendingCount = !countErr ? Number(count ?? 0) : 0;
      console.log(`[WORKER] Worker finished for ${broadcastId}. Remaining pending: ${pendingCount}`);
      if (sessionToken && baseUrl) {
        const triggerUrl = `${baseUrl}${API_PREFIX}/jobs/process-broadcasts`;
        const p = fetch(triggerUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [SESSION_HEADER]: sessionToken,
          },
        }).catch((err) => {
          console.error(`[WORKER] Chain retrigger post failed:`, err);
        });

        // @ts-ignore
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
          // @ts-ignore
          EdgeRuntime.waitUntil(p);
        } else if (c?.executionCtx?.waitUntil) {
          c.executionCtx.waitUntil(p);
        }
      } else if (pendingCount > 0) {
        runBroadcastWorkerInBackground(supa, orgId, actorUserId, broadcastId, sessionToken, baseUrl, c);
      }
    }
  }
}

function runBroadcastWorkerInBackground(
  supa: any,
  orgId: string,
  actorUserId: string | null,
  broadcastId: string,
  sessionToken?: string,
  baseUrl?: string,
  c?: any
) {
  const promise = runBroadcastWorker(supa, orgId, actorUserId, broadcastId, sessionToken, baseUrl, c).catch((err) => {
    console.error(`[WORKER] Failed in background worker for broadcast ${broadcastId}:`, err);
  });

  let executionCtx: any = undefined;
  try {
    executionCtx = c?.executionCtx;
  } catch {
    // Ignore error if Hono context doesn't have ExecutionContext getter
  }

  // @ts-ignore
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(promise);
  } else if (executionCtx?.waitUntil) {
    executionCtx.waitUntil(promise);
  }
}

app.post(`${API_PREFIX}/jobs/process-due-broadcasts`, async (c) => {
  try {
    const configuredSecret = String(Deno.env.get("BROADCAST_SCHEDULER_SECRET") || "").trim();
    const suppliedSecret = String(c.req.header(SCHEDULER_HEADER) || "").trim();
    if (!configuredSecret) {
      return c.json(jsonFail("Scheduler broadcast belum dikonfigurasi"), 503);
    }
    if (!suppliedSecret || !constantTimeEqual(suppliedSecret, configuredSecret)) {
      return c.json(jsonFail("Scheduler secret tidak valid"), 403);
    }

    const requestedLimit = Number(c.req.query("limit") ?? 5);
    const claimLimit = Math.max(1, Math.min(Number.isInteger(requestedLimit) ? requestedLimit : 5, 25));
    const claimToken = crypto.randomUUID();
    const supa = sb();
    await recoverCancelledBroadcastProcessingRecipients(supa);
    const { data: claimed, error: claimErr } = await supa.rpc("claim_due_wa_broadcasts", {
      p_claim_token: claimToken,
      p_limit: claimLimit,
      p_lease_seconds: 180,
    });
    if (claimErr) return c.json(jsonFail(claimErr.message), 500);

    const claimedBroadcasts = Array.isArray(claimed) ? claimed : [];
    for (const broadcast of claimedBroadcasts) {
      runBroadcastWorkerInBackground(
        supa,
        String(broadcast.org_id),
        broadcast.created_by ? String(broadcast.created_by) : null,
        String(broadcast.id),
        undefined,
        undefined,
        c,
      );
    }

    return c.json(jsonOk({
      claimToken,
      claimedCount: claimedBroadcasts.length,
      broadcasts: claimedBroadcasts.map((broadcast: any) => ({
        id: broadcast.id,
        orgId: broadcast.org_id,
        scheduledAt: broadcast.scheduled_at,
        recoveredStaleClaim: Boolean(broadcast.recovered_stale_claim),
      })),
    }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/jobs/process-broadcasts`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const now = nowIso();

    const { data: broadcasts, error: bErr } = await supa
      .from("wa_broadcasts")
      .select("*")
      .eq("org_id", user.org_id)
      .in("status", ["queued", "sending"])
      .order("created_at", { ascending: true });

    if (bErr) return c.json(jsonFail(bErr.message), 500);

    const eligible = (broadcasts ?? []).filter((b: any) => {
      if (b.status === "sending") return true;
      if (!b.scheduled_at) return true;
      return new Date(b.scheduled_at).getTime() <= new Date(now).getTime();
    });

    if (eligible.length === 0) {
      return c.json(jsonOk({ message: "Tidak ada broadcast untuk diproses saat ini" }));
    }

    const broadcast = eligible[0];

    if (activeWorkers.has(broadcast.id)) {
      return c.json(
        jsonOk({
          message: "Broadcast sedang diproses di background",
          broadcastId: broadcast.id,
        }),
      );
    }

    const baseUrl = new URL(c.req.url).origin;
    const sessionToken = c.get("sessionToken");
    runBroadcastWorkerInBackground(supa, user.org_id, user.id, broadcast.id, sessionToken, baseUrl, c);

    return c.json(
      jsonOk({
        message: "Worker broadcast berhasil dijalankan di background",
        broadcastId: broadcast.id,
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

async function recalculateBroadcastStats(supa: any, broadcastId: string, expectedOrgId?: string) {
  try {
    let broadcastQuery = supa
      .from("wa_broadcasts")
      .select("id, org_id, status, scheduled_at, finished_at")
      .eq("id", broadcastId);

    if (expectedOrgId) {
      broadcastQuery = broadcastQuery.eq("org_id", expectedOrgId);
    }

    const { data: broadcast, error: broadcastErr } = await broadcastQuery.maybeSingle();
    if (broadcastErr || !broadcast) return;

    const { data: statsRows, error: statsErr } = await supa
      .from("wa_broadcast_recipients")
      .select("status")
      .eq("broadcast_id", broadcastId)
      .eq("org_id", broadcast.org_id);

    if (statsErr || !statsRows) return;

    const totalSent = statsRows.filter((x: any) => x.status === "sent" || x.status === "delivered" || x.status === "read").length;
    const totalDelivered = statsRows.filter((x: any) => x.status === "delivered" || x.status === "read").length;
    const totalRead = statsRows.filter((x: any) => x.status === "read").length;
    const totalFailed = statsRows.filter((x: any) => x.status === "failed").length;
    const totalCancelled = statsRows.filter((x: any) => x.status === "cancelled" || x.status === "canceled").length;
    const totalPending = statsRows.filter((x: any) => x.status === "pending" || x.status === "processing").length;

    const currentStatus = String(broadcast.status || "").toLowerCase();
    const scheduledForFuture = broadcast.scheduled_at
      ? new Date(broadcast.scheduled_at).getTime() > Date.now()
      : false;

    let nextStatus: string;
    if (statsRows.length === 0) {
      nextStatus = currentStatus || "queued";
    } else if (currentStatus === "cancelled") {
      nextStatus = "cancelled";
    } else if (totalPending === 0) {
      nextStatus = totalCancelled > 0 && totalSent === 0 && totalFailed === 0
        ? "cancelled"
        : "completed";
    } else if (["paused", "failed", "cancelled"].includes(currentStatus)) {
      nextStatus = currentStatus;
    } else if (scheduledForFuture && currentStatus === "queued") {
      nextStatus = currentStatus;
    } else {
      nextStatus = "sending";
    }

    await supa
      .from("wa_broadcasts")
      .update({
        status: nextStatus,
        total_recipients: statsRows.length,
        total_sent: totalSent,
        total_delivered: totalDelivered,
        total_read: totalRead,
        total_failed: totalFailed,
        total_cancelled: totalCancelled,
        finished_at: totalPending === 0 ? (broadcast.finished_at ?? nowIso()) : null,
        updated_at: nowIso(),
      })
      .eq("id", broadcastId)
      .eq("org_id", broadcast.org_id);
  } catch (err) {
    console.error("Error recalculating stats:", err);
  }
}

async function bufferWebhookStatusFallback(
  supa: any,
  metaMessageId: string,
  status: string,
  timestamp: string,
  error: string | null,
  payload: any,
) {
  const key = `webhook_status:${metaMessageId}`;
  const value = {
    status,
    timestamp,
    error,
    meta_status_payload: payload,
  };
  const { data: existing } = await supa
    .from("key_info")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (!existing) {
    await supa.from("key_info").insert({ key, value });
    return;
  }

  if (waStatusCanTransition(existing.value?.status, status)) {
    await supa.from("key_info").update({ value }).eq("key", key);
  }
}

async function applyWebhookStatusFallback(
  supa: any,
  metaMessageId: string,
  patch: any,
  timestamp: string,
) {
  const affectedBroadcastIds = new Set<string>();
  let messageFound = false;

  const { data: message } = await supa
    .from("wa_messages")
    .select("id, status")
    .eq("meta_message_id", metaMessageId)
    .maybeSingle();

  if (message) {
    messageFound = true;
    if (waStatusCanTransition(message.status, patch.status)) {
      const messagePatch: any = {
        status: patch.status,
        meta_status_payload: patch.meta_status_payload,
      };
      if (patch.error) messagePatch.error = patch.error;
      if (["sent", "delivered", "read"].includes(patch.status)) {
        messagePatch.sent_at = timestamp;
      }
      if (["delivered", "read"].includes(patch.status)) {
        messagePatch.delivered_at = timestamp;
      }
      if (patch.status === "read") messagePatch.read_at = timestamp;

      await supa
        .from("wa_messages")
        .update(messagePatch)
        .eq("id", message.id)
        .eq("status", message.status);
    }
  }

  const { data: recipients } = await supa
    .from("wa_broadcast_recipients")
    .select("id, status, broadcast_id")
    .eq("provider_message_id", metaMessageId);

  for (const recipient of recipients ?? []) {
    if (recipient.broadcast_id) affectedBroadcastIds.add(recipient.broadcast_id);
    if (!waStatusCanTransition(recipient.status, patch.status)) continue;

    const recipientPatch: any = {
      status: patch.status,
      updated_at: nowIso(),
    };
    if (patch.error) recipientPatch.error = patch.error;
    if (["sent", "delivered", "read"].includes(patch.status)) {
      recipientPatch.sent_at = timestamp;
    }

    await supa
      .from("wa_broadcast_recipients")
      .update(recipientPatch)
      .eq("id", recipient.id)
      .eq("status", recipient.status);
  }

  return {
    linkedFound: messageFound || affectedBroadcastIds.size > 0,
    affectedBroadcastIds: Array.from(affectedBroadcastIds),
  };
}

async function processAutoReplyForInbound(
  supa: any,
  numberRow: any,
  contact: any,
  from: string,
  inboundMessageId: string,
) {
  let autoReplyEnabled = true;
  let replyText =
    "Nomor ini hanya digunakan untuk pengiriman broadcast. Apabila Anda membutuhkan informasi lebih lanjut, silakan hubungi Customer Service kami.";

  const { data: numKeyRow } = await supa
    .from("key_info")
    .select("value")
    .eq("key", `autoreply_num_${numberRow.id}`)
    .maybeSingle();

  if (numKeyRow?.value) {
    autoReplyEnabled = numKeyRow.value.autoReplyEnabled !== false;
    replyText = numKeyRow.value.autoReplyMessage || replyText;
  } else {
    const { data: orgData } = await supa
      .from("orgs")
      .select("auto_reply_enabled, auto_reply_message")
      .eq("id", numberRow.org_id)
      .maybeSingle();

    if (orgData) {
      autoReplyEnabled = orgData.auto_reply_enabled !== false;
      replyText = orgData.auto_reply_message || replyText;
    }
  }

  if (!autoReplyEnabled || !numberRow.phone_number_id || !numberRow.access_token) return;

  const claimDate = new Date().toISOString().slice(0, 10);
  const { data: claimed, error: claimErr } = await supa.rpc("claim_meta_auto_reply", {
    p_number_id: numberRow.id,
    p_contact_id: contact.id,
    p_claim_date: claimDate,
    p_inbound_message_id: inboundMessageId,
  });

  if (claimErr) throw claimErr;
  if (!claimed) {
    console.log("Auto-reply skipped: daily claim already exists.", {
      numberId: numberRow.id,
      contactId: contact.id,
      inboundMessageId,
    });
    return;
  }

  // Preserve the existing one-auto-reply-per-day policy for rows sent before
  // the claim table existed.
  const startOfClaimDay = new Date(`${claimDate}T00:00:00.000Z`).toISOString();
  const { data: existingAutoReply } = await supa
    .from("wa_messages")
    .select("id, payload")
    .eq("number_id", numberRow.id)
    .eq("contact_id", contact.id)
    .eq("direction", "out")
    .gte("sent_at", startOfClaimDay);

  const alreadyReplied = existingAutoReply?.some(
    (message: any) => message.payload?.source === "auto_reply",
  );
  if (alreadyReplied) {
    await supa
      .from("meta_auto_reply_claims")
      .update({ status: "skipped_existing", updated_at: nowIso() })
      .eq("number_id", numberRow.id)
      .eq("contact_id", contact.id)
      .eq("claim_date", claimDate);
    return;
  }

  try {
    await sleep(2000);
    const metaReplyRes = await sendMetaTextMessage({
      phoneNumberId: numberRow.phone_number_id,
      accessToken: numberRow.access_token,
      to: from,
      text: replyText,
    });
    const replyMetaId = metaReplyRes?.messages?.[0]?.id ?? null;
    if (!replyMetaId) throw new Error("Meta tidak mengembalikan message_id untuk auto-reply");

    // Mark the claim first after Meta accepts the send. A later local insert
    // failure must not make a webhook replay send the reply again.
    const { error: claimUpdateErr } = await supa
      .from("meta_auto_reply_claims")
      .update({
        status: "sent",
        reply_meta_message_id: replyMetaId,
        updated_at: nowIso(),
      })
      .eq("number_id", numberRow.id)
      .eq("contact_id", contact.id)
      .eq("claim_date", claimDate);

    if (claimUpdateErr) {
      console.error("Auto-reply accepted but claim update failed; reconciliation required.", {
        numberId: numberRow.id,
        contactId: contact.id,
        replyMetaId,
      });
    }

    const { error: replyInsertErr } = await supa.from("wa_messages").insert({
      org_id: numberRow.org_id,
      number_id: numberRow.id,
      contact_id: contact.id,
      direction: "out",
      status: "sent",
      meta_message_id: replyMetaId,
      meta_status_payload: metaReplyRes,
      message_type: "text",
      text_body: replyText,
      payload: { source: "auto_reply", inbound_message_id: inboundMessageId },
      sent_at: nowIso(),
    });

    if (replyInsertErr && replyInsertErr.code !== "23505") {
      console.error("Auto-reply accepted but message persistence failed; reconciliation required.", {
        numberId: numberRow.id,
        contactId: contact.id,
        replyMetaId,
        errorCode: replyInsertErr.code || "unknown",
      });
    }
  } catch (error) {
    await supa
      .from("meta_auto_reply_claims")
      .update({ status: "failed", updated_at: nowIso() })
      .eq("number_id", numberRow.id)
      .eq("contact_id", contact.id)
      .eq("claim_date", claimDate);
    throw error;
  }
}

/// ===== WEBHOOK HANDLERS =====
const handleWebhookGet = async (c: any) => {
  try {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");

    if (!mode || !token || !challenge) {
      return c.text("Missing params", 400);
    }

    const expectedToken = Deno.env.get("APP_WEBHOOK_VERIFY_TOKEN") || "sipesa_global_secure_token";
    if (token !== expectedToken) return c.text("Forbidden", 403);
    if (mode !== "subscribe") return c.text("Invalid mode", 400);

    return c.text(challenge, 200);
  } catch (e) {
    return c.text(e instanceof Error ? e.message : String(e), 500);
  }
};

const handleWebhookPost = async (c: any) => {
  try {
    // Meta signs the exact request bytes. Read and verify the raw body before
    // JSON parsing and before creating a database client (fail closed).
    const rawBodyBytes = new Uint8Array(await c.req.arrayBuffer());
    const rawBody = new TextDecoder().decode(rawBodyBytes);
    const signature = c.req.header("x-hub-signature-256") || "";
    const appSecret = Deno.env.get("META_APP_SECRET") || "";
    const verification = await verifyMetaWebhookSignature(rawBodyBytes, signature, appSecret);

    if (!verification.ok) {
      if (verification.reason === "missing_secret") {
        console.error("Meta webhook rejected: META_APP_SECRET is not configured.");
        return c.json(jsonFail("Meta webhook verification is not configured"), 503);
      }

      console.warn(`Meta webhook rejected: ${verification.reason}.`);
      return c.json(
        jsonFail(verification.reason === "missing_signature" ? "Missing webhook signature" : "Invalid webhook signature"),
        verification.reason === "missing_signature" ? 401 : 403,
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json(jsonFail("Invalid webhook JSON"), 400);
    }

    const correlationId = String(payload?.entry?.[0]?.id || crypto.randomUUID());
    console.log("Authenticated Meta webhook received:", {
      correlationId,
      entryCount: Array.isArray(payload?.entry) ? payload.entry.length : 0,
    });
    const supa = sb();

    const entries = Array.isArray(payload?.entry) ? payload.entry : [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];

      for (const change of changes) {
        const field = String(change?.field ?? "");
        const value = change?.value ?? {};

        if (field === "message_template_status_update") {
          const event = String(value?.event ?? "").toLowerCase(); // "approved", "rejected", etc.
          const metaTemplateId = String(value?.message_template_id ?? "");
          const templateName = String(value?.message_template_name ?? "");

          if (metaTemplateId || templateName) {
            let query = supa.from("wa_templates").update({
              status: normalizeTemplateStatus(event),
              updated_at: nowIso(),
            });

            if (metaTemplateId) {
              query = query.eq("meta_template_id", metaTemplateId);
            } else {
              query = query.eq("name", templateName);
            }

            const { error: tplUpdErr } = await query;
            console.log("Webhook template status update:", { event, metaTemplateId, templateName, tplUpdErr });
          }
        }

        if (field === "messages") {
          const metadata = value?.metadata ?? {};
          const phoneNumberId = metadata?.phone_number_id ?? null;
          console.log("Webhook field=messages. phoneNumberId received:", phoneNumberId);

          let numberRow: any = null;

          if (phoneNumberId) {
            const { data, error: numErr } = await supa
              .from("wa_numbers")
              .select("*")
              .eq("phone_number_id", phoneNumberId)
              .maybeSingle();
            
            if (numErr) {
              console.error("Error querying wa_numbers for phoneNumberId:", numErr.message);
              await supa.from("app_activity").insert({
                org_id: null,
                actor_user_id: null,
                type: "webhook_error",
                message: `Error querying wa_numbers: ${numErr.message}`,
                meta: { phoneNumberId, errorCode: numErr.code || "unknown" },
              });
            }
            numberRow = data;
            
            if (!numberRow) {
              console.warn("WABA number not found for authenticated webhook.", { phoneNumberId });
              await supa.from("app_activity").insert({
                org_id: null,
                actor_user_id: null,
                type: "webhook_warn",
                message: `WABA number not found in DB for ID: ${phoneNumberId}`,
                meta: { phoneNumberId },
              });
            } else {
              console.log("Authenticated webhook matched WABA number.", { numberId: numberRow.id });
            }
          } else {
            console.warn("Missing phone_number_id in webhook payload metadata.");
            await supa.from("app_activity").insert({
              org_id: null,
              actor_user_id: null,
              type: "webhook_warn",
              message: "Missing phone_number_id in webhook payload metadata.",
              meta: { correlationId },
            });
          }

          const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
          for (const statusRow of statuses) {
            const metaMessageId = statusRow?.id ?? null;
            const status = String(statusRow?.status ?? "");
            const timestamp = statusRow?.timestamp
              ? new Date(Number(statusRow.timestamp) * 1000).toISOString()
              : nowIso();

            if (!metaMessageId) continue;

            const patch: any = {
              meta_status_payload: statusRow,
            };

            if (status === "accepted") {
              patch.status = "sent";
            } else if (status === "sent") {
              patch.status = "sent";
              patch.sent_at = timestamp;
            } else if (status === "delivered") {
              patch.status = "delivered";
              patch.delivered_at = timestamp;
            } else if (status === "read") {
              patch.status = "read";
              patch.read_at = timestamp;
            } else if (status === "failed") {
              patch.status = "failed";
              patch.error =
                statusRow?.errors?.[0]?.title ||
                statusRow?.errors?.[0]?.message ||
                "Message failed";
            }

            // 1. Store the webhook event in key_info monotonically first to handle race conditions
            const { error: bufferRpcErr } = await supa.rpc("upsert_webhook_status_key_info", {
              p_key: `webhook_status:${metaMessageId}`,
              p_status: patch.status || "sent",
              p_timestamp: timestamp,
              p_error: patch.error ?? null,
              p_payload: statusRow,
            });

            if (bufferRpcErr) {
              console.error("upsert_webhook_status_key_info failed:", bufferRpcErr);
              await bufferWebhookStatusFallback(
                supa,
                metaMessageId,
                patch.status || "sent",
                timestamp,
                patch.error ?? null,
                statusRow,
              );
            }

            // Apply the webhook monotonically so an out-of-order "sent" or
            // "delivered" event can never downgrade a message already read.
            if (patch.status) {
              const { data: advanceData, error: advanceErr } = await supa.rpc(
                "advance_wa_message_status",
                {
                  p_meta_message_id: metaMessageId,
                  p_new_status: patch.status,
                  p_timestamp: timestamp,
                  p_error: patch.error ?? null,
                  p_payload: statusRow,
                },
              );

              const advanceResult = Array.isArray(advanceData) ? advanceData[0] : advanceData;

              if (advanceErr || !advanceResult?.message_id) {
                if (advanceErr) {
                  console.error("advance_wa_message_status failed:", advanceErr);
                }

                // Production databases created before the monotonic RPC
                // migration still need to process authentic Meta webhooks.
                const fallbackResult = await applyWebhookStatusFallback(
                  supa,
                  metaMessageId,
                  { ...patch, meta_status_payload: statusRow },
                  timestamp,
                );

                for (const affectedBroadcastId of fallbackResult.affectedBroadcastIds) {
                  await recalculateBroadcastStats(supa, affectedBroadcastId);
                }

                if (fallbackResult.linkedFound) {
                  await supa
                    .from("key_info")
                    .delete()
                    .eq("key", `webhook_status:${metaMessageId}`);
                }
              } else {
                const affectedBroadcastId = advanceResult.broadcast_id;

                if (affectedBroadcastId) {
                  await recalculateBroadcastStats(supa, affectedBroadcastId);
                }

                // The message is already linked, so its race-condition buffer
                // is no longer needed. If it was not found, keep the buffer for
                // link_and_advance_wa_message to consume later.
                if (advanceResult?.message_id) {
                  await supa
                    .from("key_info")
                    .delete()
                    .eq("key", `webhook_status:${metaMessageId}`);
                }
              }
            }
          }

          const messages = Array.isArray(value?.messages) ? value.messages : [];
          const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
          console.log(`Processing ${messages.length} messages and ${contacts.length} contacts.`);

          for (const incoming of messages) {
            const from = normalizePhone(incoming?.from ?? "");
            if (!from || !numberRow) {
              console.warn("Inbound message skipped because routing data is incomplete.", {
                hasSender: Boolean(from),
                numberMatched: Boolean(numberRow),
              });
              await supa.from("app_activity").insert({
                org_id: numberRow?.org_id || null,
                actor_user_id: null,
                type: "webhook_warn",
                message: "Inbound message skipped because routing data is incomplete",
                meta: { inboundMessageId: incoming?.id ?? null, numberId: numberRow?.id ?? null },
              });
              continue;
            }

            const waContact = contacts.find((x: any) => normalizePhone(x?.wa_id ?? "") === from);
            const displayName =
              waContact?.profile?.name ||
              waContact?.profile?.formatted_name ||
              "Kontak";

            let { data: contact } = await supa
              .from("wa_contacts")
              .select("*")
              .eq("org_id", numberRow.org_id)
              .eq("phone_e164", from)
              .maybeSingle();

            if (!contact) {
              console.log("Creating contact for authenticated inbound message.", { numberId: numberRow.id });
              const inserted = await supa
                .from("wa_contacts")
                .insert({
                  org_id: numberRow.org_id,
                  phone_e164: from,
                  display_name: displayName,
                  last_message_at: nowIso(),
                })
                .select("*")
                .single();

              if (inserted.error) {
                console.error("Error creating contact:", inserted.error.message);
                await supa.from("app_activity").insert({
                  org_id: numberRow.org_id,
                  actor_user_id: null,
                  type: "webhook_error",
                  message: `Error creating contact for inbound message: ${inserted.error.message}`,
                  meta: { numberId: numberRow.id, errorCode: inserted.error.code || "unknown" },
                });
                throw inserted.error;
              }
              contact = inserted.data;
            } else {
              console.log("Matched contact for authenticated inbound message.", {
                numberId: numberRow.id,
                contactId: contact.id,
              });
              await supa
                .from("wa_contacts")
                .update({
                  last_message_at: nowIso(),
                })
                .eq("id", contact.id);
            }

            const inboundMessageId = String(incoming?.id ?? "").trim();
            if (!inboundMessageId) {
              console.warn("Inbound Meta message skipped: provider message ID is missing.", {
                numberId: numberRow.id,
                contactId: contact.id,
              });
              continue;
            }

            const messageType = String(incoming?.type ?? "text");
            const textBody =
              incoming?.text?.body ??
              incoming?.button?.text ??
              incoming?.interactive?.button_reply?.title ??
              incoming?.interactive?.list_reply?.title ??
              `[${messageType}]`;

            const { data: insertedMessage, error: insertErr } = await supa
              .from("wa_messages")
              .insert({
                org_id: numberRow.org_id,
                number_id: numberRow.id,
                contact_id: contact.id,
                direction: "in",
                status: "delivered",
                meta_message_id: inboundMessageId,
                meta_status_payload: incoming,
                message_type: messageType,
                text_body: textBody,
                payload: incoming,
                delivered_at: nowIso(),
              })
              .select("id")
              .single();

            if (insertErr) {
              if (insertErr.code === "23505") {
                console.log("Duplicate inbound Meta message ignored.", {
                  inboundMessageId,
                  numberId: numberRow.id,
                });
                continue;
              }

              console.error("Inbound Meta message persistence failed.", {
                inboundMessageId,
                numberId: numberRow.id,
                errorCode: insertErr.code || "unknown",
              });
            } else {
              console.log("Inbound Meta message persisted.", {
                inboundMessageId,
                localMessageId: insertedMessage?.id,
                numberId: numberRow.id,
              });
              await supa.from("app_activity").insert({
                org_id: numberRow.org_id,
                actor_user_id: null,
                type: "webhook_success",
                message: "Inbound Meta message processed successfully",
                meta: { inboundMessageId, localMessageId: insertedMessage?.id, messageType },
              });

              try {
                await processAutoReplyForInbound(
                  supa,
                  numberRow,
                  contact,
                  from,
                  inboundMessageId,
                );
              } catch (autoReplyErr) {
                console.error("Auto-reply processing failed.", {
                  inboundMessageId,
                  numberId: numberRow.id,
                  error: autoReplyErr instanceof Error ? autoReplyErr.message : String(autoReplyErr),
                });
              }
            }
          }
        }
      }
    }

    return c.json({ success: true });
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
};

app.get("/webhook", handleWebhookGet);
app.get("/webhooks/meta", handleWebhookGet);

app.post("/webhook", handleWebhookPost);
app.post("/webhooks/meta", handleWebhookPost);

// ===== SETTINGS =====
app.get(`${API_PREFIX}/settings`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const [
      { data: org, error: orgErr },
      { data: me, error: userErr },
      { data: avatarRow },
      { data: addressRow },
      { data: numberAutoReplyRows },
      { data: ownedNumbers },
    ] = await Promise.all([
      supa
        .from("orgs")
        .select("id, name, slug, support_email, auto_reply_enabled, auto_reply_message, fallback_template_name, send_delay_ms, throttle_per_min")
        .eq("id", user.org_id)
        .maybeSingle(),
      supa
        .from("app_users")
        .select("id, email, username, full_name, role")
        .eq("id", user.id)
        .maybeSingle(),
      supa
        .from("key_info")
        .select("value")
        .eq("key", `avatar:${user.id}`)
        .maybeSingle(),
      supa
        .from("key_info")
        .select("value")
        .eq("key", `address:${user.org_id}`)
        .maybeSingle(),
      supa
        .from("key_info")
        .select("key, value")
        .like("key", "autoreply_num_%"),
      supa
        .from("wa_numbers")
        .select("id")
        .eq("org_id", user.org_id),
    ]);

    if (orgErr) return c.json(jsonFail(orgErr.message), 500);
    if (userErr) return c.json(jsonFail(userErr.message), 500);

    const numberAutoReplies: Record<string, { autoReplyEnabled: boolean; autoReplyMessage: string }> = {};
    const ownedNumberIds = new Set((ownedNumbers ?? []).map((row: any) => String(row.id)));
    if (Array.isArray(numberAutoReplyRows)) {
      for (const row of numberAutoReplyRows) {
        const numId = String(row.key || "").replace("autoreply_num_", "");
        if (numId && ownedNumberIds.has(numId) && row.value) {
          const valObj = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
          numberAutoReplies[numId] = {
            autoReplyEnabled: valObj.autoReplyEnabled !== false,
            autoReplyMessage:
              valObj.autoReplyMessage ||
              "Nomor ini hanya digunakan untuk pengiriman broadcast. Apabila Anda membutuhkan informasi lebih lanjut, silakan hubungi Customer Service kami.",
          };
        }
      }
    }

    const webhookUrl = `${new URL(c.req.url).origin}/functions/v1/server/webhooks/meta`;

    return c.json(
      jsonOk({
        org: {
          id: org?.id ?? null,
          name: org?.name ?? "",
          slug: org?.slug ?? "",
          supportEmail: org?.support_email ?? "",
          autoReplyEnabled: org?.auto_reply_enabled !== false,
          autoReplyMessage:
            org?.auto_reply_message ||
            "Nomor ini hanya digunakan untuk pengiriman broadcast. Apabila Anda membutuhkan informasi lebih lanjut, silakan hubungi Customer Service kami.",
          fallbackTemplateName: org?.fallback_template_name ?? "",
          sendDelayMs: Number(org?.send_delay_ms ?? 2000),
          throttlePerMin: Number(org?.throttle_per_min ?? 30),
          address: addressRow?.value?.address ?? "",
          numberAutoReplies,
        },
        profile: {
          id: me?.id ?? null,
          fullName: me?.full_name ?? "",
          username: me?.username ?? "",
          email: me?.email ?? "",
          role: me?.role ?? "",
          avatar: avatarRow?.value?.avatar ?? null,
          waNumber: user.wa_number || "",
        },
        webhook: {
          url: webhookUrl,
          verifyMode: "global-secret",
        },
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.put(`${API_PREFIX}/settings/profile`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const body = await c.req.json();

    const fullName = String(body.fullName ?? "").trim();
    const username = normalizeUsername(body.username);
    const email = normalizeEmail(body.email);

    if (!fullName) return c.json(jsonFail("Nama lengkap wajib"), 400);
    if (!username) return c.json(jsonFail("Username wajib"), 400);
    if (!email) return c.json(jsonFail("Email wajib"), 400);

    const { data: existsUser, error: existsErr } = await supa
      .from("app_users")
      .select("id")
      .eq("org_id", user.org_id)
      .or(`username.ilike.${username},email.ilike.${email}`)
      .neq("id", user.id);

    if (existsErr) return c.json(jsonFail(existsErr.message), 500);
    if ((existsUser ?? []).length > 0) {
      return c.json(jsonFail("Username atau email sudah dipakai"), 400);
    }

    const { data, error } = await supa
      .from("app_users")
      .update({
        full_name: fullName,
        username,
        email,
      })
      .eq("id", user.id)
      .eq("org_id", user.org_id)
      .select("id, full_name, username, email, role")
      .single();

    if (error) return c.json(jsonFail(error.message), 500);

    // Sync waNumber (wa_number) in auth.users user metadata if passed
    if ("waNumber" in body) {
      const waNumber = String(body.waNumber ?? "").trim();
      const { error: authUpdateErr } = await supa.auth.admin.updateUserById(user.id, {
        user_metadata: {
          wa_number: waNumber
        }
      });
      if (authUpdateErr) {
        console.warn("Failed to update wa_number in user metadata:", authUpdateErr.message);
      }
    }

    // Sync avatar if passed
    let avatar = undefined;
    if ("avatar" in body) {
      avatar = body.avatar; // can be base64 string or null/empty to delete
      const avatarKey = `avatar:${user.id}`;
      if (avatar) {
        await supa.from("key_info").upsert({
          key: avatarKey,
          value: { avatar }
        });
      } else {
        await supa.from("key_info").delete().eq("key", avatarKey);
      }
    }

    return c.json(
      jsonOk({
        id: data.id,
        fullName: data.full_name,
        username: data.username,
        email: data.email,
        role: data.role,
        ...(avatar !== undefined ? { avatar } : {}),
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.put(`${API_PREFIX}/settings/org`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const body = await c.req.json();

    const name = String(body.name ?? "").trim();
    const supportEmail = normalizeEmail(body.supportEmail ?? "");

    if (!name) return c.json(jsonFail("Nama organisasi wajib"), 400);

    const { data, error } = await supa
      .from("orgs")
      .update({
        name,
        support_email: supportEmail || null,
      })
      .eq("id", user.org_id)
      .select("id, name, support_email")
      .single();

    if (error) return c.json(jsonFail(error.message), 500);

    // Sync address if passed
    let address = undefined;
    if ("address" in body) {
      address = String(body.address ?? "").trim();
      const addressKey = `address:${user.org_id}`;
      if (address) {
        await supa.from("key_info").upsert({
          key: addressKey,
          value: { address }
        });
      } else {
        await supa.from("key_info").delete().eq("key", addressKey);
      }
    }

    return c.json(
      jsonOk({
        id: data.id,
        name: data.name,
        supportEmail: data.support_email ?? "",
        ...(address !== undefined ? { address } : {}),
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/settings/contact-labels`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const { data, error } = await supa
      .from("key_info")
      .select("value")
      .eq("key", `contact_labels:${user.org_id}`)
      .maybeSingle();

    if (error) return c.json(jsonFail(error.message), 500);
    return c.json(jsonOk(data?.value?.labels || {}));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.put(`${API_PREFIX}/settings/contact-labels`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const body = await c.req.json();

    const labels = body.labels || {};

    const { error } = await supa
      .from("key_info")
      .upsert({
        key: `contact_labels:${user.org_id}`,
        value: { labels }
      });

    if (error) return c.json(jsonFail(error.message), 500);
    return c.json(jsonOk(labels));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.put(`${API_PREFIX}/settings/messaging`, requireAuth, requireOrgAdmin, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const body = await c.req.json();

    const numberId = body.numberId ? String(body.numberId).trim() : null;
    const autoReplyEnabled = !!body.autoReplyEnabled;
    const autoReplyMessage = String(body.autoReplyMessage ?? "").trim();
    const sendDelayMs = Math.max(0, Number(body.sendDelayMs ?? 2000));
    const throttlePerMin = Math.max(1, Number(body.throttlePerMin ?? 30));

    if (numberId) {
      const { data: ownedNumber, error: ownedNumberError } = await supa
        .from("wa_numbers")
        .select("id")
        .eq("id", numberId)
        .eq("org_id", user.org_id)
        .maybeSingle();
      if (ownedNumberError) return c.json(jsonFail(ownedNumberError.message), 500);
      if (!ownedNumber) return c.json(jsonFail("Nomor tidak ditemukan"), 404);

      const keyStr = `autoreply_num_${numberId}`;
      const payloadVal = {
        autoReplyEnabled,
        autoReplyMessage:
          autoReplyMessage ||
          "Nomor ini hanya digunakan untuk pengiriman broadcast. Apabila Anda membutuhkan informasi lebih lanjut, silakan hubungi Customer Service kami.",
      };

      const { data: existingRow } = await supa
        .from("key_info")
        .select("key")
        .eq("key", keyStr)
        .maybeSingle();

      let keyErr: any = null;
      if (existingRow) {
        const { error: err } = await supa
          .from("key_info")
          .update({ value: payloadVal })
          .eq("key", keyStr);
        keyErr = err;
      } else {
        const { error: err } = await supa
          .from("key_info")
          .insert({ key: keyStr, value: payloadVal });
        keyErr = err;
      }

      if (keyErr) {
        console.error(`[SETTINGS] Error saving key_info per-number auto reply for ${numberId}:`, keyErr.message);
        return c.json(jsonFail(`Gagal menyimpan auto reply per nomor di database: ${keyErr.message}`), 500);
      } else {
        console.log(`[SETTINGS] Successfully saved per-number auto reply for number ${numberId}`);
      }
    }

    const { data, error } = await supa
      .from("orgs")
      .update({
        auto_reply_enabled: autoReplyEnabled,
        auto_reply_message: autoReplyMessage || null,
        send_delay_ms: sendDelayMs,
        throttle_per_min: throttlePerMin,
      })
      .eq("id", user.org_id)
      .select("auto_reply_enabled, auto_reply_message, send_delay_ms, throttle_per_min")
      .single();

    if (error) return c.json(jsonFail(error.message), 500);

    return c.json(
      jsonOk({
        numberId,
        autoReplyEnabled: !!data.auto_reply_enabled,
        autoReplyMessage: data.auto_reply_message ?? "",
        sendDelayMs: Number(data.send_delay_ms ?? 2000),
        throttlePerMin: Number(data.throttle_per_min ?? 30),
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.put(`${API_PREFIX}/settings/password`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const body = await c.req.json();

    const currentPassword = String(body.currentPassword ?? "");
    const newPassword = String(body.newPassword ?? "");

    if (!currentPassword || !newPassword) {
      return c.json(jsonFail("Password lama dan password baru wajib"), 400);
    }

    if (newPassword.length < 8) {
      return c.json(jsonFail("Password baru minimal 8 karakter"), 400);
    }

    const { data: me, error: meErr } = await supa
      .from("app_users")
      .select("id, password_hash")
      .eq("id", user.id)
      .eq("org_id", user.org_id)
      .maybeSingle();

    if (meErr) return c.json(jsonFail(meErr.message), 500);
    if (!me) return c.json(jsonFail("User tidak ditemukan"), 404);

    const ok = await bcrypt.compare(currentPassword, me.password_hash);
    if (!ok) return c.json(jsonFail("Password lama salah"), 400);

    const password_hash = await bcrypt.hash(newPassword, 10);

    const { error } = await supa
      .from("app_users")
      .update({ password_hash })
      .eq("id", user.id)
      .eq("org_id", user.org_id);

    if (error) return c.json(jsonFail(error.message), 500);

    return c.json(jsonOk({ changed: true }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});
// ===== SUPERADMIN ENDPOINTS =====
async function requireSuperadmin(c: any, next: any) {
  const user = c.get("authUser");
  if (!isConfiguredSuperadmin(user)) {
    const superadminUserId = String(Deno.env.get("SUPERADMIN_USER_ID") || "").trim();
    const superadminEmail = normalizeEmail(Deno.env.get("SUPERADMIN_EMAIL"));
    if (!superadminUserId && !superadminEmail) {
      console.error("Superadmin authorization is not configured");
      return c.json(jsonFail("Konfigurasi otorisasi superadmin belum tersedia"), 503);
    }
    return c.json(jsonFail("Hanya pemilik yang dapat mengakses halaman ini"), 403);
  }
  await next();
}

function isConfiguredSuperadmin(user: any) {
  const superadminUserId = String(Deno.env.get("SUPERADMIN_USER_ID") || "").trim();
  const superadminEmail = normalizeEmail(Deno.env.get("SUPERADMIN_EMAIL"));
  if (!superadminUserId && !superadminEmail) return false;
  return superadminUserId
    ? user?.auth_user_id === superadminUserId
    : normalizeEmail(user?.auth_email) === superadminEmail;
}

app.get(`${API_PREFIX}/superadmin/orgs`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const supa = sb();

    const { data: orgs, error: orgsErr } = await supa
      .from("orgs")
      .select("*")
      .order("created_at", { ascending: false });

    if (orgsErr) return c.json(jsonFail(orgsErr.message), 500);

    const { data: balances, error: balErr } = await supa
      .from("billing_balance")
      .select("*");

    if (balErr) return c.json(jsonFail(balErr.message), 500);

    const { data: numbers, error: numErr } = await supa
      .from("wa_numbers")
      .select("*");

    if (numErr) return c.json(jsonFail(numErr.message), 500);

    const { data: users, error: usersErr } = await supa
      .from("app_users")
      .select("id, org_id, email, full_name, role, username, is_active, created_at");

    if (usersErr) return c.json(jsonFail(usersErr.message), 500);

    const adminUser = c.get("authUser");
    const mapped = (orgs ?? [])
      .filter((org: any) => org.id !== adminUser.org_id)
      .map((org: any) => {
        const balance = (balances ?? []).find((b: any) => b.org_id === org.id);
        const orgNumbers = (numbers ?? []).filter((n: any) => n.org_id === org.id);
        const orgUsers = (users ?? []).filter((u: any) => u.org_id === org.id && u.email?.toLowerCase() !== "mckuadratid@gmail.com");

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.plan,
        isActive: org.is_active,
        supportEmail: org.support_email ?? "",
        sendDelayMs: org.send_delay_ms ?? 2000,
        throttlePerMin: org.throttle_per_min ?? 30,
        createdAt: org.created_at,
        tokensBalance: balance ? Number(balance.tokens_balance ?? 0) : 0,
        tokenPrice: balance
          ? requireCanonicalTokenPrice(balance.token_price_idr, org.id)
          : null,
        numbers: orgNumbers.map((n: any) => ({
          id: n.id,
          label: n.label,
          phone: n.phone_e164,
          isActive: n.is_active,
          phoneNumberId: n.phone_number_id,
          wabaId: n.waba_id,
        })),
        users: orgUsers.map((u: any) => ({
          id: u.id,
          email: u.email,
          username: u.username,
          fullName: u.full_name,
          role: u.role,
          isActive: u.is_active,
          createdAt: u.created_at,
        })),
      };
    });

    return c.json(jsonOk(mapped));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/superadmin/orgs/:orgId/stats`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const orgId = c.req.param("orgId");
    const supa = sb();

    const { count: totalBroadcasts, error: bErr } = await supa
      .from("wa_broadcasts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);

    if (bErr) return c.json(jsonFail(bErr.message), 500);

    const { count: messagesSent, error: mOutErr } = await supa
      .from("wa_messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("direction", "out");

    if (mOutErr) return c.json(jsonFail(mOutErr.message), 500);

    const { count: messagesReceived, error: mInErr } = await supa
      .from("wa_messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("direction", "in");

    if (mInErr) return c.json(jsonFail(mInErr.message), 500);

    const { count: totalContacts, error: cErr } = await supa
      .from("wa_contacts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId);

    if (cErr) return c.json(jsonFail(cErr.message), 500);

    const { data: requestRows, error: reqErr } = await supa
      .from("key_info")
      .select("key, value")
      .like("key", `payment_request:${orgId}:%`);

    if (reqErr) return c.json(jsonFail(reqErr.message), 500);
    const requests = (requestRows ?? []).map((row: any) => row.value);
    requests.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const { data: transactionRows, error: txErr } = await supa
      .from("billing_transactions")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(15);

    if (txErr) return c.json(jsonFail(txErr.message), 500);

    return c.json(
      jsonOk({
        totalBroadcasts: totalBroadcasts ?? 0,
        messagesSent: messagesSent ?? 0,
        messagesReceived: messagesReceived ?? 0,
        totalContacts: totalContacts ?? 0,
        manualRequests: requests,
        recentTransactions: (transactionRows ?? []).map((r: any) => ({
          id: r.id,
          type: r.type,
          tokensDelta: r.tokens_delta ?? 0,
          amountIdr: r.amount_idr ?? 0,
          description: r.description ?? "",
          createdAt: r.created_at,
        })),
      })
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/superadmin/orgs/:orgId/tokens`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const orgId = c.req.param("orgId");
    const body = await c.req.json();
    const tokensDelta = Number(body.tokensDelta ?? 0);
    const description = String(body.description ?? "").trim() || "Manual token adjustment by owner";

    if (!Number.isFinite(tokensDelta) || !Number.isInteger(tokensDelta) || tokensDelta === 0) {
      return c.json(jsonFail("Nominal token tidak valid"), 400);
    }

    const supa = sb();

    const { data: org, error: orgErr } = await supa
      .from("orgs")
      .select("id, name")
      .eq("id", orgId)
      .maybeSingle();

    if (orgErr) return c.json(jsonFail(`Gagal memeriksa instansi: ${orgErr.message}`), 500);
    if (!org) return c.json(jsonFail("Instansi tidak ditemukan"), 404);

    const adjustmentReference = crypto.randomUUID();
    const mutation = await applyBillingMutation({
      orgId,
      tokenDelta: tokensDelta,
      transactionType: "adjustment",
      amountIdr: 0,
      description,
      refType: "admin_adjustment",
      refId: adjustmentReference,
      actorUserId: c.get("authUser").id,
      provider: "adjustment",
      externalReference: adjustmentReference,
      metadata: { requested_delta: tokensDelta, reason: description },
      // Preserve the existing endpoint behavior: an oversized debit floors the
      // balance at zero and records the actually applied delta.
      floorAtZero: true,
    });

    const currentBalance = Number(mutation?.balance_before ?? 0);
    const newBalance = Number(mutation?.new_balance ?? currentBalance);
    const appliedDelta = Number(mutation?.applied_delta ?? 0);

    await supa.from("app_activity").insert({
      org_id: orgId,
      actor_user_id: c.get("authUser").id,
      type: "billing_adjustment",
      message: `Penyesuaian token manual untuk ${org.name}: ${appliedDelta >= 0 ? "+" : ""}${appliedDelta}`,
      meta: {
        previous_balance: currentBalance,
        new_balance: newBalance,
        requested_delta: tokensDelta,
        billing_ledger_id: mutation?.ledger_id ?? null,
        adjustment_reference: adjustmentReference,
      },
    });

    return c.json(jsonOk({
      tokensBalance: newBalance,
      appliedDelta,
      ledgerId: mutation?.ledger_id ?? null,
      adjustmentReference,
    }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.put(`${API_PREFIX}/superadmin/orgs/:orgId`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const orgId = c.req.param("orgId");
    const body = await c.req.json();
    const supa = sb();

    const name = String(body.name ?? "").trim();
    const slug = String(body.slug ?? "").trim();
    const plan = String(body.plan ?? "free").trim();
    const isActive = body.isActive !== undefined ? !!body.isActive : true;
    const supportEmail = String(body.supportEmail ?? "").trim();
    const sendDelayMs = Number(body.sendDelayMs ?? 2000);
    const throttlePerMin = Number(body.throttlePerMin ?? 30);
    const hasTokenPrice = body.tokenPrice !== undefined && body.tokenPrice !== null;
    const tokenPrice = hasTokenPrice ? Number(body.tokenPrice) : null;

    if (!name) return c.json(jsonFail("Nama instansi wajib diisi"), 400);
    if (!slug) return c.json(jsonFail("Slug wajib diisi"), 400);
    if (hasTokenPrice && (!Number.isFinite(tokenPrice) || Number(tokenPrice) <= 0)) {
      return c.json(jsonFail("Harga token wajib berupa angka lebih besar dari nol"), 400);
    }

    const { data, error } = await supa
      .from("orgs")
      .update({
        name,
        slug,
        plan,
        is_active: isActive,
        support_email: supportEmail || null,
        send_delay_ms: Number.isNaN(sendDelayMs) ? 2000 : sendDelayMs,
        throttle_per_min: Number.isNaN(throttlePerMin) ? 30 : throttlePerMin,
        updated_at: nowIso(),
      })
      .eq("id", orgId)
      .select("*")
      .single();

    if (error) return c.json(jsonFail(error.message), 500);

    // Sync is_active with organization users
    await supa
      .from("app_users")
      .update({ is_active: isActive })
      .eq("org_id", orgId);

    // Update token price in billing_balance
    if (hasTokenPrice) {
      const { error: priceError } = await supa
        .from("billing_balance")
        .upsert({
          org_id: orgId,
          token_price_idr: Number(tokenPrice),
          updated_at: nowIso(),
        }, { onConflict: "org_id" });
      if (priceError) return c.json(jsonFail(priceError.message), 500);
    }

    return c.json(jsonOk(data));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/superadmin/orgs/:orgId/numbers`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const orgId = c.req.param("orgId");
    const body = await c.req.json();
    const supa = sb();

    const label = String(body.name ?? body.label ?? "Nomor WA").trim();
    const phone_e164 = normalizePhone(body.number ?? body.phone_e164);
    const business_id = String(body.businessId ?? "").trim() || null;
    const waba_id = String(body.wabaId ?? "").trim() || null;
    const phone_number_id = String(body.phoneNumberId ?? "").trim() || null;
    const access_token = String(body.accessToken ?? "").trim() || null;

    if (!phone_e164) return c.json(jsonFail("Nomor wajib diisi"), 400);
    if (!phone_number_id) return c.json(jsonFail("Phone Number ID wajib"), 400);
    if (!access_token) return c.json(jsonFail("Access Token wajib"), 400);

    await testMetaNumber(access_token, phone_number_id);

    const { data, error } = await supa
      .from("wa_numbers")
      .insert({
        org_id: orgId,
        label,
        phone_e164,
        business_id,
        waba_id,
        phone_number_id,
        access_token,
        is_active: true,
      })
      .select("*")
      .single();

    if (error) return c.json(jsonFail(error.message), 500);

    if (waba_id && access_token) {
      try {
        await syncMetaTemplatesForNumber({
          orgId,
          userId: c.get("authUser").id,
          wabaId: waba_id,
          accessToken: access_token,
        });
      } catch (syncErr) {
        console.warn("Auto sync template failed for superadmin added number:", syncErr);
      }
    }

    return c.json(jsonOk(data));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/superadmin/signups`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const supa = sb();

    // Fetch all auth users from Supabase Auth admin panel
    const { data: authData, error: authErr } = await supa.auth.admin.listUsers();
    if (authErr) return c.json(jsonFail(authErr.message), 500);
    const authUsers = authData?.users ?? [];

    const { data: users, error: usersErr } = await supa
      .from("app_users")
      .select("id, email, username, full_name, role, created_at, org_id, is_active")
      .eq("role", "owner")
      .order("created_at", { ascending: false });

    if (usersErr) return c.json(jsonFail(usersErr.message), 500);

    const { data: orgs, error: orgsErr } = await supa
      .from("orgs")
      .select("id, name, slug, plan");

    if (orgsErr) return c.json(jsonFail(orgsErr.message), 500);

    const signups: any[] = [];

    for (const u of users ?? []) {
      if (u.email?.toLowerCase() === "mckuadratid@gmail.com") continue;
      const authUser = authUsers.find((au) => au.id === u.id);
      const isEmailConfirmed = authUser ? !!authUser.email_confirmed_at : false;

      // Filter: Show only if email is NOT confirmed OR profile is NOT active (i.e. new unverified registrants)
      if (!isEmailConfirmed || !u.is_active) {
        const org = (orgs ?? []).find((o: any) => o.id === u.org_id);
         signups.push({
          id: u.id,
          email: u.email,
          username: u.username,
          fullName: u.full_name,
          createdAt: u.created_at,
          isActive: u.is_active,
          isEmailConfirmed,
          waNumber: authUser?.user_metadata?.wa_number || "",
          org: org ? {
            id: org.id,
            name: org.name,
            slug: org.slug,
            plan: org.plan,
          } : null,
        });
      }
    }

    return c.json(jsonOk(signups));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/superadmin/users/:userId/activate`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const userId = c.req.param("userId");
    const supa = sb();

    const { data: userProfile, error: profileErr } = await supa
      .from("app_users")
      .select("org_id, email")
      .eq("id", userId)
      .maybeSingle();

    if (profileErr) return c.json(jsonFail(profileErr.message), 500);
    if (!userProfile) return c.json(jsonFail("User tidak ditemukan"), 404);

    // 1. Confirm email in Supabase Auth
    const { error: authErr } = await supa.auth.admin.updateUserById(userId, {
      email_confirm: true,
    });

    if (authErr) {
      console.warn("Failed to confirm email in Supabase Auth:", authErr.message);
    }

    // 2. Activate user profile in app_users
    const { error: userUpdateErr } = await supa
      .from("app_users")
      .update({ is_active: true })
      .eq("id", userId);

    if (userUpdateErr) return c.json(jsonFail(userUpdateErr.message), 500);

    // 3. Activate organization
    if (userProfile.org_id) {
      const { error: orgUpdateErr } = await supa
        .from("orgs")
        .update({ is_active: true })
        .eq("id", userProfile.org_id);

      if (orgUpdateErr) {
        console.warn("Failed to activate org:", orgUpdateErr.message);
      }
    }

    return c.json(jsonOk(true));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/superadmin/users/:userId/resend-verification`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const userId = c.req.param("userId");
    const supa = sb();

    const { data: userProfile, error: profileErr } = await supa
      .from("app_users")
      .select("email")
      .eq("id", userId)
      .maybeSingle();

    if (profileErr) return c.json(jsonFail(profileErr.message), 500);
    if (!userProfile) return c.json(jsonFail("User tidak ditemukan"), 404);

    // Resend verification email
    const { error: resendErr } = await supa.auth.resend({
      type: "signup",
      email: userProfile.email,
    });

    if (resendErr) return c.json(jsonFail(resendErr.message), 500);

    return c.json(jsonOk({ message: `Email verifikasi berhasil dikirim ulang ke ${userProfile.email}` }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/billing/midtrans/create`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const { amount, tokens } = await c.req.json();

    if (!tokens || tokens <= 0) {
      return c.json(jsonFail("Jumlah token tidak valid"), 400);
    }
    if (!amount || amount <= 0) {
      return c.json(jsonFail("Jumlah nominal pembayaran tidak valid"), 400);
    }

    const supa = sb();

    const { data: balance, error: balErr } = await supa
      .from("billing_balance")
      .select("token_price_idr")
      .eq("org_id", user.org_id)
      .maybeSingle();

    if (balErr) return c.json(jsonFail(balErr.message), 500);
    const price = Number(balance?.token_price_idr ?? 1500);

    const expectedAmount = tokens * price;
    if (Math.abs(amount - expectedAmount) > 1000) {
      return c.json(jsonFail(`Nominal pembayaran tidak sesuai. Diharapkan Rp ${expectedAmount}`), 400);
    }

    const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");
    const isProduction = Deno.env.get("MIDTRANS_IS_PRODUCTION") === "true";
    const webhookUrl = Deno.env.get("MIDTRANS_WEBHOOK_URL");

    if (!serverKey) {
      return c.json(jsonFail("Midtrans Server Key belum dikonfigurasi di server"), 500);
    }

    const authHeader = `Basic ${btoa(serverKey + ":")}`;

    const midtransUrl = isProduction
      ? "https://app.midtrans.com/snap/v1/transactions"
      : "https://app.sandbox.midtrans.com/snap/v1/transactions";

    const orderId = `SIPESA-TX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const payload = {
      transaction_details: {
        order_id: orderId,
        gross_amount: amount,
      },
      item_details: [
        {
          id: `token-${tokens}`,
          price: price,
          quantity: tokens,
          name: `${tokens} Saldo Token SIPESA`,
        }
      ],
      customer_details: {
        first_name: user.full_name || user.name,
        email: user.email,
      },
      callbacks: {
        finish: `https://sipesa.mckuadrat.com/#/billing`,
      }
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": authHeader,
    };

    if (webhookUrl) {
      headers["X-Override-Notification"] = webhookUrl;
    }

    const midtransRes = await fetch(midtransUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!midtransRes.ok) {
      const errText = await midtransRes.text();
      console.error("Midtrans Snap API Error:", errText);
      return c.json(jsonFail(`Gagal menghubungi Midtrans: ${errText}`), 500);
    }

    const midtransData = await midtransRes.json();

    const txObj = {
      id: orderId,
      org_id: user.org_id,
      user_id: user.id,
      user_email: user.email,
      amount_tokens: tokens,
      amount_idr: amount,
      status: "pending",
      created_at: new Date().toISOString(),
      snap_token: midtransData.token,
      snap_url: midtransData.redirect_url,
    };

    const { error: saveErr } = await supa
      .from("key_info")
      .upsert({
        key: `midtrans_tx:${orderId}`,
        value: txObj,
      });

    if (saveErr) {
      console.error("Gagal menyimpan data transaksi midtrans ke key_info:", saveErr);
      return c.json(jsonFail(saveErr.message), 500);
    }

    return c.json(jsonOk({
      token: midtransData.token,
      redirect_url: midtransData.redirect_url,
      order_id: orderId,
    }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/billing/midtrans/webhook`, async (c) => {
  // Legacy C-01 route intentionally disabled. The Batch 9 primary flow is
  // direct payment + manual verification and never depends on this webhook.
  // Keep the old implementation below only as historical reference until the
  // separate signed webhook migration is retired in a future gateway batch.
  return c.json(jsonFail("Webhook gateway legacy tidak aktif"), 410);
  /* c8 ignore start */
  try {
    const body = await c.req.json();
    console.log("Midtrans Webhook Received:", JSON.stringify(body));

    const orderId = body.order_id;
    const transactionStatus = body.transaction_status;
    const fraudStatus = body.fraud_status;

    if (!orderId) {
      return c.json(jsonFail("Order ID tidak ditemukan"), 400);
    }

    const supa = sb();

    // Retrieve pending transaction from key_info
    const { data: kvRow, error: kvErr } = await supa
      .from("key_info")
      .select("key, value")
      .eq("key", `midtrans_tx:${orderId}`)
      .maybeSingle();

    if (kvErr || !kvRow) {
      console.warn("Midtrans transaction not found in key_info:", orderId);
      return c.json(jsonFail("Transaksi tidak ditemukan"), 404);
    }

    const txObj = kvRow.value;
    const orgId = txObj.org_id;
    const tokens = Number(txObj.amount_tokens);
    const amount = Number(txObj.amount_idr);

    let nextStatus = "pending";
    let shouldAddTokens = false;

    if (transactionStatus === "capture") {
      if (fraudStatus === "challenge") {
        nextStatus = "challenge";
      } else if (fraudStatus === "accept") {
        nextStatus = "success";
        shouldAddTokens = true;
      }
    } else if (transactionStatus === "settlement") {
      nextStatus = "success";
      shouldAddTokens = true;
    } else if (["cancel", "deny", "expire"].includes(transactionStatus)) {
      nextStatus = "failed";
    } else if (transactionStatus === "pending") {
      nextStatus = "pending";
    }

    let billingMutation: any = null;
    if (shouldAddTokens) {
      // Provider handling only produces a verified-event-shaped input here.
      // C-01 remains open for this legacy route because it still does not
      // verify the Midtrans signature; accounting itself is now centralized.
      billingMutation = await applyBillingMutation({
        orgId,
        tokenDelta: tokens,
        transactionType: "topup",
        amountIdr: amount,
        description: `Top-up Midtrans berhasil (${tokens} token)`,
        refType: "midtrans",
        refId: orderId,
        actorUserId: txObj.user_id,
        provider: "midtrans",
        externalReference: orderId,
        metadata: {
          transaction_status: transactionStatus,
          fraud_status: fraudStatus ?? null,
          source_handler: "server_legacy_midtrans_webhook",
        },
      });

      console.log(
        `Midtrans billing event ${orderId}: ${billingMutation?.applied ? "applied" : "duplicate"}.`,
      );
    }

    if (txObj.status !== nextStatus || shouldAddTokens) {
      txObj.status = nextStatus;
      txObj.updated_at = new Date().toISOString();
      txObj.raw_webhook_payload = body;
      if (billingMutation?.ledger_id) {
        txObj.billing_ledger_id = billingMutation.ledger_id;
      }

      const { error: statusUpdateErr } = await supa
        .from("key_info")
        .update({ value: txObj })
        .eq("key", `midtrans_tx:${orderId}`);

      if (statusUpdateErr) throw statusUpdateErr;
    }

    return c.json(jsonOk("Webhook processed successfully"));
  } catch (e) {
    console.error("Midtrans Webhook Error:", e);
    return c.json(jsonFail(e), 500);
  }
});

// ===== MANUAL BILLING ENDPOINTS =====
app.get(`${API_PREFIX}/billing/payment-destinations`, requireAuth, async (c) => {
  try {
    const supa = sb();
    const { data, error } = await supa
      .from("payment_destinations")
      .select("id, method, provider_name, account_reference, account_holder, qris_object_path, instructions, display_order")
      .eq("active", true)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Payment destination load failed", error);
      return c.json(jsonFail("Metode pembayaran belum dapat dimuat"), 500);
    }

    return c.json(jsonOk((data ?? []).map((destination: any) => ({
      id: destination.id,
      method: destination.method,
      provider_name: destination.provider_name,
      account_reference: destination.account_reference,
      account_holder: destination.account_holder,
      instructions: destination.instructions,
      has_qris: Boolean(destination.qris_object_path),
    }))));
  } catch (error) {
    console.error("Payment destination load crashed", error);
    return c.json(jsonFail("Metode pembayaran belum dapat dimuat"), 500);
  }
  /* c8 ignore stop */
});

app.get(`${API_PREFIX}/billing/payment-destinations/:id/qris`, requireAuth, async (c) => {
  try {
    const supa = sb();
    const { data: destination, error } = await supa
      .from("payment_destinations")
      .select("qris_object_path")
      .eq("id", c.req.param("id"))
      .eq("method", "qris_static")
      .eq("active", true)
      .maybeSingle();
    if (error) console.error("QRIS destination lookup failed", error);
    if (!destination?.qris_object_path) return c.json(jsonFail("QRIS tidak tersedia"), 404);

    const { data: file, error: downloadError } = await supa.storage
      .from(PAYMENT_ASSET_BUCKET)
      .download(destination.qris_object_path);
    if (downloadError || !file) {
      console.error("QRIS asset download failed", downloadError);
      return c.json(jsonFail("QRIS belum dapat dimuat"), 500);
    }
    return c.body(await file.arrayBuffer(), 200, {
      "Content-Type": file.type || "image/png",
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    });
  } catch (error) {
    console.error("QRIS asset request crashed", error);
    return c.json(jsonFail("QRIS belum dapat dimuat"), 500);
  }
});

app.get(`${API_PREFIX}/billing/payment-settings`, requireAuth, async (c) => {
  try {
    const supa = sb();
    const { data, error } = await supa
      .from("key_info")
      .select("value")
      .eq("key", "payment_settings")
      .maybeSingle();

    if (error) return c.json(jsonFail(error.message), 500);
    return c.json(jsonOk(data?.value || { bank_transfer: "", gopay: "", qris_url: "" }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/billing/manual-requests`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const { data, error } = await supa
      .from("manual_payment_requests")
      .select("*, destination:payment_destinations(id, method, provider_name, account_reference, account_holder, qris_object_path, instructions)")
      .eq("org_id", user.org_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Manual payment list failed", error);
      return c.json(jsonFail("Riwayat pembayaran belum dapat dimuat"), 500);
    }

    const requests = (data ?? []).map(paymentRequestDto);
    const { data: legacyRows, error: legacyError } = await supa
      .from("key_info")
      .select("value")
      .like("key", `payment_request:${user.org_id}:%`)
      .limit(100);
    if (legacyError) console.warn("Legacy manual payment history load failed", legacyError);
    const knownIds = new Set(requests.map((request: any) => request.id));
    for (const row of legacyRows ?? []) {
      const legacy = legacyPaymentRequestDto(row.value);
      if (!knownIds.has(legacy.id)) requests.push({ ...legacy, legacy_manual: true });
    }
    requests.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return c.json(jsonOk(requests));
  } catch (error) {
    console.error("Manual payment list crashed", error);
    return c.json(jsonFail("Riwayat pembayaran belum dapat dimuat"), 500);
  }
});

app.post(`${API_PREFIX}/billing/manual-requests`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const { tokens, destinationId, note } = await c.req.json();
    const requestedTokens = Number(tokens);

    if (!Number.isSafeInteger(requestedTokens) || requestedTokens <= 0) {
      return c.json(jsonFail("Jumlah token tidak valid"), 400);
    }
    if (!destinationId) {
      return c.json(jsonFail("Pilih metode pembayaran"), 400);
    }

    const supa = sb();
    const { data: destination, error: destinationError } = await supa
      .from("payment_destinations")
      .select("id, method, provider_name, account_reference, account_holder, qris_object_path, instructions")
      .eq("id", destinationId)
      .eq("active", true)
      .maybeSingle();
    if (destinationError) console.error("Payment destination validation failed", destinationError);
    if (!destination) return c.json(jsonFail("Metode pembayaran tidak tersedia"), 400);

    const price = await getCanonicalTokenPrice(supa, user.org_id);
    const referenceDate = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const amountRequested = requestedTokens * price;
    let created: any = null;
    for (let attempt = 0; attempt < PAYMENT_UNIQUE_CODE_ATTEMPTS; attempt += 1) {
      const requestId = crypto.randomUUID();
      const paymentReference = `PAY-${referenceDate}-${requestId.slice(0, 8).toUpperCase()}`;
      const requestRow = {
        id: requestId,
        org_id: user.org_id,
        requested_by: user.id,
        tokens_requested: requestedTokens,
        token_price_idr: price,
        amount_requested: amountRequested,
        unique_code: generatePaymentUniqueCode(),
        payment_method: destination.method,
        destination_account_id: destination.id,
        payment_reference: paymentReference,
        note: typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null,
        status: "draft",
      };
      const result = await supa
        .from("manual_payment_requests")
        .insert(requestRow)
        .select("*")
        .single();
      if (!result.error) {
        created = result.data;
        break;
      }
      if (result.error.code !== "23505") {
        console.error("Manual payment create failed", result.error);
        return c.json(jsonFail("Permintaan pembayaran belum dapat dibuat"), 500);
      }
    }
    if (!created) {
      return c.json(jsonFail("Kode unik pembayaran sedang penuh. Silakan coba lagi."), 409);
    }

    return c.json(jsonOk(paymentRequestDto({ ...created, destination })), 201);
  } catch (error) {
    console.error("Manual payment create crashed", error);
    return c.json(jsonFail("Permintaan pembayaran belum dapat dibuat"), 500);
  }
});

app.post(`${API_PREFIX}/billing/manual-requests/:id/proof`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const requestId = c.req.param("id");
    const form = await c.req.formData();
    const proof = form.get("proof");
    if (!(proof instanceof File) || proof.size <= 0) {
      return c.json(jsonFail("Pilih bukti pembayaran"), 400);
    }
    const extension = PAYMENT_PROOF_MIME_EXTENSIONS.get(proof.type);
    if (!extension) {
      return c.json(jsonFail("Format bukti harus JPG, PNG, WEBP, atau PDF"), 400);
    }
    if (proof.size > PAYMENT_PROOF_MAX_BYTES) {
      return c.json(jsonFail("Ukuran bukti pembayaran maksimal 5 MB"), 413);
    }

    const supa = sb();
    const { data: requestRow, error: requestError } = await supa
      .from("manual_payment_requests")
      .select("id, org_id, status, proof_object_path")
      .eq("id", requestId)
      .eq("org_id", user.org_id)
      .maybeSingle();
    if (requestError) console.error("Payment proof request lookup failed", requestError);
    if (!requestRow) return c.json(jsonFail("Permintaan pembayaran tidak ditemukan"), 404);
    if (requestRow.status !== "draft") {
      return c.json(jsonFail("Bukti pembayaran tidak dapat diubah setelah dikirim"), 409);
    }

    const objectPath = `${user.org_id}/${requestId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supa.storage
      .from(PAYMENT_PROOF_BUCKET)
      .upload(objectPath, proof, { contentType: proof.type, upsert: false });
    if (uploadError) {
      console.error("Payment proof upload failed", uploadError);
      return c.json(jsonFail("Bukti pembayaran belum dapat diunggah"), 500);
    }

    const { data: updated, error: updateError } = await supa
      .from("manual_payment_requests")
      .update({
        proof_object_path: objectPath,
        proof_mime_type: proof.type,
        proof_size_bytes: proof.size,
        proof_file_name: safePaymentProofFileName(proof.name),
        updated_at: nowIso(),
      })
      .eq("id", requestId)
      .eq("org_id", user.org_id)
      .eq("status", "draft")
      .select("*")
      .maybeSingle();
    if (updateError || !updated) {
      await supa.storage.from(PAYMENT_PROOF_BUCKET).remove([objectPath]);
      console.error("Payment proof metadata update failed", updateError);
      return c.json(jsonFail("Bukti pembayaran belum dapat disimpan"), 409);
    }
    if (requestRow.proof_object_path && requestRow.proof_object_path !== objectPath) {
      const { error: cleanupError } = await supa.storage
        .from(PAYMENT_PROOF_BUCKET)
        .remove([requestRow.proof_object_path]);
      if (cleanupError) console.warn("Old payment proof cleanup failed", cleanupError);
    }

    return c.json(jsonOk(paymentRequestDto(updated)));
  } catch (error) {
    console.error("Payment proof upload crashed", error);
    return c.json(jsonFail("Bukti pembayaran belum dapat diunggah"), 500);
  }
});

app.post(`${API_PREFIX}/billing/manual-requests/:id/submit`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const requestId = c.req.param("id");
    const supa = sb();
    const { data: requestRow, error: requestError } = await supa
      .from("manual_payment_requests")
      .select("*, destination:payment_destinations(id, method, provider_name, account_reference, account_holder, qris_object_path, instructions, active)")
      .eq("id", requestId)
      .eq("org_id", user.org_id)
      .maybeSingle();
    if (requestError) console.error("Manual payment submit lookup failed", requestError);
    if (!requestRow) return c.json(jsonFail("Permintaan pembayaran tidak ditemukan"), 404);
    if (["submitted", "approved"].includes(requestRow.status)) {
      return c.json(jsonOk(paymentRequestDto(requestRow)));
    }
    if (requestRow.status !== "draft") {
      return c.json(jsonFail("Permintaan pembayaran sudah diproses"), 409);
    }
    const destination = Array.isArray(requestRow.destination) ? requestRow.destination[0] : requestRow.destination;
    if (!destination?.active) return c.json(jsonFail("Metode pembayaran sudah tidak aktif"), 409);
    if (!requestRow.proof_object_path) return c.json(jsonFail("Bukti pembayaran wajib diunggah"), 400);

    const submittedAt = nowIso();
    const { data: submitted, error: submitError } = await supa
      .from("manual_payment_requests")
      .update({ status: "submitted", submitted_at: submittedAt, updated_at: submittedAt })
      .eq("id", requestId)
      .eq("org_id", user.org_id)
      .eq("status", "draft")
      .select("*")
      .maybeSingle();
    if (submitError || !submitted) {
      console.error("Manual payment submit failed", submitError);
      return c.json(jsonFail("Permintaan pembayaran belum dapat dikirim"), 409);
    }
    return c.json(jsonOk(paymentRequestDto({ ...submitted, destination })));
  } catch (error) {
    console.error("Manual payment submit crashed", error);
    return c.json(jsonFail("Permintaan pembayaran belum dapat dikirim"), 500);
  }
});

app.get(`${API_PREFIX}/billing/manual-requests/:id/proof`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const requestId = c.req.param("id");
    const supa = sb();
    let query = supa
      .from("manual_payment_requests")
      .select("org_id, proof_object_path, proof_mime_type")
      .eq("id", requestId);
    if (!isConfiguredSuperadmin(user)) query = query.eq("org_id", user.org_id);
    const { data: requestRow, error: requestError } = await query.maybeSingle();
    if (requestError) console.error("Payment proof access lookup failed", requestError);
    if (!requestRow?.proof_object_path) {
      let legacyQuery = supa.from("key_info").select("value");
      legacyQuery = isConfiguredSuperadmin(user)
        ? legacyQuery.like("key", `payment_request:%:${requestId}`)
        : legacyQuery.eq("key", `payment_request:${user.org_id}:${requestId}`);
      const { data: legacyRows } = await legacyQuery.limit(1);
      const decoded = decodeLegacyDataUrl(legacyRows?.[0]?.value?.receipt_url);
      if (!decoded) return c.json(jsonFail("Bukti pembayaran tidak ditemukan"), 404);
      return c.body(decoded.bytes.buffer, 200, {
        "Content-Type": decoded.mime,
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
    }

    const { data: file, error: downloadError } = await supa.storage
      .from(PAYMENT_PROOF_BUCKET)
      .download(requestRow.proof_object_path);
    if (downloadError || !file) {
      console.error("Payment proof download failed", downloadError);
      return c.json(jsonFail("Bukti pembayaran belum dapat dimuat"), 500);
    }
    return c.body(await file.arrayBuffer(), 200, {
      "Content-Type": requestRow.proof_mime_type || file.type || "application/octet-stream",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
  } catch (error) {
    console.error("Payment proof request crashed", error);
    return c.json(jsonFail("Bukti pembayaran belum dapat dimuat"), 500);
  }
});

app.get(`${API_PREFIX}/rules`, requireAuth, async (c) => {
  try {
    const supa = sb();
    const { data, error } = await supa
      .from("key_info")
      .select("value")
      .eq("key", "rules_content")
      .maybeSingle();

    if (error) return c.json(jsonFail(error.message), 500);
    return c.json(jsonOk(data?.value || null));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.put(`${API_PREFIX}/rules`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const rulesContent = await c.req.json();
    const supa = sb();

    const { error } = await supa
      .from("key_info")
      .upsert({ key: "rules_content", value: rulesContent });

    if (error) return c.json(jsonFail(error.message), 500);
    return c.json(jsonOk(rulesContent));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/superadmin/payment-settings`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const supa = sb();
    const { data, error } = await supa
      .from("key_info")
      .select("value")
      .eq("key", "payment_settings")
      .maybeSingle();

    if (error) return c.json(jsonFail(error.message), 500);
    return c.json(jsonOk(data?.value || { bank_transfer: "", gopay: "", qris_url: "" }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.put(`${API_PREFIX}/superadmin/payment-settings`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const settings = await c.req.json();
    const supa = sb();

    const { error } = await supa
      .from("key_info")
      .upsert({ key: "payment_settings", value: settings });

    if (error) return c.json(jsonFail(error.message), 500);
    return c.json(jsonOk(settings));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/superadmin/manual-requests`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const supa = sb();
    const statusFilter = String(c.req.query("status") || "submitted").toLowerCase();
    if (!["draft", "submitted", "approved", "rejected", "all"].includes(statusFilter)) {
      return c.json(jsonFail("Filter status pembayaran tidak valid"), 400);
    }
    let requestQuery = supa
      .from("manual_payment_requests")
      .select("*, destination:payment_destinations(id, method, provider_name, account_reference, account_holder, qris_object_path, instructions), organization:orgs!org_id(name), requester:app_users!requested_by(email)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (statusFilter !== "all") requestQuery = requestQuery.eq("status", statusFilter);
    const { data, error } = await requestQuery;
    if (error) {
      console.error("Manual payment review queue failed", error);
      return c.json(jsonFail("Antrean verifikasi belum dapat dimuat"), 500);
    }

    const manualRequests = (data ?? []).map(paymentRequestDto);

    const { data: legacyManualData, error: legacyManualError } = await supa
      .from("key_info")
      .select("value")
      .like("key", "payment_request:%")
      .limit(100);
    if (legacyManualError) console.warn("Legacy manual payment queue load failed", legacyManualError);
    const knownManualIds = new Set(manualRequests.map((request: any) => request.id));
    for (const row of legacyManualData ?? []) {
      const legacy = legacyPaymentRequestDto(row.value);
      if (!knownManualIds.has(legacy.id) && (statusFilter === "all" || legacy.status === statusFilter)) {
        manualRequests.push({ ...legacy, legacy_manual: true });
      }
    }

    // Historical gateway records remain visible for compatibility, but they
    // are never part of the primary direct-payment approval path.
    const { data: midtransData, error: midtransError } = await supa
      .from("key_info")
      .select("key, value")
      .like("key", "midtrans_tx:%")
      .limit(100);
    if (midtransError) console.warn("Legacy gateway history load failed", midtransError);
    const { data: orgs } = await supa.from("orgs").select("id, name");
    const orgMap = new Map((orgs ?? []).map((org: any) => [org.id, org.name]));
    const gatewayHistory = (midtransData ?? []).map((row: any) => {
      const value = row.value ?? {};
      return {
        id: value.id,
        org_name: orgMap.get(value.org_id) || "Organisasi Tidak Dikenal",
        created_by_email: value.user_email,
        amount_tokens: Number(value.amount_tokens || 0),
        amount_idr: Number(value.amount_idr || 0),
        payment_method: "Gateway (Legacy)",
        payment_reference: value.order_id || value.id,
        proof_available: false,
        status: ["success", "settlement", "capture"].includes(value.status)
          ? "approved"
          : ["failed", "expire", "cancel", "deny"].includes(value.status)
            ? "rejected"
            : "submitted",
        status_label: ["success", "settlement", "capture"].includes(value.status)
          ? "Disetujui"
          : ["failed", "expire", "cancel", "deny"].includes(value.status)
            ? "Ditolak"
            : "Menunggu Verifikasi",
        created_at: value.created_at,
        reviewed_at: value.updated_at || value.created_at,
        reviewed_by: "Sistem gateway legacy",
        legacy_gateway: true,
      };
    }).filter((request: any) => statusFilter === "all" || request.status === statusFilter);

    const allPurchases = [...manualRequests, ...gatewayHistory];
    allPurchases.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return c.json(jsonOk(allPurchases));
  } catch (error) {
    console.error("Manual payment review queue crashed", error);
    return c.json(jsonFail("Antrean verifikasi belum dapat dimuat"), 500);
  }
});

app.post(`${API_PREFIX}/superadmin/manual-requests/:id/approve`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const requestId = c.req.param("id");
    const supa = sb();
    const { data: requestRow, error: requestError } = await supa
      .from("manual_payment_requests")
      .select("id, org_id, status")
      .eq("id", requestId)
      .maybeSingle();
    if (requestError) {
      console.error("Manual payment approval lookup failed", requestError);
      return c.json(jsonFail("Permintaan pembayaran belum dapat diperiksa"), 500);
    }
    let key = requestRow ? `payment_request:${requestRow.org_id}:${requestRow.id}` : "";
    if (!key) {
      const { data: legacyRows, error: legacyError } = await supa
        .from("key_info")
        .select("key")
        .like("key", `payment_request:%:${requestId}`)
        .limit(1);
      if (legacyError) console.error("Legacy manual payment approval lookup failed", legacyError);
      key = legacyRows?.[0]?.key || "";
    }
    if (!key) return c.json(jsonFail("Permintaan pembayaran tidak ditemukan"), 404);

    const adminUser = c.get("authUser");
    const { data: approvalResult, error: approvalErr } = await supa.rpc(
      "approve_manual_payment_with_billing",
      {
        p_request_key: key,
        p_actor_user_id: adminUser.id,
        p_actor_email: adminUser.email,
      },
    );

    if (approvalErr) {
      console.error("Manual payment approval failed", approvalErr);
      const friendly = String(approvalErr.message || "").includes("belum siap")
        ? "Permintaan pembayaran belum siap disetujui"
        : "Permintaan pembayaran belum dapat disetujui";
      return c.json(jsonFail(friendly), 409);
    }

    return c.json(jsonOk({
      ...(approvalResult?.request ?? {}),
      billing: approvalResult?.billing ?? null,
      duplicate: Boolean(approvalResult?.duplicate),
    }));
  } catch (error) {
    console.error("Manual payment approval crashed", error);
    return c.json(jsonFail("Permintaan pembayaran belum dapat disetujui"), 500);
  }
});

app.post(`${API_PREFIX}/superadmin/manual-requests/:id/reject`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const requestId = c.req.param("id");
    const body = await c.req.json();
    const reason = String(body.reason ?? body.notes ?? "").trim();
    if (reason.length < 3 || reason.length > 500) {
      return c.json(jsonFail("Alasan penolakan wajib diisi (3-500 karakter)"), 400);
    }
    const adminUser = c.get("authUser");
    const supa = sb();
    const reviewedAt = nowIso();
    const { data: rejected, error: rejectError } = await supa
      .from("manual_payment_requests")
      .update({
        status: "rejected",
        rejection_reason: reason,
        reviewed_at: reviewedAt,
        reviewed_by: adminUser.id,
        updated_at: reviewedAt,
      })
      .eq("id", requestId)
      .eq("status", "submitted")
      .select("*")
      .maybeSingle();
    if (rejectError) {
      console.error("Manual payment rejection failed", rejectError);
      return c.json(jsonFail("Permintaan pembayaran belum dapat ditolak"), 500);
    }
    if (!rejected) {
      const { data: existing } = await supa
        .from("manual_payment_requests")
        .select("status")
        .eq("id", requestId)
        .maybeSingle();
      if (!existing) {
        const { data: legacyRows, error: legacyLookupError } = await supa
          .from("key_info")
          .select("key, value")
          .like("key", `payment_request:%:${requestId}`)
          .limit(1);
        if (legacyLookupError) console.error("Legacy manual payment rejection lookup failed", legacyLookupError);
        const legacyRow = legacyRows?.[0];
        if (!legacyRow) return c.json(jsonFail("Permintaan pembayaran tidak ditemukan"), 404);
        if (legacyRow.value?.status !== "pending") {
          return c.json(jsonFail("Permintaan pembayaran ini sudah diproses sebelumnya"), 409);
        }
        const legacyValue = {
          ...legacyRow.value,
          status: "rejected",
          approved_at: reviewedAt,
          approved_by: adminUser.email,
          notes: reason,
        };
        const { error: legacySaveError } = await supa
          .from("key_info")
          .update({ value: legacyValue })
          .eq("key", legacyRow.key);
        if (legacySaveError) {
          console.error("Legacy manual payment rejection failed", legacySaveError);
          return c.json(jsonFail("Permintaan pembayaran belum dapat ditolak"), 500);
        }
        return c.json(jsonOk({ ...legacyPaymentRequestDto(legacyValue), legacy_manual: true }));
      }
      return c.json(jsonFail("Permintaan pembayaran ini sudah diproses sebelumnya"), 409);
    }

    return c.json(jsonOk(paymentRequestDto(rejected)));
  } catch (error) {
    console.error("Manual payment rejection crashed", error);
    return c.json(jsonFail("Permintaan pembayaran belum dapat ditolak"), 500);
  }
});

app.delete(`${API_PREFIX}/superadmin/manual-requests/:id`, requireAuth, requireSuperadmin, async (c) => {
  return c.json(jsonFail("Riwayat pembayaran dipertahankan sebagai audit trail dan tidak dapat dihapus"), 405);
});

// ===== 404 fallback =====
app.notFound((c) => {
  return c.json(
    jsonFail(`Route not found: ${c.req.method} ${new URL(c.req.url).pathname}`),
    404,
  );
});

app.onError((err, _c) => {
  console.error("SERVER ERROR:", err);
  return new Response(JSON.stringify(jsonFail(err)), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
});

// ===== Supabase path rewrite =====
Deno.serve((req) => {
  const url = new URL(req.url);
  let pathname = url.pathname;

  if (pathname.startsWith("/functions/v1/server")) {
    pathname = pathname.replace(/^\/functions\/v1\/server/, "") || "/";
  } else if (pathname.startsWith("/server")) {
    pathname = pathname.replace(/^\/server/, "") || "/";
  }

  const rewrittenUrl = new URL(req.url);
  rewrittenUrl.pathname = pathname;

  return app.fetch(new Request(rewrittenUrl.toString(), req));
});
