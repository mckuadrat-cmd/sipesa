// src/app/lib/apiClient.ts

const DEFAULT_BASE_URL =
  "https://gwokwhznesggqoqrzaet.supabase.co/functions/v1/server";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

const TOKEN_KEY = "SIPESA_SESSION";
const SESSION_HEADER = "x-sipesa-session";
const SESSION_EXPIRED_MESSAGE = "Sesi Anda telah berakhir. Silakan masuk kembali.";
const NETWORK_ERROR_MESSAGE = "Layanan sementara tidak dapat dijangkau. Silakan coba lagi.";
let sessionInvalidated = false;
let unauthorizedEventDispatched = false;

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
  sessionInvalidated = false;
  unauthorizedEventDispatched = false;
}

export function getAuthToken() {
  try {
    const key = "sb-gwokwhznesggqoqrzaet-auth-token";
    const sessionStr = localStorage.getItem(key);
    if (sessionStr) {
      const session = JSON.parse(sessionStr);
      if (session?.access_token) {
        const localToken = localStorage.getItem(TOKEN_KEY);
        if (localToken !== session.access_token) {
          localStorage.setItem(TOKEN_KEY, session.access_token);
        }
        return session.access_token;
      }
    }
  } catch (err) {
    console.warn("Failed to parse Supabase token from local storage:", err);
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function invalidateSessionOnce() {
  sessionInvalidated = true;
  clearAuthToken();
  if (!unauthorizedEventDispatched && typeof window !== "undefined") {
    unauthorizedEventDispatched = true;
    window.dispatchEvent(new Event("sipesa-unauthorized"));
  }
}

function canRunWithoutCurrentSession(path: string) {
  return path.endsWith("/auth/login");
}

export type ApiOk<T> = { success: true; data: T };
export type ApiFail = { success: false; error: string; code?: string; retryable?: boolean };
export type ApiResponse<T = any> = ApiOk<T> | ApiFail;

function normalizeError(data: any, status: number) {
  if (typeof data?.error === "string") return data.error;
  if (typeof data?.message === "string") return data.message;

  if (data?.error && typeof data.error === "object") {
    if (typeof data.error.message === "string") return data.error.message;
    try {
      return JSON.stringify(data.error);
    } catch {
      return `HTTP_${status}`;
    }
  }

  try {
    if (data) return JSON.stringify(data);
  } catch {}

  return `HTTP_${status}`;
}

export function isApiFail<T>(res: ApiResponse<T>): res is ApiFail {
  return "error" in res;
}

export function isApiOk<T>(res: ApiResponse<T>): res is ApiOk<T> {
  return "data" in res;
}

export async function apiFetch<T = any>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  if (sessionInvalidated && !canRunWithoutCurrentSession(path)) {
    return { success: false, error: SESSION_EXPIRED_MESSAGE, code: "SESSION_EXPIRED", retryable: false };
  }
  const token = getAuthToken();

  const headers: Record<string, string> = {
    ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
    ...(ANON_KEY ? { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } : {}),
    ...(init?.headers as any),
  };

  if (token) headers[SESSION_HEADER] = token;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
    });
  } catch {
    return { success: false, error: NETWORK_ERROR_MESSAGE, code: "NETWORK_ERROR", retryable: true };
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401) invalidateSessionOnce();
    return {
      success: false,
      error: res.status === 401 ? SESSION_EXPIRED_MESSAGE : normalizeError(data, res.status),
      code: res.status === 401 ? "SESSION_EXPIRED" : typeof data?.code === "string" ? data.code : undefined,
      retryable: res.status === 401 ? false : typeof data?.retryable === "boolean" ? data.retryable : undefined,
    };
  }

  if (data && typeof data === "object" && "success" in data) {
    return data as ApiResponse<T>;
  }

  return { success: true, data: data as T };
}

export async function apiFetchBlob(path: string): Promise<ApiResponse<Blob>> {
  if (sessionInvalidated) {
    return { success: false, error: SESSION_EXPIRED_MESSAGE, code: "SESSION_EXPIRED", retryable: false };
  }
  const token = getAuthToken();
  const headers: Record<string, string> = {
    ...(ANON_KEY ? { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } : {}),
  };
  if (token) headers[SESSION_HEADER] = token;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers,
      cache: "no-store",
    });
  } catch {
    return { success: false, error: NETWORK_ERROR_MESSAGE, code: "NETWORK_ERROR", retryable: true };
  }

  if (!res.ok) {
    let data: any = null;
    try {
      data = await res.json();
    } catch {}
    if (res.status === 401) invalidateSessionOnce();
    return {
      success: false,
      error: res.status === 401 ? SESSION_EXPIRED_MESSAGE : normalizeError(data, res.status),
      code: res.status === 401 ? "SESSION_EXPIRED" : undefined,
      retryable: res.status === 401 ? false : undefined,
    };
  }

  return { success: true, data: await res.blob() };
}
