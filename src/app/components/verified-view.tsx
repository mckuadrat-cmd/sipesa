import { CheckCircle2, MessageCircle, ArrowRight } from "lucide-react";

interface VerifiedViewProps {
  onContinue: () => void;
  user?: any;
}

export function VerifiedView({ onContinue, user }: VerifiedViewProps) {
  const waAdminLink = "https://wa.me/6282312006987?text=Halo%20Admin%20SIPESA%2C%20akun%20saya%20sudah%20terverifikasi.%20Saya%20ingin%20bertanya%20lebih%20lanjut%20mengenai%20langkah%20selanjutnya.";

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden relative text-center p-8 sm:p-12">
        {/* Decorative background */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-[#DF7A5E]/10 to-transparent pointer-events-none"></div>

        <div className="relative z-10 flex flex-col items-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#3C405B] mb-2">
            Pendaftaran Berhasil!
          </h1>
          
          <p className="text-slate-600 mb-8">
            Terima kasih {user?.user_metadata?.full_name || user?.name ? ` ${user?.user_metadata?.full_name || user?.name}` : ""}, email Anda telah berhasil diverifikasi. Akun SIPESA Anda sudah aktif dan siap digunakan untuk menjangkau lebih banyak pelanggan.
          </p>

          <div className="w-full space-y-4">
            <button
              onClick={onContinue}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-[#DF7A5E] hover:bg-[#DF7A5E]/90 text-white font-bold rounded-xl shadow-lg shadow-[#DF7A5E]/20 transition-all duration-200"
            >
              Lanjutkan ke Dashboard
              <ArrowRight className="w-5 h-5" />
            </button>

            <a
              href={waAdminLink}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-white hover:bg-slate-50 border-2 border-[#3C405B] text-[#3C405B] font-bold rounded-xl transition-all duration-200"
            >
              <MessageCircle className="w-5 h-5" />
              Hubungi WhatsApp Admin
            </a>
          </div>

          <p className="mt-8 text-xs text-slate-400">
            Butuh bantuan teknis? Tim support kami selalu siap membantu Anda kapan saja.
          </p>
        </div>
      </div>
    </div>
  );
}
