import { useEffect, useMemo, useState, useRef } from "react";
import {
  Loader2,
  CheckCircle2,
  Clock3,
  Send,
  XCircle,
  Eye,
  AlertTriangle,
} from "lucide-react";
import { Button } from "./ui/button";
import { AppModal } from "./AppModal";
import { api } from "../lib/api";
import { supabase } from "../lib/supabaseClient";

function translateError(err?: string | null) {
  if (!err) return "";
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

function formatDateWIB(isoString?: string | null) {
  if (!isoString || isoString === "-") return "-";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = pad(d.getDate());
    const month = pad(d.getMonth() + 1);
    const year = d.getFullYear();
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${day}/${month}/${year} ${hours}:${minutes} WIB`;
  } catch {
    return isoString;
  }
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

type RecipientRow = {
  id: string;
  recipient_name?: string | null;
  phone_e164?: string | null;
  status?: string | null;
  sent_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  error?: string | null;
};

interface BroadcastProgressModalProps {
  open: boolean;
  broadcastId: string | null;
  onClose: () => void;
  onCancelled?: () => void;
  onComplete?: (broadcastId: string) => void;
}

function normalizeRecipientStatus(status?: string | null) {
  const s = String(status || "").toLowerCase();
  if (s === "read") return "read";
  if (s === "delivered") return "delivered";
  if (s === "sent" || s === "accepted") return "accepted";
  if (s === "failed") return "failed";
  if (s === "processing") return "processing";
  if (s === "pending") return "pending";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return s || "pending";
}

function renderStatusBadge(status?: string | null) {
  const s = normalizeRecipientStatus(status);

  if (s === "read") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
        <Eye className="w-3 h-3" />
        Read
      </span>
    );
  }

  if (s === "delivered") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
        <CheckCircle2 className="w-3 h-3" />
        Delivered
      </span>
    );
  }

  if (s === "accepted") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
        <Clock3 className="w-3 h-3" />
        Accepted
      </span>
    );
  }

  if (s === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        Processing
      </span>
    );
  }

  if (s === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700">
        <XCircle className="w-3 h-3" />
        Failed
      </span>
    );
  }

  if (s === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700">
        <XCircle className="w-3 h-3" />
        Cancelled
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
      <Clock3 className="w-3 h-3" />
      Pending
    </span>
  );
}

export function BroadcastProgressModal({
  open,
  broadcastId,
  onClose,
  onCancelled,
  onComplete,
}: BroadcastProgressModalProps) {
  const [stats, setStats] = useState<any | null>(null);
  const [rows, setRows] = useState<RecipientRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [isCancelling, setIsCancelling] = useState(false);
  const isProcessingRef = useRef(false);
  const hasTriggeredComplete = useRef(false);

  const fetchBroadcastData = async () => {
    if (!broadcastId) return;

    const [statsRes, rowsRes] = await Promise.all([
      api.getBroadcastStats(broadcastId),
      api.getBroadcastRecipients(broadcastId),
    ]);

    let currentStats = stats;
    if ("error" in statsRes) {
      setError(statsRes.error);
    } else {
      setStats(statsRes.data);
      currentStats = statsRes.data;
      setError("");
    }

    let currentRecs: RecipientRow[] = [];
    if (!("error" in rowsRes)) {
      currentRecs = rowsRes.data || [];
      setRows(currentRecs);
    }

    const hasProcessing = currentRecs.some((r: any) => normalizeRecipientStatus(r.status) === "processing");
    const hasPending = currentRecs.some((r: any) => normalizeRecipientStatus(r.status) === "pending");

    // Auto-trigger sequential processing (one-by-one) if broadcast is sending or queued
    // and no recipient is currently in 'processing' status to avoid duplicate processing.
    if (
      currentStats && 
      (currentStats.status === "sending" || currentStats.status === "queued") &&
      !hasProcessing && 
      hasPending
    ) {
      if (!isProcessingRef.current) {
        isProcessingRef.current = true;
        try {
          // Process exactly 1 recipient sequentially
          await api.processBroadcasts(1);
          // After processing, refetch data to update progress
          const [updatedStatsRes, updatedRowsRes] = await Promise.all([
            api.getBroadcastStats(broadcastId),
            api.getBroadcastRecipients(broadcastId),
          ]);
          if (!("error" in updatedStatsRes)) {
            setStats(updatedStatsRes.data);
          }
          if (!("error" in updatedRowsRes)) {
            setRows(updatedRowsRes.data || []);
          }
        } catch (err) {
          console.error("Auto sequential processing error:", err);
        } finally {
          isProcessingRef.current = false;
        }
      }
    }
  };

  const handleCancelBroadcast = async () => {
    if (!broadcastId || isCancelling) return;

    setIsCancelling(true);
    try {
      const result = await api.cancelBroadcast(broadcastId);

      if ("error" in result) {
        setError(result.error);
        return;
      }

      await fetchBroadcastData();
      onCancelled?.();
    } catch {
      setError("Gagal membatalkan broadcast.");
    } finally {
      setIsCancelling(false);
    }
  };

  useEffect(() => {
    if (!open || !broadcastId) return;

    let active = true;

    const fetchData = async () => {
      try {
        if (!active) return;
        await fetchBroadcastData();
      } catch (err) {
        if (!active) return;
        console.error(err);
        setError("Gagal mengambil status broadcast.");
      }
    };

    const initialFetch = async () => {
      setLoading(true);
      await fetchData();
      if (active) setLoading(false);
    };
    initialFetch();

    const channelName = `bc-realtime-${broadcastId}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wa_broadcast_recipients",
          filter: `broadcast_id=eq.${broadcastId}`,
        },
        () => {
          fetchData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wa_broadcasts",
          filter: `id=eq.${broadcastId}`,
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    const interval = setInterval(() => {
      fetchData();
    }, 10000);

    return () => {
      active = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [open, broadcastId]);

  useEffect(() => {
    if (!open) {
      hasTriggeredComplete.current = false;
    }
  }, [open]);

  const summary = useMemo(() => {
    const accepted = rows.filter((r) => normalizeRecipientStatus(r.status) === "accepted").length;
    const delivered = rows.filter((r) => normalizeRecipientStatus(r.status) === "delivered").length;
    const read = rows.filter((r) => normalizeRecipientStatus(r.status) === "read").length;
    const failed = rows.filter((r) => normalizeRecipientStatus(r.status) === "failed").length;
    const pending = rows.filter((r) => normalizeRecipientStatus(r.status) === "pending").length;
    const cancelled = rows.filter((r) => normalizeRecipientStatus(r.status) === "cancelled").length;
    const processing = rows.filter((r) => normalizeRecipientStatus(r.status) === "processing").length;

    const sent = accepted + delivered + read;

    return {
      total: rows.length,
      accepted,
      sent,
      delivered,
      read,
      failed,
      pending,
      cancelled,
      processing,
    };
  }, [rows]);

  const processedCount =
    summary.sent +
    summary.failed +
    summary.cancelled;

  const progressPct = summary.total > 0 ? Math.round((processedCount / summary.total) * 100) : 0;

  const progressBarColorClass = useMemo(() => {
    if (progressPct < 33) return "bg-red-500";
    if (progressPct < 80) return "bg-amber-500";
    return "bg-green-500";
  }, [progressPct]);

  const isDone =
    stats?.status === "completed" ||
    stats?.status === "cancelled" ||
    (summary.total > 0 && summary.pending === 0 && summary.processing === 0);

  useEffect(() => {
    if (isDone && open && broadcastId && !hasTriggeredComplete.current) {
      hasTriggeredComplete.current = true;
      if (onComplete) {
        onComplete(broadcastId);
      }
    }
  }, [isDone, open, broadcastId, onComplete]);

  return (
    <AppModal
      open={open}
      title="Proses Broadcast"
      description={`Total: ${summary.total} • Sent: ${summary.sent} • Accepted: ${summary.accepted} • Processing: ${summary.processing} • Delivered: ${summary.delivered} • Read: ${summary.read} • Failed: ${summary.failed} • Cancelled: ${summary.cancelled} • Pending: ${summary.pending}`}
      onClose={onClose}
      closeOnBackdrop={isDone}
      closeDisabled={!isDone}
      closeOnContentClick={isDone}
      maxWidthClassName="max-w-3xl"
      footer={
        <div className="flex justify-between items-center">
          <Button
            variant="outline"
            onClick={handleCancelBroadcast}
            disabled={isDone || isCancelling || !broadcastId}
          >
            {isCancelling ? "Cancelling..." : "Cancel Broadcast"}
          </Button>

          <Button variant="outline" onClick={onClose} disabled={!isDone}>
            Tutup
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {stats?.senderNumber && (
          <div className="flex justify-between items-center bg-slate-50 border px-4 py-2 rounded-xl">
            <span className="text-xs font-semibold text-slate-500">Nomor Pengirim:</span>
            <span className="text-xs font-bold text-slate-700">
              {stats.senderName ? `${stats.senderName} (${stats.senderNumber})` : stats.senderNumber}
            </span>
          </div>
        )}

        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all ${progressBarColorClass}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-[2px]" />
            <span>{error}</span>
          </div>
        )}

        {loading && rows.length === 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Mengambil status broadcast…</span>
          </div>
        )}

        <div
          className="overflow-x-auto overflow-y-auto max-h-[450px] rounded-xl border"
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
        >
          <table className="min-w-full text-xs table-fixed">
            <thead className="sticky top-0 bg-slate-50 z-10 border-b">
              <tr>
                <th className="px-3 py-2 text-center font-semibold text-slate-600 w-12">No</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600 w-40">Penerima</th>
                <th className="px-3 py-2 text-center font-semibold text-slate-600 w-28">Status</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Info</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {rows.map((row, idx) => {
                const status = normalizeRecipientStatus(row.status);

                return (
                  <tr
                    key={row.id || `${row.phone_e164}-${idx}`}
                    className={
                      status === "read" || status === "delivered"
                        ? "bg-green-50/50"
                        : status === "failed"
                        ? "bg-red-50/50"
                        : status === "sent"
                        ? "bg-orange-50/50"
                        : status === "accepted" || status === "processing"
                        ? "bg-amber-50/50"
                        : status === "cancelled"
                        ? "bg-slate-100/80"
                        : ""
                    }
                  >
                    <td className="px-3 py-2 text-center text-slate-500">{idx + 1}</td>
                    <td className="px-3 py-2 text-slate-800 font-mono">
                      {row.phone_e164 || "-"}
                    </td>
                    <td className="px-3 py-2 text-center">{renderStatusBadge(row.status)}</td>
                    <td className="px-3 py-2 text-slate-600 overflow-visible">
                      <InfoTooltip text={row.error ? translateError(row.error) : formatDateWIB(row.sent_at || row.updated_at || row.created_at)} />
                    </td>
                  </tr>
                );
              })}

              {!rows.length && !loading && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-slate-500">
                    Tidak ada data penerima.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-500">
          Modal ini terhubung secara realtime untuk menampilkan progres broadcast terbaru.
        </p>
      </div>
    </AppModal>
  );
}