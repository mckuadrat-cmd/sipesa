import { useState, useEffect, useMemo, useRef } from "react";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import {
  Download,
  Search,
  RefreshCcw,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  Eye,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import { AppModal } from "./AppModal";
import { toast } from "sonner";
import { supabase } from "../lib/supabaseClient";

export interface BroadcastDetailContext {
  id: string;
  numberId: string;
  numberName: string;
  templateName?: string;
  title?: string;
  message: string;
  totalRecipients: number;
  totalSent: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  cancelled: number;
  createdAt: string;
  scheduledAt?: string;
  startedAt?: string | null;
  status: "sending" | "scheduled" | "completed" | "failed" | "queued" | "cancelled" | string;
}

interface BroadcastHistoryProps {
  onViewDetail: (broadcastId: string, context: BroadcastDetailContext) => void;
}

const PAGE_SIZE = 10;

function getPhaseBadge(status: string, startedAt?: string | null) {
  const s = String(status || "").toLowerCase();

  if (s === "queued" || s === "scheduled" || (s === "sending" && !startedAt)) {
    return (
      <span className="flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs">
        <Clock size={14} />
        Menunggu
      </span>
    );
  }

  if (s === "sending" && !!startedAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-[11px] text-amber-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        Sedang Dikirim
      </span>
    );
  }

  if (s === "completed") {
    return (
      <span className="flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-lg text-xs">
        <CheckCircle2 size={14} />
        Selesai
      </span>
    );
  }

  if (s === "failed") {
    return (
      <span className="flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded-lg text-xs">
        <XCircle size={14} />
        Gagal
      </span>
    );
  }

  if (s === "paused") {
    return (
      <span className="flex items-center gap-1 px-3 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs">
        <Clock size={14} />
        Dijeda
      </span>
    );
  }

  if (s === "cancelled") {
    return (
      <span className="flex items-center gap-1 px-3 py-1 bg-slate-200 text-slate-700 rounded-lg text-xs">
        <XCircle size={14} />
        Dibatalkan
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 px-3 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs">
      Tidak diketahui
    </span>
  );
}

function isCancellableBroadcast(broadcast: BroadcastDetailContext) {
  const status = String(broadcast.status || "").toLowerCase();
  const pendingSchedule = status === "queued" && !!broadcast.scheduledAt && !broadcast.startedAt;
  const activeSending = status === "sending" && !!broadcast.startedAt;
  return pendingSchedule || activeSending;
}

function isDeletableBroadcast(broadcast: BroadcastDetailContext) {
  return ["completed", "failed", "cancelled"].includes(String(broadcast.status || "").toLowerCase());
}

function formatDateParts(iso?: string) {
  if (!iso) return { date: "-", time: "" };

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: "" };

  const pad = (n: number) => String(n).padStart(2, "0");
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());

  return {
    date: `${day}-${month}-${year}`,
    time: `${hours}:${minutes}`,
  };
}

