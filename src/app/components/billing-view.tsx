import { useState, useEffect, useMemo } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Coins, CreditCard, ArrowUpCircle, History, AlertCircle, Upload, Eye, Image } from "lucide-react";
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

export function BillingView({ billingData, transactions, onUpdate }: BillingViewProps) {
  const [topupAmount, setTopupAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const safe = useMemo(() => {
    const currentTokens = Number(billingData?.currentTokens ?? 0);
    const totalSpent = Number(billingData?.totalSpent ?? 0);
    const tokenPrice = Number(billingData?.tokenPrice ?? 1500);
    return { currentTokens, totalSpent, tokenPrice };
  }, [billingData]);

  // Manual payment states
  const [paymentSettings, setPaymentSettings] = useState<{
    bank_transfer?: string;
    gopay?: string;
    qris_url?: string;
  } | null>(null);
  const [manualRequests, setManualRequests] = useState<any[]>([]);
  const [isTopupModalOpen, setIsTopupModalOpen] = useState(false);
  const [referralCode, setReferralCode] = useState(0);
  const [receiptBase64, setReceiptBase64] = useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [historyTab, setHistoryTab] = useState<"transactions" | "manual">("transactions");
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
  }, []);

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
                onClick={handleProceedToPayment}
                disabled={loading}
                className="bg-primary hover:bg-primary/90"
              >
                Beli Token / Top-up
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
            <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs font-semibold">
              <button
                onClick={() => setHistoryTab("transactions")}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  historyTab === "transactions" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Transaksi
              </button>
              <button
                onClick={() => setHistoryTab("manual")}
                className={`px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
                  historyTab === "manual" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                Top-up Manual
                {manualRequests.filter((r) => r.status === "pending").length > 0 && (
                  <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
            {historyTab === "transactions" ? (
              transactions.length === 0 ? (
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
              )
            ) : (
              manualRequests.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  Belum ada pengajuan top-up manual
                </div>
              ) : (
                manualRequests.map((req) => (
                  <div
                    key={req.id}
                    className="border rounded-lg p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <Badge
                        className={
                          req.status === "approved"
                            ? "bg-green-500 text-white"
                            : req.status === "rejected"
                            ? "bg-red-500 text-white"
                            : "bg-yellow-500 text-black"
                        }
                      >
                        {req.status === "approved"
                          ? "Disetujui"
                          : req.status === "rejected"
                          ? "Ditolak"
                          : "Menunggu Approval"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(req.created_at)}
                      </span>
                    </div>

                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold text-slate-800">
                          {Number(req.amount_tokens ?? 0).toLocaleString("id-ID")} token
                        </p>
                        <p className="text-sm text-slate-600 mt-0.5">
                          Nominal Transfer: <span className="font-semibold text-slate-900">Rp {Number(req.amount_idr ?? 0).toLocaleString("id-ID")}</span>
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          Diajukan oleh: {req.created_by_email}
                        </p>
                      </div>

                      {req.receipt_url && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedReceipt(req.receipt_url)}
                          className="flex items-center gap-1.5 text-xs h-8"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Bukti
                        </Button>
                      )}
                    </div>

                    {req.notes && (
                      <div className="bg-slate-50 p-2.5 rounded text-xs text-slate-600 border border-slate-100">
                        <span className="font-semibold text-slate-700">Catatan Admin:</span> {req.notes}
                      </div>
                    )}

                    {req.approved_at && (
                      <p className="text-[10px] text-slate-400 text-right">
                        Diproses pada {formatDate(req.approved_at)} oleh {req.approved_by}
                      </p>
                    )}
                  </div>
                ))
              )
            )}
          </div>
        </Card>
      </div>

      {/* Manual Top-up Modal */}
      <AppModal
        open={isTopupModalOpen}
        title="Pembayaran Top-up Token"
        onClose={() => setIsTopupModalOpen(false)}
        footer={
          <div className="flex justify-between w-full">
            <Button variant="outline" onClick={() => setIsTopupModalOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={handleSubmitManualPayment}
              disabled={submittingRequest || !receiptBase64}
              className="bg-primary hover:bg-primary/90 text-white"
            >
              {submittingRequest ? "Mengirim..." : "Konfirmasi & Kirim Bukti"}
            </Button>
          </div>
        }
      >
        <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-1">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
            <p className="font-semibold mb-1">PENTING: Transfer Sesuai Nominal Unik!</p>
            <p>
              Mohon transfer tepat sesuai jumlah nominal di bawah ini hingga 3 digit terakhir. Kode referral digunakan untuk mempercepat proses pencocokan transfer secara manual.
            </p>
          </div>

          <div className="text-center py-4 bg-gray-50 border rounded-lg">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Total Nominal Transfer</p>
            <h1 className="text-3xl font-extrabold text-slate-900 mt-1">
              Rp {((parseInt(topupAmount, 10) || 0) * safe.tokenPrice + referralCode).toLocaleString("id-ID")}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              (Rp {((parseInt(topupAmount, 10) || 0) * safe.tokenPrice).toLocaleString("id-ID")} + Rp {referralCode} kode referral)
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="font-semibold text-slate-800 border-b pb-1">Tujuan Transfer</h4>
            
            {paymentSettings?.bank_transfer && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase font-bold">Transfer Bank</p>
                <p className="text-sm font-medium whitespace-pre-line bg-white p-3 border rounded-lg">
                  {paymentSettings.bank_transfer}
                </p>
              </div>
            )}

            {paymentSettings?.gopay && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase font-bold">Gopay / E-Wallet</p>
                <p className="text-sm font-medium bg-white p-3 border rounded-lg">
                  {paymentSettings.gopay}
                </p>
              </div>
            )}

            {paymentSettings?.qris_url && (
              <div className="space-y-1 text-center">
                <p className="text-xs text-muted-foreground uppercase font-bold text-left">QRIS Pembayaran</p>
                <div className="inline-block bg-white p-3 border rounded-lg mt-1 mx-auto">
                  <img
                    src={paymentSettings.qris_url}
                    alt="QRIS Barcode"
                    className="max-w-[200px] h-auto mx-auto object-contain"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Pindai kode QRIS di atas untuk membayar</p>
                </div>
              </div>
            )}

            {(!paymentSettings?.bank_transfer && !paymentSettings?.gopay && !paymentSettings?.qris_url) && (
              <p className="text-sm text-yellow-600 bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                Peringatan: Admin belum mengkonfigurasi rekening transfer di pengaturan. Silakan hubungi admin secara langsung.
              </p>
            )}
          </div>

          <div className="space-y-3 pt-2">
            <h4 className="font-semibold text-slate-800">Unggah Bukti Transfer</h4>
            <div className="flex flex-col gap-3">
              <label className="border-2 border-dashed border-slate-200 hover:border-primary/50 transition-colors rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer bg-slate-50/50 hover:bg-slate-50 group">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <Upload className="w-8 h-8 text-slate-400 group-hover:text-primary transition-colors mb-2" />
                <span className="text-sm font-semibold text-slate-600 group-hover:text-primary transition-colors">
                  {receiptFileName || "Pilih file bukti transfer"}
                </span>
                <span className="text-xs text-slate-400 mt-1">Format gambar (PNG, JPG), maks. 5MB</span>
              </label>

              {receiptBase64 && (
                <div className="border rounded-lg p-3 bg-white flex items-center justify-between">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <Image className="w-5 h-5 text-primary flex-shrink-0" />
                    <span className="text-sm truncate font-medium">{receiptFileName}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setReceiptBase64(null);
                      setReceiptFileName("");
                    }}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
                  >
                    Hapus
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </AppModal>

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