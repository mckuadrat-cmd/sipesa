import { useState, useEffect, useMemo } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Coins, CreditCard, ArrowUpCircle, History, AlertCircle, Upload, Eye, Image, Copy } from "lucide-react";
import { Badge } from "./ui/badge";
import { api } from "../lib/api";
import { AppModal } from "./AppModal";
import { toast } from "sonner";

export function BankBrandLogo({ name }: { name: string }) {
  const normalized = name.toUpperCase();
  if (normalized === "BCA") {
    return <span className="inline-flex items-center justify-center w-10 h-6 rounded text-[10px] font-extrabold bg-blue-600 text-white tracking-wider shadow-sm select-none">BCA</span>;
  }
  if (normalized === "MANDIRI") {
    return <span className="inline-flex items-center justify-center w-14 h-6 rounded text-[9px] font-bold bg-[#003D7C] text-[#F2A900] shadow-sm select-none">mandiri</span>;
  }
  if (normalized === "BRI") {
    return <span className="inline-flex items-center justify-center w-10 h-6 rounded text-[10px] font-extrabold bg-[#00529C] text-white shadow-sm select-none">BRI</span>;
  }
  if (normalized === "BNI") {
    return <span className="inline-flex items-center justify-center w-10 h-6 rounded text-[10px] font-extrabold bg-[#E05B26] text-teal-950 shadow-sm select-none">BNI</span>;
  }
  if (normalized === "BSI") {
    return <span className="inline-flex items-center justify-center w-10 h-6 rounded text-[10px] font-extrabold bg-teal-600 text-white shadow-sm select-none">BSI</span>;
  }
  return <span className="inline-flex items-center justify-center px-2 h-6 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 shadow-sm select-none">{name}</span>;
}

export function EWalletBrandLogo({ name }: { name: string }) {
  const normalized = name.toUpperCase();
  if (normalized === "GOPAY") {
    return <span className="inline-flex items-center justify-center w-14 h-6 rounded text-[9px] font-extrabold bg-sky-500 text-white shadow-sm select-none">go pay</span>;
  }
  if (normalized === "OVO") {
    return <span className="inline-flex items-center justify-center w-10 h-6 rounded text-[10px] font-extrabold bg-purple-700 text-white shadow-sm select-none">ovo</span>;
  }
  if (normalized === "DANA") {
    return <span className="inline-flex items-center justify-center w-12 h-6 rounded text-[10px] font-extrabold bg-blue-600 text-white shadow-sm select-none">DANA</span>;
  }
  if (normalized === "LINKAJA") {
    return <span className="inline-flex items-center justify-center w-14 h-6 rounded text-[9px] font-extrabold bg-red-600 text-white shadow-sm select-none">LinkAja!</span>;
  }
  return <span className="inline-flex items-center justify-center px-2 h-6 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 shadow-sm select-none">{name}</span>;
}

type BillingData = {
  currentTokens?: number;
  totalSpent?: number;
  tokenPrice?: number;
};

type Transaction = {
  id: string;
  type: "topup" | "usage" | "adjustment" | "refund" | "midtrans";
  amount: number;
  date: string;
  description: string;
  status?: string;
  snap_token?: string;
  snap_url?: string;
  amount_idr?: number;
};

type BillingViewProps = {
  billingData: BillingData;
  transactions: Transaction[];
  onUpdate?: () => void;
};