export function BroadcastHistory({ onViewDetail }: BroadcastHistoryProps) {
  const [broadcasts, setBroadcasts] = useState<BroadcastDetailContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<BroadcastDetailContext | null>(null);
  const [cancellingBroadcast, setCancellingBroadcast] = useState(false);

  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [senderFilter, setSenderFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [totalRows, setTotalRows] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [senderOptions, setSenderOptions] = useState<Array<{ id: string; name: string }>>([]);
  const hasLoadedRef = useRef(false);
  const requestVersionRef = useRef(0);
  const queryRef = useRef({ page: 1, search: "", startDate: "", endDate: "", status: "all", sender: "all" });
  queryRef.current = { page: currentPage, search: debouncedSearch, startDate, endDate, status: statusFilter, sender: senderFilter };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    const selected = broadcasts.filter((broadcast) => selectedIds.includes(broadcast.id));
    if (selected.length !== selectedIds.length || selected.some((broadcast) => !isDeletableBroadcast(broadcast))) {
      toast.error("Broadcast Menunggu, Sedang Dikirim, atau Dijeda tidak dapat dihapus");
      return;
    }
    setDeleteConfirmOpen(true);
  };

  const executeDeleteSelected = async () => {
    try {
      const res = await api.deleteBroadcasts({ ids: selectedIds });
      if ("error" in res) {
        toast.error("Gagal menghapus: " + res.error);
        return;
      }
      toast.success(`${selectedIds.length} riwayat broadcast terpilih berhasil dihapus`);
      setSelectedIds([]);
      loadBroadcasts("refresh");
    } catch (err) {
      console.error(err);
      toast.error("Gagal menghapus broadcast");
    } finally {
      setDeleteConfirmOpen(false);
    }
  };

  const executeCancelBroadcast = async () => {
    if (!cancelTarget || cancellingBroadcast) return;

    setCancellingBroadcast(true);
    try {
      const isActive = String(cancelTarget.status).toLowerCase() === "sending" && !!cancelTarget.startedAt;
      const result = isActive
        ? await api.cancelBroadcast(cancelTarget.id)
        : await api.cancelScheduledBroadcast(cancelTarget.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      toast.success(isActive ? "Sisa pengiriman broadcast berhasil dihentikan" : "Jadwal broadcast berhasil dibatalkan");
      setCancelTarget(null);
      setSelectedIds([]);
      await loadBroadcasts("refresh");
    } catch (err) {
      console.error(err);
      toast.error("Gagal membatalkan jadwal broadcast");
    } finally {
      setCancellingBroadcast(false);
    }
  };

  useEffect(() => {
    const channelStatusRef = { current: "INITIAL" };
    let realtimeRefreshTimer: number | null = null;
    const channel = supabase
      .channel("broadcast-history-list")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wa_broadcasts",
        },
        () => {
          if (realtimeRefreshTimer !== null) window.clearTimeout(realtimeRefreshTimer);
          realtimeRefreshTimer = window.setTimeout(() => loadBroadcasts("silent"), 250);
        }
      );

    channel.subscribe((status) => {
      channelStatusRef.current = status;
      if (status === "SUBSCRIBED") {
        loadBroadcasts("silent");
      }
    });

    let tickCount = 0;
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;

      tickCount++;
      const isSubscribed = channelStatusRef.current === "SUBSCRIBED";
      const pollInterval = isSubscribed ? 20 : 5;

      if (tickCount % pollInterval === 0) {
        loadBroadcasts("silent");
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      if (realtimeRefreshTimer !== null) window.clearTimeout(realtimeRefreshTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    requestVersionRef.current += 1;
    const timeout = window.setTimeout(() => {
      setCurrentPage(1);
      setDebouncedSearch(search.trim());
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    void loadBroadcasts("initial");
  }, [currentPage, debouncedSearch, startDate, endDate, statusFilter, senderFilter]);

  const loadBroadcasts = async (mode: "initial" | "refresh" | "silent" = "initial") => {
    const requestVersion = ++requestVersionRef.current;
    if (mode === "refresh") setRefreshing(true);
    if (!hasLoadedRef.current) setLoading(true);
    else setTableLoading(true);

    try {
      const query = queryRef.current;
      const result = await api.getBroadcastHistory({
        page: query.page,
        pageSize: PAGE_SIZE,
        search: query.search || undefined,
        status: query.status === "all" ? undefined : query.status,
        numberId: query.sender === "all" ? undefined : query.sender,
        dateFrom: query.startDate ? new Date(`${query.startDate}T00:00:00`).toISOString() : undefined,
        dateTo: query.endDate ? new Date(`${query.endDate}T23:59:59.999`).toISOString() : undefined,
      });

      if (requestVersion !== requestVersionRef.current) return;

      if ("error" in result) {
        setError(result.error);
        return;
      }

      const normalized: BroadcastDetailContext[] = (result.data.items ?? []).map((b: any) => {
        const rawTotalSent = Number(b.totalSent ?? (Number(b.sent ?? 0) + Number(b.delivered ?? 0) + Number(b.read ?? 0)));
        return {
          id: b.id,
          numberId: b.numberId ?? "",
          numberName: b.numberName ?? "Nomor WA",
          templateName: b.templateName ?? b.title ?? "Broadcast",
          title: b.title ?? b.templateName ?? "Broadcast",
          message: b.message ?? "",
          totalRecipients: Number(b.totalRecipients ?? 0),
          totalSent: rawTotalSent,
          sent: rawTotalSent,
          delivered: Number(b.delivered ?? 0),
          read: Number(b.read ?? 0),
          failed: Number(b.failed ?? b.totalFailed ?? 0),
          cancelled: Number(b.cancelled ?? b.totalCancelled ?? 0),
          createdAt: b.createdAt ?? "",
          scheduledAt: b.scheduledAt,
          startedAt: b.startedAt ?? null,
          status: b.status ?? "completed",
        };
      });

      setBroadcasts(normalized);
      setTotalRows(result.data.total);
      setServerTotalPages(result.data.totalPages);
      if (currentPage > result.data.totalPages) setCurrentPage(result.data.totalPages);
      setSenderOptions(result.data.senderOptions ?? []);
      setSelectedIds([]);
      setError("");
      hasLoadedRef.current = true;
    } catch (err) {
      if (requestVersion !== requestVersionRef.current) return;
      console.error("Error loading broadcasts:", err);
      setError("Gagal memuat riwayat broadcast.");
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setLoading(false);
        setTableLoading(false);
        setRefreshing(false);
      }
    }
  };

  const paginatedBroadcasts = broadcasts;

  const isAllSelected = useMemo(() => {
    if (paginatedBroadcasts.length === 0) return false;
    return paginatedBroadcasts.every((b) => selectedIds.includes(b.id));
  }, [paginatedBroadcasts, selectedIds]);

  const selectedBroadcasts = useMemo(
    () => broadcasts.filter((broadcast) => selectedIds.includes(broadcast.id)),
    [broadcasts, selectedIds],
  );
  const selectedCancelTarget = selectedBroadcasts.length === 1 && isCancellableBroadcast(selectedBroadcasts[0])
    ? selectedBroadcasts[0]
    : null;
  const canDeleteSelection = selectedBroadcasts.length > 0
    && selectedBroadcasts.length === selectedIds.length
    && selectedBroadcasts.every(isDeletableBroadcast);

  const handleSelectAllToggle = () => {
    if (isAllSelected) {
      const pageIds = paginatedBroadcasts.map((b) => b.id);
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      const pageIds = paginatedBroadcasts.map((b) => b.id);
      setSelectedIds((prev) => {
        const unique = new Set([...prev, ...pageIds]);
        return Array.from(unique);
      });
    }
  };

  const handleSelectRowToggle = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const totalPages = serverTotalPages;
  const fromIndex = totalRows ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const toIndex = totalRows
    ? Math.min(currentPage * PAGE_SIZE, totalRows)
    : 0;

  const totalRecipients = broadcasts.reduce((sum, b) => sum + b.totalRecipients, 0);
  const totalSent = broadcasts.reduce((sum, b) => sum + b.sent, 0);
  const totalDelivered = broadcasts.reduce((sum, b) => sum + b.delivered, 0);
  const totalRead = broadcasts.reduce((sum, b) => sum + b.read, 0);
  const totalFailed = broadcasts.reduce((sum, b) => sum + b.failed, 0);
  const inProgressCount = broadcasts.filter((b) =>
    ["sending", "queued", "scheduled"].includes(String(b.status)),
  ).length;

  const handleExportCsv = async () => {
    if (!totalRows) return;

    const exported: BroadcastDetailContext[] = [];
    let page = 1;
    while (true) {
      const query = queryRef.current;
      const result = await api.getBroadcastHistory({
        page,
        pageSize: 50,
        search: query.search || undefined,
        status: query.status === "all" ? undefined : query.status,
        numberId: query.sender === "all" ? undefined : query.sender,
        dateFrom: query.startDate ? new Date(`${query.startDate}T00:00:00`).toISOString() : undefined,
        dateTo: query.endDate ? new Date(`${query.endDate}T23:59:59.999`).toISOString() : undefined,
      });
      if ("error" in result) {
        toast.error("Gagal mengekspor riwayat: " + result.error);
        return;
      }
      exported.push(...(result.data.items as unknown as BroadcastDetailContext[]));
      if (page >= result.data.totalPages) break;
      page += 1;
    }

    const header = [
      "id",
      "template",
      "sender",
      "recipients",
      "sent",
      "delivered",
      "read",
      "failed",
      "status",
      "createdAt",
      "scheduledAt",
    ];

    const rows = exported.map((b) =>
      [
        b.id,
        b.templateName ?? b.title ?? "",
        b.numberName,
        b.totalRecipients,
        b.sent,
        b.delivered,
        b.read,
        b.failed,
        b.status,
        b.createdAt,
        b.scheduledAt ?? "",
      ]
        .map((v) => {
          let s = String(v ?? "");
          if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
          return s;
        })
        .join(","),
    );

    const csv = [header.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `broadcast-history-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading && !hasLoadedRef.current) {
    return (
      <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-white">
        <div className="mx-auto h-full flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-slate-500 text-sm">Memuat riwayat broadcast...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] w-full p-6 md:p-8 bg-white">
      <div className="mx-auto h-full flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">Riwayat Broadcast</h1>
          <p className="text-sm text-slate-500 mt-1.5 leading-relaxed break-words whitespace-normal max-w-2xl">
            Lihat status dan laporan pengiriman broadcast pesan.
          </p>
        </div>

        {error && (
          <Card className="p-4 border-red-200 bg-red-50 text-red-700">
            {error}
          </Card>
        )}

        {/* Filters */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-center gap-3 w-full">
              <div className="relative col-span-1 sm:col-span-2 lg:flex-1 lg:min-w-[260px] w-full">
                <Search
                  size={18}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <Input
                  aria-label="Cari riwayat broadcast"
                  placeholder="Cari template / sender / isi pesan..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 rounded-xl h-11 border-slate-200 focus-visible:ring-[#25D366] w-full text-sm"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-slate-500 text-xs font-semibold uppercase min-w-[32px]">Dari:</span>
                <input
                  type="date"
                  aria-label="Tanggal mulai riwayat broadcast"
                  value={startDate}
                  onChange={(e) => {
                    setCurrentPage(1);
                    setStartDate(e.target.value);
                  }}
                  className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#25D366] w-full bg-white h-11"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-slate-500 text-xs font-semibold uppercase min-w-[32px]">Sampai:</span>
                <input
                  type="date"
                  aria-label="Tanggal akhir riwayat broadcast"
                  value={endDate}
                  onChange={(e) => {
                    setCurrentPage(1);
                    setEndDate(e.target.value);
                  }}
                  className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#25D366] w-full bg-white h-11"
                />
              </div>

              <select
                aria-label="Filter status broadcast"
                value={statusFilter}
                onChange={(e) => {
                  setCurrentPage(1);
                  setStatusFilter(e.target.value);
                }}
                className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#25D366] bg-white h-11 w-full sm:w-auto min-w-[140px]"
              >
                <option value="all">Semua Status</option>
                <option value="queued">Menunggu</option>
                <option value="sending">Sedang Dikirim</option>
                <option value="completed">Selesai</option>
                <option value="failed">Gagal</option>
                <option value="cancelled">Dibatalkan</option>
              </select>

              <select
                aria-label="Filter nomor pengirim"
                value={senderFilter}
                onChange={(e) => {
                  setCurrentPage(1);
                  setSenderFilter(e.target.value);
                }}
                className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#25D366] bg-white h-11 w-full sm:w-auto min-w-[140px]"
              >
                <option value="all">Semua Nomor Pengirim</option>
                {senderOptions.map((sender) => (
                  <option key={sender.id} value={sender.id}>
                    {sender.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => loadBroadcasts("refresh")}
                disabled={loading || refreshing || tableLoading}
                aria-label="Perbarui riwayat broadcast"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 h-11 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors w-full sm:w-auto shrink-0"
              >
                <RefreshCcw size={16} className={refreshing ? "animate-spin" : ""} />
                <span>{refreshing ? "Memperbarui..." : "Perbarui"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Total follows the full filtered server result; delivery metrics below
            intentionally describe only the rows currently visible in the table. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,3fr)] gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 sm:p-6">
            <div className="text-gray-600 mb-2 text-sm">Total Broadcast</div>
            <div className="text-gray-900 text-2xl font-semibold">
              {totalRows.toLocaleString()}
            </div>
            <div className="mt-2 text-xs text-slate-500">Seluruh hasil filter</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4 min-w-0">
            <div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Pada halaman ini</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 p-4 min-w-0">
                <div className="text-gray-600 mb-2 text-sm">Penerima</div>
                <div className="text-gray-900 text-2xl font-semibold break-words">
                  {totalRecipients.toLocaleString()}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-4 min-w-0">
                <div className="text-gray-600 mb-2 text-sm">Berhasil Dikirim</div>
                <div className="text-gray-900 text-2xl font-semibold break-words">
                  {totalSent.toLocaleString()}
                </div>
                <div className="mt-2 text-blue-600 text-xs">
                  {inProgressCount} broadcast diproses
                </div>
              </div>

              <div className="bg-red-50 rounded-xl border border-red-100 p-4 min-w-0">
                <div className="text-gray-600 mb-2 text-sm">Gagal</div>
                <div className="text-gray-900 text-2xl font-semibold break-words">
                  {totalFailed.toLocaleString()}
                </div>
                <div className="mt-2 text-slate-500 text-xs break-words">
                  Diterima {totalDelivered.toLocaleString()} • Dibaca {totalRead.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Broadcast Logs Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 sm:p-6 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h3 className="text-gray-900 font-semibold text-base">Daftar Broadcast</h3>

            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>{totalRows ? `${fromIndex}–${toIndex} dari ${totalRows}` : "0 data"}</span>

                <div className="flex items-center gap-1.5 ml-1">
                  <button
                    type="button"
                    aria-label="Halaman riwayat sebelumnya"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1 || tableLoading}
                    className={`w-7 h-7 flex items-center justify-center rounded-full border text-xs transition-colors ${
                      currentPage === 1
                        ? "border-slate-200 text-slate-300 cursor-not-allowed"
                        : "border-slate-300 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    &lt;
                  </button>

                  <span className="text-slate-600 font-medium px-1">
                    {currentPage}/{totalPages}
                  </span>

                  <button
                    type="button"
                    aria-label="Halaman riwayat berikutnya"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages || tableLoading}
                    className={`w-7 h-7 flex items-center justify-center rounded-full border text-xs transition-colors ${
                      currentPage >= totalPages
                        ? "border-slate-200 text-slate-300 cursor-not-allowed"
                        : "border-slate-300 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    &gt;
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => selectedCancelTarget && setCancelTarget(selectedCancelTarget)}
                disabled={!selectedCancelTarget}
                className={`px-3.5 py-1.5 border rounded-lg transition-all flex items-center gap-1.5 text-xs font-semibold shadow-sm ${
                  !selectedCancelTarget
                    ? "border-slate-200 text-slate-300 bg-slate-50 cursor-not-allowed"
                    : "border-amber-200 text-amber-700 bg-white hover:bg-amber-50"
                }`}
                title={selectedIds.length > 1 ? "Pilih tepat satu broadcast untuk dibatalkan" : "Batalkan broadcast terpilih"}
              >
                <XCircle size={14} />
                Cancel
              </button>

              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={!canDeleteSelection}
                className={`px-3.5 py-1.5 border rounded-lg transition-all flex items-center gap-1.5 text-xs font-semibold shadow-sm ${
                  !canDeleteSelection
                    ? "border-slate-200 text-slate-300 bg-slate-50 cursor-not-allowed"
                    : "border-red-200 text-red-600 bg-white hover:bg-red-50"
                }`}
                title="Hapus terpilih"
              >
                <Trash2 size={14} />
                {selectedIds.length > 0 ? `Hapus (${selectedIds.length})` : "Hapus"}
              </button>

              <button
                type="button"
                onClick={handleExportCsv}
                className="px-3.5 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-white shadow-sm"
              >
                <Download size={14} />
                Export CSV
              </button>
            </div>
          </div>

          <div className="overflow-auto max-h-[60vh] border-b border-slate-100 rounded-b-lg">
            <table className="w-full relative">
              <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm ring-1 ring-slate-100">
                <tr>
                  <th className="px-3 py-3 w-10 text-center">
                    <input
                      type="checkbox"
                      aria-label="Pilih semua broadcast pada halaman ini"
                      checked={isAllSelected}
                      onChange={handleSelectAllToggle}
                      className="rounded border-slate-300 text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
                    />
                  </th>
                  <th className="px-3 py-3 text-left text-gray-600 text-xs font-semibold">Tanggal &amp; Waktu</th>
                  <th className="px-3 py-3 text-left text-gray-600 text-xs font-semibold">Template</th>
                  <th className="px-3 py-3 text-left text-gray-600 text-xs font-semibold">Nomor Pengirim</th>
                  <th className="px-3 py-3 text-center text-gray-600 text-xs font-semibold">Penerima</th>
                  <th className="px-3 py-3 text-center text-gray-600 text-xs font-semibold">Terkirim</th>
                  <th className="px-3 py-3 text-center text-gray-600 text-xs font-semibold">Gagal</th>
                  <th className="px-3 py-3 text-left text-gray-600 text-xs font-semibold">Progress</th>
                  <th className="px-3 py-3 text-left text-gray-600 text-xs font-semibold">Status</th>
                  <th className="px-3 py-3 text-right text-gray-600 text-xs font-semibold">Detail</th>
                </tr>
              </thead>

              <tbody>
                {paginatedBroadcasts.map((log) => {
                  const displayAt = log.scheduledAt || log.createdAt;
                  const { date, time } = formatDateParts(displayAt);
                  const whenLabel = log.scheduledAt ? "Scheduled" : "Direct";

                  const total = Number(log.totalRecipients || 0);
                  const sent = Number(log.sent || log.totalSent || 0);
                  const delivered = Number(log.delivered || 0);
                  const read = Number(log.read || 0);
                  const failed = Number(log.failed || 0);
                  const cancelled = Number(log.cancelled || 0);

                  const processed = sent + failed + cancelled;
                  const pending = Math.max(total - processed, 0);

                  const successRate = total ? (sent / total) * 100 : 0;
                  const processedRate = total ? (processed / total) * 100 : 0;

                  const rateColor =
                    successRate < 30 ? "bg-red-500" : successRate < 70 ? "bg-yellow-500" : "bg-green-500";

                  const shownDonePct = total ? (sent / total) * 100 : 0;
                  const shownFailedPct = total ? (failed / total) * 100 : 0;
                  const shownCancelledPct = total ? (cancelled / total) * 100 : 0;

                  return (
                    <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Pilih broadcast ${log.templateName || log.title || log.id}`}
                          checked={selectedIds.includes(log.id)}
                          onChange={() => handleSelectRowToggle(log.id)}
                          className="rounded border-slate-300 text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
                        />
                      </td>

                      <td className="px-3 py-3 text-gray-600 text-xs">
                        <div className="font-medium text-slate-800">
                          {date} {time}
                        </div>
                        <div className="mt-1">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
                              whenLabel === "Scheduled"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {whenLabel}
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-3 text-gray-600 text-xs">
                        <div className="font-medium text-slate-800">
                          {log.templateName || log.title || "-"}
                        </div>
                        <div className="text-xs text-slate-500 mt-1 line-clamp-1">
                          {log.message || "-"}
                        </div>
                      </td>

                      <td className="px-3 py-3 text-gray-600 text-xs">{log.numberName}</td>

                      <td className="px-3 py-3 text-gray-900 text-xs text-center font-medium">
                        {log.totalRecipients.toLocaleString()}
                      </td>

                      <td className="px-3 py-3 text-green-600 text-xs text-center font-semibold">
                        {sent.toLocaleString()}
                      </td>

                      <td className="px-3 py-3 text-red-600 text-xs text-center font-medium">
                        {log.failed.toLocaleString()}
                      </td>

                      <td className="px-3 py-3 text-xs">
                        <div className="min-w-[140px]">
                          <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                            <span>
                              {sent}/{total}
                            </span>
                            <span className="text-slate-700 font-medium">
                              {failed > 0 || cancelled > 0 ? `${successRate.toFixed(1)}% Berhasil` : `${processedRate.toFixed(1)}%`}
                            </span>
                          </div>

                          <div className="h-2 rounded-full bg-gray-200 overflow-hidden flex">
                            <div className={`h-full ${rateColor}`} style={{ width: `${shownDonePct}%` }} />
                            <div className="h-full bg-red-500" style={{ width: `${shownFailedPct}%` }} />
                            <div className="h-full bg-slate-400" style={{ width: `${shownCancelledPct}%` }} />
                            <div className="h-full flex-1 bg-gray-300/60" />
                          </div>

                          <div className="mt-1 text-xs text-slate-500 flex justify-between gap-1">
                            <span>{pending > 0 ? `Menunggu ${pending}` : `Selesai`}</span>
                            {cancelled > 0 && <span className="text-slate-400 font-medium">Batal {cancelled}</span>}
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3">{getPhaseBadge(log.status, log.startedAt)}</td>

                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onViewDetail(log.id, log)}
                          className="text-xs text-[#25D366] hover:text-[#128C7E] underline inline-flex items-center gap-1 font-semibold"
                        >
                          <Eye className="w-4 h-4" />
                          Detail
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {paginatedBroadcasts.length === 0 && !loading && !tableLoading && (
                  <tr>
                    <td colSpan={10} className="px-6 py-10 text-center text-slate-400 text-sm">
                      Tidak ada data untuk ditampilkan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {tableLoading && (
              <div className="px-6 py-3 text-xs text-slate-500 flex items-center gap-2 border-t border-slate-100">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Memperbarui data...
              </div>
            )}
            {error && <div className="px-6 py-4 text-sm text-red-500">{error}</div>}
          </div>
        </div>
      </div>

      <AppModal
        open={deleteConfirmOpen}
        title="Hapus Riwayat Broadcast"
        onClose={() => setDeleteConfirmOpen(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            Apakah Anda yakin ingin menghapus <strong>{selectedIds.length}</strong> riwayat broadcast terpilih? Tindakan ini tidak dapat dibatalkan.
          </p>
          <div className="flex items-center justify-end gap-3 mt-2">
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(false)}
              className="px-4.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors border"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={executeDeleteSelected}
              className="px-4.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-sm"
            >
              Hapus
            </button>
          </div>
        </div>
      </AppModal>

      <AppModal
        open={!!cancelTarget}
        title={cancelTarget?.status === "sending" ? "Hentikan Broadcast" : "Batalkan Jadwal Broadcast"}
        onClose={() => {
          if (!cancellingBroadcast) setCancelTarget(null);
        }}
        closeDisabled={cancellingBroadcast}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            {cancelTarget?.status === "sending"
              ? "Hentikan broadcast ini? Pesan yang sudah terkirim tidak dapat dibatalkan. Sistem hanya akan menghentikan sisa pengiriman yang belum diproses."
              : "Batalkan broadcast terjadwal ini? Pesan belum dikirim dan jadwal akan dibatalkan."}
          </p>
          <div className="flex items-center justify-end gap-3 mt-2">
            <button
              type="button"
              onClick={() => setCancelTarget(null)}
              disabled={cancellingBroadcast}
              className="px-4.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors border disabled:opacity-50"
            >
              Kembali
            </button>
            <button
              type="button"
              onClick={executeCancelBroadcast}
              disabled={cancellingBroadcast}
              className="px-4.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-sm disabled:opacity-50"
            >
              {cancellingBroadcast
                ? "Memproses..."
                : cancelTarget?.status === "sending"
                ? "Ya, Hentikan Broadcast"
                : "Ya, Batalkan Jadwal"}
            </button>
          </div>
        </div>
      </AppModal>
    </div>
  );
}
