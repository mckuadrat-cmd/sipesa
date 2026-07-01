import {
  apiFetch,
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

export type MessageItem = {
  id: string;
  content: string;
  sender: "user" | "contact";
  timestamp: string;
  status?: string;
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
  startedAt?: string | null;
  finishedAt?: string | null;
  mode?: string;
  templateId?: string | null;
  numberId?: string;
  numberName?: string;
  message?: string;
};

export type SendMessageResult =
  | { success: true; data: MessageItem; tokensRemaining: number }
  | { success: false; error: string };

function ok<T>(data: T): AppResult<T> {
  return { success: true, data };
}

function fail<T = never>(error: string): AppResult<T> {
  return { success: false, error };
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
    const res = await apiFetch<any>(`${API_PREFIX}/dashboard/usage-7d`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
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

  async testNumber(numberId: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/numbers/${numberId}/test`, {
      method: "POST",
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async getSettings() {
    const res = await apiFetch<any>(`${API_PREFIX}/settings`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async updateProfile(payload: { fullName: string; username: string; email: string; avatar?: string | null }) {
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
    autoReplyEnabled: boolean;
    autoReplyMessage: string;
    fallbackTemplateName: string;
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

  getMediaUrl(mediaId: string, numberId: string): string {
    const token = getAuthToken() || "";
    const apiKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
    const baseUrl = (import.meta.env.VITE_API_BASE_URL || "https://gwokwhznesggqoqrzaet.supabase.co/functions/v1/server").replace(/\/$/, "");
    return `${baseUrl}/media/${mediaId}?numberId=${numberId}&token=${encodeURIComponent(token)}&apikey=${encodeURIComponent(apiKey)}`;
  },

  async getMessages(numberId: string, contactId: string): Promise<AppResult<MessageItem[]>> {
    const res = await apiFetch<any>(
      `${API_PREFIX}/numbers/${numberId}/contacts/${contactId}/messages`,
      { method: "GET" },
    );

    if (isApiFail(res)) return fail(res.error);
    const parsed = (res.data ?? []).map((msg: any) => {
      let payload = msg.payload;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {}
      }
      return { ...msg, payload };
    });
    return ok(parsed);
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
    content: string,
  ): Promise<SendMessageResult> {
    const res = await apiFetch<any>(
      `${API_PREFIX}/numbers/${numberId}/contacts/${contactId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
    );

    if (isApiFail(res)) {
      return { success: false, error: res.error };
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

  async getBroadcastRecipients(broadcastId: string): Promise<AppResult<any[]>> {
    const res = await apiFetch<any>(`${API_PREFIX}/broadcasts/${broadcastId}/recipients`, {
      method: "GET",
    });

    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async getBroadcastStats(broadcastId: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/broadcasts/${broadcastId}/stats`, {
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
    const res = await apiFetch<any>(`${API_PREFIX}/billing/topup`, {
      method: "POST",
      body: JSON.stringify({ tokens }),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
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

  async getManualRequests(): Promise<AppResult<any[]>> {
    const res = await apiFetch<any>(`${API_PREFIX}/billing/manual-requests`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async createManualRequest(tokens: number, receiptData: string): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/billing/manual-requests`, {
      method: "POST",
      body: JSON.stringify({ tokens, receipt_data: receiptData }),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
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

  async getSuperadminManualRequests(): Promise<AppResult<any[]>> {
    const res = await apiFetch<any>(`${API_PREFIX}/superadmin/manual-requests`, { method: "GET" });
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

  async getBroadcastHistory(): Promise<AppResult<BroadcastHistoryItem[]>> {
    const res = await apiFetch<any>(`${API_PREFIX}/broadcasts`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async getBroadcastDetail(broadcastId: string): Promise<AppResult<any>> {
    const detailRes = await apiFetch<any>(`${API_PREFIX}/broadcasts`, { method: "GET" });
    if (isApiFail(detailRes)) return fail(detailRes.error);

    const recipientsRes = await apiFetch<any>(
      `${API_PREFIX}/broadcasts/${broadcastId}/recipients`,
      { method: "GET" },
    );
    if (isApiFail(recipientsRes)) return fail(recipientsRes.error);

    const broadcast = (detailRes.data ?? []).find((x: any) => x.id === broadcastId);
    if (!broadcast) return fail("Broadcast tidak ditemukan");

    const recipients = (recipientsRes.data ?? []).map((r: any) => ({
      id: r.id,
      contactName: r.recipient_name ?? "Tanpa Nama",
      contactPhone: r.phone_e164 ?? "-",
      status: r.status || "pending",
      timestamp: r.sent_at ?? r.updated_at ?? r.created_at ?? "-",
      errorMessage: r.error ?? undefined,
    }));

    return ok({
      id: broadcast.id,
      numberId: broadcast.numberId,
      numberName: broadcast.numberName ?? "Nomor WA",
      message: broadcast.message ?? "",
      totalRecipients: broadcast.totalRecipients ?? recipients.length,
      createdAt: broadcast.createdAt ?? "-",
      recipients,
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

        if (!phone) continue;

        const name =
          (nameIndex >= 0 ? row[nameIndex] : "")?.trim() ||
          phone;

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

  async getOrgContacts(): Promise<AppResult<any[]>> {
    const res = await apiFetch<any>(`${API_PREFIX}/contacts`, { method: "GET" });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data ?? []);
  },

  async createContact(payload: { name: string; phone: string }): Promise<AppResult<any>> {
    const res = await apiFetch<any>(`${API_PREFIX}/contacts`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (isApiFail(res)) return fail(res.error);
    return ok(res.data);
  },

  async updateContact(id: string, payload: { name: string; phone: string }): Promise<AppResult<any>> {
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
