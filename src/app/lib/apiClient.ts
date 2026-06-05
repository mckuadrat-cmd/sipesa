// src/app/lib/apiClient.ts

const DEFAULT_BASE_URL =
  "https://gwokwhznesggqoqrzaet.supabase.co/functions/v1/server";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

const TOKEN_KEY = "SIPESA_SESSION";
const SESSION_HEADER = "x-sipesa-session";

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
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

export type ApiOk<T> = { success: true; data: T };
export type ApiFail = { success: false; error: string };
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
  const token = getAuthToken();

  const headers: Record<string, string> = {
    ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
    ...(ANON_KEY ? { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } : {}),
    ...(init?.headers as any),
  };

  if (token) headers[SESSION_HEADER] = token;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      clearAuthToken();
      window.dispatchEvent(new Event("sipesa-unauthorized"));
    }
    return {
      success: false,
      error: normalizeError(data, res.status),
    };
  }

  if (data && typeof data === "object" && "success" in data) {
    return data as ApiResponse<T>;
  }

  return { success: true, data: data as T };
}