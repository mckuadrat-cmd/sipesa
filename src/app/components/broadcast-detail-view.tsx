import { useState, useEffect, useMemo, useRef } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ArrowLeft, CheckCircle, Clock, XCircle, Search, Download, Eye, CheckCircle2, Send, Loader2, Clock3 } from "lucide-react";
import { api } from "../lib/api";
import { AppModal } from "./AppModal";
import { supabase } from "../lib/supabaseClient";
import { toast } from "sonner";
import { formatStoredScheduledAt } from "../lib/scheduled-at";
import type { BroadcastDetailContext } from "./broadcast-history";

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
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  createdAt: string;
  scheduledAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  status: string;
  recipients: RecipientStatus[];
  recipientPage: { total: number; page: number; pageSize: number; totalPages: number };
}

interface BroadcastDetailViewProps {
  broadcastId: string;
  historyContext: BroadcastDetailContext | null;
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

function getProcessStatus(status: string, startedAt?: string | null) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "queued" || normalized === "scheduled" || (normalized === "sending" && !startedAt)) return "Menunggu";
  if (normalized === "sending") return "Sedang Dikirim";
  if (normalized === "completed") return "Selesai";
  if (normalized === "cancelled") return "Dibatalkan";
  if (normalized === "failed") return "Gagal";
  if (normalized === "paused") return "Dijeda";
  return "Tidak diketahui";
}

function isCancellableBroadcast(broadcast: BroadcastDetail) {
  const status = String(broadcast.status || "").toLowerCase();
  const pendingSchedule = status === "queued" && !!broadcast.scheduledAt && !broadcast.startedAt;
  const activeSending = status === "sending" && !!broadcast.startedAt;
  return pendingSchedule || activeSending;
}

function getCancelUnavailableReason(broadcast: BroadcastDetail) {
  const status = String(broadcast.status || "").toLowerCase();
  if (["completed", "cancelled", "failed"].includes(status)) return "Broadcast sudah selesai dan tidak dapat dibatalkan.";
  if (status === "sending" && !broadcast.startedAt) return "Broadcast masih menunggu proses pengiriman dimulai.";
  if (status === "queued" && !broadcast.scheduledAt) return "Broadcast Direct yang belum aktif tidak dapat dibatalkan dari detail ini.";
  return "Broadcast tidak memenuhi syarat pembatalan saat ini.";
}

