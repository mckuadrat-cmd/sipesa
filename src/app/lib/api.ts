import {
  apiFetch,
  apiFetchBlob,
  setAuthToken,
  getAuthToken,
  clearAuthToken,
  isApiFail,
} from "./apiClient";
import { supabase } from "./supabaseClient";

const API_PREFIX = "";

export type AppResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ListPageOptions = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  label?: string;
  numberId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type PaymentDestination = {
  id: string;
  method: "bank_transfer" | "qris_static";
  provider_name: string;
  account_reference: string | null;
  account_holder: string | null;
  instructions: string | null;
  has_qris: boolean;
};

export type ManualPaymentRequest = {
  id: string;
  org_id?: string;
  org_name?: string | null;
  amount_tokens: number;
  amount_idr: number;
  base_amount: number;
  unique_code: number | null;
  transfer_amount: number;
  token_price_idr: number;
  payment_method: "bank_transfer" | "qris_static" | string;
  payment_reference: string;
  destination: PaymentDestination | null;
  proof_available: boolean;
  proof_mime_type: string | null;
  proof_size_bytes: number | null;
  proof_file_name: string | null;
  note: string | null;
  status: "draft" | "submitted" | "approved" | "rejected";
  status_label: string;
  rejection_reason: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  billing_ledger_id: string | null;
  created_at: string;
  updated_at: string;
  created_by_email?: string | null;
  legacy_gateway?: boolean;
};

export type NumberItem = {
  id: string;
  name: string;
  number: string;
  status: string;
  unreadCount?: number;
  lastActivity?: string;
  businessId?: string | null;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  hasAccessToken?: boolean;
};

export type ContactItem = {
  id: string;
  name: string;
  phone: string;
  lastMessage: string;
  timestamp: string;
  unread: boolean;
};

export type ContactImportPreflightInput = {
  rowId: string | number;
  phone: string;
};

export type ContactImportPreflightRow = {
  rowId: string | number;
  normalizedPhone: string;
  valid: boolean;
  invalidReason: string | null;
  duplicateWithinImport: boolean;
  existingOrganizationDuplicate: boolean;
  existingContactId: string | null;
};

export type ContactImportPreflightResult = {
  results: ContactImportPreflightRow[];
  summary: {
    total: number;
    validNew: number;
    invalid: number;
    duplicateWithinImport: number;
    existingOrganizationDuplicate: number;
  };
};

export type MessageItem = {
  id: string;
  content: string;
  sender: "user" | "contact";
  timestamp: string;
  status?: string;
  messageType?: string;
  payload?: any;
};

export type MessageCursor = {
  createdAt: string;
  id: string;
};

export type MessagePage = {
  messages: MessageItem[];
  hasMore: boolean;
  olderCursor: MessageCursor | null;
  latestCursor: MessageCursor | null;
};

