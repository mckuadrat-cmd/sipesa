import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Phone, MessageCircle, Clock, AlertTriangle, Loader2, RefreshCcw } from "lucide-react";

interface WhatsAppNumber {
  id: string;
  number: string;
  name: string;
  status: "active" | "inactive";
  unreadCount: number;
  lastActivity: string;
}

interface InboxViewProps {
  numbers: WhatsAppNumber[];
  onSelectNumber: (numberId: string) => void;
  state?: { loading: boolean; hasData: boolean; error: boolean };
  onRetry?: () => void;
}

function formatDate(date: string) {
  if (!date) return "-";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleString("id-ID");
}

export function InboxView({
  numbers,
  onSelectNumber,
  state = { loading: false, hasData: true, error: false },
  onRetry,
}: InboxViewProps) {
  return (
    <div className="w-full p-6 md:p-8 bg-white min-h-screen">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">Kotak Masuk WhatsApp</h1>
        <p className="text-sm text-slate-500 mt-1.5 leading-relaxed break-words whitespace-normal max-w-2xl">
          Kelola percakapan dari semua nomor WABA Anda.
        </p>
      </div>

      {!state.hasData && state.loading ? (
        <Card className="p-10 text-center" role="status">
          <Loader2 className="w-10 h-10 mx-auto mb-4 text-primary animate-spin" />
          <h3 className="mb-2">Memuat nomor WhatsApp...</h3>
        </Card>
      ) : !state.hasData && state.error ? (
        <Card className="p-10 text-center border-red-200 bg-red-50" role="alert">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
          <h3 className="mb-2 text-slate-900">Nomor WhatsApp belum dapat dimuat.</h3>
          <p className="text-sm text-slate-600 mb-4">Periksa koneksi lalu coba kembali.</p>
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            <RefreshCcw className="w-4 h-4" />
            Coba Lagi
          </button>
        </Card>
      ) : numbers.length === 0 ? (
        <Card className="p-10 text-center">
          <Phone className="w-14 h-14 mx-auto mb-4 text-muted-foreground opacity-20" />
          <h3 className="mb-2">Belum ada nomor WhatsApp yang tersedia.</h3>
          <p className="text-muted-foreground">
            Tambahkan nomor WABA terlebih dahulu untuk mulai membuka inbox
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {numbers.map((number) => {
            const isActive = number.status === "active";
            return (
            <button
              type="button"
              key={number.id}
              disabled={!isActive}
              onClick={() => onSelectNumber(number.id)}
              aria-label={`${number.name}, ${number.number}, ${isActive ? "aktif" : "nonaktif"}`}
              className={`w-full rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${isActive ? "cursor-pointer hover:border-primary hover:shadow-lg" : "cursor-not-allowed border-slate-200 opacity-60"}`}
              style={{ backgroundColor: number.unreadCount > 0 && isActive ? "#F0EAC6" : "white" }}
            >
              <Card className="p-6 border-0 shadow-none bg-transparent">
              <div className="flex items-start justify-between mb-4 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="bg-primary p-3 rounded-lg text-white shrink-0">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="mb-1 truncate">{number.name}</h4>
                    <p className="text-sm text-muted-foreground truncate">{number.number}</p>
                  </div>
                </div>

                <Badge
                  variant={number.status === "active" ? "default" : "secondary"}
                  className={number.status === "active" ? "bg-green-500" : ""}
                >
                  {number.status === "active" ? "Aktif" : "Nonaktif"}
                </Badge>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <MessageCircle className="w-4 h-4 text-muted-foreground" />
                  <span>
                    {number.unreadCount > 0 ? (
                      <span className="text-primary font-medium">
                        {number.unreadCount} pesan belum dibaca
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Tidak ada pesan baru</span>
                    )}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Aktivitas terakhir: {formatDate(number.lastActivity)}
                  </span>
                </div>
              </div>
              </Card>
            </button>
          )})}
        </div>
      )}

      {state.hasData && state.error && (
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
          <span>Daftar terakhir ditampilkan. Gagal memperbarui nomor WhatsApp.</span>
          <button type="button" onClick={onRetry} className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold">
            <RefreshCcw className="w-4 h-4" /> Coba Lagi
          </button>
        </div>
      )}
    </div>
  );
}
