import { useState, useEffect, useMemo } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ArrowLeft, CheckCircle, Clock, XCircle, Search, Download } from "lucide-react";
import { api } from "../lib/api";

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
    return `${day}-${month}-${year} ${hours}:${minutes}`;
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
    if (!broadcast) return { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 };

    const r = broadcast.recipients;

    return {
      total: r.length,
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

  const getStatus = (status: string) => {
    switch (status) {
      case "read":
        return { label: "Read", color: "text-blue-700", icon: <CheckCircle size={16} /> };
      case "delivered":
        return { label: "Delivered", color: "text-green-700", icon: <CheckCircle size={16} /> };
      case "sent":
        return { label: "Accepted", color: "text-yellow-700", icon: <Clock size={16} /> };
      case "failed":
        return { label: "Failed", color: "text-red-600", icon: <XCircle size={16} /> };
      default:
        return { label: "Pending", color: "text-gray-500", icon: <Clock size={16} /> };
    }
  };

  const exportCsv = () => {
    if (!broadcast) return;

    const header = ["Nama", "Nomor", "Status", "Waktu", "Error"];

    const rows = broadcast.recipients.map((r) => [
      r.contactName,
      r.contactPhone,
      r.status,
      r.timestamp,
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
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-slate-50">
      <div className="mx-auto max-w-6xl flex flex-col gap-6">

        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Detail Broadcast</h1>
            <p className="text-sm text-slate-500">Status pengiriman per nomor</p>
          </div>

          <Button variant="outline" onClick={onBack} className="rounded-xl border-slate-200">
            <ArrowLeft size={16} className="mr-2" />
            Kembali
          </Button>
        </div>

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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
              filterStatus === "sent" ? "border-yellow-600 bg-yellow-50/20 shadow-sm" : "border-slate-100 hover:border-slate-300"
            }`} 
            onClick={() => setFilterStatus("sent")}
          >
            <div className="text-xs font-medium text-yellow-700">Accepted</div>
            <div className="text-xl font-bold mt-1 text-yellow-700">{stats.sent}</div>
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
              filterStatus === "read" ? "border-blue-600 bg-blue-50/20 shadow-sm" : "border-slate-100 hover:border-slate-300"
            }`} 
            onClick={() => setFilterStatus("read")}
          >
            <div className="text-xs font-medium text-blue-700">Read</div>
            <div className="text-xl font-bold mt-1 text-blue-700">{stats.read}</div>
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
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0 border-b border-gray-200">
                <tr>
                  <th className="p-3 text-left text-slate-600 font-semibold w-16">No</th>
                  <th className="p-3 text-left text-slate-600 font-semibold">Nomor</th>
                  <th className="p-3 text-left text-slate-600 font-semibold">Nama</th>
                  <th className="p-3 text-left text-slate-600 font-semibold">Status</th>
                  <th className="p-3 text-left text-slate-600 font-semibold">Waktu</th>
                  <th className="p-3 text-left text-slate-600 font-semibold">Info</th>
                </tr>
              </thead>

              <tbody>
                {filteredRecipients.map((r, i) => {
                  const st = getStatus(r.status);

                  return (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-slate-50/50 transition-colors">
                      <td className="p-3 text-slate-500">{i + 1}</td>
                      <td className="p-3 font-mono font-medium text-slate-800">{r.contactPhone}</td>
                      <td className="p-3 text-slate-700">{r.contactName}</td>
                      <td className="p-3">
                        <div className={`flex items-center gap-2 font-medium ${st.color}`}>
                          {st.icon}
                          <span>{st.label}</span>
                        </div>
                      </td>
                      <td className="p-3 text-slate-500">
                        {formatDate(r.timestamp)}
                      </td>
                      <td className="p-3 text-slate-500 max-w-[200px] truncate" title={r.errorMessage || ""}>
                        {translateError(r.errorMessage)}
                      </td>
                    </tr>
                  );
                })}

                {filteredRecipients.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400 text-sm font-medium">
                      Tidak ada data penerima ditemukan
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

      </div>
    </div>
  );
}