import { useState, useEffect } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ArrowLeft, Eye, Users, CheckCircle, Clock, XCircle, MessageSquare } from "lucide-react";
import { api } from "../lib/api";

interface Broadcast {
  id: string;
  numberId: string;
  numberName: string;
  message: string;
  totalRecipients: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  createdAt: string;
  status: "sending" | "completed" | "failed" | "scheduled" | string;
}

interface BroadcastHistoryViewProps {
  onBack: () => void;
  onViewDetail: (broadcastId: string) => void;
}

function formatDate(date: string) {
  if (!date) return "-";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleString("id-ID");
}

export function BroadcastHistoryView({ onBack, onViewDetail }: BroadcastHistoryViewProps) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadBroadcasts();
  }, []);

  const loadBroadcasts = async () => {
    setLoading(true);
    try {
      const result = await api.getBroadcastHistory();

      if ("error" in result) {
        setError(result.error);
        return;
      }

      const normalized: Broadcast[] = (result.data ?? []).map((b: any) => ({
        id: b.id,
        numberId: b.numberId ?? "",
        numberName: b.numberName ?? "Nomor WA",
        message: b.message ?? "",
        totalRecipients: Number(b.totalRecipients ?? 0),
        sent: Number(b.sent ?? b.totalSent ?? 0),
        delivered: Number(b.delivered ?? 0),
        read: Number(b.read ?? 0),
        failed: Number(b.failed ?? b.totalFailed ?? 0),
        createdAt: b.createdAt ?? "-",
        status: b.status ?? "completed",
      }));

      setError("");
      setBroadcasts(normalized);
    } catch (error) {
      console.error("Error loading broadcasts:", error);
      setError("Gagal memuat riwayat broadcast.");
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-500";
      case "sending":
        return "bg-blue-500";
      case "failed":
        return "bg-red-500";
      case "scheduled":
        return "bg-purple-500";
      case "cancelled":
        return "bg-slate-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "completed":
        return "Selesai";
      case "sending":
        return "Mengirim";
      case "failed":
        return "Gagal";
      case "scheduled":
        return "Terjadwal";
      case "cancelled":
        return "Dibatalkan";
      default:
        return status;
    }
  };

  const safePercent = (value: number, total: number) => {
    if (!total || total <= 0) return 0;
    return Math.max(0, Math.min(100, (value / total) * 100));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Memuat riwayat broadcast...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <Button variant="ghost" onClick={onBack} className="mb-6">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Kembali ke Broadcast
      </Button>

      <div className="mb-8">
        <h1 className="mb-2">Riwayat Broadcast</h1>
        <p className="text-muted-foreground">Lihat detail dan status pengiriman broadcast pesan</p>
      </div>

      {error && (
        <Card className="p-4 mb-6 border-red-200 bg-red-50 text-red-700">
          {error}
        </Card>
      )}

      {broadcasts.length > 0 ? (
        <div className="space-y-4">
          {broadcasts.map((broadcast) => {
            const unsent = Math.max(
              0,
              broadcast.totalRecipients - (broadcast.sent + broadcast.delivered + broadcast.read + broadcast.failed),
            );

            return (
              <Card
                key={broadcast.id}
                className="p-6 hover:shadow-lg transition-shadow"
                style={{ backgroundColor: "#F0EAC6" }}
              >
                <div className="flex items-start justify-between mb-4 gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <h3>{broadcast.numberName}</h3>
                      <Badge className={getStatusColor(broadcast.status)}>
                        {getStatusLabel(broadcast.status)}
                      </Badge>
                    </div>

                    <p className="text-sm text-muted-foreground mb-3">
                      {formatDate(broadcast.createdAt)}
                    </p>

                    <div className="bg-white p-3 rounded-lg border mb-4">
                      <p className="text-sm line-clamp-2 whitespace-pre-wrap">{broadcast.message || "-"}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <span className="text-2xl font-medium">{broadcast.totalRecipients}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>

                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <Clock className="w-4 h-4 text-blue-500" />
                      <span className="text-2xl font-medium text-blue-600">{broadcast.sent}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Terkirim</p>
                  </div>

                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-2xl font-medium text-green-600">{broadcast.delivered}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Delivered</p>
                  </div>

                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <CheckCircle className="w-4 h-4 text-purple-500" />
                      <span className="text-2xl font-medium text-purple-600">{broadcast.read}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Dibaca</p>
                  </div>

                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <XCircle className="w-4 h-4 text-red-500" />
                      <span className="text-2xl font-medium text-red-600">{broadcast.failed}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Gagal</p>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-gray-200">
                    <div
                      className="bg-green-500"
                      style={{ width: `${safePercent(broadcast.delivered, broadcast.totalRecipients)}%` }}
                    />
                    <div
                      className="bg-purple-500"
                      style={{ width: `${safePercent(broadcast.read, broadcast.totalRecipients)}%` }}
                    />
                    <div
                      className="bg-blue-500"
                      style={{ width: `${safePercent(broadcast.sent, broadcast.totalRecipients)}%` }}
                    />
                    <div
                      className="bg-red-500"
                      style={{ width: `${safePercent(broadcast.failed, broadcast.totalRecipients)}%` }}
                    />
                    <div
                      className="bg-gray-300"
                      style={{ width: `${safePercent(unsent, broadcast.totalRecipients)}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Biaya: Rp {(broadcast.totalRecipients * 1500).toLocaleString("id-ID")}
                  </div>

                  <Button
                    onClick={() => onViewDetail(broadcast.id)}
                    className="bg-accent hover:bg-accent/90"
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    Lihat Detail
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <MessageSquare className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-20" />
          <h3 className="mb-2">Belum Ada Riwayat Broadcast</h3>
          <p className="text-muted-foreground mb-4">
            Mulai kirim broadcast untuk melihat riwayat di sini
          </p>
          <Button onClick={onBack} className="bg-primary hover:bg-primary/90">
            Buat Broadcast Baru
          </Button>
        </Card>
      )}
    </div>
  );
}