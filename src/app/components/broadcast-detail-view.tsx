import { useState, useEffect, useMemo, useRef } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ArrowLeft, CheckCircle, Clock, XCircle, Search, Download, Eye, CheckCircle2, Send, Loader2, Clock3 } from "lucide-react";
import { api } from "../lib/api";
import { AppModal } from "./AppModal";
import { supabase } from "../lib/supabaseClient";

interface RecipientStatus {
  id: string;
  contactName: string;
  contactPhone: string;
  status: "pending" | "processing" | "accepted" | "sent" | "delivered" | "read" | "failed" | "cancelled";
  timestamp: string;
  errorMessage?: string;
}

interface BroadcastDetail {
  id: string;
  numberId: string;
  numberName: string;
  message: string;
  totalRecipients: number;
  createdAt: string;
  recipients: RecipientStatus[];
}

interface BroadcastDetailViewProps {
  broadcastId: string;
  onBack: () => void;
}

function formatDate(date?: string) {
  if (!date || date === "-") return "-";
  try {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return date;
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = pad(d.getDate());
    const month = pad(d.getMonth() + 1);
    const year = d.getFullYear();
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${day}-${month}-${year} ${hours}:${minutes} WIB`;
  } catch {
    return date;
  }
}

function translateError(err?: string) {
  if (!err) return "-";
  const lower = err.toLowerCase();
  if (lower.includes("capability mismatch") || lower.includes("not register") || lower.includes("not on whatsapp")) {
    return "Nomor tidak terdaftar di WhatsApp";
  }
  if (lower.includes("structure unavailable") || lower.includes("format") || lower.includes("template")) {
    return "Struktur template tidak cocok atau tidak tersedia";
  }
  if (lower.includes("rate limit") || lower.includes("throttled") || lower.includes("spam")) {
    return "Pengiriman dibatasi / diblokir oleh Meta (Spam/Limit)";
  }
  if (lower.includes("balance") || lower.includes("token")) {
    return "Saldo/token tidak cukup";
  }
  if (lower.includes("parameter") || lower.includes("variable")) {
    return "Variabel parameter tidak sesuai";
  }
  if (lower.includes("media") || lower.includes("header")) {
    return "File media header wajib diunggah";
  }
  return err;
}

const InfoTooltip = ({ text }: { text: string }) => {
  if (!text || text === "-") return <span className="text-slate-400">-</span>;
  return (
    <div className="relative group inline-block max-w-full cursor-help">
      <div className="truncate text-slate-500 max-w-[280px]">
        {text}
      </div>
      <div className="absolute right-full top-1/2 -translate-y-1/2 mr-2 hidden group-hover:block bg-slate-900 text-white text-xs rounded-lg px-3 py-2 z-[999] whitespace-normal w-64 shadow-xl pointer-events-none">
        {text}
        <div className="absolute left-full top-1/2 -translate-y-1/2 border-4 border-transparent border-l-slate-900"></div>
      </div>
    </div>
  );
};

export function BroadcastDetailView({ broadcastId, onBack }: BroadcastDetailViewProps) {
  const [broadcast, setBroadcast] = useState<BroadcastDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadDetail = async (showLoading = true) => {
      if (!active) return;
      if (showLoading) setLoading(true);
      try {
        const result = await api.getBroadcastDetail(broadcastId);
        if (active) {
          if ("error" in result) {
            setError(result.error);
          } else {
            setBroadcast(result.data);
            setError("");
          }
        }
      } catch (err) {
        console.error(err);
        if (active && showLoading) setError("Gagal memuat detail broadcast");
      } finally {
        if (active && showLoading) setLoading(false);
      }
    };

    loadDetail(true);

    const channelStatusRef = { current: "INITIAL" };
    const channelName = `bc-detail-recipients-${broadcastId}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wa_broadcasts",
          filter: `id=eq.${broadcastId}`,
        },
        () => {
          if (!active) return;
          loadDetail(false);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wa_broadcast_recipients",
          filter: `broadcast_id=eq.${broadcastId}`,
        },
        (payload) => {
          if (!active) return;
          if (payload.eventType === "UPDATE" || payload.eventType === "INSERT") {
            const updated = payload.new;
            if (updated && updated.id) {
              setBroadcast((prev: any) => {
                if (!prev || !prev.recipients) return prev;
                return {
                  ...prev,
                  recipients: prev.recipients.map((r: any) =>
                    r.id === updated.id
                      ? {
                          ...r,
                          status: updated.status || "pending",
                          timestamp: updated.sent_at ?? updated.updated_at ?? updated.created_at ?? "-",
                          errorMessage: updated.error ?? undefined,
                        }
                      : r
                  ),
                };
              });
            }
          }
        }
      );

    channel.subscribe((status) => {
      if (!active) return;
      channelStatusRef.current = status;
      if (status === "SUBSCRIBED") {
        loadDetail(false);
      }
    });

    let tickCount = 0;
    const interval = setInterval(() => {
      if (!active) return;
      if (document.visibilityState === "hidden") return;

      tickCount++;
      const isSubscribed = channelStatusRef.current === "SUBSCRIBED";
      const pollInterval = isSubscribed ? 20 : 5;

      if (tickCount % pollInterval === 0) {
        loadDetail(false);
      }
    }, 1000);

    return () => {
      active = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [broadcastId]);

  const loadBroadcastDetail = async (showLoading = true) => {
    // Stub kept for compatibility
  };

  const stats = useMemo(() => {
    if (!broadcast) return { total: 0, accepted: 0, sent: 0, delivered: 0, read: 0, failed: 0 };

    const r = broadcast.recipients;

    const sentCount = r.filter((x) => x.status === "accepted" || x.status === "processing" || x.status === "sent").length;
    const deliveredCount = r.filter((x) => x.status === "delivered").length;
    const readCount = r.filter((x) => x.status === "read").length;
    const failedCount = r.filter((x) => x.status === "failed").length;

    return {
      total: r.length,
      sent: sentCount,
      delivered: deliveredCount,
      read: readCount,
      failed: failedCount,
    };
  }, [broadcast]);

  const filteredRecipients = useMemo(() => {
    if (!broadcast) return [];

    return broadcast.recipients.filter((r) => {
      const search =
        (r.contactName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.contactPhone || "").includes(searchQuery);

      let filter = false;
      if (filterStatus === "all") {
        filter = true;
      } else if (filterStatus === "sent") {
        filter = r.status === "accepted" || r.status === "processing" || r.status === "sent";
      } else {
        filter = r.status === filterStatus;
      }

      return search && filter;
    });
  }, [broadcast, searchQuery, filterStatus]);

  function renderStatusBadge(status?: string | null) {
    const s = String(status || "").toLowerCase().trim();

    if (s === "read") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
          <Eye className="w-3 h-3" />
          Read
        </span>
      );
    }

    if (s === "delivered") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
          <CheckCircle2 className="w-3 h-3" />
          Delivered
        </span>
      );
    }

    if (s === "processing") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
          Processing
        </span>
      );
    }

    if (s === "accepted" || s === "sent") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
          <Send className="w-3 h-3" />
          Sent
        </span>
      );
    }

    if (s === "failed") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
          <XCircle className="w-3 h-3" />
          Failed
        </span>
      );
    }

    if (s === "cancelled") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
          <XCircle className="w-3 h-3" />
          Cancelled
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
        <Clock3 className="w-3 h-3" />
        Pending
      </span>
    );
  }

  const exportCsv = () => {
    if (!broadcast) return;

    const header = ["Nama", "Nomor", "Status", "Waktu", "Error"];

    const rows = filteredRecipients.map((r) => [
      r.contactName,
      r.contactPhone,
      r.status,
      r.status === "failed" ? translateError(r.errorMessage) : formatDate(r.timestamp),
      r.errorMessage || "",
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `broadcast-${broadcastId}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  };

  return (
    <AppModal
      open={true}
      title="Detail Broadcast"
      description={broadcast ? "Status pengiriman per nomor" : ""}
      onClose={onBack}
      maxWidthClassName="max-w-4xl"
    >
      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full w-10 h-10 border-b-2 border-slate-700" />
        </div>
      ) : !broadcast ? (
        <div className="p-8 text-center text-slate-500">Broadcast tidak ditemukan</div>
      ) : (
        <div className="w-full flex flex-col gap-4 max-h-none sm:max-h-[75vh] overflow-y-visible sm:overflow-y-auto pr-1">

          {error && (
            <Card className="p-4 bg-red-50 border-red-200 text-red-700">
              {error}
            </Card>
          )}

          {/* Info Broadcast */}
          <Card className="p-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-medium">Pengirim:</span>
                  <span className="font-semibold text-slate-800">{broadcast.numberName}</span>
                </div>
                <div className="hidden sm:block text-slate-300">|</div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-medium">Tanggal:</span>
                  <span className="text-slate-700 font-medium">{formatDate(broadcast.createdAt)}</span>
                </div>
                <div className="hidden sm:block text-slate-300">|</div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-medium">Total Penerima:</span>
                  <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-full font-bold">{broadcast.totalRecipients}</span>
                </div>
              </div>

              {broadcast.message && (
                <div className="bg-slate-50 p-4 rounded-xl border text-sm whitespace-pre-wrap text-slate-600 leading-relaxed max-h-48 overflow-y-auto">
                  <div className="font-semibold text-slate-700 mb-1">Isi Pesan:</div>
                  {broadcast.message}
                </div>
              )}
            </div>
          </Card>

          {/* Statistik */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            <Card
              className={`p-4 text-center cursor-pointer transition-all duration-200 border ${filterStatus === "all" ? "border-slate-800 bg-slate-50/50 shadow-sm" : "border-slate-100 hover:border-slate-300"
                }`}
              onClick={() => setFilterStatus("all")}
            >
              <div className="text-xs text-slate-500 font-semibold mb-1">Total</div>
              <div className="text-xl font-bold text-slate-800">{stats.total}</div>
            </Card>
            <Card
              className={`p-4 text-center cursor-pointer transition-all duration-200 border ${filterStatus === "sent" ? "border-amber-800 bg-amber-50/30 shadow-sm" : "border-slate-100 hover:border-slate-300"
                }`}
              onClick={() => setFilterStatus("sent")}
            >
              <div className="text-xs text-amber-600 font-semibold mb-1">Sent</div>
              <div className="text-xl font-bold text-amber-700">{stats.sent}</div>
            </Card>
            <Card
              className={`p-4 text-center cursor-pointer transition-all duration-200 border ${filterStatus === "delivered" ? "border-green-800 bg-green-50/30 shadow-sm" : "border-slate-100 hover:border-slate-300"
                }`}
              onClick={() => setFilterStatus("delivered")}
            >
              <div className="text-xs text-green-600 font-semibold mb-1">Delivered</div>
              <div className="text-xl font-bold text-green-700">{stats.delivered}</div>
            </Card>
            <Card
              className={`p-4 text-center cursor-pointer transition-all duration-200 border ${filterStatus === "read" ? "border-blue-800 bg-blue-50/30 shadow-sm" : "border-slate-100 hover:border-slate-300"
                }`}
              onClick={() => setFilterStatus("read")}
            >
              <div className="text-xs text-blue-600 font-semibold mb-1">Read</div>
              <div className="text-xl font-bold text-blue-700">{stats.read}</div>
            </Card>
            <Card
              className={`p-4 text-center cursor-pointer transition-all duration-200 border ${filterStatus === "failed" ? "border-red-800 bg-red-50/30 shadow-sm" : "border-slate-100 hover:border-slate-300"
                }`}
              onClick={() => setFilterStatus("failed")}
            >
              <div className="text-xs text-red-600 font-semibold mb-1">Failed</div>
              <div className="text-xl font-bold text-red-700">{stats.failed}</div>
            </Card>
          </div>

          {/* Tabel detail */}
          <Card className="overflow-hidden border border-slate-100 rounded-xl">
            <div className="p-4 bg-slate-50/50 border-b flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Cari nama atau nomor..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-white"
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                className="w-full sm:w-auto flex items-center justify-center gap-2 border-slate-200 hover:bg-slate-50"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </Button>
            </div>

            <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
              <table className="w-full min-w-[600px]">
                <thead className="bg-slate-50/80 border-b text-slate-600 text-xs font-semibold uppercase tracking-wider sticky top-0 z-10">
                  <tr>
                    <th className="px-6 py-3 text-left">Nama Kontak</th>
                    <th className="px-6 py-3 text-left">Nomor WhatsApp</th>
                    <th className="px-6 py-3 text-left">Status</th>
                    <th className="px-6 py-3 text-left">Waktu</th>
                    <th className="px-6 py-3 text-left">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                  {filteredRecipients.map((r) => {
                    const rowId = `rec-row-${r.id}`;
                    const isProcessing = r.status === "processing";

                    return (
                      <tr
                        key={r.id}
                        id={rowId}
                        ref={(el) => {
                          if (el) {
                            rowRefs.current.set(r.id, el);
                          } else {
                            rowRefs.current.delete(r.id);
                          }
                        }}
                        className={`hover:bg-slate-50/50 transition-colors ${isProcessing
                          ? "bg-amber-50/30 ring-1 ring-amber-100/50"
                          : ""
                          }`}
                      >
                        <td className="px-6 py-4 font-medium text-slate-900">{r.contactName}</td>
                        <td className="px-6 py-4 font-mono text-slate-600">{r.contactPhone}</td>
                        <td className="px-6 py-4">{renderStatusBadge(r.status)}</td>
                        <td className="px-6 py-4 text-slate-500 whitespace-nowrap">
                          {r.status === "failed" ? translateError(r.errorMessage) : formatDate(r.timestamp)}
                        </td>
                        <td className="px-6 py-4 text-slate-500 max-w-xs truncate">
                          {r.errorMessage || "-"}
                        </td>
                      </tr>
                    );
                  })}

                  {filteredRecipients.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400 text-sm font-medium">
                        Tidak ada data penerima ditemukan
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </AppModal>
  );
}