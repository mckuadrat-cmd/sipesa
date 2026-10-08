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
  sequence_no?: number | null;
  recipient_name?: string | null;
  phone_e164?: string | null;
  status?: string | null;
  sent_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  error?: string | null;
};

function sortRecipientRows(rows: RecipientRow[]) {
  return [...rows].sort((a, b) => {
    const aSequence = Number(a.sequence_no ?? Number.MAX_SAFE_INTEGER);
    const bSequence = Number(b.sequence_no ?? Number.MAX_SAFE_INTEGER);
    if (aSequence !== bSequence) return aSequence - bSequence;

    const aCreated = new Date(a.created_at || 0).getTime();
    const bCreated = new Date(b.created_at || 0).getTime();
    if (aCreated !== bCreated) return aCreated - bCreated;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

function mergeRecipientRows(current: RecipientRow[], incoming: RecipientRow[]) {
  const byId = new Map(current.map((row) => [row.id, row]));
  incoming.forEach((row) => {
    if (!row?.id) return;
    byId.set(row.id, { ...byId.get(row.id), ...row });
  });
  return sortRecipientRows(Array.from(byId.values()));
}

interface BroadcastProgressModalProps {
  open: boolean;
  broadcastId: string | null;
  onClose: () => void;
  onComplete?: (broadcastId: string) => void;
}

const RECIPIENT_PAGE_SIZE = 100;
const FALLBACK_REFRESH_MS = 5_000;
const SUBSCRIBED_REFRESH_TICKS = 12;
const RECOVERY_TRIGGER_TICKS = 6;
const TERMINAL_CAMPAIGN_STATUSES = new Set(["completed", "cancelled", "failed"]);

function normalizeRecipientStatus(status?: string | null) {
  const s = String(status || "").toLowerCase();
  if (s === "read") return "read";
  if (s === "delivered") return "delivered";
  if (s === "sent" || s === "accepted") return "sent";
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
        Dibaca
      </span>
    );
  }

  if (s === "delivered") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
        <CheckCircle2 className="w-3 h-3" />
        Diterima
      </span>
    );
  }

  if (s === "sent") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
        <Send className="w-3 h-3" />
        Terkirim
      </span>
    );
  }

  if (s === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        Mengirim
      </span>
    );
  }

  if (s === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700">
        <XCircle className="w-3 h-3" />
        Gagal
      </span>
    );
  }

  if (s === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700">
        <XCircle className="w-3 h-3" />
        Dibatalkan
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
      <Clock3 className="w-3 h-3" />
      Mengirim
    </span>
  );
}