export function BroadcastDetailView({ broadcastId, historyContext, onBack }: BroadcastDetailViewProps) {
  const [broadcast, setBroadcast] = useState<BroadcastDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const hasLoadedRef = useRef(false);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    requestVersionRef.current += 1;
    const timeout = window.setTimeout(() => {
      setCurrentPage(1);
      setDebouncedSearch(searchQuery.trim());
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    let active = true;

    const loadDetail = async () => {
      if (!active) return;
      const requestVersion = ++requestVersionRef.current;
      if (!hasLoadedRef.current) setLoading(true);
      else setTableLoading(true);
      try {
        const result = await api.getBroadcastDetail(broadcastId, {
          page: currentPage,
          pageSize: 50,
          search: debouncedSearch || undefined,
          status: filterStatus === "all" ? undefined : filterStatus,
        });
        if (!active || requestVersion !== requestVersionRef.current) return;
        if (active) {
          if ("error" in result) {
            console.error("Broadcast detail request failed:", result.error);
            setError("Detail broadcast belum dapat dimuat. Silakan coba lagi.");
          } else {
            setBroadcast({
              ...result.data,
              status: result.data.status ?? historyContext?.status ?? "",
              scheduledAt: result.data.scheduledAt ?? historyContext?.scheduledAt,
              startedAt: result.data.startedAt ?? historyContext?.startedAt ?? null,
              createdAt: historyContext?.createdAt ?? result.data.createdAt ?? "-",
            });
            setError("");
            hasLoadedRef.current = true;
          }
        }
      } catch (err) {
        if (!active || requestVersion !== requestVersionRef.current) return;
        console.error(err);
        if (active) setError("Gagal memuat detail broadcast");
      } finally {
        if (active && requestVersion === requestVersionRef.current) {
          setLoading(false);
          setTableLoading(false);
        }
      }
    };

    loadDetail();

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
          loadDetail();
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
        loadDetail();
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
        loadDetail();
      }
    }, 1000);

    return () => {
      active = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [broadcastId, currentPage, debouncedSearch, filterStatus, historyContext, refreshNonce]);

  const stats = useMemo(() => {
    if (!broadcast) return { total: 0, accepted: 0, sent: 0, delivered: 0, read: 0, failed: 0 };

    return {
      total: broadcast.totalRecipients,
      sent: broadcast.sent,
      delivered: broadcast.delivered,
      read: broadcast.read,
      failed: broadcast.failed,
    };
  }, [broadcast]);

  const filteredRecipients = broadcast?.recipients ?? [];
  const selectStatusFilter = (status: string) => {
    setCurrentPage(1);
    setFilterStatus(status);
  };

  function renderStatusBadge(status?: string | null) {
    const s = String(status || "").toLowerCase().trim();

    if (s === "read") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
          <Eye className="w-3 h-3" />
          Dibaca
        </span>
      );
    }

    if (s === "delivered") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
          <CheckCircle2 className="w-3 h-3" />
          Diterima
        </span>
      );
    }

    if (s === "processing") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
          Mengirim
        </span>
      );
    }

    if (s === "accepted" || s === "sent") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
          <Send className="w-3 h-3" />
          Terkirim
        </span>
      );
    }

    if (s === "failed") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
          <XCircle className="w-3 h-3" />
          Gagal
        </span>
      );
    }

    if (s === "cancelled") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
          <XCircle className="w-3 h-3" />
          Dibatalkan
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
        <Clock3 className="w-3 h-3" />
        Mengirim
      </span>
    );
  }

  const executeCancellation = async () => {
    if (!broadcast || cancelling || !isCancellableBroadcast(broadcast)) return;
    const activeSending = String(broadcast.status).toLowerCase() === "sending" && !!broadcast.startedAt;
    setCancelling(true);
    try {
      const result = activeSending
        ? await api.cancelBroadcast(broadcast.id)
        : await api.cancelScheduledBroadcast(broadcast.id);
      if ("error" in result) {
        console.error("Broadcast cancellation failed:", result.error);
        toast.error("Broadcast belum dapat dibatalkan. Silakan coba lagi.");
        return;
      }
      setBroadcast((previous) => previous ? { ...previous, status: "cancelled" } : previous);
      setCancelConfirmOpen(false);
      toast.success(activeSending ? "Sisa pengiriman broadcast berhasil dihentikan" : "Jadwal broadcast berhasil dibatalkan");
      setRefreshNonce((value) => value + 1);
    } catch (cancellationError) {
      console.error("Broadcast cancellation failed:", cancellationError);
      toast.error("Broadcast belum dapat dibatalkan. Silakan coba lagi.");
    } finally {
      setCancelling(false);
    }
  };

  const exportCsv = async () => {
    if (!broadcast) return;

    const exported: RecipientStatus[] = [];
    let page = 1;
    while (true) {
      const result = await api.getBroadcastRecipients(broadcastId, {
        page,
        pageSize: 100,
        search: debouncedSearch || undefined,
        status: filterStatus === "all" ? undefined : filterStatus,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      exported.push(...result.data.items.map((recipient: any) => ({
        id: recipient.id,
        contactName: recipient.recipient_name ?? "Tanpa Nama",
        contactPhone: recipient.phone_e164 ?? "-",
        status: recipient.status || "pending",
        timestamp: recipient.sent_at ?? recipient.updated_at ?? recipient.created_at ?? "-",
        errorMessage: recipient.error ?? undefined,
      })));
      if (page >= result.data.totalPages) break;
      page += 1;
    }

    const header = ["No", "Nama Kontak", "Nomor WhatsApp", "Status", "Keterangan"];

    const rows = exported.map((r, index) => [
      index + 1,
      r.contactName,
      r.contactPhone,
      r.status,
      r.status === "failed" ? translateError(r.errorMessage) : formatDate(r.timestamp),
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
      title={
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full pr-2">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-2 self-start text-left hover:text-primary" aria-label="Kembali ke Riwayat Broadcast">
            <ArrowLeft className="h-4 w-4" />
            <span>Detail Broadcast</span>
          </button>
          {broadcast && (
            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  aria-label="Cari penerima broadcast"
                  placeholder="Cari nama atau nomor..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-xs font-normal bg-white"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                className="h-9 flex items-center justify-center gap-1.5 border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </Button>
            </div>
          )}
        </div>
      }
      onClose={onBack}
      maxWidthClassName="max-w-4xl"
    >
      {loading && !hasLoadedRef.current ? (
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div><div className="text-xs text-slate-500">Tipe</div><div className="mt-1 font-semibold text-slate-800">{broadcast.scheduledAt ? "Scheduled" : "Direct"}</div></div>
                <div><div className="text-xs text-slate-500">Status Proses</div><div className="mt-1 font-semibold text-slate-800">{getProcessStatus(broadcast.status, broadcast.startedAt)}</div></div>
                <div><div className="text-xs text-slate-500">Pengirim</div><div className="mt-1 font-semibold text-slate-800 break-words">{broadcast.numberName}</div></div>
                <div><div className="text-xs text-slate-500">Dibuat</div><div className="mt-1 font-medium text-slate-700">{formatDate(broadcast.createdAt)}</div></div>
                {broadcast.scheduledAt && (
                  <div className="sm:col-span-2"><div className="text-xs text-slate-500">Jadwal Pengiriman</div><div className="mt-1 font-semibold text-slate-800">{formatStoredScheduledAt(broadcast.scheduledAt) ?? broadcast.scheduledAt}</div></div>
                )}
                <div><div className="text-xs text-slate-500">Total Penerima</div><div className="mt-1 font-bold text-slate-800">{broadcast.totalRecipients.toLocaleString("id-ID")}</div></div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-slate-100 p-4">
                <div>
                  <div className="text-xs font-semibold text-slate-700">Pembatalan</div>
                  <p className="mt-1 text-xs text-slate-500">
                    {isCancellableBroadcast(broadcast) ? "Broadcast ini masih dapat dibatalkan sesuai status prosesnya." : getCancelUnavailableReason(broadcast)}
                  </p>
                </div>
                {isCancellableBroadcast(broadcast) && (
                  <Button type="button" variant="outline" onClick={() => setCancelConfirmOpen(true)} className="border-amber-200 text-amber-700 hover:bg-amber-50 shrink-0">
                    {String(broadcast.status).toLowerCase() === "sending" ? "Hentikan Broadcast" : "Batalkan Jadwal"}
                  </Button>
                )}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
            <Card
              role="button"
              tabIndex={0}
              aria-pressed={filterStatus === "all"}
              aria-label="Tampilkan semua penerima"
              className={`p-2.5 text-center cursor-pointer transition-all duration-200 border ${filterStatus === "all" ? "border-slate-800 bg-slate-50/50 shadow-sm ring-1 ring-slate-800/10" : "border-slate-100 hover:border-slate-300 hover:bg-slate-50/50"
                }`}
              onClick={() => selectStatusFilter("all")}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectStatusFilter("all"); } }}
            >
              <div className="text-[11px] text-slate-500 font-semibold mb-0.5 uppercase tracking-wider">Total</div>
              <div className="text-lg font-bold text-slate-800">{stats.total}</div>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              aria-pressed={filterStatus === "sent"}
              aria-label="Filter penerima berstatus terkirim"
              className={`p-2.5 text-center cursor-pointer transition-all duration-200 border ${filterStatus === "sent" ? "border-amber-700 bg-amber-50/40 shadow-sm ring-1 ring-amber-700/10" : "border-slate-100 hover:border-amber-200 hover:bg-amber-50/20"
                }`}
              onClick={() => selectStatusFilter("sent")}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectStatusFilter("sent"); } }}
            >
              <div className="text-[11px] text-amber-600 font-semibold mb-0.5 uppercase tracking-wider">Terkirim</div>
              <div className="text-lg font-bold text-amber-700">{stats.sent}</div>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              aria-pressed={filterStatus === "delivered"}
              aria-label="Filter penerima berstatus diterima"
              className={`p-2.5 text-center cursor-pointer transition-all duration-200 border ${filterStatus === "delivered" ? "border-green-700 bg-green-50/40 shadow-sm ring-1 ring-green-700/10" : "border-slate-100 hover:border-green-200 hover:bg-green-50/20"
                }`}
              onClick={() => selectStatusFilter("delivered")}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectStatusFilter("delivered"); } }}
            >
              <div className="text-[11px] text-green-600 font-semibold mb-0.5 uppercase tracking-wider">Diterima</div>
              <div className="text-lg font-bold text-green-700">{stats.delivered}</div>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              aria-pressed={filterStatus === "read"}
              aria-label="Filter penerima berstatus dibaca"
              className={`p-2.5 text-center cursor-pointer transition-all duration-200 border ${filterStatus === "read" ? "border-blue-700 bg-blue-50/40 shadow-sm ring-1 ring-blue-700/10" : "border-slate-100 hover:border-blue-200 hover:bg-blue-50/20"
                }`}
              onClick={() => selectStatusFilter("read")}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectStatusFilter("read"); } }}
            >
              <div className="text-[11px] text-blue-600 font-semibold mb-0.5 uppercase tracking-wider">Dibaca</div>
              <div className="text-lg font-bold text-blue-700">{stats.read}</div>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              aria-pressed={filterStatus === "failed"}
              aria-label="Filter penerima berstatus gagal"
              className={`p-2.5 text-center cursor-pointer transition-all duration-200 border ${filterStatus === "failed" ? "border-red-700 bg-red-50/40 shadow-sm ring-1 ring-red-700/10" : "border-slate-100 hover:border-red-200 hover:bg-red-50/20"
                }`}
              onClick={() => selectStatusFilter("failed")}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectStatusFilter("failed"); } }}
            >
              <div className="text-[11px] text-red-600 font-semibold mb-0.5 uppercase tracking-wider">Gagal</div>
              <div className="text-lg font-bold text-red-700">{stats.failed}</div>
            </Card>
          </div>

          {/* Tabel detail */}
          <Card className="overflow-hidden border border-slate-200 shadow-sm rounded-xl flex-1 flex flex-col min-h-[300px]">
            <div className="overflow-x-auto max-h-[50vh] overflow-y-auto flex-1">
              <table className="w-full min-w-[600px]">
                <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 text-[11px] font-bold uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-6 py-3 text-center w-12">No</th>
                    <th className="px-6 py-3 text-left">Nama Kontak</th>
                    <th className="px-6 py-3 text-left">Nomor WhatsApp</th>
                    <th className="px-6 py-3 text-left">Status</th>
                    <th className="px-6 py-3 text-left">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                  {filteredRecipients.map((r, idx) => {
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
                        <td className="px-6 py-4 text-center font-medium text-slate-500">{(currentPage - 1) * 50 + idx + 1}</td>
                        <td className="px-6 py-4 font-medium text-slate-900 max-w-[200px] truncate" title={r.contactName}>{r.contactName}</td>
                        <td className="px-6 py-4 font-mono text-slate-600">{r.contactPhone}</td>
                        <td className="px-6 py-4">{renderStatusBadge(r.status)}</td>
                        <td className="px-6 py-4 text-slate-500 max-w-[250px] truncate" title={r.status === "failed" ? translateError(r.errorMessage) : formatDate(r.timestamp)}>
                          {r.status === "failed" ? translateError(r.errorMessage) : formatDate(r.timestamp)}
                        </td>
                      </tr>
                    );
                  })}

                  {filteredRecipients.length === 0 && !tableLoading && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-400 text-sm font-medium">
                        {debouncedSearch || filterStatus !== "all" ? "Tidak ada penerima yang cocok dengan pencarian atau filter." : "Belum ada data penerima untuk broadcast ini."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {tableLoading && (
              <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Memperbarui penerima...
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              <span>
                {broadcast.recipientPage.total
                  ? `${(currentPage - 1) * 50 + 1}–${Math.min(currentPage * 50, broadcast.recipientPage.total)} dari ${broadcast.recipientPage.total}`
                  : "0 data"}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" aria-label="Halaman penerima sebelumnya" disabled={currentPage <= 1 || tableLoading} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>Sebelumnya</Button>
                <span>{currentPage}/{broadcast.recipientPage.totalPages}</span>
                <Button variant="outline" size="sm" aria-label="Halaman penerima berikutnya" disabled={currentPage >= broadcast.recipientPage.totalPages || tableLoading} onClick={() => setCurrentPage((page) => Math.min(broadcast.recipientPage.totalPages, page + 1))}>Berikutnya</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <AppModal
        open={cancelConfirmOpen}
        title={String(broadcast?.status).toLowerCase() === "sending" ? "Hentikan Broadcast?" : "Batalkan Jadwal?"}
        description={String(broadcast?.status).toLowerCase() === "sending"
          ? "Penerima yang sedang diproses dapat diselesaikan pada batas aman. Penerima yang belum diproses akan dibatalkan."
          : "Broadcast yang dijadwalkan tidak akan dikirim setelah dibatalkan."}
        onClose={() => !cancelling && setCancelConfirmOpen(false)}
        closeDisabled={cancelling}
        footer={(
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCancelConfirmOpen(false)} disabled={cancelling}>Kembali</Button>
            <Button type="button" onClick={executeCancellation} disabled={cancelling} className="bg-amber-600 hover:bg-amber-700">
              {cancelling ? "Membatalkan..." : "Ya, Batalkan"}
            </Button>
          </div>
        )}
      >
        <p className="text-sm text-slate-600">Tindakan ini menggunakan alur pembatalan broadcast yang sama dengan Riwayat Broadcast.</p>
      </AppModal>
    </AppModal>
  );
}
