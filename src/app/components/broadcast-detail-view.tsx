import { useState, useEffect, useMemo } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ArrowLeft, CheckCircle, Clock, XCircle, Search, Download, Eye, CheckCircle2, Send, Loader2, Clock3 } from "lucide-react";
import { api } from "../lib/api";
import { AppModal } from "./AppModal";

interface RecipientStatus {
  id: string;
  contactName: string;
  contactPhone: string;
  status: "sent" | "delivered" | "read" | "failed";
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
    loadBroadcastDetail();
  }, [broadcastId]);

  const loadBroadcastDetail = async () => {
    setLoading(true);

    try {
      const result = await api.getBroadcastDetail(broadcastId);

      if ("error" in result) {
        setError(result.error);
        return;
      }

      setBroadcast(result.data);
      setError("");
    } catch (err) {
      console.error(err);
      setError("Gagal memuat detail broadcast");
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    if (!broadcast) return { total: 0, accepted: 0, sent: 0, delivered: 0, read: 0, failed: 0 };

    const r = broadcast.recipients;

    return {
      total: r.length,
      accepted: r.filter((x) => x.status === "accepted").length,
      sent: r.filter((x) => x.status === "sent").length,
      delivered: r.filter((x) => x.status === "delivered").length,
      read: r.filter((x) => x.status === "read").length,
      failed: r.filter((x) => x.status === "failed").length,
    };
  }, [broadcast]);

  const filteredRecipients = useMemo(() => {
    if (!broadcast) return [];

    return broadcast.recipients.filter((r) => {
      const search =
        (r.contactName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.contactPhone || "").includes(searchQuery);

      const filter = filterStatus === "all" || r.status === filterStatus;

      return search && filter;
    });
  }, [broadcast, searchQuery, filterStatus]);

function renderStatusBadge(status?: string | null) {
  const s = String(status || "").toLowerCase().trim();

  if (s === "read") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
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

  if (s === "sent" || s === "accepted") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
        <Send className="w-3 h-3" />
        Sent
      </span>
    );
  }

  if (s === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        Processing
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

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[70vh]">
        <div className="animate-spin rounded-full w-10 h-10 border-b-2 border-slate-700" />
      </div>
    );
  }

  if (!broadcast) {
    return <div className="p-8 text-center text-slate-500">Broadcast tidak ditemukan</div>;
  }

  return (
    <AppModal
      open={true}
      title="Detail Broadcast"
      description="Status pengiriman per nomor"
      onClose={onBack}
      maxWidthClassName="max-w-4xl"
    >
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
          <Card 
            className={`p-4 text-center cursor-pointer transition-all duration-200 border ${
              filterStatus === "all" ? "border-slate-800 bg-slate-50/50 shadow-sm" : "border-slate-100 hover:border-slate-300"
            }`} 
            onClick={() => setFilterStatus("all")}
          >
            <div className="text-xs font-medium text-slate-500">Total</div>
            <div className="text-xl font-bold mt-1 text-slate-800">{stats.total}</div>
          </Card>

          <Card 
            className={`p-4 text-center cursor-pointer transition-all duration-200 border ${
              filterStatus === "accepted" ? "border-yellow-600 bg-yellow-50/20 shadow-sm" : "border-slate-100 hover:border-slate-300"
            }`} 
            onClick={() => setFilterStatus("accepted")}
          >
            <div className="text-xs font-medium text-yellow-700">Accepted</div>
            <div className="text-xl font-bold mt-1 text-yellow-700">{stats.accepted}</div>
          </Card>

          <Card 
            className={`p-4 text-center cursor-pointer transition-all duration-200 border ${
              filterStatus === "sent" ? "border-blue-600 bg-blue-50/20 shadow-sm" : "border-slate-100 hover:border-slate-300"
            }`} 
            onClick={() => setFilterStatus("sent")}
          >
            <div className="text-xs font-medium text-blue-700">Sent</div>
            <div className="text-xl font-bold mt-1 text-blue-700">{stats.sent}</div>
          </Card>

          <Card 
            className={`p-4 text-center cursor-pointer transition-all duration-200 border ${
              filterStatus === "delivered" ? "border-green-600 bg-green-50/20 shadow-sm" : "border-slate-100 hover:border-slate-300"
            }`} 
            onClick={() => setFilterStatus("delivered")}
          >
            <div className="text-xs font-medium text-green-700">Delivered</div>
            <div className="text-xl font-bold mt-1 text-green-700">{stats.delivered}</div>
          </Card>

          <Card 
            className={`p-4 text-center cursor-pointer transition-all duration-200 border ${
              filterStatus === "read" ? "border-emerald-600 bg-emerald-50/20 shadow-sm" : "border-slate-100 hover:border-slate-300"
            }`} 
            onClick={() => setFilterStatus("read")}
          >
            <div className="text-xs font-medium text-emerald-700">Read</div>
            <div className="text-xl font-bold mt-1 text-emerald-700">{stats.read}</div>
          </Card>

          <Card 
            className={`p-4 text-center cursor-pointer transition-all duration-200 border ${
              filterStatus === "failed" ? "border-red-600 bg-red-50/20 shadow-sm" : "border-slate-100 hover:border-slate-300"
            }`} 
            onClick={() => setFilterStatus("failed")}
          >
            <div className="text-xs font-medium text-red-600">Failed</div>
            <div className="text-xl font-bold mt-1 text-red-600">{stats.failed}</div>
          </Card>
        </div>

        {/* Filter & Actions */}
        <Card className="p-4 flex flex-col sm:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9 w-full rounded-xl border-slate-200 focus-visible:ring-[#25D366]"
              placeholder="Cari nama / nomor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <Button variant="outline" onClick={exportCsv} className="rounded-xl border-slate-200 w-full sm:w-auto">
            <Download size={16} className="mr-2" />
            Export CSV
          </Button>
        </Card>

        {/* Table */}
        <Card className="overflow-hidden border border-gray-200 shadow-sm">
          <div className="overflow-x-auto w-full">
            <table className="w-full text-sm min-w-[650px] table-fixed">
              <thead className="bg-slate-50 sticky top-0 border-b border-gray-200 z-10">
                <tr>
                  <th className="p-3 text-left text-slate-600 font-semibold w-16">No</th>
                  <th className="p-3 text-left text-slate-600 font-semibold w-40">Nomor</th>
                  <th className="p-3 text-left text-slate-600 font-semibold w-48">Nama</th>
                  <th className="p-3 text-left text-slate-600 font-semibold w-32">Status</th>
                  <th className="p-3 text-left text-slate-600 font-semibold">Info</th>
                </tr>
              </thead>

              <tbody>
                {filteredRecipients.map((r, i) => {
                  return (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-slate-50/50 transition-colors">
                      <td className="p-3 text-slate-500">{i + 1}</td>
                      <td className="p-3 font-mono font-medium text-slate-800">{r.contactPhone}</td>
                      <td className="p-3 text-slate-700">{r.contactName}</td>
                      <td className="p-3">
                        {renderStatusBadge(r.status)}
                      </td>
                      <td className="p-3 text-slate-500 overflow-visible">
                        <InfoTooltip text={r.status === "failed" ? translateError(r.errorMessage) : formatDate(r.timestamp)} />
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
    </AppModal>
  );
}