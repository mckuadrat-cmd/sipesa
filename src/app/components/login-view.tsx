import { useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Lock, Mail, Eye, EyeOff, AlertCircle, Building2, UserRound, Phone } from "lucide-react";
import { AppModal } from "./AppModal";

interface LoginViewProps {
  onLogin: (identifier: string, password: string) => Promise<void>;
  onSignup: (
    identifier: string,
    password: string,
    name: string,
    orgName: string,
    username: string,
    waNumber: string
  ) => Promise<{ emailVerificationRequired: boolean } | void>;
}

function getErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;

  if (err && typeof err === "object") {
    const e = err as any;

    if (typeof e.message === "string" && e.message.trim()) return e.message;
    if (typeof e.error === "string" && e.error.trim()) return e.error;

    if (e.error && typeof e.error === "object") {
      if (typeof e.error.message === "string" && e.error.message.trim()) {
        return e.error.message;
      }
      try {
        return JSON.stringify(e.error);
      } catch {
        return "Terjadi kesalahan";
      }
    }

    try {
      return JSON.stringify(e);
    } catch {
      return "Terjadi kesalahan";
    }
  }

  return "Terjadi kesalahan";
}

function normalizeUsername(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function LoginView({ onLogin, onSignup }: LoginViewProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [isRegistered, setIsRegistered] = useState(false);

  const [identifier, setIdentifier] = useState("");
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [waNumber, setWaNumber] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showRulesModal, setShowRulesModal] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!username.trim()) {
      setUsername(normalizeUsername(value));
    }
  };

  const resetFormError = () => setError("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!identifier.trim() && isLogin) {
      setError("Email atau username wajib diisi");
      return;
    }

    if (!password.trim()) {
      setError("Password wajib diisi");
      return;
    }

    if (!isLogin) {
      if (!orgName.trim()) {
        setError("Instansi / Sekolah wajib diisi");
        return;
      }

      if (!name.trim()) {
        setError("Nama lengkap wajib diisi");
        return;
      }

      if (!username.trim()) {
        setError("Username wajib diisi");
        return;
      }

      if (!/^[a-z0-9_]+$/.test(username.trim())) {
        setError("Username hanya boleh huruf kecil, angka, dan underscore");
        return;
      }

      if (!waNumber.trim()) {
        setError("No. WhatsApp wajib diisi");
        return;
      }

      if (!identifier.trim()) {
        setError("Email wajib diisi");
        return;
      }

      if (!/\S+@\S+\.\S+/.test(identifier.trim())) {
        setError("Format email tidak valid");
        return;
      }

      if (password.length < 8) {
        setError("Password minimal 8 karakter");
        return;
      }

      if (password !== confirmPassword) {
        setError("Konfirmasi password tidak sama");
        return;
      }

      setAgreed(false);
      setShowRulesModal(true);
      return;
    }

    setLoading(true);

    try {
      await onLogin(identifier.trim(), password);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSignup = async () => {
    setShowRulesModal(false);
    setLoading(true);
    try {
      const res = await onSignup(
        identifier.trim(),
        password,
        name.trim(),
        orgName.trim(),
        normalizeUsername(username),
        waNumber.trim()
      );
      if (res?.emailVerificationRequired) {
        setIsRegistered(true);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="h-screen overflow-hidden grid lg:grid-cols-2"
      style={{ background: "linear-gradient(135deg, #F0EAC6 0%, #f6f2dd 100%)" }}
    >
      <div className="hidden lg:flex flex-col justify-center px-40 py-16 bg-[#3C405B] text-white">
        <img src="/sipesa-white.png" alt="SIPESA Logo" className="h-20 w-fit mb-8" />
        <p className="text-lg text-white/80 mb-8 max-w-xl">
          Platform WhatsApp Business untuk sekolah, instansi, dan tim yang ingin
          mengelola inbox, template, billing, dan broadcast dalam satu dashboard.
        </p>

        <div className="space-y-4 text-sm text-white/85">
          <div className="rounded-2xl bg-white/10 p-4">
            Multi-tenant per instansi / sekolah
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            Inbox, template, broadcast, dan billing dalam satu sistem
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            Siap terkoneksi dengan WhatsApp Business API Meta
          </div>
        </div>
      </div>

      <div className="h-full flex items-center justify-center p-4 md:p-8 overflow-hidden">
        {isRegistered ? (
          <Card className="w-full max-w-md p-6 md:p-10 shadow-xl rounded-3xl border-0 flex flex-col items-center text-center justify-center">
            <div className="rounded-full bg-emerald-50 p-4 mb-6 text-emerald-600">
              <Mail className="w-12 h-12" />
            </div>
            <h2 className="text-2xl font-bold mb-3" style={{ color: "#3C405B" }}>
              Registrasi Berhasil!
            </h2>
            <p className="text-muted-foreground mb-6">
              Kami telah mengirimkan email verifikasi ke <strong className="text-foreground">{identifier}</strong>.<br />
              Silakan periksa kotak masuk (atau folder spam) Anda dan klik link verifikasi sebelum melakukan login.
            </p>
            <Button
              onClick={() => {
                setIsRegistered(false);
                setIsLogin(true);
                setPassword("");
                setConfirmPassword("");
                setWaNumber("");
              }}
              className="w-full h-11 rounded-xl"
              style={{ backgroundColor: "#DF7A5E" }}
            >
              Kembali ke Login
            </Button>
          </Card>
        ) : (
          <Card className="w-full max-w-md p-6 md:p-10 shadow-xl rounded-3xl border-0 flex flex-col max-h-full overflow-hidden">
            <div className="text-center mb-4 flex-shrink-0">
              <img
                src="/logo-sipesa.png"
                alt="SIPESA Logo"
                className="h-16 mx-auto mb-4 hover:scale-105 transition-transform"
              />

              <h1 className="text-3xl font-bold mb-2" style={{ color: "#3C405B" }}>
                {isLogin ? "Login" : "Register"}
              </h1>

              <p className="text-muted-foreground">
                {isLogin
                  ? "Masuk untuk mengelola WhatsApp Business Anda"
                  : "Buat akun untuk mulai mengelola WhatsApp Business Anda dengan mudah"}
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-5 flex items-start gap-2 text-red-700 flex-shrink-0">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p className="text-sm break-words">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 space-y-4 overflow-hidden">
              <div className="space-y-4 overflow-y-auto flex-1 pr-1 pb-2">
                {!isLogin && (
                  <>
                    <div>
                      <Label>Instansi / Sekolah *</Label>
                      <div className="relative mt-2">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Contoh: SMP Mulia Berbagi"
                          value={orgName}
                          onChange={(e) => {
                            setOrgName(e.target.value);
                            resetFormError();
                          }}
                          className="pl-10"
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Nama Lengkap *</Label>
                      <div className="relative mt-2">
                        <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Masukkan nama lengkap"
                          value={name}
                          onChange={(e) => {
                            handleNameChange(e.target.value);
                            resetFormError();
                          }}
                          className="pl-10"
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Username *</Label>
                      <div className="relative mt-2">
                        <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="contoh: smp_muliaberbagi"
                          value={username}
                          onChange={(e) => {
                            setUsername(normalizeUsername(e.target.value));
                            resetFormError();
                          }}
                          className="pl-10"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Hanya huruf kecil, angka, dan underscore
                      </p>
                    </div>

                    <div>
                      <Label>No. WhatsApp *</Label>
                      <div className="relative mt-2">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Contoh: 08123456789"
                          value={waNumber}
                          onChange={(e) => {
                            setWaNumber(e.target.value);
                            resetFormError();
                          }}
                          className="pl-10"
                        />
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <Label>{isLogin ? "Email / Username" : "Email *"}</Label>
                  <div className="relative mt-2">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type={isLogin ? "text" : "email"}
                      placeholder={isLogin ? "Masukkan email/username anda" : "email@example.com"}
                      value={identifier}
                      onChange={(e) => {
                        setIdentifier(e.target.value);
                        resetFormError();
                      }}
                      required
                      className="pl-10"
                    />
                  </div>
                </div>

                <div>
                  <Label>Password *</Label>
                  <div className="relative mt-2">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        resetFormError();
                      }}
                      required
                      className="pl-10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {!isLogin && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Minimal 8 karakter
                    </p>
                  )}
                </div>

                {!isLogin && (
                  <div>
                    <Label>Konfirmasi Password *</Label>
                    <div className="relative mt-2">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          resetFormError();
                        }}
                        required
                        className="pl-10 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-shrink-0 pt-2">
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 rounded-xl"
                  style={{ backgroundColor: "#DF7A5E" }}
                >
                  {loading ? "Memproses..." : isLogin ? "Masuk" : "Daftar Sekarang"}
                </Button>
              </div>
            </form>

            <div className="text-center mt-4 flex-shrink-0">
              <p className="text-sm text-muted-foreground">
                {isLogin ? "Belum punya akun?" : "Sudah punya akun?"}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsLogin(!isLogin);
                    setError("");
                    setPassword("");
                    setConfirmPassword("");
                    setWaNumber("");
                  }}
                  className="font-medium hover:underline"
                  style={{ color: "#DF7A5E" }}
                >
                  {isLogin ? "Daftar sekarang" : "Masuk"}
                </button>
              </p>
            </div>
          </Card>
        )}
      </div>

      <AppModal
        open={showRulesModal}
        title="Pernyataan Kepatuhan Layanan"
        onClose={() => setShowRulesModal(false)}
        maxWidthClassName="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            Sebelum menyelesaikan pendaftaran, Anda wajib menyetujui pernyataan komitmen penggunaan platform di bawah ini:
          </p>

          <label className="flex gap-3 items-start p-3 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 rounded border-slate-300 text-primary focus:ring-primary w-4 h-4 cursor-pointer"
            />
            <span className="text-sm text-slate-700 leading-normal font-medium">
              Saya menyatakan bahwa seluruh penerima pesan merupakan pelanggan, anggota, peserta, atau kontak yang relevan dengan bisnis/organisasi saya. Saya tidak akan menggunakan platform ini untuk spam, pembelian database nomor, atau pengiriman pesan yang melanggar kebijakan Meta dan peraturan yang berlaku.
            </span>
          </label>

          <div className="flex gap-3 pt-2">
            <Button
              onClick={handleConfirmSignup}
              disabled={!agreed || loading}
              className="flex-1 text-white font-medium rounded-xl h-11 transition-all"
              style={{ backgroundColor: agreed ? "#DF7A5E" : "#cbd5e1", cursor: agreed ? "pointer" : "not-allowed" }}
            >
              {loading ? "Mendaftar..." : "Saya Setuju & Daftar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowRulesModal(false)}
              className="flex-1 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium rounded-xl h-11"
            >
              Batal
            </Button>
          </div>
        </div>
      </AppModal>
    </div>
  );
}