export function BillingView({ billingData, transactions, onUpdate }: BillingViewProps) {
  const [topupAmount, setTopupAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} berhasil disalin ke clipboard.`);
  };

  const safe = useMemo(() => {
    const currentTokens = Number(billingData?.currentTokens ?? 0);
    const totalSpent = Number(billingData?.totalSpent ?? 0);
    const tokenPrice = Number(billingData?.tokenPrice ?? 1500);
    return { currentTokens, totalSpent, tokenPrice };
  }, [billingData]);

  // Manual payment states
  const [paymentSettings, setPaymentSettings] = useState<any | null>(null);
  const [manualRequests, setManualRequests] = useState<any[]>([]);
  const [isTopupModalOpen, setIsTopupModalOpen] = useState(false);
  const [referralCode, setReferralCode] = useState(0);
  const [receiptBase64, setReceiptBase64] = useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(null);

  const [notice, setNotice] = useState<{
    open: boolean;
    type: "success" | "error" | "info";
    title: string;
    message: string;
  }>({
    open: false,
    type: "info",
    title: "",
    message: "",
  });

  const openNotice = (
    type: "success" | "error" | "info",
    title: string,
    message: string,
  ) => {
    setNotice({ open: true, type, title, message });
  };

  const closeNotice = () => {
    setNotice({ open: false, type: "info", title: "", message: "" });
  };

  const loadSettings = async () => {
    const res = await api.getPaymentSettings();
    if (res.success) {
      setPaymentSettings(res.data);
    }
  };

  const loadManualRequests = async () => {
    const res = await api.getManualRequests();
    if (res.success) {
      setManualRequests(res.data);
    }
  };

  useEffect(() => {
    loadSettings();
    loadManualRequests();

    // 1. Load Midtrans Snap JS dynamically
    const isProduction = import.meta.env.VITE_MIDTRANS_IS_PRODUCTION === "true";
    const snapUrl = isProduction
      ? "https://app.midtrans.com/snap/snap.js"
      : "https://app.sandbox.midtrans.com/snap/snap.js";
    const clientKey = import.meta.env.VITE_MIDTRANS_CLIENT_KEY || "";

    if (clientKey && !document.querySelector(`script[src="${snapUrl}"]`)) {
      const script = document.createElement("script");
      script.src = snapUrl;
      script.setAttribute("data-client-key", clientKey);
      script.async = true;
      document.body.appendChild(script);
    }

    // 2. Detect redirect callback from Midtrans
    const hash = window.location.hash;
    if (hash.includes("?")) {
      const queryStr = hash.split("?")[1];
      const params = new URLSearchParams(queryStr);
      const status = params.get("status") || params.get("transaction_status");
      const orderId = params.get("order_id");

      if (status && orderId) {
        if (status === "success" || status === "settlement" || status === "capture") {
          openNotice(
            "success",
            "Pembayaran Berhasil",
            `Terima kasih! Pembayaran untuk transaksi #${orderId} telah berhasil diselesaikan. Saldo token Anda akan bertambah secara otomatis.`
          );
        } else if (status === "pending") {
          openNotice(
            "info",
            "Pembayaran Pending",
            `Transaksi #${orderId} sedang menunggu pembayaran. Harap selesaikan pembayaran Anda sesuai dengan petunjuk.`
          );
        } else if (status === "error" || status === "failure") {
          openNotice(
            "error",
            "Pembayaran Gagal",
            `Transaksi #${orderId} gagal atau dibatalkan. Silakan coba kembali.`
          );
        }
        // Clean hash query params to prevent double notification on page refresh
        window.location.hash = "#/billing";
        onUpdate?.();
      }
    }
  }, []);

  const mergedHistory = useMemo(() => {
    const list: any[] = [];

    // Add transactions
    (transactions || []).forEach((tx) => {
      list.push({
        id: tx.id,
        itemType: "transaction",
        type: tx.type,
        amount: tx.amount,
        date: tx.date,
        timestamp: new Date(tx.date).getTime(),
        description: tx.description,
        status: tx.status,
        snap_token: tx.snap_token,
        snap_url: tx.snap_url,
        amount_idr: tx.amount_idr,
      });
    });

    // Add manual requests
    (manualRequests || []).forEach((req) => {
      list.push({
        id: req.id,
        itemType: "manual_request",
        amount_tokens: req.amount_tokens,
        amount_idr: req.amount_idr,
        created_by_email: req.created_by_email,
        receipt_url: req.receipt_url,
        notes: req.notes,
        status: req.status,
        created_at: req.created_at,
        approved_at: req.approved_at,
        approved_by: req.approved_by,
        timestamp: new Date(req.created_at).getTime(),
      });
    });

    // Sort by timestamp descending
    return list.sort((a, b) => b.timestamp - a.timestamp);
  }, [transactions, manualRequests]);

  const handleQuickTopup = (tokens: number) => {
    setTopupAmount(tokens.toString());
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      openNotice("error", "Ukuran file terlalu besar", "Ukuran file bukti transfer maksimal 5MB.");
      return;
    }

    setReceiptFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => {
      setReceiptBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleProceedToPayment = () => {
    const tokens = parseInt(topupAmount, 10);
    if (!tokens || tokens <= 0) {
      openNotice("error", "Jumlah token tidak valid", "Masukkan jumlah token yang valid.");
      return;
    }
    const code = Math.floor(Math.random() * 900) + 100;
    setReferralCode(code);
    setReceiptBase64(null);
    setReceiptFileName("");
    setIsTopupModalOpen(true);
  };

  const handleMidtransPayment = async () => {
    const tokens = parseInt(topupAmount, 10);
    if (!tokens || tokens <= 0) {
      openNotice("error", "Jumlah token tidak valid", "Masukkan jumlah token yang valid.");
      return;
    }

    setLoading(true);
    try {
      const amount = tokens * safe.tokenPrice;
      const res = await api.createMidtransPayment(amount, tokens);
      
      if (res.success && res.data?.token) {
        const { token } = res.data;
        const snap = (window as any).snap;
        
        if (snap) {
          snap.pay(token, {
            onSuccess: function (result: any) {
              openNotice(
                "success",
                "Pembayaran Berhasil",
                "Terima kasih! Pembayaran Anda berhasil dan saldo token akan bertambah secara otomatis."
              );
              setTopupAmount("");
              onUpdate?.();
            },
            onPending: function (result: any) {
              openNotice(
                "info",
                "Pembayaran Tertunda",
                "Silakan selesaikan pembayaran Anda sesuai instruksi pada layar pembayaran."
              );
              setTopupAmount("");
              onUpdate?.();
            },
            onError: function (result: any) {
              openNotice("error", "Pembayaran Gagal", "Terjadi kesalahan saat memproses pembayaran. Silakan coba lagi.");
            },
            onClose: function () {
              console.log("Snap popup closed by user");
            },
          });
        } else {
          if (res.data.redirect_url) {
            window.location.href = res.data.redirect_url;
          } else {
            openNotice("error", "Gagal Memuat Pembayaran", "Sistem pembayaran gagal dimuat. Silakan muat ulang halaman.");
          }
        }
      } else {
        const errorMsg = !res.success ? res.error : "Token transaksi tidak ditemukan.";
        openNotice("error", "Gagal Memproses Pembayaran", errorMsg);
      }
    } catch (err) {
      console.error(err);
      openNotice("error", "Terjadi Kesalahan", "Gagal menghubungi server untuk memproses pembayaran otomatis.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitManualPayment = async () => {
    if (!receiptBase64) {
      openNotice("error", "Bukti transfer belum diunggah", "Unggah bukti transfer Anda terlebih dahulu.");
      return;
    }

    setSubmittingRequest(true);
    try {
      const tokens = parseInt(topupAmount, 10);
      const finalAmount = (tokens * safe.tokenPrice) + referralCode;

      const res = await api.createManualRequest(tokens, receiptBase64);
      if (res.success) {
        openNotice(
          "success",
          "Konfirmasi Terkirim",
          "Bukti transfer Anda telah dikirim dan sedang menunggu persetujuan admin. Saldo token Anda akan bertambah setelah disetujui."
        );
        setIsTopupModalOpen(false);
        setTopupAmount("");
        setReceiptBase64(null);
        setReceiptFileName("");
        loadManualRequests();
        onUpdate?.();
      } else {
        openNotice("error", "Gagal memproses pengajuan", "error" in res ? res.error : "Gagal memproses pengajuan.");
      }
    } catch (err) {
      console.error(err);
      openNotice("error", "Terjadi kesalahan", "Gagal menghubungi server untuk memproses pembayaran.");
    } finally {
      setSubmittingRequest(false);
    }
  };

  const formatDate = (date: string) => {
    if (!date) return "-";
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return date;
    return d.toLocaleString("id-ID");
  };

  const getTransactionColor = (type: Transaction["type"]) => {
    switch (type) {
      case "topup":
        return "bg-green-500 text-white";
      case "usage":
        return "bg-blue-500 text-white";
      case "refund":
        return "bg-yellow-500 text-black";
      case "adjustment":
        return "bg-purple-500 text-white";
      default:
        return "bg-gray-500 text-white";
    }
  };

  const getTransactionLabel = (type: Transaction["type"]) => {
    switch (type) {
      case "topup":
        return "Top-up";
      case "usage":
        return "Pemakaian";
      case "refund":
        return "Refund";
      case "adjustment":
        return "Adjustment";
      default:
        return type;
    }
  };

  return (
    <div className="w-full p-6 md:p-8 bg-white">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">Billing & Token</h1>
        <p className="text-sm text-slate-500 mt-1.5 leading-relaxed break-words whitespace-normal max-w-2xl">
          Kelola saldo token dan riwayat transaksi Anda.
        </p>
      </div>

      {safe.currentTokens === 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-red-900 font-medium mb-1">Token Anda Habis!</h4>
            <p className="text-sm text-red-700">
              Anda tidak dapat mengirim pesan tanpa token. Silakan lakukan top-up segera.
            </p>
          </div>
        </div>
      )}

      {safe.currentTokens > 0 && safe.currentTokens < 100 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-yellow-900 font-medium mb-1">Token Menipis</h4>
            <p className="text-sm text-yellow-700">
              Saldo token Anda tinggal {safe.currentTokens}. Segera top-up agar pengiriman tidak terhenti.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card className="p-6" style={{ backgroundColor: "#F0EAC6" }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-primary p-3 rounded-lg text-white">
              <Coins className="w-6 h-6" />
            </div>
            <div>
              <p className="text-muted-foreground">Saldo Token</p>
              <h2>{safe.currentTokens.toLocaleString("id-ID")}</h2>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Setara Rp {(safe.currentTokens * safe.tokenPrice).toLocaleString("id-ID")}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-accent p-3 rounded-lg text-white">
              <CreditCard className="w-6 h-6" />
            </div>
            <div>
              <p className="text-muted-foreground">Total Pengeluaran</p>
              <h2>Rp {safe.totalSpent.toLocaleString("id-ID")}</h2>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Harga per token: Rp {safe.tokenPrice.toLocaleString("id-ID")}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-primary p-3 rounded-lg text-white">
              <ArrowUpCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-muted-foreground">Estimasi Kapasitas</p>
              <h2>{safe.currentTokens.toLocaleString("id-ID")} pesan</h2>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Asumsi 1 token = 1 pengiriman pesan
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="mb-4">Top-up Token</h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[100, 250, 500, 1000].map((tokens) => (
              <Button
                key={tokens}
                variant="outline"
                onClick={() => handleQuickTopup(tokens)}
                className="h-auto py-3"
              >
                <div className="text-center">
                  <div className="font-medium">{tokens}</div>
                  <div className="text-xs text-muted-foreground">token</div>
                </div>
              </Button>
            ))}
          </div>

          <div className="space-y-4">
            <Input
              type="number"
              min="1"
              placeholder="Masukkan jumlah token"
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
            />

            <div className="bg-gray-50 rounded-lg p-4 border">
              <p className="text-sm text-muted-foreground mb-1">Estimasi pembayaran</p>
              <h3>
                Rp{" "}
                {(
                  (parseInt(topupAmount || "0", 10) || 0) * safe.tokenPrice
                ).toLocaleString("id-ID")}
              </h3>
            </div>

            <div className="flex flex-col gap-3">
              <Button
                onClick={handleMidtransPayment}
                disabled={loading}
                className="bg-primary hover:bg-primary/90 font-semibold"
              >
                Beli Token
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between border-b pb-3 mb-4">
            <div className="flex items-center gap-3">
              <History className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-bold text-slate-800">Riwayat</h3>
            </div>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
            {mergedHistory.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                Belum ada riwayat transaksi atau top-up
              </div>
            ) : (
              mergedHistory.map((item) => {
                if (item.itemType === "transaction") {
                  if (item.type === "midtrans") {
                    const isPending = item.status === "pending";
                    return (
                      <div
                        key={item.id}
                        className="border rounded-lg p-4 space-y-3 bg-slate-50/30"
                      >
                        <div className="flex items-center justify-between">
                          <Badge
                            className={
                              item.status === "success"
                                ? "bg-green-500 text-white"
                                : item.status === "failed"
                                ? "bg-red-500 text-white"
                                : "bg-yellow-500 text-black"
                            }
                          >
                            Pembayaran Instan ({item.status === "success" ? "Berhasil" : item.status === "failed" ? "Gagal" : "Menunggu Pembayaran"})
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(item.date)}
                          </span>
                        </div>

                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-bold text-slate-800 text-sm">
                              +{Number(item.amount ?? 0).toLocaleString("id-ID")} token
                            </p>
                            <p className="text-xs text-slate-600 mt-0.5">
                              Nominal: <span className="font-semibold text-slate-900">Rp {Number(item.amount_idr ?? 0).toLocaleString("id-ID")}</span>
                            </p>
                            <p className="text-[10px] text-slate-400 mt-1">
                              ID Transaksi: {item.id}
                            </p>
                          </div>

                          {isPending && item.snap_token && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => {
                                const snap = (window as any).snap;
                                if (snap) {
                                  snap.pay(item.snap_token, {
                                    onSuccess: function (result: any) {
                                      openNotice(
                                        "success",
                                        "Pembayaran Berhasil",
                                        "Terima kasih! Pembayaran Anda berhasil dan saldo token akan bertambah secara otomatis."
                                      );
                                      onUpdate?.();
                                    },
                                    onPending: function (result: any) {
                                      openNotice(
                                        "info",
                                        "Pembayaran Tertunda",
                                        "Silakan selesaikan pembayaran Anda sesuai instruksi pada layar pembayaran."
                                      );
                                      onUpdate?.();
                                    },
                                    onError: function (result: any) {
                                      openNotice(
                                        "error",
                                        "Pembayaran Gagal",
                                        "Terjadi kesalahan saat memproses pembayaran. Silakan coba lagi."
                                      );
                                    },
                                    onClose: function () {
                                      console.log("Snap popup closed by user");
                                    }
                                  });
                                } else if (item.snap_url) {
                                  window.open(item.snap_url, "_blank");
                                }
                              }}
                              className="bg-primary hover:bg-primary/90 text-white text-xs h-8 flex items-center gap-1 font-semibold"
                            >
                              <Coins className="w-3.5 h-3.5" />
                              Bayar Sekarang
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      className="border rounded-lg p-4 flex items-start justify-between gap-4"
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={getTransactionColor(item.type)}>
                            {getTransactionLabel(item.type)}
                          </Badge>
                        </div>
                        <p className="font-medium text-sm">{item.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(item.date)}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="font-semibold text-sm">
                          {item.type === "usage" ? "-" : "+"}
                          {Number(item.amount ?? 0).toLocaleString("id-ID")} token
                        </p>
                      </div>
                    </div>
                  );
                } else {
                  return (
                    <div
                      key={item.id}
                      className="border rounded-lg p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <Badge
                          className={
                            item.status === "approved"
                              ? "bg-green-500 text-white"
                              : item.status === "rejected"
                              ? "bg-red-500 text-white"
                              : "bg-yellow-500 text-black"
                          }
                        >
                          Top-up Manual ({item.status === "approved"
                            ? "Disetujui"
                            : item.status === "rejected"
                            ? "Ditolak"
                            : "Menunggu Approval"})
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(item.created_at)}
                        </span>
                      </div>

                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold text-slate-800 text-sm">
                            +{Number(item.amount_tokens ?? 0).toLocaleString("id-ID")} token
                          </p>
                          <p className="text-xs text-slate-600 mt-0.5">
                            Nominal Transfer: <span className="font-semibold text-slate-900">Rp {Number(item.amount_idr ?? 0).toLocaleString("id-ID")}</span>
                          </p>
                          <p className="text-[10px] text-slate-400 mt-1">
                            Diajukan oleh: {item.created_by_email}
                          </p>
                        </div>

                        {item.receipt_url && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedReceipt(item.receipt_url)}
                            className="flex items-center gap-1.5 text-xs h-8"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Bukti
                          </Button>
                        )}
                      </div>

                      {item.notes && (
                        <div className="bg-slate-50 p-2.5 rounded text-xs text-slate-600 border border-slate-100">
                          <span className="font-semibold text-slate-700">Catatan Admin:</span> {item.notes}
                        </div>
                      )}

                      {item.approved_at && (
                        <p className="text-[10px] text-slate-400 text-right">
                          Diproses pada {formatDate(item.approved_at)} oleh {item.approved_by}
                        </p>
                      )}
                    </div>
                  );
                }
              })
            )}
          </div>
        </Card>
      </div>


      {/* Zoom Receipt Modal */}
      <AppModal
        open={!!selectedReceipt}
        title="Bukti Transfer"
        onClose={() => setSelectedReceipt(null)}
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setSelectedReceipt(null)}>Tutup</Button>
          </div>
        }
      >
        {selectedReceipt && (
          <div className="flex items-center justify-center p-2 bg-slate-900/5 rounded-lg overflow-hidden border">
            <img
              src={selectedReceipt}
              alt="Bukti Transfer Zoom"
              className="max-w-full max-h-[70vh] object-contain rounded"
            />
          </div>
        )}
      </AppModal>

      {/* Alert Notice Modal */}
      <AppModal
        open={notice.open}
        title={notice.title}
        onClose={closeNotice}
        footer={
          <div className="flex justify-end">
            <Button onClick={closeNotice}>Oke</Button>
          </div>
        }
      >
        <p
          className={`text-sm leading-6 ${
            notice.type === "success"
              ? "text-green-700"
              : notice.type === "error"
              ? "text-red-700"
              : "text-slate-600"
          }`}
        >
          {notice.message}
        </p>
      </AppModal>
    </div>
  );
}