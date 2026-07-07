// @ts-nocheck
import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs";

// ===== Env =====
type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  META_GRAPH_VERSION?: string;
  APP_WEBHOOK_SECRET?: string;
};

const API_PREFIX = "";
const SESSION_HEADER = "x-sipesa-session";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "apikey", SESSION_HEADER, "x-worker-secret"],
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

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizeEmail(email: unknown) {
  return String(email ?? "").trim().toLowerCase();
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

function workerSecret() {
  return Deno.env.get("APP_WEBHOOK_SECRET") || "";
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

async function consumeOneToken(orgId: string) {
  const supa = sb();

  const { data, error } = await supa.rpc("consume_billing_tokens", {
    p_org_id: orgId,
    p_tokens: 1,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : null;
  return {
    success: !!row?.success,
    remaining: Number(row?.remaining ?? 0),
    message: String(row?.message ?? ""),
  };
}

async function refundOneToken(orgId: string) {
  const supa = sb();

  const { data: bal, error: balErr } = await supa
    .from("billing_balance")
    .select("tokens_balance")
    .eq("org_id", orgId)
    .maybeSingle();

  if (balErr) throw balErr;

  const { error: updErr } = await supa
    .from("billing_balance")
    .update({
      tokens_balance: Number(bal?.tokens_balance ?? 0) + 1,
      updated_at: nowIso(),
    })
    .eq("org_id", orgId);

  if (updErr) throw updErr;
}

function slugifyOrgName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
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
      c.req.header("Authorization")?.split(" ")[1] ||
      c.req.query("token");
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
    if (!user.is_active) return c.json(jsonFail("Akun Anda dinonaktifkan. Silakan hubungi admin."), 403);

    let org_id = user.org_id;
    let email = user.email;
    let name = user.full_name;
    let role = user.role;

    if (email === "mckuadratid@gmail.com") {
      role = "owner";
    }

    const authUserObj: any = {
      id: user.id,
      org_id,
      email,
      name,
      full_name: name,
      role,
      status: user.is_active ? "active" : "inactive",
      is_active: user.is_active,
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

async function requireWorkerSecret(c: any, next: any) {
  const incoming =
    c.req.header("x-worker-secret") ||
    c.req.query("secret") ||
    "";
  const expected = workerSecret();

  if (!expected || incoming !== expected) {
    return c.json(jsonFail("Unauthorized worker"), 401);
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

    if (!userProfile.is_active) {
      return c.json(jsonFail("Akun Anda belum aktif. Silakan verifikasi email Anda terlebih dahulu."), 403);
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
    if (!countErr && unreadMessages) {
      for (const msg of unreadMessages) {
        if (msg.number_id) {
          unreadCountsMap[msg.number_id] = (unreadCountsMap[msg.number_id] || 0) + 1;
        }
      }
    }

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
    }));

    return c.json(jsonOk(mapped));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/numbers`, requireAuth, async (c) => {
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

app.post(`${API_PREFIX}/numbers/:id/test`, requireAuth, async (c) => {
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

app.get(`${API_PREFIX}/numbers/:numberId/contacts`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const numberId = c.req.param("numberId");
    const supa = sb();

    // 1. Fetch unique contact IDs that have messages for this WABA number (limit to latest 20000 messages)
    const { data: msgContacts, error: msgErr } = await supa
      .from("wa_messages")
      .select("contact_id")
      .eq("org_id", user.org_id)
      .eq("number_id", numberId)
      .order("created_at", { ascending: false })
      .limit(20000);

    if (msgErr) return c.json(jsonFail(msgErr.message), 500);

    const contactIds = [...new Set((msgContacts ?? []).map((m: any) => m.contact_id).filter(Boolean))];

    if (contactIds.length === 0) {
      return c.json(jsonOk([]));
    }

    // 2. Fetch details for these contacts
    const { data: contacts, error: contactsErr } = await supa
      .from("wa_contacts")
      .select("*")
      .in("id", contactIds);

    if (contactsErr) return c.json(jsonFail(contactsErr.message), 500);

    // 3. Fetch messages for this numberId to find last messages and unread statuses (limit to latest 20000 messages)
    const { data: allMessages, error: msgsErr } = await supa
      .from("wa_messages")
      .select("id, contact_id, text_body, direction, created_at, status")
      .eq("org_id", user.org_id)
      .eq("number_id", numberId)
      .order("created_at", { ascending: false })
      .limit(20000);

    if (msgsErr) return c.json(jsonFail(msgsErr.message), 500);

    // Group by contact_id to get the last message details
    const lastMessagesMap: Record<string, { text: string; time: string; direction: string; unread: boolean }> = {};
    for (const msg of allMessages ?? []) {
      if (!msg.contact_id) continue;
      if (!lastMessagesMap[msg.contact_id]) {
        lastMessagesMap[msg.contact_id] = {
          text: msg.text_body ?? (msg.direction === "out" ? "Pesan Keluar" : "Pesan Masuk"),
          time: msg.created_at,
          direction: msg.direction,
          unread: msg.direction === "in" && msg.status === "delivered",
        };
      }
    }

    const mapped = (contacts ?? []).map((r: any) => {
      const lastMsg = lastMessagesMap[r.id];
      return {
        id: r.id,
        name: r.display_name || r.phone_e164 || "Kontak",
        phone: r.phone_e164 ?? "",
        lastMessage: lastMsg?.text ?? "",
        timestamp: lastMsg?.time ?? r.last_message_at ?? r.updated_at ?? r.created_at ?? nowIso(),
        unread: lastMsg?.unread ?? false,
      };
    });

    // Sort contacts by latest message timestamp descending
    mapped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return c.json(jsonOk(mapped));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.get(`${API_PREFIX}/media/:mediaId`, async (c) => {
  try {
    const mediaId = c.req.param("mediaId");
    const numberId = c.req.query("numberId");
    const token = c.req.query("token");
    const apiKeyParam = c.req.query("apikey");

    if (!numberId) {
      return c.json(jsonFail("numberId wajib"), 400);
    }

    const supa = sb();

    // Authenticate: either valid JWT user token OR valid Supabase Anon/Service Key
    let isAuthenticated = false;
    let authUser: any = null;
    const systemAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const systemServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (apiKeyParam && (apiKeyParam === systemAnonKey || apiKeyParam === systemServiceKey)) {
      isAuthenticated = true;
    } else if (token) {
      const { data: { user } } = await supa.auth.getUser(token);
      if (user) {
        isAuthenticated = true;
        // Fetch user org details
        const { data: appUser } = await supa
          .from("app_users")
          .select("org_id")
          .eq("id", user.id)
          .maybeSingle();
        if (appUser) {
          authUser = appUser;
        }
      }
    }

    if (!isAuthenticated) {
      return c.json(jsonFail("Sesi Anda tidak valid atau tidak memiliki akses"), 401);
    }

    // Query WABA number row
    let query = supa.from("wa_numbers").select("access_token").eq("id", numberId);
    if (authUser?.org_id) {
      query = query.eq("org_id", authUser.org_id);
    }

    const { data: numberRow, error } = await query.maybeSingle();

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
      "Cache-Control": "public, max-age=86400",
    });
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// GET all organization contacts
app.get(`${API_PREFIX}/contacts`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const { data, error } = await supa
      .from("wa_contacts")
      .select("*")
      .eq("org_id", user.org_id)
      .order("display_name", { ascending: true });

    if (error) return c.json(jsonFail(error.message), 500);

    const mapped = (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.display_name || r.phone_e164 || "Kontak",
      phone: r.phone_e164 ?? "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return c.json(jsonOk(mapped));
  } catch (e) {
    return c.json(jsonFail(e), 500);
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

    if (!name) return c.json(jsonFail("Nama kontak harus diisi"), 400);
    if (!phone) return c.json(jsonFail("Nomor telepon harus diisi"), 400);

    const { data, error } = await supa
      .from("wa_contacts")
      .insert({
        org_id: user.org_id,
        display_name: name,
        phone_e164: phone,
      })
      .select("*")
      .single();

    if (error) return c.json(jsonFail(error.message), 500);

    return c.json(jsonOk({
      id: data.id,
      name: data.display_name,
      phone: data.phone_e164,
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

    if (!name) return c.json(jsonFail("Nama kontak harus diisi"), 400);
    if (!phone) return c.json(jsonFail("Nomor telepon harus diisi"), 400);

    const { data, error } = await supa
      .from("wa_contacts")
      .update({
        display_name: name,
        phone_e164: phone,
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
      updatedAt: data.updated_at,
    }));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// DELETE contact
app.delete(`${API_PREFIX}/contacts/:id`, requireAuth, async (c) => {
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

app.post(`${API_PREFIX}/templates/sync-default`, requireAuth, async (c) => {
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
app.get(`${API_PREFIX}/numbers/:numberId/contacts/:contactId/messages`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const numberId = c.req.param("numberId");
    const contactId = c.req.param("contactId");
    const supa = sb();

    // Mark incoming messages as read
    await supa
      .from("wa_messages")
      .update({ status: "read", read_at: nowIso() })
      .eq("org_id", user.org_id)
      .eq("number_id", numberId)
      .eq("contact_id", contactId)
      .eq("direction", "in")
      .eq("status", "delivered");

    const { data, error } = await supa
      .from("wa_messages")
      .select("*")
      .eq("org_id", user.org_id)
      .eq("number_id", numberId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: true });

    if (error) return c.json(jsonFail(error.message), 500);

    const mapped = (data ?? []).map((r: any) => ({
      id: r.id,
      content: r.text_body ?? "",
      sender: r.direction === "out" ? "user" : "contact",
      timestamp: r.created_at ?? nowIso(),
      status: r.status,
      messageType: r.message_type || "text",
      payload: r.payload || null,
      contactName: undefined,
    }));

    return c.json(jsonOk(mapped));
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

app.post(`${API_PREFIX}/numbers/:numberId/delete-conversations`, requireAuth, async (c) => {
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

    const content = String(body.content ?? body.message ?? body.text ?? "").trim();
    if (!content) return c.json(jsonFail("content wajib"), 400);

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

    const tokenResult = await consumeOneToken(user.org_id);
    if (!tokenResult.success) {
      return c.json(jsonFail(tokenResult.message || "Token tidak cukup"), 400);
    }

    const { data: msg, error } = await supa
      .from("wa_messages")
      .insert({
        org_id: user.org_id,
        number_id: numberId,
        contact_id: contactId,
        direction: "out",
        status: "queued",
        message_type: "text",
        text_body: content,
        payload: { source: "manual" },
      })
      .select("*")
      .single();

    if (error) return c.json(jsonFail(error.message), 500);

    try {
      const metaRes = await sendMetaTextMessage({
        phoneNumberId: numberRow.phone_number_id,
        accessToken: numberRow.access_token,
        to: contact.phone_e164,
        text: content,
      });

      const metaMessageId = metaRes?.messages?.[0]?.id ?? null;

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
        .from("wa_contacts")
        .update({ last_message_at: nowIso() })
        .eq("id", contactId)
        .eq("org_id", user.org_id);

      await supa.from("billing_transactions").insert({
        org_id: user.org_id,
        type: "usage",
        tokens_delta: -1,
        amount_idr: 1500,
        description: `Pemakaian token chat manual ke ${contact.phone_e164}`,
        ref_type: "message",
        ref_id: msg.id,
        created_by: user.id,
      });

      await supa.from("app_activity").insert({
        org_id: user.org_id,
        actor_user_id: user.id,
        type: "message_sent",
        message: "Pesan manual terkirim",
        meta: { message_id: msg.id, number_id: numberId, contact_id: contactId, meta_message_id: metaMessageId },
      });

      return c.json(
        jsonOk({
          id: msg.id,
          content,
          sender: "user",
          timestamp: nowIso(),
          status: "sent",
          metaMessageId,
          tokensRemaining: tokenResult.remaining,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      await supa
        .from("wa_messages")
        .update({
          status: "failed",
          error: message,
        })
        .eq("id", msg.id);

      await refundOneToken(user.org_id);

      await supa.from("billing_transactions").insert({
        org_id: user.org_id,
        type: "refund",
        tokens_delta: 1,
        amount_idr: 1500,
        description: `Refund token pesan gagal ke ${contact.phone_e164}`,
        ref_type: "message",
        ref_id: msg.id,
        created_by: user.id,
      });

      return c.json(jsonFail(message), 400);
    }
  } catch (e) {
    return c.json(jsonFail(e), 500);
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

app.post(`${API_PREFIX}/templates/upload-sample`, requireAuth, async (c) => {
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

function buildTemplateComponentsFromContent(content: string) {
  return [
    {
      type: "BODY",
      text: content,
    },
  ];
}

app.post(`${API_PREFIX}/templates`, requireAuth, async (c) => {
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

app.put(`${API_PREFIX}/templates/:id`, requireAuth, async (c) => {
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

app.delete(`${API_PREFIX}/templates/:id`, requireAuth, async (c) => {
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

app.post(`${API_PREFIX}/templates/sync`, requireAuth, async (c) => {
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

app.post(`${API_PREFIX}/templates/:id/push-meta`, requireAuth, async (c) => {
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
      .select("*")
      .eq("org_id", user.org_id)
      .maybeSingle();

    if (balErr) return c.json(jsonFail(balErr.message), 500);

    const { data: txRows, error: txErr } = await supa
      .from("billing_transactions")
      .select("amount_idr, type")
      .eq("org_id", user.org_id);

    if (txErr) return c.json(jsonFail(txErr.message), 500);

    const totalSpent = (txRows ?? [])
      .reduce((sum: number, x: any) => {
        if (x.type === "usage") {
          return sum + Number(x.amount_idr ?? 0);
        } else if (x.type === "refund") {
          return sum - Number(x.amount_idr ?? 0);
        }
        return sum;
      }, 0);

    return c.json(
      jsonOk({
        currentTokens: Number(balance?.tokens_balance ?? 0),
        totalSpent,
        tokenPrice: Number(balance?.token_price_idr ?? 1500),
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

    return c.json(jsonOk(mapped));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// ===== STATS =====
app.get(`${API_PREFIX}/stats`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

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

    const { data: usageRows, error: usageErr } = await supa
      .from("billing_transactions")
      .select("tokens_delta, type")
      .eq("org_id", user.org_id)
      .eq("type", "usage");

    if (usageErr) return c.json(jsonFail(usageErr.message), 500);

    const tokensUsed = Math.abs(
      (usageRows ?? []).reduce((sum: number, x: any) => sum + Number(x.tokens_delta ?? 0), 0),
    );

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

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);

    const { data, error } = await supa
      .from("billing_transactions")
      .select("created_at, tokens_delta, type")
      .eq("org_id", user.org_id)
      .eq("type", "usage")
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: true });

    if (error) return c.json(jsonFail(error.message), 500);

    const days: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      days[key] = 0;
    }

    for (const row of data ?? []) {
      const key = String(row.created_at).slice(0, 10);
      const delta = Math.abs(Number(row.tokens_delta ?? 0));
      if (key in days) days[key] += delta;
    }

    const result = Object.entries(days).map(([date, tokens]) => ({
      date,
      tokens,
      amountIdr: tokens * 1500,
    }));

    return c.json(jsonOk(result));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// ===== INIT =====
app.post(`${API_PREFIX}/init`, requireAuth, async (c) => {
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

    const { data, error } = await supa
      .from("wa_broadcasts")
      .select("*, wa_numbers(phone_e164, label)")
      .eq("org_id", user.org_id)
      .order("created_at", { ascending: false });

    if (error) return c.json(jsonFail(error.message), 500);

    const mapped = (data ?? []).map((r: any) => {
      const waNumObj = r.wa_numbers;
      const phone = waNumObj?.phone_e164 ? normalizePhone(waNumObj.phone_e164) : "";
      const label = waNumObj?.label || "";
      const senderText = phone && label ? `${phone} — ${label}` : phone || label || "Nomor WA";

      return {
        id: r.id,
        title: r.title,
        status: r.status,
        totalRecipients: r.total_recipients ?? 0,
        totalSent: r.total_sent ?? 0,
        totalFailed: r.total_failed ?? 0,
        createdAt: r.created_at,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        mode: r.mode ?? "text",
        templateId: r.template_id ?? null,
        numberId: r.number_id,
        numberName: senderText,
      };
    });

    return c.json(jsonOk(mapped));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/broadcasts`, requireAuth, async (c) => {
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
    const scheduledAt = body.scheduledAt ?? null;

    if (!title) return c.json(jsonFail("title wajib"), 400);
    if (!numberId) return c.json(jsonFail("numberId wajib"), 400);
    if (recipients.length === 0) return c.json(jsonFail("recipients wajib"), 400);
    if (mode === "text" && !message) return c.json(jsonFail("message wajib"), 400);

    const { data: numberRow, error: numberErr } = await supa
      .from("wa_numbers")
      .select("*")
      .eq("id", numberId)
      .eq("org_id", user.org_id)
      .maybeSingle();

    if (numberErr) return c.json(jsonFail(numberErr.message), 500);
    if (!numberRow) return c.json(jsonFail("Nomor tidak ditemukan"), 404);

    const { data: broadcast, error: bErr } = await supa
      .from("wa_broadcasts")
      .insert({
        org_id: user.org_id,
        number_id: numberId,
        title,
        status: "queued",
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

    const recipientRows = recipients.map((r: any) => {
      const phone = normalizePhone(r.phone);
      const name = String(r.name ?? "").trim();
      const vars = typeof r.vars === "object" && r.vars ? r.vars : {};
      const bodyVariables = Object.keys(vars)
        .filter((key) => /^var\d+$/i.test(key))
        .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")))
        .map((key) => String(vars[key] ?? ""));

      const finalMessage =
        mode === "text"
          ? renderTemplate(message, { name, ...vars })
          : JSON.stringify({
              kind: "template_payload",
              vars,
              bodyVariables,
              mediaUrl: String(r.mediaUrl ?? "").trim(),
              fileName: String(r.fileName ?? "").trim(),
              rowNumber: r.rowNumber ?? null,
            });

      return {
        org_id: user.org_id,
        broadcast_id: broadcast.id,
        contact_id: r.contactId ?? null,
        phone_e164: phone,
        recipient_name: name || null,
        message: finalMessage,
        status: "pending",
      };
    });

    const { error: recErr } = await supa.from("wa_broadcast_recipients").insert(recipientRows);
    if (recErr) return c.json(jsonFail(recErr.message), 500);

    await supa.from("app_activity").insert({
      org_id: user.org_id,
      actor_user_id: user.id,
      type: "broadcast_created",
      message: `Broadcast dibuat: ${title}`,
      meta: { broadcast_id: broadcast.id, total_recipients: recipients.length, mode },
    });

    return c.json(
      jsonOk({
        id: broadcast.id,
        title: broadcast.title,
        status: broadcast.status,
        totalRecipients: recipients.length,
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

    const { data: recipients, error: recErr } = await supa
      .from("wa_broadcast_recipients")
      .select("*")
      .eq("org_id", user.org_id)
      .eq("broadcast_id", id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (recErr) return c.json(jsonFail(recErr.message), 500);

    const messageIds = (recipients ?? []).map((r: any) => r.wa_message_id).filter(Boolean);
    
    let messagesMap = new Map();
    if (messageIds.length > 0) {
      const { data: messages } = await supa
        .from("wa_messages")
        .select("id, status")
        .in("id", messageIds);
      
      (messages ?? []).forEach((m: any) => {
        messagesMap.set(m.id, m.status);
      });
    }

    const mapped = (recipients ?? []).map((r: any) => {
      let finalStatus = r.status || "pending";
      if (r.wa_message_id && messagesMap.has(r.wa_message_id)) {
        finalStatus = messagesMap.get(r.wa_message_id);
      }
      return {
        ...r,
        status: finalStatus,
      };
    });

    return c.json(jsonOk(mapped));
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
      .select("id, title, status, total_recipients, total_sent, total_failed, started_at, finished_at, number_id")
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
        progress,
        startedAt: b.started_at,
        finishedAt: b.finished_at,
        senderNumber,
        senderName,
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

// ===== JOBS / WORKER =====
app.post(`${API_PREFIX}/jobs/process-broadcasts`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const { data: org, error: orgErr } = await supa
      .from("orgs")
      .select("id, send_delay_ms, throttle_per_min")
      .eq("id", user.org_id)
      .maybeSingle();

    if (orgErr) return c.json(jsonFail(orgErr.message), 500);

    const orgDelayMs = Math.max(0, Number(org?.send_delay_ms ?? 2000));
    const orgThrottlePerMin = Math.max(1, Number(org?.throttle_per_min ?? 30));

    const { data: broadcast, error: bErr } = await supa
      .from("wa_broadcasts")
      .select("*")
      .eq("org_id", user.org_id)
      .in("status", ["queued", "sending"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (bErr) return c.json(jsonFail(bErr.message), 500);
    if (!broadcast) {
      return c.json(jsonOk({ message: "Tidak ada broadcast untuk diproses" }));
    }

    const { data: numberRow, error: numberErr } = await supa
      .from("wa_numbers")
      .select("*")
      .eq("org_id", user.org_id)
      .eq("id", broadcast.number_id)
      .maybeSingle();

    if (numberErr) return c.json(jsonFail(numberErr.message), 500);
    if (!numberRow) return c.json(jsonFail("Nomor broadcast tidak ditemukan"), 404);
    if (!numberRow.access_token || !numberRow.phone_number_id) {
      return c.json(jsonFail("Nomor broadcast belum lengkap untuk Meta"), 400);
    }

    if (broadcast.status === "queued") {
      const { error: startErr } = await supa
        .from("wa_broadcasts")
        .update({
          status: "sending",
          started_at: broadcast.started_at ?? nowIso(),
        })
        .eq("id", broadcast.id);

      if (startErr) return c.json(jsonFail(startErr.message), 500);
    }

    // Support limit query parameter for sequential/real-time processing
    const limitQuery = c.req.query("limit");
    const overrideLimit = limitQuery ? Number(limitQuery) : null;
    const effectiveThrottle = overrideLimit !== null && !isNaN(overrideLimit)
      ? Math.max(1, overrideLimit)
      : Math.max(
          1,
          Math.min(Number(broadcast.throttle_per_min ?? orgThrottlePerMin), 100),
        );

    const effectiveDelayMs = orgDelayMs;

    const { data: recipients, error: rErr } = await supa
      .from("wa_broadcast_recipients")
      .select("*")
      .eq("org_id", user.org_id)
      .eq("broadcast_id", broadcast.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(effectiveThrottle);

    if (rErr) return c.json(jsonFail(rErr.message), 500);

    const batch = recipients ?? [];
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < batch.length; i++) {
      const rec = batch[i];

      // Atomic claim using condition to prevent duplicate concurrent runs
      const { data: claimedRec, error: claimErr } = await supa
        .from("wa_broadcast_recipients")
        .update({ status: "processing", updated_at: nowIso() })
        .eq("id", rec.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (claimErr || !claimedRec) {
        console.warn(`Recipient ${rec.phone_e164} already claimed/processed concurrently. Skipping.`);
        continue;
      }

      const tokenResult = await consumeOneToken(user.org_id);

      if (!tokenResult.success) {
        await supa
          .from("wa_broadcasts")
          .update({
            status: "paused",
            updated_at: nowIso(),
          })
          .eq("id", broadcast.id);

        await supa.from("app_activity").insert({
          org_id: user.org_id,
          actor_user_id: user.id,
          type: "broadcast_paused",
          message: `Broadcast dijeda (Token habis): ${broadcast.title}`,
          meta: { broadcast_id: broadcast.id },
        });

        return c.json(
          jsonOk({
            broadcastId: broadcast.id,
            sentInBatch: sentCount,
            failedInBatch: failedCount,
            status: "paused",
            message: "Token habis",
          }),
        );
      }

      try {
        const { data: msg, error: msgErr } = await supa
          .from("wa_messages")
          .insert({
            org_id: user.org_id,
            number_id: broadcast.number_id,
            contact_id: rec.contact_id,
            direction: "out",
            status: "queued",
            message_type: broadcast.mode === "template" ? "template" : "text",
            text_body: broadcast.mode === "text" ? rec.message : null,
            payload: {
              source: "broadcast_worker",
              broadcast_id: broadcast.id,
              recipient_id: rec.id,
              phone_e164: rec.phone_e164,
              send_delay_ms: effectiveDelayMs,
              throttle_per_min: effectiveThrottle,
            },
          })
          .select("*")
          .single();

        if (msgErr) throw new Error(msgErr.message);

        let metaRes: any = null;

        if (broadcast.mode === "template") {
          const { data: tpl, error: tplErr } = await supa
            .from("wa_templates")
            .select("*")
            .eq("id", broadcast.template_id)
            .maybeSingle();

          if (tplErr) throw new Error(tplErr.message);
          if (!tpl) throw new Error("Template tidak ditemukan");

          const recipientPayload = parseTemplateRecipientPayload(rec.message);
          const vars = Array.isArray(recipientPayload?.bodyVariables)
            ? recipientPayload.bodyVariables.map((x: any) => String(x ?? ""))
            : Array.isArray(broadcast.template_variables?.body)
            ? broadcast.template_variables.body.map((x: any) => String(x ?? ""))
            : [];

          // Find expected body variables count from template BODY component
          const bodyComp = Array.isArray(tpl.components)
            ? tpl.components.find((x: any) => String(x?.type || "").toUpperCase() === "BODY")
            : null;
          const bodyText = String(bodyComp?.text || "");
          const variableMatches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
          const bodyVariablesCount = variableMatches.length > 0 ? Math.max(...variableMatches) : 0;

          // Pad/slice vars to exactly match bodyVariablesCount to prevent Meta parameter count mismatch (#131008)
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
          metaRes = await sendMetaTextMessage({
            phoneNumberId: numberRow.phone_number_id,
            accessToken: numberRow.access_token,
            to: rec.phone_e164,
            text: rec.message,
          });
        }

        const metaMessageId = metaRes?.messages?.[0]?.id ?? null;

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
            wa_message_id: msg.id,
            provider_message_id: metaMessageId,
            sent_at: nowIso(),
            updated_at: nowIso(),
            error: null,
          })
          .eq("id", rec.id);

        await supa.from("billing_transactions").insert({
          org_id: user.org_id,
          type: "usage",
          tokens_delta: -1,
          amount_idr: 1500,
          description: `Pemakaian token broadcast: ${broadcast.title} -> ${rec.phone_e164}`,
          ref_type: "broadcast_recipient",
          ref_id: rec.id,
          created_by: user.id,
        });

        sentCount += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        await supa
          .from("wa_broadcast_recipients")
          .update({
            status: "failed",
            error: message,
            updated_at: nowIso(),
          })
          .eq("id", rec.id);

        await refundOneToken(user.org_id);

        await supa.from("billing_transactions").insert({
          org_id: user.org_id,
          type: "refund",
          tokens_delta: 1,
          amount_idr: 1500,
          description: `Refund token broadcast gagal ke ${rec.phone_e164}`,
          ref_type: "broadcast_recipient",
          ref_id: rec.id,
          created_by: user.id,
        });

        failedCount += 1;
      }

      const isLast = i === batch.length - 1;
      if (!isLast && effectiveDelayMs > 0) {
        await sleep(effectiveDelayMs);
      }
    }

    const { data: statsRows, error: statsErr } = await supa
      .from("wa_broadcast_recipients")
      .select("status")
      .eq("org_id", user.org_id)
      .eq("broadcast_id", broadcast.id);

    if (statsErr) return c.json(jsonFail(statsErr.message), 500);

    const totalSent = (statsRows ?? []).filter((x: any) => x.status === "sent").length;
    const totalFailed = (statsRows ?? []).filter((x: any) => x.status === "failed").length;
    const totalPending = (statsRows ?? []).filter(
      (x: any) => x.status === "pending" || x.status === "processing",
    ).length;

    const nextStatus = totalPending === 0 ? "completed" : "sending";

    const { error: updErr } = await supa
      .from("wa_broadcasts")
      .update({
        status: nextStatus,
        total_sent: totalSent,
        total_failed: totalFailed,
        finished_at: totalPending === 0 ? nowIso() : null,
        updated_at: nowIso(),
      })
      .eq("id", broadcast.id);

    if (updErr) return c.json(jsonFail(updErr.message), 500);

    if (nextStatus === "completed") {
      await supa.from("app_activity").insert({
        org_id: user.org_id,
        actor_user_id: user.id,
        type: "broadcast_completed",
        message: `Broadcast selesai: ${broadcast.title} (${totalSent} sukses, ${totalFailed} gagal)`,
        meta: {
          broadcast_id: broadcast.id,
          total_sent: totalSent,
          total_failed: totalFailed,
        },
      });
    }

    return c.json(
      jsonOk({
        broadcastId: broadcast.id,
        sentInBatch: sentCount,
        failedInBatch: failedCount,
        status: nextStatus,
        sendDelayMs: effectiveDelayMs,
        throttlePerMin: effectiveThrottle,
      }),
    );
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

async function recalculateBroadcastStats(supa: any, broadcastId: string) {
  try {
    const { data: statsRows, error: statsErr } = await supa
      .from("wa_broadcast_recipients")
      .select("status")
      .eq("broadcast_id", broadcastId);

    if (statsErr || !statsRows) return;

    const totalSent = statsRows.filter((x: any) => x.status === "sent" || x.status === "delivered" || x.status === "read").length;
    const totalFailed = statsRows.filter((x: any) => x.status === "failed").length;
    const totalPending = statsRows.filter((x: any) => x.status === "pending" || x.status === "processing").length;

    const nextStatus = totalPending === 0 ? "completed" : "sending";

    await supa
      .from("wa_broadcasts")
      .update({
        status: nextStatus,
        total_sent: totalSent,
        total_failed: totalFailed,
        finished_at: totalPending === 0 ? nowIso() : null,
        updated_at: nowIso(),
      })
      .eq("id", broadcastId);
  } catch (err) {
    console.error("Error recalculating stats:", err);
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
    const payload = await c.req.json();
    console.log("Webhook POST payload received:", JSON.stringify(payload));
    const supa = sb();

    // Log payload to app_activity
    await supa.from("app_activity").insert({
      org_id: null,
      actor_user_id: null,
      type: "webhook_payload",
      message: `Webhook POST received`,
      meta: { payload },
    });

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
                meta: { phoneNumberId, error: numErr },
              });
            }
            numberRow = data;
            
            if (!numberRow) {
              const { data: allNums } = await supa.from("wa_numbers").select("phone_number_id, phone_e164");
              console.warn("WABA number NOT found in DB. Received:", phoneNumberId, ". Configured in DB:", allNums);
              await supa.from("app_activity").insert({
                org_id: null,
                actor_user_id: null,
                type: "webhook_warn",
                message: `WABA number not found in DB for ID: ${phoneNumberId}`,
                meta: { phoneNumberId, configuredNumbers: allNums },
              });
            } else {
              console.log("Matched WABA number in DB:", numberRow.phone_e164);
            }
          } else {
            console.warn("Missing phone_number_id in webhook payload metadata.");
            await supa.from("app_activity").insert({
              org_id: null,
              actor_user_id: null,
              type: "webhook_warn",
              message: "Missing phone_number_id in webhook payload metadata.",
              meta: { value },
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

            const { data: msg } = await supa
              .from("wa_messages")
              .update(patch)
              .eq("meta_message_id", metaMessageId)
              .select("*")
              .maybeSingle();

            if (msg) {
              const recipientPatch: any = {
                provider_message_id: metaMessageId,
                error: patch.error ?? null,
              };
              if (patch.status && ["pending", "processing", "sent", "delivered", "read", "failed"].includes(patch.status)) {
                recipientPatch.status = patch.status;
              }
              const { data: updatedRecs } = await supa
                .from("wa_broadcast_recipients")
                .update(recipientPatch)
                .eq("wa_message_id", msg.id)
                .select("broadcast_id");

              let broadcastId = updatedRecs?.[0]?.broadcast_id;
              if (!broadcastId && typeof msg.payload === "object" && msg.payload) {
                broadcastId = msg.payload.broadcast_id;
              } else if (!broadcastId && typeof msg.payload === "string" && msg.payload) {
                try {
                  const parsed = JSON.parse(msg.payload);
                  broadcastId = parsed.broadcast_id;
                } catch {}
              }

              if (broadcastId) {
                await recalculateBroadcastStats(supa, broadcastId);
              }
            }
          }

          const messages = Array.isArray(value?.messages) ? value.messages : [];
          const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
          console.log(`Processing ${messages.length} messages and ${contacts.length} contacts.`);

          for (const incoming of messages) {
            const from = normalizePhone(incoming?.from ?? "");
            if (!from || !numberRow) {
              console.warn("Skipping message: from =", from, ", numberRow found =", !!numberRow);
              await supa.from("app_activity").insert({
                org_id: numberRow?.org_id || null,
                actor_user_id: null,
                type: "webhook_warn",
                message: `Skipping message: from=${from}, numberRow found=${!!numberRow}`,
                meta: { incoming },
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
              console.log("Creating new contact in DB for:", from, "with name:", displayName);
              const inserted = await supa
                .from("wa_contacts")
                .insert({
                  org_id: numberRow.org_id,
                  phone_e164: from,
                  display_name: null,
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
                  message: `Error creating contact for ${from}: ${inserted.error.message}`,
                  meta: { from, displayName, error: inserted.error },
                });
                throw inserted.error;
              }
              contact = inserted.data;
            } else {
              console.log("Found existing contact in DB for:", from);
              await supa
                .from("wa_contacts")
                .update({
                  last_message_at: nowIso(),
                })
                .eq("id", contact.id);
            }

            const messageType = String(incoming?.type ?? "text");
            const textBody =
              incoming?.text?.body ??
              incoming?.button?.text ??
              incoming?.interactive?.button_reply?.title ??
              incoming?.interactive?.list_reply?.title ??
              `[${messageType}]`;

            console.log("Inserting incoming message into wa_messages:", textBody, "type:", messageType);
            const { error: insertErr } = await supa.from("wa_messages").insert({
              org_id: numberRow.org_id,
              number_id: numberRow.id,
              contact_id: contact.id,
              direction: "in",
              status: "delivered",
              meta_message_id: incoming?.id ?? null,
              meta_status_payload: incoming,
              message_type: messageType,
              text_body: textBody,
              payload: incoming,
              delivered_at: nowIso(),
            });

            if (insertErr) {
              console.error("Error inserting incoming message into wa_messages:", insertErr.message);
              await supa.from("app_activity").insert({
                org_id: numberRow.org_id,
                actor_user_id: null,
                type: "webhook_error",
                message: `Error inserting incoming message from ${from}: ${insertErr.message}`,
                meta: { from, textBody, error: insertErr },
              });
            } else {
              console.log("Incoming message inserted successfully!");
              await supa.from("app_activity").insert({
                org_id: numberRow.org_id,
                actor_user_id: null,
                type: "webhook_success",
                message: `Incoming message processed successfully from ${from}`,
                meta: { from, textBody, messageType },
              });
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

app.get("/webhooks/meta", handleWebhookGet);
app.get(`${API_PREFIX}/webhooks/meta`, handleWebhookGet);

app.post("/webhooks/meta", handleWebhookPost);
app.post(`${API_PREFIX}/webhooks/meta`, handleWebhookPost);

app.get(`${API_PREFIX}/dev/check-columns`, async (c) => {
  return c.json({ success: true, message: "Diagnostic endpoint active" });
});



// ===== SETTINGS =====
app.get(`${API_PREFIX}/settings`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();

    const [
      { data: org, error: orgErr },
      { data: me, error: userErr },
      { data: avatarRow },
      { data: addressRow }
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
    ]);

    if (orgErr) return c.json(jsonFail(orgErr.message), 500);
    if (userErr) return c.json(jsonFail(userErr.message), 500);

    const webhookUrl = `${new URL(c.req.url).origin}/functions/v1/server/webhooks/meta`;

    return c.json(
      jsonOk({
        org: {
          id: org?.id ?? null,
          name: org?.name ?? "",
          slug: org?.slug ?? "",
          supportEmail: org?.support_email ?? "",
          autoReplyEnabled: !!org?.auto_reply_enabled,
          autoReplyMessage:
            org?.auto_reply_message ??
            "Terima kasih telah menghubungi kami. Kami akan membalas pesan Anda pada jam kerja.",
          fallbackTemplateName: org?.fallback_template_name ?? "",
          sendDelayMs: Number(org?.send_delay_ms ?? 2000),
          throttlePerMin: Number(org?.throttle_per_min ?? 30),
          address: addressRow?.value?.address ?? "",
        },
        profile: {
          id: me?.id ?? null,
          fullName: me?.full_name ?? "",
          username: me?.username ?? "",
          email: me?.email ?? "",
          role: me?.role ?? "",
          avatar: avatarRow?.value?.avatar ?? null,
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

app.put(`${API_PREFIX}/settings/org`, requireAuth, async (c) => {
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

app.put(`${API_PREFIX}/settings/messaging`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const supa = sb();
    const body = await c.req.json();

    const autoReplyEnabled = !!body.autoReplyEnabled;
    const autoReplyMessage = String(body.autoReplyMessage ?? "").trim();
    const fallbackTemplateName = String(body.fallbackTemplateName ?? "").trim();
    const sendDelayMs = Math.max(0, Number(body.sendDelayMs ?? 2000));
    const throttlePerMin = Math.max(1, Number(body.throttlePerMin ?? 30));

    const { data, error } = await supa
      .from("orgs")
      .update({
        auto_reply_enabled: autoReplyEnabled,
        auto_reply_message: autoReplyMessage || null,
        fallback_template_name: fallbackTemplateName || null,
        send_delay_ms: sendDelayMs,
        throttle_per_min: throttlePerMin,
      })
      .eq("id", user.org_id)
      .select("auto_reply_enabled, auto_reply_message, fallback_template_name, send_delay_ms, throttle_per_min")
      .single();

    if (error) return c.json(jsonFail(error.message), 500);

    return c.json(
      jsonOk({
        autoReplyEnabled: !!data.auto_reply_enabled,
        autoReplyMessage: data.auto_reply_message ?? "",
        fallbackTemplateName: data.fallback_template_name ?? "",
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
  const superadminEmail = Deno.env.get("SUPERADMIN_EMAIL") || "mckuadratid@gmail.com";
  if (user?.email !== superadminEmail) {
    return c.json(jsonFail("Hanya pemilik yang dapat mengakses halaman ini"), 403);
  }
  await next();
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
        tokenPrice: balance ? Number(balance.token_price_idr ?? 1500) : 1500,
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
    const description = String(body.description ?? "Manual token adjustment by owner").trim();

    if (Number.isNaN(tokensDelta)) {
      return c.json(jsonFail("Nominal token tidak valid"), 400);
    }

    const supa = sb();

    const { data: balance, error: balErr } = await supa
      .from("billing_balance")
      .select("tokens_balance")
      .eq("org_id", orgId)
      .maybeSingle();

    if (balErr) return c.json(jsonFail(balErr.message), 500);

    const currentBalance = balance ? Number(balance.tokens_balance ?? 0) : 0;
    const newBalance = Math.max(0, currentBalance + tokensDelta);

    const { error: upsertErr } = await supa
      .from("billing_balance")
      .upsert({
        org_id: orgId,
        tokens_balance: newBalance,
        updated_at: nowIso(),
      }, { onConflict: "org_id" });

    if (upsertErr) return c.json(jsonFail(upsertErr.message), 500);

    const { error: txErr } = await supa
      .from("billing_transactions")
      .insert({
        org_id: orgId,
        type: tokensDelta >= 0 ? "topup" : "adjustment",
        tokens_delta: tokensDelta,
        amount_idr: 0,
        description,
        created_by: c.get("authUser").id,
      });

    if (txErr) {
      console.warn("Failed to insert billing transaction record for superadmin update:", txErr);
    }

    return c.json(jsonOk({ tokensBalance: newBalance }));
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
    const tokenPrice = Number(body.tokenPrice ?? 1500);

    if (!name) return c.json(jsonFail("Nama instansi wajib diisi"), 400);
    if (!slug) return c.json(jsonFail("Slug wajib diisi"), 400);

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
    if (!Number.isNaN(tokenPrice) && tokenPrice > 0) {
      await supa
        .from("billing_balance")
        .upsert({
          org_id: orgId,
          token_price_idr: tokenPrice,
          updated_at: nowIso(),
        }, { onConflict: "org_id" });
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

// ===== MANUAL BILLING ENDPOINTS =====
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
    const prefix = `payment_request:${user.org_id}:`;
    const { data, error } = await supa
      .from("key_info")
      .select("key, value")
      .like("key", prefix + "%");

    if (error) return c.json(jsonFail(error.message), 500);

    const requests = (data ?? []).map((row: any) => row.value);
    requests.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return c.json(jsonOk(requests));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/billing/manual-requests`, requireAuth, async (c) => {
  try {
    const user = c.get("authUser");
    const { tokens, receipt_data, amount_idr } = await c.req.json();

    if (!tokens || tokens <= 0) {
      return c.json(jsonFail("Jumlah token tidak valid"), 400);
    }
    if (!receipt_data) {
      return c.json(jsonFail("Bukti transfer wajib diunggah"), 400);
    }

    const supa = sb();

    const { data: orgRow, error: orgErr } = await supa
      .from("orgs")
      .select("name")
      .eq("id", user.org_id)
      .maybeSingle();

    if (orgErr) return c.json(jsonFail(orgErr.message), 500);
    const orgName = orgRow?.name || "Instansi Tanpa Nama";

    const { data: balance, error: balErr } = await supa
      .from("billing_balance")
      .select("token_price_idr")
      .eq("org_id", user.org_id)
      .maybeSingle();

    if (balErr) return c.json(jsonFail(balErr.message), 500);
    const price = Number(balance?.token_price_idr ?? 1500);

    let finalAmount = amount_idr;
    if (!finalAmount) {
      const referralCode = Math.floor(Math.random() * 900) + 100;
      finalAmount = (tokens * price) + referralCode;
    }

    const requestId = crypto.randomUUID();
    const requestObj = {
      id: requestId,
      org_id: user.org_id,
      org_name: orgName,
      amount_tokens: tokens,
      amount_idr: finalAmount,
      status: "pending",
      receipt_url: receipt_data,
      created_by_email: user.email,
      created_at: nowIso(),
      approved_at: null,
      approved_by: null,
      notes: null,
    };

    const key = `payment_request:${user.org_id}:${requestId}`;
    const { error: saveErr } = await supa
      .from("key_info")
      .upsert({ key, value: requestObj });

    if (saveErr) return c.json(jsonFail(saveErr.message), 500);

    return c.json(jsonOk(requestObj));
  } catch (e) {
    return c.json(jsonFail(e), 500);
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
    const { data, error } = await supa
      .from("key_info")
      .select("key, value")
      .like("key", "payment_request:%");

    if (error) return c.json(jsonFail(error.message), 500);

    const requests = (data ?? []).map((row: any) => row.value);
    requests.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return c.json(jsonOk(requests));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/superadmin/manual-requests/:id/approve`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const requestId = c.req.param("id");
    const supa = sb();

    const { data: searchRows, error: searchErr } = await supa
      .from("key_info")
      .select("key, value")
      .like("key", `%:${requestId}`)
      .limit(1);

    if (searchErr) return c.json(jsonFail(searchErr.message), 500);
    if (!searchRows || searchRows.length === 0) {
      return c.json(jsonFail("Permintaan pembayaran tidak ditemukan"), 404);
    }

    const { key, value: requestObj } = searchRows[0];

    if (requestObj.status !== "pending") {
      return c.json(jsonFail("Permintaan pembayaran ini sudah diproses sebelumnya"), 400);
    }

    const adminUser = c.get("authUser");

    const { data: balance, error: balErr } = await supa
      .from("billing_balance")
      .select("tokens_balance")
      .eq("org_id", requestObj.org_id)
      .maybeSingle();

    if (balErr) return c.json(jsonFail(balErr.message), 500);

    const currentBalance = balance ? Number(balance.tokens_balance ?? 0) : 0;
    const newBalance = currentBalance + Number(requestObj.amount_tokens);

    const { error: upsertErr } = await supa
      .from("billing_balance")
      .upsert({
        org_id: requestObj.org_id,
        tokens_balance: newBalance,
        updated_at: nowIso(),
      }, { onConflict: "org_id" });

    if (upsertErr) return c.json(jsonFail(upsertErr.message), 500);

    const { error: txErr } = await supa
      .from("billing_transactions")
      .insert({
        org_id: requestObj.org_id,
        type: "topup",
        tokens_delta: Number(requestObj.amount_tokens),
        amount_idr: Number(requestObj.amount_idr),
        description: `Top-up manual disetujui (${requestObj.amount_tokens} token)`,
        created_by: adminUser.id,
      });

    if (txErr) {
      console.warn("Failed to insert billing transaction record for manual topup approval:", txErr);
    }

    requestObj.status = "approved";
    requestObj.approved_at = nowIso();
    requestObj.approved_by = adminUser.email;

    const { error: saveErr } = await supa
      .from("key_info")
      .upsert({ key, value: requestObj });

    if (saveErr) return c.json(jsonFail(saveErr.message), 500);

    return c.json(jsonOk(requestObj));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
});

app.post(`${API_PREFIX}/superadmin/manual-requests/:id/reject`, requireAuth, requireSuperadmin, async (c) => {
  try {
    const requestId = c.req.param("id");
    const { notes } = await c.req.json();
    const adminUser = c.get("authUser");
    const supa = sb();

    const { data: searchRows, error: searchErr } = await supa
      .from("key_info")
      .select("key, value")
      .like("key", `%:${requestId}`)
      .limit(1);

    if (searchErr) return c.json(jsonFail(searchErr.message), 500);
    if (!searchRows || searchRows.length === 0) {
      return c.json(jsonFail("Permintaan pembayaran tidak ditemukan"), 404);
    }

    const { key, value: requestObj } = searchRows[0];

    if (requestObj.status !== "pending") {
      return c.json(jsonFail("Permintaan pembayaran ini sudah diproses sebelumnya"), 400);
    }

    requestObj.status = "rejected";
    requestObj.approved_at = nowIso();
    requestObj.approved_by = adminUser.email;
    requestObj.notes = notes || "Ditolak oleh admin";

    const { error: saveErr } = await supa
      .from("key_info")
      .upsert({ key, value: requestObj });

    if (saveErr) return c.json(jsonFail(saveErr.message), 500);

    return c.json(jsonOk(requestObj));
  } catch (e) {
    return c.json(jsonFail(e), 500);
  }
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