export type TemplateItem = {
  id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  components?: any;
  metaTemplateId?: string | null;
  content: string;
  variables: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type BroadcastRecipientInput = {
  contactId?: string | null;
  name: string;
  phone: string;
  vars?: Record<string, string>;
  mediaUrl?: string;
  fileName?: string;
  rowNumber?: number;
};

export type BroadcastHistoryItem = {
  id: string;
  title: string;
  status: string;
  totalRecipients: number;
  totalSent: number;
  totalFailed: number;
  createdAt: string;
  scheduledAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  mode?: string;
  templateId?: string | null;
  numberId?: string;
  numberName?: string;
  message?: string;
};

export type DashboardBroadcastItem = Pick<
  BroadcastHistoryItem,
  "id" | "title" | "status" | "totalRecipients" | "createdAt" | "scheduledAt"
>;

export type DashboardBroadcastSummary = {
  totalRecipients: number;
  recent: DashboardBroadcastItem[];
};

export type SendMessageResult =
  | {
      success: true;
      data: MessageItem & {
        outcome?: "accepted" | "accepted_reconciliation_required" | "processing";
        reconciliationRequired?: boolean;
      };
      tokensRemaining: number;
    }
  | { success: false; error: string; code?: string; retryable?: boolean };

function ok<T>(data: T): AppResult<T> {
  return { success: true, data };
}

function fail<T = never>(error: string): AppResult<T> {
  return { success: false, error };
}

function listQuery(options: ListPageOptions = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function extractTemplateContent(components: any): string {
  if (!components) return "";
  if (typeof components === "string") return components;

  if (Array.isArray(components)) {
    const body = components.find((x) => String(x?.type ?? "").toUpperCase() === "BODY");
    if (body?.text) return String(body.text);
  }

  if (typeof components === "object") {
    if (typeof components.text === "string") return components.text;
    try {
      return JSON.stringify(components);
    } catch {
      return "";
    }
  }

  return "";
}

function extractTemplateVariablesFromContent(content: string): string[] {
  const regex = /\{\{(\d+)\}\}/g;
  const matches = content.match(regex) || [];
  return [...new Set(matches)].sort();
}

export const api = {
  async login(identifier: string, password: string) {
    const res = await apiFetch<any>(`${API_PREFIX}/auth/login`, {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    });

    if (isApiFail(res)) return fail(res.error);

    if (res.data?.token) {
      setAuthToken(res.data.token);
      await supabase.realtime.setAuth(res.data.token);
    }

    return ok(res.data);
  },

  async signup(email: string, password: string, name: string, orgName: string, username: string, waNumber: string) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            org_name: orgName,
            username,
            wa_number: waNumber,
          },
        },
      });

      if (error) {
        return fail(error.message);
      }

      if (data?.session?.access_token) {
        setAuthToken(data.session.access_token);
      }

      return ok(data);
    } catch (e: any) {
      return fail(e?.message || "Gagal melakukan pendaftaran.");
    }
  },

  async requestPasswordReset(email: string): Promise<AppResult<{ requested: true }>> {
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}?recovery=1`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) return fail(error.message);
      return ok({ requested: true as const });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Permintaan pemulihan belum dapat diproses.");
    }
  },

  async checkSession(): Promise<AppResult<any>> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        setAuthToken(session.access_token);
      }
    } catch (e) {
      console.warn("Failed to sync supabase session:", e);
    }

    const token = getAuthToken();
    if (!token) return fail("NO_TOKEN");
    await supabase.realtime.setAuth(token);

    const res = await apiFetch<any>(`${API_PREFIX}/auth/session`, { method: "GET" });
    if (isApiFail(res)) {
      clearAuthToken();
      try {
        await supabase.auth.signOut();
      } catch {}
      return fail(res.error);
    }

    return ok(res.data);
  },

  async logout(): Promise<AppResult<any>> {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("Failed to sign out from Supabase:", e);
    }
    clearAuthToken();
    return ok(true);
  },

  async init(): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/init`, { method: "POST" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getStats(): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/stats`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getDashboardActivity() {
    const res = await apiFetch<any>(`${API_PREFIX}/dashboard/activity`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getUsage7d() {
    const now = new Date();
    const endDate = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const params = new URLSearchParams({ endDate, timeZone });
    const res = await apiFetch<any>(`${API_PREFIX}/dashboard/usage-7d?${params.toString()}`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getDashboardBroadcastSummary(rangeStart?: string | null): Promise<AppResult<DashboardBroadcastSummary>> {
    const params = new URLSearchParams();
    if (rangeStart) params.set("rangeStart", rangeStart);
    const query = params.toString();
    const res = await apiFetch<any>(
      `${API_PREFIX}/dashboard/broadcast-summary${query ? `?${query}` : ""}`,
      { method: "GET" },
    );
    if (isApiFail(res)) return fail(res.error);
    return ok({
      totalRecipients: Number(res.data?.totalRecipients ?? 0),
      recent: Array.isArray(res.data?.recent) ? res.data.recent : [],
    });
  },

  async getDashboardBroadcastCalendar(
    from: string,
    to: string,
  ): Promise<AppResult<DashboardBroadcastItem[]>> {
    const params = new URLSearchParams({ from, to });
    const res = await apiFetch<any>(
      `${API_PREFIX}/dashboard/broadcast-calendar?${params.toString()}`,
      { method: "GET" },
    );
    if (isApiFail(res)) return fail(res.error);
    return ok(Array.isArray(res.data) ? res.data : []);
  },

  async getNumbers(): Promise<AppResult<NumberItem[]>> {
    const res = await apiFetch<any>(`${API_PREFIX}/numbers`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async addNumber(payload: {
    name: string;
    number: string;
    businessId?: string;
    wabaId?: string;
    phoneNumberId?: string;
    accessToken?: string;
  }) {
    const res = await apiFetch<any>(`${API_PREFIX}/numbers`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async validateNumbers(numberId: string, phones: string[]): Promise<AppResult<{
    checkedWithMeta: boolean;
    metaError?: string | null;
    results: Array<{
      input: string;
      normalized: string;
      formatValid: boolean;
      formatReason?: string;
      waExists: boolean | null;
      waStatus: string;
    }>;
  }>> {
    const res = await apiFetch<any>(`${API_PREFIX}/numbers/validate`, {
      method: "POST",
      body: JSON.stringify({ numberId, phones }),
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getSettings() {
    const res = await apiFetch<any>(`${API_PREFIX}/settings`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async updateProfile(payload: { fullName: string; username: string; email: string; avatar?: string | null; waNumber?: string }) {
    const res = await apiFetch<any>(`${API_PREFIX}/settings/profile`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async updateOrgSettings(payload: { name: string; supportEmail: string; address?: string }) {
    const res = await apiFetch<any>(`${API_PREFIX}/settings/org`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getContactLabels(): Promise<AppResult<Record<string, string>>> {
    const res = await apiFetch<any>(`${API_PREFIX}/settings/contact-labels`, {
      method: "GET",
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data || {});
  },

  async updateContactLabels(labels: Record<string, string>): Promise<AppResult<Record<string, string>>> {
    const res = await apiFetch<any>(`${API_PREFIX}/settings/contact-labels`, {
      method: "PUT",
      body: JSON.stringify({ labels }),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data || {});
  },

  async updateMessagingSettings(payload: {
    numberId?: string;
    autoReplyEnabled: boolean;
    autoReplyMessage: string;
    fallbackTemplateName?: string;
    sendDelayMs: number;
    throttlePerMin: number;
  }) {
    const res = await apiFetch<any>(`${API_PREFIX}/settings/messaging`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async changePassword(payload: { currentPassword: string; newPassword: string }) {
    const res = await apiFetch<any>(`${API_PREFIX}/settings/password`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getContacts(numberId: string): Promise<AppResult<ContactItem[]>> {
    const res = await apiFetch<any>(`${API_PREFIX}/numbers/${numberId}/contacts`, {
      method: "GET",
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async getMediaObjectUrl(mediaId: string, numberId: string): Promise<AppResult<string>> {
    const res = await apiFetchBlob(
      `${API_PREFIX}/media/${encodeURIComponent(mediaId)}?numberId=${encodeURIComponent(numberId)}`,
    );
    if (isApiFail(res)) return fail(res.error);
    return ok(URL.createObjectURL(res.data));
  },

  async getMessages(
    numberId: string,
    contactId: string,
    options: {
      before?: MessageCursor;
      after?: MessageCursor;
      limit?: number;
    } = {},
  ): Promise<AppResult<MessagePage>> {
    const params = new URLSearchParams();
    params.set("limit", String(options.limit ?? 50));
    if (options.before) {
      params.set("beforeCreatedAt", options.before.createdAt);
      params.set("beforeId", options.before.id);
    }
    if (options.after) {
      params.set("afterCreatedAt", options.after.createdAt);
      params.set("afterId", options.after.id);
    }
    const res = await apiFetch<any>(
      `${API_PREFIX}/numbers/${numberId}/contacts/${contactId}/messages?${params.toString()}`,
      { method: "GET" },
    );

    if (isApiFail(res)) return fail(res.error);
    const parsed = (res.data?.messages ?? []).map((msg: any) => {
      let payload = msg.payload;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {}
      }
      return { ...msg, payload };
    });
    return ok({
      messages: parsed,
      hasMore: res.data?.hasMore === true,
      olderCursor: res.data?.olderCursor ?? null,
      latestCursor: res.data?.latestCursor ?? null,
    });
  },

  async markConversationRead(
    numberId: string,
    contactId: string,
  ): Promise<AppResult<{ message: string; updatedCount: number }>> {
    const res = await apiFetch<any>(
      `${API_PREFIX}/numbers/${numberId}/contacts/${contactId}/read`,
      { method: "POST" },
    );
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getMessageStatuses(
    numberId: string,
    contactId: string,
    messageIds: string[],
  ): Promise<AppResult<Array<{ id: string; status: string }>>> {
    if (messageIds.length === 0) return ok([]);
    const params = new URLSearchParams({ ids: messageIds.slice(-50).join(",") });
    const res = await apiFetch<any>(
      `${API_PREFIX}/numbers/${numberId}/contacts/${contactId}/message-statuses?${params.toString()}`,
      { method: "GET" },
    );
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async readAllMessages(numberId: string, contactIds?: string[]): Promise<AppResult<{ message: string }>> {
    const res = await apiFetch<any>(
      `/numbers/${numberId}/read-all`,
      { 
        method: "POST",
        body: JSON.stringify({ contactIds })
      },
    );
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async deleteConversations(numberId: string, payload: { contactIds?: string[]; all?: boolean }): Promise<AppResult<{ message: string }>> {
    const res = await apiFetch<any>(
      `/numbers/${numberId}/delete-conversations`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async sendMessage(
    numberId: string,
    contactId: string,
    contentOrPayload: string | {
      content?: string;
      messageType?: string;
      templateName?: string;
      language?: string;
      bodyVariables?: string[];
      header?: any;
    },
    idempotencyKey?: string,
  ): Promise<SendMessageResult> {
    const contentPayload = typeof contentOrPayload === "string"
      ? { content: contentOrPayload } 
      : contentOrPayload;
    const bodyPayload = {
      ...contentPayload,
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
    };

    const res = await apiFetch<any>(
      `${API_PREFIX}/numbers/${numberId}/contacts/${contactId}/messages`,
      {
        method: "POST",
        body: JSON.stringify(bodyPayload),
      },
    );

    if (isApiFail(res)) {
      return {
        success: false,
        error: res.error,
        code: res.code,
        retryable: res.retryable,
      };
    }

    return {
      success: true,
      data: res.data,
      tokensRemaining: Number(
        res.data?.tokensRemaining ??
          res.data?.tokens_remaining ??
          0,
      ),
    };
  },

  async getBroadcastRecipients(broadcastId: string, options: ListPageOptions = {}): Promise<AppResult<PageResult<any>>> {
    const res = await apiFetch<any>(`${API_PREFIX}/broadcasts/${broadcastId}/recipients${listQuery(options)}`, {
      method: "GET",
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getBroadcastStats(broadcastId: string): Promise<AppResult<any>> {
    const t = new Date().getTime();
    const res = await apiFetch<any>(`${API_PREFIX}/broadcasts/${broadcastId}/stats?t=${t}`, {
      method: "GET",
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async cancelBroadcast(broadcastId: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/broadcasts/${broadcastId}/cancel`, {
      method: "POST",
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async cancelScheduledBroadcast(broadcastId: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/broadcasts/${broadcastId}/cancel-schedule`, {
      method: "POST",
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getBilling(): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/billing`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getTransactions(): Promise<AppResult<any[]>> {
    const res = await apiFetch<any>(`${API_PREFIX}/billing/transactions`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async topUp(tokens: number): Promise<AppResult<any>> {
    void tokens;
    return fail("Top-up saldo langsung tidak tersedia. Buat permintaan pembayaran terlebih dahulu.");
  },

  async createMidtransPayment(amount: number, tokens: number): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/billing/midtrans/create`, {
      method: "POST",
      body: JSON.stringify({ amount, tokens }),
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getPaymentSettings(): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/billing/payment-settings`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getPaymentDestinations(): Promise<AppResult<PaymentDestination[]>> {
    const res = await apiFetch<PaymentDestination[]>(`${API_PREFIX}/billing/payment-destinations`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async getPaymentDestinationQrisObjectUrl(destinationId: string): Promise<AppResult<string>> {
    const res = await apiFetchBlob(`${API_PREFIX}/billing/payment-destinations/${destinationId}/qris`);
    if (isApiFail(res)) return fail(res.error);
    return ok(URL.createObjectURL(res.data));
  },

  async getManualRequests(): Promise<AppResult<ManualPaymentRequest[]>> {
    const res = await apiFetch<ManualPaymentRequest[]>(`${API_PREFIX}/billing/manual-requests`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async createManualRequest(tokens: number, destinationId: string, note?: string): Promise<AppResult<ManualPaymentRequest>> {
    const res = await apiFetch<ManualPaymentRequest>(`${API_PREFIX}/billing/manual-requests`, {
      method: "POST",
      body: JSON.stringify({ tokens, destinationId, note }),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async uploadManualPaymentProof(id: string, proof: File): Promise<AppResult<ManualPaymentRequest>> {
    const body = new FormData();
    body.append("proof", proof);
    const res = await apiFetch<ManualPaymentRequest>(`${API_PREFIX}/billing/manual-requests/${id}/proof`, {
      method: "POST",
      body,
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async submitManualPayment(id: string): Promise<AppResult<ManualPaymentRequest>> {
    const res = await apiFetch<ManualPaymentRequest>(`${API_PREFIX}/billing/manual-requests/${id}/submit`, {
      method: "POST",
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getManualPaymentProofObjectUrl(id: string): Promise<AppResult<string>> {
    const res = await apiFetchBlob(`${API_PREFIX}/billing/manual-requests/${id}/proof`);
    if (isApiFail(res)) return fail(res.error);
    return ok(URL.createObjectURL(res.data));
  },

  async getSuperadminPaymentSettings(): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/payment-settings`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async updateSuperadminPaymentSettings(settings: any): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/payment-settings`, {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getSuperadminManualRequests(status = "submitted"): Promise<AppResult<any[]>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/manual-requests?status=${encodeURIComponent(status)}`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async approveManualRequest(id: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/manual-requests/${id}/approve`, {
      method: "POST",
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async rejectManualRequest(id: string, notes: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/manual-requests/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async deleteSuperadminManualRequest(id: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/manual-requests/${id}`, {
      method: "DELETE",
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getSuperadminOrgStats(orgId: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/orgs/${orgId}/stats`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getRules(): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/rules`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async updateRules(rules: any): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/rules`, {
      method: "PUT",
      body: JSON.stringify(rules),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getBroadcastHistory(options: ListPageOptions = {}): Promise<AppResult<PageResult<BroadcastHistoryItem> & { senderOptions?: Array<{ id: string; name: string }> }>> {
    const res = await apiFetch<any>(`${API_PREFIX}/broadcasts${listQuery(options)}`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getBroadcastDetail(broadcastId: string, options: ListPageOptions = {}): Promise<AppResult<any>> {
    const t = new Date().getTime();
    const statsRes = await apiFetch<any>(`${API_PREFIX}/broadcasts/${broadcastId}/stats?t=${t}`, { method: "GET" });
    if (isApiFail(statsRes)) return fail(statsRes.error);

    const recipientsRes = await apiFetch<any>(
      `${API_PREFIX}/broadcasts/${broadcastId}/recipients${listQuery(options)}`,
      { method: "GET" },
    );
    if (isApiFail(recipientsRes)) return fail(recipientsRes.error);

    const broadcast = statsRes.data;
    const recipients = (recipientsRes.data?.items ?? []).map((r: any) => ({
      id: r.id,
      contactName: r.recipient_name ?? "Tanpa Nama",
      contactPhone: r.phone_e164 ?? "-",
      status: r.status || "pending",
      timestamp: r.sent_at ?? r.updated_at ?? r.created_at ?? "-",
      errorMessage: r.error ?? undefined,
    }));

    const senderNumber = broadcast.senderNumber || "";
    const senderName = broadcast.senderName || "";
    const numberName = senderName ? `${senderNumber} — ${senderName}` : senderNumber || "Nomor WA";

    return ok({
      id: broadcast.id,
      numberId: broadcast.numberId,
      numberName,
      message: broadcast.textBody ?? "",
      totalRecipients: broadcast.totalRecipients ?? recipients.length,
      sent: broadcast.totalSent ?? broadcast.sent ?? 0,
      delivered: broadcast.delivered ?? 0,
      read: broadcast.read ?? 0,
      failed: broadcast.failed ?? broadcast.totalFailed ?? 0,
      createdAt: broadcast.startedAt || broadcast.finishedAt || "-",
      status: broadcast.status ?? "queued",
      startedAt: broadcast.startedAt ?? null,
      finishedAt: broadcast.finishedAt ?? null,
      recipients,
      recipientPage: {
        total: recipientsRes.data?.total ?? 0,
        page: recipientsRes.data?.page ?? 1,
        pageSize: recipientsRes.data?.pageSize ?? 50,
        totalPages: recipientsRes.data?.totalPages ?? 1,
      },
    });
  },

  async syncTemplatesDefault() {
    const res = await apiFetch<any>(`${API_PREFIX}/templates/sync-default`, {
      method: "POST",
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async uploadTemplateSample(file: File): Promise<AppResult<{ handle: string; fileName: string }>> {
    const formData = new FormData();
    formData.append("file", file);

    const res = await apiFetch<any>(`${API_PREFIX}/templates/upload-sample`, {
      method: "POST",
      body: formData,
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async pushTemplateToMeta(templateId: string) {
    const res = await apiFetch<any>(`${API_PREFIX}/templates/${templateId}/push-meta`, {
      method: "POST",
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async getBroadcastTemplates(): Promise<AppResult<TemplateItem[]>> {
    const res = await apiFetch<any>(`${API_PREFIX}/templates`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);

    const mapped: TemplateItem[] = (res.data ?? []).map((t: any) => {
      const content = extractTemplateContent(t.components);

      return {
        id: String(t.id),
        name: String(t.name ?? ""),
        category: String(t.category ?? "marketing"),
        language: String(t.language ?? "id"),
        status: String(t.status ?? "unknown").toLowerCase(),
        components: t.components ?? null,
        metaTemplateId: t.metaTemplateId ?? t.meta_template_id ?? null,
        content,
        variables: t.variables ?? extractTemplateVariablesFromContent(content),
        createdAt: t.createdAt ?? t.created_at ?? new Date().toISOString(),
        updatedAt: t.updatedAt ?? t.updated_at ?? t.createdAt ?? t.created_at ?? new Date().toISOString(),
      };
    });

    return ok(mapped);
  },

  async saveBroadcastTemplate(payload: {
    name: string;
    category: string;
    language: string;
    content: string;
    variables?: string[];
  }): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/templates`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async updateBroadcastTemplate(
    id: string,
    payload: {
      name: string;
      category: string;
      language: string;
      content: string;
      variables?: string[];
    },
  ): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async deleteBroadcastTemplate(id: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/templates/${id}`, {
      method: "DELETE",
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async sendBroadcastWithTemplate(payload: {
    numberId: string;
    templateId: string;
    contacts: Array<{
      name: string;
      phone: string;
      variables?: string[];
      mediaUrl?: string;
      fileName?: string;
      rowNumber?: number;
    }>;
    scheduled?: string | null;
  }): Promise<AppResult<any>> {
    const templateRes = await this.getBroadcastTemplates();
    if (!templateRes.success) return fail(templateRes.error);

    const template = templateRes.data.find((t) => t.id === payload.templateId);
    if (!template) return fail("Template tidak ditemukan");

    const recipients: BroadcastRecipientInput[] = payload.contacts.map((c) => {
      const vars: Record<string, string> = { name: c.name };

      (c.variables ?? []).forEach((val, idx) => {
        vars[`var${idx + 1}`] = val;
      });

      return {
        name: c.name,
        phone: c.phone,
        vars,
        mediaUrl: c.mediaUrl || "",
        fileName: c.fileName || "",
        rowNumber: c.rowNumber,
      };
    });

    const res = await apiFetch<any>(`${API_PREFIX}/broadcasts`, {
      method: "POST",
      body: JSON.stringify({
        title: template.name,
        numberId: payload.numberId,
        mode: "template",
        templateId: payload.templateId,
        templateVariables: null,
        recipients,
        scheduledAt: payload.scheduled || null,
      }),
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async sendBroadcastText(payload: {
    title: string;
    numberId: string;
    message: string;
    recipients: BroadcastRecipientInput[];
    scheduledAt?: string | null;
  }): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/broadcasts`, {
      method: "POST",
      body: JSON.stringify({
        title: payload.title,
        numberId: payload.numberId,
        message: payload.message,
        mode: "text",
        recipients: payload.recipients,
        scheduledAt: payload.scheduledAt || null,
      }),
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async processBroadcasts(limit?: number): Promise<AppResult<any>> {
    const url = limit ? `${API_PREFIX}/jobs/process-broadcasts?limit=${limit}` : `${API_PREFIX}/jobs/process-broadcasts`;
    const res = await apiFetch<any>(url, {
      method: "POST",
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async deleteBroadcasts(payload: { ids?: string[]; all?: boolean }): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/broadcasts/delete`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async importFromGoogleSheet(
    sheetUrl: string,
    sheetName?: string,
  ): Promise<
    AppResult<
      Array<{
        name: string;
        phone: string;
        variables?: string[];
        mediaUrl?: string;
        fileName?: string;
        rowNumber?: number;
      }>
    >
  > {
    try {
      const normalized = String(sheetUrl ?? "").trim();
      if (!normalized) return fail("URL Google Sheet wajib diisi");

      const match = normalized.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!match) return fail("URL Google Sheet tidak valid");

      let csvUrl = "";
      const trimmedSheetName = String(sheetName ?? "").trim();
      if (trimmedSheetName) {
        csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(trimmedSheetName)}`;
      } else {
        const gidMatch = normalized.match(/[?&]gid=([0-9]+)/);
        const gid = gidMatch?.[1] || "0";
        csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
      }

      const res = await fetch(csvUrl);
      if (!res.ok) return fail("Gagal mengambil data Google Sheet");

      const text = await res.text();
      const lines = text
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "");

      if (lines.length < 2) return fail("Data Google Sheet kosong");

      const parseCsvLine = (line: string): string[] => {
        const out: string[] = [];
        let current = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i += 1) {
          const ch = line[i];
          const next = line[i + 1];

          if (ch === '"') {
            if (inQuotes && next === '"') {
              current += '"';
              i += 1;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (ch === "," && !inQuotes) {
            out.push(current.trim());
            current = "";
          } else {
            current += ch;
          }
        }

        out.push(current.trim());
        return out.map((v) => v.replace(/^"(.*)"$/, "$1").trim());
      };

      const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());

      const findIndex = (...names: string[]) =>
        headers.findIndex((h) => names.includes(h));

      const phoneIndex = findIndex("nomor", "phone", "nomor telepon", "telepon", "no hp", "nohp");
      const nameIndex = findIndex("contactname");
      const mediaIndex = findIndex("follow_media", "media", "mediaurl", "media_url");
      const fileNameIndex = findIndex("filename", "file_name", "namafile", "nama_file");

      if (phoneIndex === -1) {
        return fail("Kolom nomor tidak ditemukan. Gunakan header 'Nomor'");
      }

      const normalizePhone = (value: string) => {
        let phone = String(value || "").trim();

        if (!phone) return "";
        phone = phone.replace(/[^\d+]/g, "");

        if (phone.startsWith("+")) phone = phone.slice(1);
        if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
        if (phone.startsWith("8")) phone = `62${phone}`;

        return phone;
      };

      const varIndexes = headers
        .map((header, idx) => {
          const m = header.match(/^var(\d+)$/i);
          return m ? { idx, order: Number(m[1]) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (a!.order - b!.order)) as Array<{ idx: number; order: number }>;

      const contacts: Array<{
        name: string;
        phone: string;
        variables?: string[];
        mediaUrl?: string;
        fileName?: string;
        rowNumber?: number;
      }> = [];

      for (let i = 1; i < lines.length; i += 1) {
        const row = parseCsvLine(lines[i]);
        const rawPhone = row[phoneIndex] || "";
        const phone = normalizePhone(rawPhone);

        const name =
          (nameIndex >= 0 ? row[nameIndex] : "")?.trim() ||
          phone ||
          `Baris ${i + 1}`;

        const variables = varIndexes.map(({ idx }) => (row[idx] || "").trim());
        const mediaUrl = mediaIndex >= 0 ? (row[mediaIndex] || "").trim() : "";
        const fileName = fileNameIndex >= 0 ? (row[fileNameIndex] || "").trim() : "";

        contacts.push({
          name,
          phone,
          variables,
          mediaUrl: mediaUrl || undefined,
          fileName: fileName || undefined,
          rowNumber: i + 1,
        });
      }

      if (contacts.length === 0) {
        return fail("Tidak ada data valid yang bisa diimport dari Google Sheet");
      }

      return ok(contacts);
    } catch (error: any) {
      return fail(error?.message || "Gagal import Google Sheet");
    }
  },

  async getOrgContacts(options: ListPageOptions = {}): Promise<AppResult<PageResult<any>>> {
    const res = await apiFetch<any>(`${API_PREFIX}/contacts${listQuery(options)}`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async preflightContactImport(
    contacts: ContactImportPreflightInput[],
  ): Promise<AppResult<ContactImportPreflightResult>> {
    const res = await apiFetch<ContactImportPreflightResult>(`${API_PREFIX}/contacts/import/preflight`, {
      method: "POST",
      body: JSON.stringify({ contacts }),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async createContact(payload: { name: string; phone: string; label?: string }): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/contacts`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async updateContact(id: string, payload: { name: string; phone: string; label?: string }): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/contacts/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async deleteContact(id: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/contacts/${id}`, {
      method: "DELETE",
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getSuperadminOrgs(): Promise<AppResult<any[]>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/orgs`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async updateSuperadminOrgTokens(orgId: string, tokensDelta: number, description: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/orgs/${orgId}/tokens`, {
      method: "POST",
      body: JSON.stringify({ tokensDelta, description }),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async updateSuperadminOrgDetails(orgId: string, payload: {
    name: string;
    slug: string;
    plan: string;
    isActive: boolean;
    supportEmail: string;
    sendDelayMs: number;
    throttlePerMin: number;
    tokenPrice?: number;
  }): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/orgs/${orgId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async addSuperadminOrgNumber(orgId: string, payload: {
    name: string;
    number: string;
    businessId?: string;
    wabaId?: string;
    phoneNumberId?: string;
    accessToken?: string;
  }): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/orgs/${orgId}/numbers`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getSuperadminSignups(): Promise<AppResult<any[]>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/signups`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async activateSuperadminUser(userId: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/users/${userId}/activate`, {
      method: "POST",
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async resendSuperadminUserVerification(userId: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/users/${userId}/resend-verification`, {
      method: "POST",
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },
};
