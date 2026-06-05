export const env = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string,
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL as string,
};

if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.API_BASE_URL) {
  console.warn("Missing env. Check .env.local (VITE_*)");
}