import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Lock } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { authErrorMessage } from "../lib/auth-error";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type PasswordRecoveryViewProps = {
  callbackError?: string | null;
  onReturnToLogin: () => void;
};

export function PasswordRecoveryView({ callbackError, onReturnToLogin }: PasswordRecoveryViewProps) {
  const [checking, setChecking] = useState(!callbackError);
  const [sessionReady, setSessionReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState(callbackError ? authErrorMessage(callbackError, "recovery") : "");

  useEffect(() => {
    if (callbackError) return;
    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError || !data.session) {
        setError(authErrorMessage(sessionError ?? { code: "invalid_token" }, "recovery"));
      } else {
        setSessionReady(true);
      }
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [callbackError]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || !sessionReady) return;
    setError("");
    if (password.length < 8) {
      setError("Password baru minimal 8 karakter.");
      return;
    }
    if (password !== confirmation) {
      setError("Konfirmasi password baru tidak sama.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(authErrorMessage(updateError, "recovery"));
      setSubmitting(false);
      return;
    }
    await supabase.auth.signOut();
    setComplete(true);
    setSubmitting(false);
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 sm:p-8 rounded-3xl shadow-xl border-slate-100">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-[#DF7A5E]/10 text-[#DF7A5E] flex items-center justify-center mx-auto mb-4">
            {complete ? <CheckCircle2 className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
          </div>
          <h1 className="text-2xl font-bold text-[#3C405B]">{complete ? "Password Diperbarui" : "Buat Password Baru"}</h1>
          <p className="text-sm text-slate-500 mt-2">
            {complete ? "Password Anda sudah diperbarui. Silakan login kembali." : "Gunakan minimal 8 karakter untuk password baru Anda."}
          </p>
        </div>

        {checking ? (
          <p className="text-sm text-center text-slate-500" role="status">Memeriksa tautan pemulihan...</p>
        ) : complete ? (
          <Button className="w-full h-11" onClick={onReturnToLogin}>Kembali ke Login</Button>
        ) : error && !sessionReady ? (
          <div className="space-y-4">
            <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
            <Button variant="outline" className="w-full h-11" onClick={onReturnToLogin}>Minta Tautan Baru</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div id="recovery-error" className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div>
              <Label htmlFor="new-password">Password Baru</Label>
              <Input id="new-password" type="password" className="mt-2" value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? "recovery-error" : undefined} disabled={submitting} />
            </div>
            <div>
              <Label htmlFor="confirm-new-password">Konfirmasi Password Baru</Label>
              <Input id="confirm-new-password" type="password" className="mt-2" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? "recovery-error" : undefined} disabled={submitting} />
            </div>
            <Button type="submit" className="w-full h-11" disabled={submitting || !password || !confirmation}>
              {submitting ? "Memperbarui..." : "Perbarui Password"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
