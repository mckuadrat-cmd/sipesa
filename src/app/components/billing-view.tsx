import { useState, useEffect, useMemo } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Coins, CreditCard, ArrowUpCircle, History, AlertCircle } from "lucide-react";
import { Badge } from "./ui/badge";
import { api } from "../lib/api";
import { AppModal } from "./AppModal";

type BillingData = {
  currentTokens?: number;
  totalSpent?: number;
  tokenPrice?: number;
};

type Transaction = {
  id: string;
  type: "topup" | "usage" | "adjustment" | "refund";
  amount: number;
  date: string;
  description: string;
};

type BillingViewProps = {
  billingData: BillingData;
  transactions: Transaction[];
  onUpdate?: () => void;
};

declare global {
  interface Window {
    snap?: any;
  }
}

export function BillingView({ billingData, transactions, onUpdate }: BillingViewProps) {
  const [topupAmount, setTopupAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const safe = useMemo(() => {
    const currentTokens = Number(billingData?.currentTokens ?? 0);
    const totalSpent = Number(billingData?.totalSpent ?? 0);
    const tokenPrice = Number(billingData?.tokenPrice ?? 1500);
    return { currentTokens, totalSpent, tokenPrice };
  }, [billingData]);

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

  useEffect(() => {
    const MIDTRANS_CLIENT_KEY = import.meta.env.VITE_MIDTRANS_CLIENT_KEY || "";
    const MIDTRANS_IS_PRODUCTION = import.meta.env.VITE_MIDTRANS_IS_PRODUCTION === "true";

    if (!MIDTRANS_CLIENT_KEY) {
      console.warn("VITE_MIDTRANS_CLIENT_KEY belum diisi");
      return;
    }

    const script = document.createElement("script");
    script.src = MIDTRANS_IS_PRODUCTION
      ? "https://app.midtrans.com/snap/snap.js"
      : "https://app.sandbox.midtrans.com/snap/snap.js";
    script.setAttribute("data-client-key", MIDTRANS_CLIENT_KEY);
    script.async = true;

    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const handleQuickTopup = (tokens: number) => {
    setTopupAmount(tokens.toString());
  };

  const handleMidtransPayment = async () => {
    if (!topupAmount || parseInt(topupAmount, 10) <= 0) {
      openNotice("error", "Jumlah token tidak valid", "Masukkan jumlah token yang valid.");
      return;
    }

    if (!window.snap) {
      openNotice("error", "Snap belum siap", "Snap Midtrans belum termuat. Cek Client Key frontend.");
      return;
    }

    setLoading(true);
    try {
      const tokens = parseInt(topupAmount, 10);
      const amount = tokens * safe.tokenPrice;

      const createMidtransPayment = (api as any).createMidtransPayment;
      if (!createMidtransPayment) {
        openNotice("info", "Midtrans belum aktif", "Midtrans belum diaktifkan di backend.");
        return;
      }

      const result = await createMidtransPayment(amount, tokens);

      if ("error" in result) {
        openNotice("error", "Gagal membuat pembayaran", result.error);
        return;
      }

      if (!result?.data?.token) {
        openNotice("error", "Snap token tidak ditemukan", "Snap token Midtrans tidak ditemukan.");
        return;
      }

      window.snap.pay(result.data.token, {
        onSuccess: async function () {
          openNotice("success", "Pembayaran berhasil", "Pembayaran berhasil. Token akan masuk setelah webhook Midtrans diterima.");
          setTopupAmount("");
          onUpdate?.();
        },
        onPending: function () {
          openNotice("info", "Pembayaran diproses", "Pembayaran sedang diproses. Silakan cek kembali beberapa saat lagi.");
          onUpdate?.();
        },
        onError: function () {
          openNotice("error", "Pembayaran gagal", "Pembayaran gagal. Silakan coba lagi.");
        },
        onClose: function () {
          console.log("Snap popup ditutup");
        },
      });
    } catch (error) {
      console.error("Error creating Midtrans payment:", error);
      openNotice("error", "Terjadi kesalahan", "Terjadi kesalahan saat memproses pembayaran.");
    } finally {
      setLoading(false);
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
        return "bg-green-500";
      case "usage":
        return "bg-blue-500";
      case "refund":
        return "bg-yellow-500";
      case "adjustment":
        return "bg-purple-500";
      default:
        return "bg-gray-500";
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
    <div className="p-8">
      <div className="mb-8">
        <h1 className="mb-2">Billing & Token</h1>
        <p className="text-muted-foreground">Kelola saldo token dan riwayat transaksi Anda</p>
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
                className="bg-primary hover:bg-primary/90"
              >
                {loading ? "Memproses..." : "Bayar via Midtrans"}
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <History className="w-5 h-5 text-primary" />
            <h3>Riwayat Transaksi</h3>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
            {transactions.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                Belum ada transaksi
              </div>
            ) : (
              transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="border rounded-lg p-4 flex items-start justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className={getTransactionColor(tx.type)}>
                        {getTransactionLabel(tx.type)}
                      </Badge>
                    </div>
                    <p className="font-medium">{tx.description}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(tx.date)}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-medium">
                      {tx.type === "usage" ? "-" : "+"}
                      {Number(tx.amount ?? 0).toLocaleString("id-ID")} token
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

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