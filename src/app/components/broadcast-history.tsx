import { useState, useEffect, useMemo } from "react";
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

interface Broadcast {
  id: string;
  numberId: string;
  numberName: string;
  templateName?: string;
  title?: string;
  message: string;
  totalRecipients: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  createdAt: string;
  scheduledAt?: string;
  status: "sending" | "scheduled" | "completed" | "failed" | "queued" | "cancelled" | string;
}

interface BroadcastHistoryProps {
  onViewDetail: (broadcastId: string) => void;
}

const PAGE_SIZE = 10;

function getPhaseBadge(status: string) {
  const s = String(status || "").toLowerCase();

  if (s === "scheduled") {
    return (
      <span className="flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs">
        <Clock size={14} />
        Scheduled
      </span>
    );
  }

  if (s === "sending" || s === "queued") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-[11px] text-amber-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        Sending
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
      Error
    </span>
  );
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
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<{
    open: boolean;
    type: "one" | "selected" | "all";
    id?: string;
    name?: string;
  }>({
    open: false,
    type: "one",
  });

  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [senderFilter, setSenderFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);

  const handleDeleteOne = (id: string, name?: string) => {
    setConfirmDelete({
      open: true,
      type: "one",
      id,
      name,
    });
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    setConfirmDelete({
      open: true,
      type: "selected",
    });
  };

  const handleDeleteAll = () => {
    setConfirmDelete({
      open: true,
      type: "all",
    });
  };

  const executeDeleteOne = async (id: string) => {
    try {
      const res = await api.deleteBroadcasts({ ids: [id] });
      if ("error" in res) {
        toast.error("Gagal menghapus: " + res.error);
        return;
      }
      toast.success("Riwayat broadcast berhasil dihapus");
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      loadBroadcasts("refresh");
    } catch (err) {
      console.error(err);
      toast.error("Gagal menghapus broadcast");
    }
  };

  const executeDeleteSelected = async () => {
    try {
      const res = await api.deleteBroadcasts({ ids: selectedIds });
      if ("error" in res) {
        toast.error("Gagal menghapus: " + res.error);
        return;
      }
      toast.success(`${selectedIds.length} riwayat broadcast berhasil dihapus`);
      setSelectedIds([]);
      loadBroadcasts("refresh");
    } catch (err) {
      console.error(err);
      toast.error("Gagal menghapus broadcast");
    }
  };

  const executeDeleteAll = async () => {
    try {
      const res = await api.deleteBroadcasts({ all: true });
      if ("error" in res) {
        toast.error("Gagal menghapus: " + res.error);
        return;
      }
      toast.success("Seluruh riwayat broadcast berhasil dihapus");
      setSelectedIds([]);
      loadBroadcasts("refresh");
    } catch (err) {
      console.error(err);
      toast.error("Gagal menghapus semua broadcast");
    }
  };

  useEffect(() => {
    loadBroadcasts("initial");
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, startDate, endDate, statusFilter, senderFilter]);

  const loadBroadcasts = async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "refresh") setRefreshing(true);
    if (mode === "initial") setLoading(true);

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
        templateName: b.templateName ?? b.title ?? "Broadcast",
        title: b.title ?? b.templateName ?? "Broadcast",
        message: b.message ?? "",
        totalRecipients: Number(b.totalRecipients ?? 0),
        sent: Number(b.sent ?? b.totalSent ?? 0),
        delivered: Number(b.delivered ?? 0),
        read: Number(b.read ?? 0),
        failed: Number(b.failed ?? b.totalFailed ?? 0),
        createdAt: b.createdAt ?? "",
        scheduledAt: b.scheduledAt,
        status: b.status ?? "completed",
      }));

      setBroadcasts(normalized);
      setError("");
    } catch (err) {
      console.error("Error loading broadcasts:", err);
      setError("Gagal memuat riwayat broadcast.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const senderOptions = useMemo(() => {
    const set = new Set<string>();
    broadcasts.forEach((b) => {
      const sender = (b.numberName || "").trim();
      if (sender) set.add(sender);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [broadcasts]);

  const filteredBroadcasts = useMemo(() => {
    return broadcasts.filter((b) => {
      if (senderFilter !== "all" && b.numberName !== senderFilter) return false;

      if (search.trim()) {
        const s = search.toLowerCase();
        const hit =
          (b.templateName ?? "").toLowerCase().includes(s) ||
          (b.title ?? "").toLowerCase().includes(s) ||
          (b.numberName ?? "").toLowerCase().includes(s) ||
          (b.message ?? "").toLowerCase().includes(s);

        if (!hit) return false;
      }

      const displayDateISO = (b.scheduledAt || b.createdAt || "").slice(0, 10);
      if (startDate && displayDateISO < startDate) return false;
      if (endDate && displayDateISO > endDate) return false;

      if (statusFilter !== "all" && String(b.status) !== statusFilter) return false;

      return true;
    });
  }, [broadcasts, senderFilter, search, startDate, endDate, statusFilter]);

  const paginatedBroadcasts = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredBroadcasts.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredBroadcasts, currentPage]);

  const isAllSelected = useMemo(() => {
    if (paginatedBroadcasts.length === 0) return false;
    return paginatedBroadcasts.every((b) => selectedIds.includes(b.id));
  }, [paginatedBroadcasts, selectedIds]);

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

  const totalPages = Math.max(1, Math.ceil(filteredBroadcasts.length / PAGE_SIZE || 1));
  const fromIndex = filteredBroadcasts.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const toIndex = filteredBroadcasts.length
    ? Math.min(currentPage * PAGE_SIZE, filteredBroadcasts.length)
    : 0;

  const totalRecipients = filteredBroadcasts.reduce((sum, b) => sum + b.totalRecipients, 0);
  const totalSent = filteredBroadcasts.reduce((sum, b) => sum + b.sent, 0);
  const totalDelivered = filteredBroadcasts.reduce((sum, b) => sum + b.delivered, 0);
  const totalRead = filteredBroadcasts.reduce((sum, b) => sum + b.read, 0);
  const totalFailed = filteredBroadcasts.reduce((sum, b) => sum + b.failed, 0);
  const inProgressCount = filteredBroadcasts.filter((b) =>
    ["sending", "queued", "scheduled"].includes(String(b.status)),
  ).length;

  const handleExportCsv = () => {
    if (!filteredBroadcasts.length) return;

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

    const rows = filteredBroadcasts.map((b) =>
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

  if (loading) {
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
                  placeholder="Cari template / sender / isi pesan..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 rounded-xl h-11 border-slate-200 focus-visible:ring-[#25D366] w-full text-sm"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-slate-500 text-xs font-semibold uppercase min-w-[32px]">From:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#25D366] w-full bg-white h-11"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-slate-500 text-xs font-semibold uppercase min-w-[32px]">To:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#25D366] w-full bg-white h-11"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#25D366] bg-white h-11 w-full sm:w-auto min-w-[140px]"
              >
                <option value="all">All Status</option>
                <option value="completed">Completed</option>
                <option value="sending">Sending</option>
                <option value="scheduled">Scheduled</option>
                <option value="failed">Failed</option>
                <option value="queued">Queued</option>
                <option value="cancelled">Cancelled</option>
              </select>

              <select
                value={senderFilter}
                onChange={(e) => setSenderFilter(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#25D366] bg-white h-11 w-full sm:w-auto min-w-[140px]"
              >
                <option value="all">All Sender</option>
                {senderOptions.map((sender) => (
                  <option key={sender} value={sender}>
                    {sender}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => loadBroadcasts("refresh")}
                disabled={loading || refreshing}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 h-11 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors w-full sm:w-auto shrink-0"
              >
                <RefreshCcw size={16} className={refreshing ? "animate-spin" : ""} />
                <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="text-gray-600 mb-2 text-sm">Total Campaigns</div>
            <div className="text-gray-900 text-2xl font-semibold">
              {filteredBroadcasts.length.toLocaleString()}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="text-gray-600 mb-2 text-sm">Total Recipients</div>
            <div className="text-gray-900 text-2xl font-semibold">
              {totalRecipients.toLocaleString()}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="text-gray-600 mb-2 text-sm">Messages Sent</div>
            <div className="text-gray-900 text-2xl font-semibold">
              {totalSent.toLocaleString()}
            </div>
            <div className="mt-2 text-blue-600 text-sm">
              {inProgressCount} in progress
            </div>
          </div>

          <div className="bg-red-50 rounded-2xl shadow-sm border border-gray-200 p-6">
            <div className="text-gray-600 mb-2 text-sm">Campaign Failed</div>
            <div className="text-gray-900 text-2xl font-semibold">
              {totalFailed.toLocaleString()}
            </div>
            <div className="mt-2 text-slate-500 text-xs">
              Delivered {totalDelivered.toLocaleString()} • Read {totalRead.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Broadcast Logs Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 sm:p-6 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h3 className="text-gray-900 font-semibold text-base">Broadcast Logs</h3>

            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>{filteredBroadcasts.length ? `${fromIndex}–${toIndex} dari ${filteredBroadcasts.length}` : "0 data"}</span>

                <div className="flex items-center gap-1.5 ml-1">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
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
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
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

              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="px-3.5 py-1.5 border border-red-200 text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors flex items-center gap-1.5 text-xs font-semibold shadow-sm"
                >
                  <Trash2 size={14} />
                  Hapus Terpilih ({selectedIds.length})
                </button>
              )}

              <button
                type="button"
                onClick={handleDeleteAll}
                className="px-3.5 py-1.5 border border-red-200 text-red-600 bg-white rounded-lg hover:bg-red-50 transition-colors flex items-center gap-1.5 text-xs font-semibold shadow-sm"
              >
                <Trash2 size={14} />
                Hapus Semua
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

          <div className="overflow-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={handleSelectAllToggle}
                      className="rounded border-slate-300 text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
                    />
                  </th>
                  <th className="px-3 py-3 text-left text-gray-600 text-xs font-semibold">Date &amp; Time</th>
                  <th className="px-3 py-3 text-left text-gray-600 text-xs font-semibold">Template</th>
                  <th className="px-3 py-3 text-left text-gray-600 text-xs font-semibold">Sender</th>
                  <th className="px-3 py-3 text-center text-gray-600 text-xs font-semibold">Recipients</th>
                  <th className="px-3 py-3 text-center text-gray-600 text-xs font-semibold">Sent</th>
                  <th className="px-3 py-3 text-center text-gray-600 text-xs font-semibold">Failed</th>
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
                  const sent = Number(log.sent || 0);
                  const failed = Number(log.failed || 0);
                  const pending = Math.max(total - (sent + failed), 0);

                  const rate = total ? (sent / total) * 100 : 0;
                  const rateColor =
                    rate < 30 ? "bg-red-500" : rate < 70 ? "bg-yellow-500" : "bg-green-500";

                  const shownDonePct = Math.min(rate, 100);
                  const shownFailedPct = total
                    ? Math.min(Math.max(0, 100 - shownDonePct), (failed / total) * 100)
                    : 0;

                  return (
                    <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
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

                      <td className="px-3 py-3 text-gray-900 text-xs text-center">
                        {log.totalRecipients.toLocaleString()}
                      </td>

                      <td className="px-3 py-3 text-orange-600 text-xs text-center font-medium">
                        {log.sent.toLocaleString()}
                      </td>

                      <td className="px-3 py-3 text-red-600 text-xs text-center">
                        {log.failed.toLocaleString()}
                      </td>

                      <td className="px-3 py-3 text-xs">
                        <div className="min-w-[140px]">
                          <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                            <span>
                              {sent}/{total}
                            </span>
                            <span className="text-slate-700 font-medium">{rate.toFixed(1)}%</span>
                          </div>

                          <div className="h-2 rounded-full bg-gray-200 overflow-hidden flex">
                            <div className={`h-full ${rateColor}`} style={{ width: `${shownDonePct}%` }} />
                            <div className="h-full bg-red-500" style={{ width: `${shownFailedPct}%` }} />
                            <div className="h-full flex-1 bg-gray-300/60" />
                          </div>

                          <div className="mt-1 text-xs text-slate-500">
                            Pending {pending}
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3">{getPhaseBadge(log.status)}</td>

                      <td className="px-3 py-3 text-right">
                        <div className="flex justify-end items-center gap-3.5">
                          <button
                            type="button"
                            onClick={() => onViewDetail(log.id)}
                            className="text-xs text-[#25D366] hover:text-[#128C7E] underline inline-flex items-center gap-1 font-semibold"
                          >
                            <Eye className="w-4 h-4" />
                            Detail
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteOne(log.id, log.templateName || log.title)}
                            className="text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1 font-semibold"
                          >
                            <Trash2 className="w-4 h-4" />
                            Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {paginatedBroadcasts.length === 0 && !loading && (
                  <tr>
                    <td colSpan={10} className="px-6 py-10 text-center text-slate-400 text-sm">
                      Tidak ada data untuk ditampilkan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {loading && <div className="px-6 py-4 text-sm text-slate-500">Loading...</div>}
            {error && <div className="px-6 py-4 text-sm text-red-500">{error}</div>}
          </div>
        </div>
      </div>

      <AppModal
        open={confirmDelete.open}
        title="Konfirmasi Hapus Riwayat"
        onClose={() => setConfirmDelete({ open: false, type: "one" })}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            {confirmDelete.type === "one" && (
              <>Apakah Anda yakin ingin menghapus riwayat broadcast <strong>"{confirmDelete.name || "Broadcast ini"}"</strong>?</>
            )}
            {confirmDelete.type === "selected" && (
              <>Apakah Anda yakin ingin menghapus <strong>{selectedIds.length}</strong> riwayat broadcast yang terpilih?</>
            )}
            {confirmDelete.type === "all" && (
              <>Apakah Anda yakin ingin menghapus <strong>SELURUH</strong> riwayat broadcast instansi Anda? Tindakan ini tidak dapat dibatalkan.</>
            )}
          </p>
          <div className="flex items-center justify-end gap-3 mt-2">
            <button
              type="button"
              onClick={() => setConfirmDelete({ open: false, type: "one" })}
              className="px-4.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors border"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={async () => {
                const { type, id } = confirmDelete;
                setConfirmDelete({ open: false, type: "one" });
                if (type === "one" && id) {
                  await executeDeleteOne(id);
                } else if (type === "selected") {
                  await executeDeleteSelected();
                } else if (type === "all") {
                  await executeDeleteAll();
                }
              }}
              className="px-4.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors"
            >
              Ya, Hapus
            </button>
          </div>
        </div>
      </AppModal>
    </div>
  );
}