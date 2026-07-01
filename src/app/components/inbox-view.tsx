import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Phone, MessageCircle, Clock } from "lucide-react";

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
}

function formatDate(date: string) {
  if (!date) return "-";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleString("id-ID");
}

export function InboxView({ numbers, onSelectNumber }: InboxViewProps) {
  return (
    <div className="w-full p-6 md:p-8 bg-white min-h-screen">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">Kotak Masuk WhatsApp</h1>
        <p className="text-sm text-slate-500 mt-1.5 leading-relaxed break-words whitespace-normal max-w-2xl">
          Kelola percakapan dari semua nomor WABA Anda.
        </p>
      </div>

      {numbers.length === 0 ? (
        <Card className="p-10 text-center">
          <Phone className="w-14 h-14 mx-auto mb-4 text-muted-foreground opacity-20" />
          <h3 className="mb-2">Belum ada nomor WhatsApp</h3>
          <p className="text-muted-foreground">
            Tambahkan nomor WABA terlebih dahulu untuk mulai membuka inbox
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {numbers.map((number) => (
            <Card
              key={number.id}
              className="p-6 hover:shadow-lg transition-all cursor-pointer hover:border-primary"
              onClick={() => onSelectNumber(number.id)}
              style={{ backgroundColor: number.unreadCount > 0 ? "#F0EAC6" : "white" }}
            >
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
          ))}
        </div>
      )}
    </div>
  );
}