export function BroadcastProgressModal({
  open,
  broadcastId,
  onClose,
  onComplete,
}: BroadcastProgressModalProps) {
  const [stats, setStats] = useState<any | null>(null);
  const [rows, setRows] = useState<RecipientRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const hasTriggeredComplete = useRef(false);
  
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const lastScrolledRecipientIdRef = useRef<string | null>(null);
  const channelStatusRef = useRef<string>("INITIAL");

  const fetchBroadcastData = async () => {
    if (!broadcastId) return;

    const [statsRes, rowsRes] = await Promise.all([
      api.getBroadcastStats(broadcastId),
      api.getBroadcastRecipients(broadcastId, { page: 1, pageSize: RECIPIENT_PAGE_SIZE }),
    ]);

    if ("error" in statsRes) {
      console.error("Failed to refresh authoritative broadcast stats:", statsRes.error);
      setError("Status broadcast belum dapat diperbarui. Coba lagi atau tutup modal dan periksa Riwayat.");
    } else {
      setStats(statsRes.data);
      setError("");
    }

    if (!("error" in rowsRes)) {
      setRows((current) => mergeRecipientRows(current, rowsRes.data?.items || []));
    } else {
      console.error("Failed to refresh bounded broadcast recipients page:", rowsRes.error);
    }
  };

  const retryRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchBroadcastData();
    } catch (err) {
      console.error("Failed to retry broadcast progress refresh:", err);
      setError("Status broadcast belum dapat diperbarui. Coba lagi atau tutup modal dan periksa Riwayat.");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!open || !broadcastId) return;

    let active = true;
    setRows([]);
    setStats(null);
    setError("");
    channelStatusRef.current = "INITIAL";

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

    const channelName = `bc-recipients-realtime-${broadcastId}-${Date.now()}`;
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
          // Only fetch stats to avoid heavy payload
          api.getBroadcastStats(broadcastId).then((res) => {
            if (active && !("error" in res)) {
              setStats(res.data);

              const campaignStatus = String(res.data?.status || "").toLowerCase();
              if (TERMINAL_CAMPAIGN_STATUSES.has(campaignStatus)) {
                api.getBroadcastRecipients(broadcastId, { page: 1, pageSize: RECIPIENT_PAGE_SIZE }).then((rowsRes) => {
                  if (active && !("error" in rowsRes)) {
                    setRows((current) => mergeRecipientRows(current, rowsRes.data?.items || []));
                  }
                });
              }
            }
          });
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
            const updated = payload.new as RecipientRow;
            if (updated && updated.id) {
              setRows((current) => mergeRecipientRows(current, [updated]));
            }
          }
        }
      );

    channel.subscribe((status) => {
      if (!active) return;
      channelStatusRef.current = status;
      if (status === "SUBSCRIBED") {
        fetchBroadcastData();
      }
    });

    let tickCount = 0;
    const interval = setInterval(() => {
      if (!active) return;
      if (document.visibilityState === "hidden") return;

      tickCount++;
      const isSubscribed = channelStatusRef.current === "SUBSCRIBED";
      const refreshTicks = isSubscribed ? SUBSCRIBED_REFRESH_TICKS : 1;

      if (tickCount % refreshTicks === 0) {
        fetchData();
      }

      // Recovery trigger only. A database lease on the sender number prevents
      // this request (or another open tab) from creating a parallel sender.
      if (tickCount % RECOVERY_TRIGGER_TICKS === 0) {
        api.processBroadcasts(200).catch(() => {});
      }
    }, FALLBACK_REFRESH_MS);

    const handleVisibilityOrPageShow = () => {
      if (document.visibilityState === "visible" && active) {
        fetchData();
        api.processBroadcasts(200).catch(() => {});
      }
    };

    window.addEventListener("visibilitychange", handleVisibilityOrPageShow);
    window.addEventListener("pageshow", handleVisibilityOrPageShow);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("visibilitychange", handleVisibilityOrPageShow);
      window.removeEventListener("pageshow", handleVisibilityOrPageShow);
      supabase.removeChannel(channel);
    };
  }, [open, broadcastId]);

  useEffect(() => {
    if (!open) {
      hasTriggeredComplete.current = false;
    }
  }, [open]);

  const summary = useMemo(() => {
    const sent = rows.filter((r) => normalizeRecipientStatus(r.status) === "sent").length;
    const delivered = rows.filter((r) => normalizeRecipientStatus(r.status) === "delivered").length;
    const read = rows.filter((r) => normalizeRecipientStatus(r.status) === "read").length;
    const failed = rows.filter((r) => normalizeRecipientStatus(r.status) === "failed").length;
    const pending = rows.filter((r) => normalizeRecipientStatus(r.status) === "pending").length;
    const cancelled = rows.filter((r) => normalizeRecipientStatus(r.status) === "cancelled").length;
    const processing = rows.filter((r) => normalizeRecipientStatus(r.status) === "processing").length;

    return {
      total: rows.length,
      sent,
      delivered,
      read,
      failed,
      pending,
      cancelled,
      processing,
    };
  }, [rows]);

  const aggregateTotal = Number(stats?.totalRecipients ?? 0);
  const aggregateSent = Number(stats?.totalSent ?? 0);
  const aggregateFailed = Number(stats?.totalFailed ?? 0);
  const processedCount = stats
    ? aggregateSent + aggregateFailed
    : summary.sent + summary.delivered + summary.read + summary.failed + summary.cancelled;
  const progressTotal = stats ? aggregateTotal : summary.total;
  const progressPct = stats
    ? Math.max(0, Math.min(100, Number(stats?.progress ?? 0)))
    : progressTotal > 0
      ? Math.round((processedCount / progressTotal) * 100)
      : 0;

  const progressBarColorClass = useMemo(() => {
    if (progressPct < 33) return "bg-red-500";
    if (progressPct < 80) return "bg-amber-500";
    return "bg-green-500";
  }, [progressPct]);

  const campaignStatus = String(stats?.status || "").toLowerCase();
  const isComplete = campaignStatus === "completed";
  const isDone = TERMINAL_CAMPAIGN_STATUSES.has(campaignStatus);
  const canClose = isDone || Boolean(error);

  useEffect(() => {
    if (isComplete && open && broadcastId && !hasTriggeredComplete.current) {
      hasTriggeredComplete.current = true;
      onComplete?.(broadcastId);
    }
  }, [isComplete, open, broadcastId, onComplete]);

  // Smooth scroll to the currently processing row
  useEffect(() => {
    const processingRec = rows.find((r) => normalizeRecipientStatus(r.status) === "processing");
    if (processingRec && processingRec.id !== lastScrolledRecipientIdRef.current) {
      const el = rowRefs.current.get(processingRec.id);
      if (el) {
        lastScrolledRecipientIdRef.current = processingRec.id;
        el.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }
  }, [rows]);

  return (
    <AppModal
      open={open}
      title="Proses Broadcast"
      description={`Total: ${stats ? aggregateTotal : summary.total} • Terkirim: ${stats ? aggregateSent : summary.sent + summary.delivered + summary.read} • Diterima: ${stats ? Number(stats?.delivered ?? 0) + Number(stats?.read ?? 0) : summary.delivered} • Dibaca: ${stats ? Number(stats?.read ?? 0) : summary.read} • Gagal: ${stats ? aggregateFailed : summary.failed}`}
      onClose={onClose}
      closeOnBackdrop={canClose}
      closeDisabled={!canClose}
      closeOnContentClick={false}
      maxWidthClassName="max-w-3xl"
      footer={
        <div className="flex justify-end items-center">
          <Button variant="outline" onClick={onClose} disabled={!canClose}>
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

        <div className="flex items-center gap-4">
          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-2 rounded-full transition-all ${progressBarColorClass}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600 whitespace-nowrap">
            {!isDone && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />}
            <span>{processedCount} / {progressTotal} ({progressPct}%)</span>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-[2px]" />
            <div className="flex-1 space-y-2">
              <p>{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void retryRefresh()} disabled={refreshing}>
                {refreshing ? "Mencoba lagi…" : "Coba Lagi"}
              </Button>
            </div>
          </div>
        )}

        {isComplete && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-[1px]" />
            <span>
              Semua pesan sudah diteruskan ke Meta. Status Diterima dan Dibaca akan terus diperbarui dari webhook Meta.
            </span>
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
                    ref={(el) => {
                      if (el) {
                        rowRefs.current.set(row.id, el);
                      } else {
                        rowRefs.current.delete(row.id);
                      }
                    }}
                    className={`transition-all duration-300 ${
                      status === "read" || status === "delivered"
                        ? "bg-green-50/20"
                        : status === "failed"
                        ? "bg-red-50/25"
                        : status === "processing"
                        ? "bg-amber-100/60 ring-2 ring-amber-500/30 font-medium animate-pulse"
                        : status === "sent"
                        ? "bg-amber-50/20"
                        : status === "cancelled"
                        ? "bg-slate-100/80"
                        : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-center text-slate-500">{row.sequence_no ?? idx + 1}</td>
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
