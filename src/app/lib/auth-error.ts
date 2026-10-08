export type AuthErrorContext = "login" | "register" | "forgot" | "recovery";

export function authErrorMessage(error: unknown, context: AuthErrorContext): string {
  const candidate = error && typeof error === "object" ? error as any : null;
  const code = String(candidate?.code ?? candidate?.error_code ?? "").toLowerCase();
  const status = Number(candidate?.status ?? candidate?.statusCode ?? 0);
  const raw = String(
    candidate?.message ??
      candidate?.error?.message ??
      candidate?.error ??
      (typeof error === "string" ? error : ""),
  ).toLowerCase();

  if (status === 429 || code.includes("rate_limit") || raw.includes("rate limit") || raw.includes("too many")) {
    return "Terlalu banyak percobaan. Tunggu beberapa saat, lalu coba lagi.";
  }
  if (
    code.includes("network") ||
    raw.includes("failed to fetch") ||
    raw.includes("network") ||
    raw.includes("load failed")
  ) {
    return "Koneksi bermasalah. Periksa internet Anda lalu coba lagi.";
  }
  if (context === "login" && (
    code === "invalid_credentials" ||
    raw.includes("invalid login credentials") ||
    raw.includes("invalid credential") ||
    raw.includes("email atau password") ||
    raw.includes("username atau password")
  )) {
    return "Email/username atau password tidak valid.";
  }
  if (
    code === "email_not_confirmed" ||
    raw.includes("email not confirmed") ||
    raw.includes("email belum diverifikasi")
  ) {
    return "Email belum diverifikasi. Periksa kotak masuk Anda sebelum login.";
  }
  if (context === "recovery" && (
    code.includes("otp_expired") ||
    code.includes("invalid_token") ||
    raw.includes("expired") ||
    raw.includes("invalid") ||
    raw.includes("token")
  )) {
    return "Tautan pemulihan tidak valid atau sudah kedaluwarsa. Minta tautan baru dari halaman login.";
  }
  if (context === "register" && (
    code === "user_already_exists" ||
    raw.includes("already registered") ||
    raw.includes("already exists")
  )) {
    return "Pendaftaran belum dapat diproses. Gunakan email lain atau masuk dengan akun yang sudah ada.";
  }

  if (context === "login") return "Login belum berhasil. Periksa data Anda lalu coba lagi.";
  if (context === "register") return "Pendaftaran belum dapat diproses. Silakan coba lagi.";
  if (context === "forgot") return "Permintaan pemulihan belum dapat diproses. Silakan coba lagi.";
  return "Password belum dapat diperbarui. Silakan minta tautan pemulihan baru.";
}
