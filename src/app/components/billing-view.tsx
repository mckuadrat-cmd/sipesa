import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowUpCircle, CheckCircle2, Coins, CreditCard, Eye, History, RefreshCw, Trash2, Upload } from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { AppModal } from "./AppModal";
import { api, type ManualPaymentRequest, type PaymentDestination } from "../lib/api";
import { useVisibilityRefresh } from "../hooks/use-visibility-refresh";

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
  amount_idr?: number;
};

type BillingViewProps = {
  billingData: BillingData;
  transactions: Transaction[];
  onUpdate?: () => void;
};

const proofMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("id-ID");
}

function requestBadge(status: ManualPaymentRequest["status"]) {
  switch (status) {
    case "approved": return "bg-green-600 text-white";
    case "rejected": return "bg-red-600 text-white";
    case "submitted": return "bg-amber-500 text-slate-950";
    default: return "bg-slate-500 text-white";
  }
}

export function BillingView({ billingData, transactions, onUpdate }: BillingViewProps) {
  const safe = useMemo(() => {
    const currentTokens = Number(billingData?.currentTokens ?? 0);
    const totalSpent = Number(billingData?.totalSpent ?? 0);
    const rawTokenPrice = Number(billingData?.tokenPrice);
    const tokenPrice = Number.isFinite(rawTokenPrice) && rawTokenPrice > 0 ? rawTokenPrice : 0;
    return { currentTokens, totalSpent, tokenPrice };
  }, [billingData]);

  const [topupAmount, setTopupAmount] = useState("");
  const [destinations, setDestinations] = useState<PaymentDestination[]>([]);
  const [destinationsLoading, setDestinationsLoading] = useState(true);
  const [destinationsError, setDestinationsError] = useState<string | null>(null);
  const [selectedDestinationId, setSelectedDestinationId] = useState("");
  const [requests, setRequests] = useState<ManualPaymentRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);
  const [draft, setDraft] = useState<ManualPaymentRequest | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [mutation, setMutation] = useState<"create" | "upload" | "submit" | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [qrisUrl, setQrisUrl] = useState<string | null>(null);
  const [qrisError, setQrisError] = useState<string | null>(null);
  const [qrisRetry, setQrisRetry] = useState(0);
  const [proofViewer, setProofViewer] = useState<{ url: string; mime: string | null } | null>(null);
  const [proofLoadingId, setProofLoadingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);

  const loadDestinations = useCallback(async () => {
    setDestinationsLoading(true);
    setDestinationsError(null);
    const result = await api.getPaymentDestinations();
    if (result.success) {
      setDestinations(result.data);
      setSelectedDestinationId((current) => current || result.data[0]?.id || "");
    } else {
      setDestinationsError(result.error);
    }
    setDestinationsLoading(false);
  }, []);

  const loadRequests = useCallback(async (background = false) => {
    if (!background) setRequestsLoading(true);
    const result = await api.getManualRequests();
    if (result.success) {
      setRequests(result.data);
      setRequestsError(null);
    } else {
      setRequestsError(result.error);
    }
    if (!background) setRequestsLoading(false);
  }, []);

  const refreshRequests = useVisibilityRefresh(() => loadRequests(true), { intervalMs: 30_000 });

  useEffect(() => {
    void loadDestinations();
    void loadRequests();
  }, [loadDestinations, loadRequests]);

  useEffect(() => {
    const destination = draft?.destination;
    if (!flowOpen || !destination?.has_qris) {
      setQrisUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      setQrisError(null);
      return;
    }
    let active = true;
    void api.getPaymentDestinationQrisObjectUrl(destination.id).then((result) => {
      if (!active) {
        if (result.success) URL.revokeObjectURL(result.data);
        return;
      }
      if (result.success) setQrisUrl(result.data);
      else setQrisError(result.error);
    });
    return () => { active = false; };
  }, [draft?.destination, flowOpen, qrisRetry]);

  useEffect(() => () => {
    if (qrisUrl) URL.revokeObjectURL(qrisUrl);
    if (proofViewer?.url) URL.revokeObjectURL(proofViewer.url);
  }, [proofViewer?.url, qrisUrl]);

  const selectedDestination = destinations.find((item) => item.id === selectedDestinationId) ?? null;
  const amountTokens = Number.parseInt(topupAmount, 10);
  const amountIsValid = Number.isSafeInteger(amountTokens) && amountTokens > 0 && safe.tokenPrice > 0;

  const beginPayment = async () => {
    if (!amountIsValid) {
      setFlowError("Masukkan jumlah token yang valid dan pastikan harga token tersedia.");
      return;
    }
    if (!selectedDestination) {
      setFlowError("Pilih metode pembayaran yang tersedia.");
      return;
    }
    if (mutation) return;
    setMutation("create");
    setFlowError(null);
    const result = await api.createManualRequest(amountTokens, selectedDestination.id);
    if (result.success) {
      setDraft(result.data);
      setProof(null);
      if (proofInputRef.current) proofInputRef.current.value = "";
      setFlowOpen(true);
      void loadRequests(true);
    } else {
      setFlowError(result.error);
    }
    setMutation(null);
  };

  const resumeDraft = (request: ManualPaymentRequest) => {
    setDraft(request);
    setTopupAmount(String(request.amount_tokens));
    setSelectedDestinationId(request.destination?.id ?? "");
    setProof(null);
    if (proofInputRef.current) proofInputRef.current.value = "";
    setFlowError(null);
    setFlowOpen(true);
  };

  const selectProof = (file?: File) => {
    if (!file) return;
    if (!proofMimeTypes.has(file.type)) {
      setProof(null);
      if (proofInputRef.current) proofInputRef.current.value = "";
      setFlowError("Format bukti harus JPG, PNG, WEBP, atau PDF.");
      return;
    }
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
      setProof(null);
      if (proofInputRef.current) proofInputRef.current.value = "";
      setFlowError("Ukuran bukti pembayaran maksimal 5 MB.");
      return;
    }
    setProof(file);
    setFlowError(null);
  };

  const removeProof = () => {
    setProof(null);
    setFlowError(null);
    if (proofInputRef.current) proofInputRef.current.value = "";
  };

  const submitPayment = async () => {
    if (!draft || !proof || mutation) {
      if (!proof) setFlowError("Unggah bukti pembayaran sebelum mengirim permintaan.");
      return;
    }
    setMutation("upload");
    setFlowError(null);
    const upload = await api.uploadManualPaymentProof(draft.id, proof);
    if (!upload.success) {
      setFlowError(upload.error);
      setMutation(null);
      return;
    }
    setMutation("submit");
    const submitted = await api.submitManualPayment(draft.id);
    if (!submitted.success) {
      setDraft({ ...upload.data, destination: upload.data.destination ?? draft.destination });
      setFlowError(submitted.error);
      setMutation(null);
      return;
    }
    setMutation(null);
    setFlowOpen(false);
    setDraft(null);
    setProof(null);
    if (proofInputRef.current) proofInputRef.current.value = "";
    setTopupAmount("");
    setNotice({
      title: "Menunggu Verifikasi",
      message: `Permintaan ${submitted.data.payment_reference} sudah dikirim. Saldo baru akan bertambah setelah disetujui.`,
    });
    await refreshRequests();
    onUpdate?.();
  };

  const showProof = async (request: ManualPaymentRequest) => {
    if (!request.proof_available || proofLoadingId) return;
    setProofLoadingId(request.id);
    const result = await api.getManualPaymentProofObjectUrl(request.id);
    if (result.success) {
      setProofViewer((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return { url: result.data, mime: request.proof_mime_type };
      });
    } else {
      setNotice({ title: "Bukti Belum Dapat Dimuat", message: result.error });
    }
    setProofLoadingId(null);
  };

  const history = useMemo(() => {
    const ledger = transactions.map((transaction) => ({
      key: `ledger-${transaction.id}`,
      timestamp: new Date(transaction.date).getTime(),
      kind: "ledger" as const,
      transaction,
    }));
    const payments = requests.map((request) => ({
      key: `payment-${request.id}`,
      timestamp: new Date(request.created_at).getTime(),
      kind: "payment" as const,
      request,
    }));
    return [...ledger, ...payments].sort((a, b) => b.timestamp - a.timestamp);
  }, [requests, transactions]);

  const transactionLabel = (type: Transaction["type"]) => ({
    topup: "Top-up",
    usage: "Pemakaian",
    adjustment: "Penyesuaian",
    refund: "Pengembalian",
    midtrans: "Gateway (Legacy)",
  })[type] ?? type;

  return (
    <div className="w-full p-4 sm:p-6 md:p-8 bg-white overflow-x-hidden">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900">Billing & Token</h1>
        <p className="text-sm text-slate-500 mt-1.5 max-w-2xl">Tambah saldo melalui transfer langsung dan verifikasi manual.</p>
      </div>

      {safe.currentTokens < 100 && (
        <div className={`${safe.currentTokens === 0 ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-800"} border rounded-lg p-4 mb-6 flex gap-3`}>
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div><p className="font-semibold">{safe.currentTokens === 0 ? "Token habis" : "Token menipis"}</p><p className="text-sm">Saldo saat ini {safe.currentTokens.toLocaleString("id-ID")} token.</p></div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-8">
        <Card className="p-5 sm:p-6 bg-[#F0EAC6]"><div className="flex items-center gap-3"><div className="bg-primary p-3 rounded-lg text-white"><Coins className="w-6 h-6" aria-hidden="true" /></div><div><p className="text-muted-foreground">Saldo Token</p><h2>{safe.currentTokens.toLocaleString("id-ID")}</h2></div></div></Card>
        <Card className="p-5 sm:p-6"><div className="flex items-center gap-3"><div className="bg-accent p-3 rounded-lg text-white"><CreditCard className="w-6 h-6" aria-hidden="true" /></div><div><p className="text-muted-foreground">Total Pengeluaran</p><h2>Rp {safe.totalSpent.toLocaleString("id-ID")}</h2></div></div></Card>
        <Card className="p-5 sm:p-6"><div className="flex items-center gap-3"><div className="bg-primary p-3 rounded-lg text-white"><ArrowUpCircle className="w-6 h-6" aria-hidden="true" /></div><div><p className="text-muted-foreground">Harga per Token</p><h2>Rp {safe.tokenPrice.toLocaleString("id-ID")}</h2></div></div></Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="p-5 sm:p-6 min-w-0">
          <h3 className="mb-1">Top-up Token</h3>
          <p className="text-sm text-slate-500 mb-5">Pilih nominal dan rekening tujuan. Saldo dikreditkan setelah bukti diverifikasi.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {[100, 250, 500, 1000].map((tokens) => <Button key={tokens} type="button" variant={topupAmount === String(tokens) ? "default" : "outline"} onClick={() => setTopupAmount(String(tokens))}>{tokens.toLocaleString("id-ID")}</Button>)}
          </div>
          <label htmlFor="topup-token-amount" className="block text-sm font-medium text-slate-700 mb-1.5">Jumlah token</label>
          <Input id="topup-token-amount" type="number" min="1" value={topupAmount} onChange={(event) => setTopupAmount(event.target.value)} aria-invalid={Boolean(topupAmount && !amountIsValid)} disabled={Boolean(mutation)} />
          <div className="bg-slate-50 border rounded-lg p-4 my-4"><p className="text-sm text-slate-500">Nominal top-up (belum termasuk kode unik)</p><p className="text-xl font-bold">Rp {((amountTokens || 0) * safe.tokenPrice).toLocaleString("id-ID")}</p></div>

          <fieldset disabled={Boolean(mutation)} className="space-y-2 mb-4">
            <legend className="text-sm font-medium text-slate-700 mb-2">Metode pembayaran</legend>
            {destinationsLoading ? <p className="text-sm text-slate-500">Memuat metode pembayaran…</p> : destinationsError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p>{destinationsError}</p><Button type="button" variant="outline" size="sm" onClick={() => void loadDestinations()} className="mt-2"><RefreshCw className="w-4 h-4 mr-1" aria-hidden="true" />Coba Lagi</Button></div>
            ) : destinations.length === 0 ? <p className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">Belum ada rekening atau QRIS aktif. Hubungi administrator.</p> : destinations.map((destination) => (
              <label key={destination.id} className="flex items-start gap-3 border rounded-lg p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input type="radio" name="payment-destination" value={destination.id} checked={selectedDestinationId === destination.id} onChange={() => setSelectedDestinationId(destination.id)} className="mt-1" />
                <span><span className="block font-semibold text-sm">{destination.provider_name}</span><span className="block text-xs text-slate-500">{destination.method === "qris_static" ? "QRIS Statis" : `Transfer Bank • ${destination.account_reference}`}</span></span>
              </label>
            ))}
          </fieldset>
          {flowError && !flowOpen && <p role="alert" className="text-sm text-red-700 mb-3">{flowError}</p>}
          <Button type="button" onClick={() => void beginPayment()} disabled={!amountIsValid || !selectedDestination || Boolean(mutation)} className="w-full">{mutation === "create" ? "Membuat Permintaan…" : "Lanjutkan Pembayaran"}</Button>
          {!selectedDestination && !destinationsLoading && destinations.length > 0 && <p className="text-xs text-slate-500 mt-2">Pilih metode pembayaran untuk melanjutkan.</p>}
        </Card>

        <Card className="p-5 sm:p-6 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 mb-4"><div className="flex items-center gap-2"><History className="w-5 h-5 text-primary" aria-hidden="true" /><h3>Riwayat</h3></div><Button type="button" variant="ghost" size="sm" onClick={() => void refreshRequests()} aria-label="Perbarui riwayat pembayaran"><RefreshCw className="w-4 h-4" aria-hidden="true" /></Button></div>
          {requestsError && <div className="mb-3 border border-amber-200 bg-amber-50 rounded-lg p-3 text-sm text-amber-800">{requests.length > 0 ? "Data terakhir ditampilkan. Gagal memperbarui riwayat." : requestsError}<Button type="button" variant="link" className="h-auto px-2" onClick={() => void loadRequests()}>Coba Lagi</Button></div>}
          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {requestsLoading && history.length === 0 ? <p className="text-sm text-slate-500 py-10 text-center">Memuat riwayat…</p> : history.length === 0 ? <p className="text-sm text-slate-500 py-10 text-center">Belum ada riwayat pembayaran atau transaksi.</p> : history.map((item) => item.kind === "ledger" ? (
              <div key={item.key} className="border rounded-lg p-4 flex justify-between gap-3"><div><Badge variant="outline">{transactionLabel(item.transaction.type)}</Badge><p className="text-sm font-medium mt-2 break-words">{item.transaction.description}</p><p className="text-xs text-slate-500">{formatDate(item.transaction.date)}</p></div><p className="text-sm font-semibold whitespace-nowrap">{item.transaction.type === "usage" ? "-" : "+"}{Number(item.transaction.amount).toLocaleString("id-ID")} token</p></div>
            ) : (
              <div key={item.key} className="border rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap justify-between gap-2"><Badge className={requestBadge(item.request.status)}>{item.request.status_label}</Badge><span className="text-xs text-slate-500">{formatDate(item.request.created_at)}</span></div>
                <div className="space-y-1">
                  <p className="font-semibold">+{item.request.amount_tokens.toLocaleString("id-ID")} token</p>
                  <p className="text-xs text-slate-500">Nominal Top Up: Rp {item.request.base_amount.toLocaleString("id-ID")}</p>
                  {item.request.unique_code != null && <p className="text-xs text-slate-500">Kode Unik: {String(item.request.unique_code).padStart(3, "0")}</p>}
                  <p className="text-sm font-bold text-slate-800">Total Transfer: Rp {item.request.transfer_amount.toLocaleString("id-ID")}</p>
                  <p className="text-xs text-slate-500 break-all">Referensi: {item.request.payment_reference}</p>
                  <p className="text-xs text-slate-500">Metode: {item.request.destination?.provider_name ?? item.request.payment_method}</p>
                </div>
                {item.request.rejection_reason && <p className="rounded bg-red-50 border border-red-100 p-2 text-xs text-red-700"><strong>Alasan:</strong> {item.request.rejection_reason}</p>}
                {item.request.status === "approved" && <p className="text-xs text-green-700">Saldo dikreditkan pada {formatDate(item.request.reviewed_at)}.</p>}
                <div className="flex flex-wrap gap-2">
                  {item.request.status === "draft" && <Button type="button" size="sm" onClick={() => resumeDraft(item.request)}>Lanjutkan Pembayaran</Button>}
                  {item.request.proof_available && <Button type="button" variant="outline" size="sm" onClick={() => void showProof(item.request)} disabled={proofLoadingId === item.request.id}><Eye className="w-4 h-4 mr-1" aria-hidden="true" />{proofLoadingId === item.request.id ? "Memuat…" : "Lihat Bukti"}</Button>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <AppModal open={flowOpen && Boolean(draft)} title="Instruksi Pembayaran" description={draft ? `Referensi ${draft.payment_reference}` : undefined} onClose={() => setFlowOpen(false)} closeDisabled={Boolean(mutation)} closeOnBackdrop={!mutation} maxWidthClassName="max-w-xl" footer={<div className="flex flex-col-reverse sm:flex-row justify-end gap-2"><Button type="button" variant="outline" onClick={() => setFlowOpen(false)} disabled={Boolean(mutation)}>Simpan & Tutup</Button><Button type="button" onClick={() => void submitPayment()} disabled={!proof || Boolean(mutation)}>{mutation === "upload" ? "Mengunggah bukti…" : mutation === "submit" ? "Mengirim untuk verifikasi…" : "Kirim untuk Verifikasi"}</Button></div>}>
        {draft && <div className="space-y-4">
          <div className="rounded-lg border bg-slate-50 p-4 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div><p className="text-slate-500">Nominal Top Up</p><p className="font-semibold">Rp {draft.base_amount.toLocaleString("id-ID")}</p></div>
              {draft.unique_code != null && <div><p className="text-slate-500">Kode Unik</p><p className="font-semibold font-mono">{String(draft.unique_code).padStart(3, "0")}</p></div>}
            </div>
            <div className="rounded-lg border border-primary/20 bg-white p-3"><p className="text-sm font-medium text-slate-600">Total Transfer</p><p className="text-3xl font-extrabold text-primary">Rp {draft.transfer_amount.toLocaleString("id-ID")}</p></div>
            <p className="text-sm mt-2">{draft.destination?.provider_name}</p>{draft.destination?.account_reference && <p className="font-mono break-all">{draft.destination.account_reference}</p>}{draft.destination?.account_holder && <p className="text-sm text-slate-600">a.n. {draft.destination.account_holder}</p>}{draft.destination?.instructions && <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{draft.destination.instructions}</p>}
            {draft.destination?.method === "bank_transfer" && <p className="text-sm font-medium">Transfer tepat sebesar <strong>Rp {draft.transfer_amount.toLocaleString("id-ID")}</strong>.</p>}
            {draft.destination?.method === "qris_static" && <p className="text-sm font-medium">Masukkan nominal pembayaran tepat sebesar <strong>Rp {draft.transfer_amount.toLocaleString("id-ID")}</strong>.</p>}
            {draft.unique_code != null && <p className="text-xs text-slate-600">3 digit terakhir adalah kode unik pembayaran untuk membantu verifikasi. Kode unik tidak menambah saldo.</p>}
          </div>
          {draft.destination?.has_qris && <div className="text-center">{qrisUrl ? <img src={qrisUrl} alt={`QRIS ${draft.destination.provider_name}`} className="max-w-[280px] w-full mx-auto rounded-lg border" /> : qrisError ? <div className="text-sm text-red-700"><p>{qrisError}</p><Button type="button" variant="link" onClick={() => { setQrisError(null); setQrisRetry((value) => value + 1); }}>Coba Lagi</Button></div> : <p className="text-sm text-slate-500">Memuat QRIS…</p>}</div>}
          <div>
            <label htmlFor="payment-proof" className="block text-sm font-semibold mb-1.5">Upload Bukti Pembayaran <span aria-hidden="true">*</span></label>
            <input ref={proofInputRef} id="payment-proof" type="file" className="sr-only" required accept="image/jpeg,image/png,image/webp,application/pdf" disabled={Boolean(mutation)} onChange={(event) => selectProof(event.target.files?.[0])} aria-invalid={Boolean(flowError)} aria-describedby="payment-proof-help payment-flow-error" />
            <div className={`rounded-xl border-2 border-dashed p-4 ${proof ? "border-green-300 bg-green-50/60" : "border-slate-300 bg-slate-50"}`}>
              {proof ? <div className="space-y-3">
                <div className="flex items-start gap-2"><CheckCircle2 className="w-5 h-5 text-green-700 shrink-0 mt-0.5" aria-hidden="true" /><div className="min-w-0"><p className="text-sm font-semibold text-green-800">Bukti pembayaran dipilih</p><p className="text-sm text-slate-700 break-all">{proof.name}</p></div></div>
                <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => proofInputRef.current?.click()} disabled={Boolean(mutation)}><Upload className="w-4 h-4 mr-1" aria-hidden="true" />Ganti File</Button><Button type="button" variant="ghost" size="sm" onClick={removeProof} disabled={Boolean(mutation)}><Trash2 className="w-4 h-4 mr-1" aria-hidden="true" />Hapus</Button></div>
              </div> : <div className="flex flex-col items-center text-center gap-2"><Upload className="w-7 h-7 text-slate-500" aria-hidden="true" /><p className="text-sm text-slate-600">Pilih bukti pembayaran dari perangkat Anda.</p><Button type="button" variant="outline" onClick={() => proofInputRef.current?.click()} disabled={Boolean(mutation)}>Pilih File</Button></div>}
            </div>
            <p id="payment-proof-help" className="text-xs text-slate-500 mt-1.5">JPG, PNG, WEBP, atau PDF • Maks. 5 MB</p>
            {mutation === "upload" && <p role="status" aria-live="polite" className="text-sm text-primary mt-2">Mengunggah bukti…</p>}
          </div>
          {flowError && <p id="payment-flow-error" role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{flowError}</p>}
          <p className="text-xs text-slate-500">Saldo tidak bertambah saat bukti dikirim. Superadmin akan memverifikasi pembayaran terlebih dahulu.</p>
        </div>}
      </AppModal>

      <AppModal open={Boolean(proofViewer)} title="Bukti Pembayaran" onClose={() => setProofViewer(null)} maxWidthClassName="max-w-3xl" footer={<div className="flex justify-end"><Button type="button" onClick={() => setProofViewer(null)}>Tutup</Button></div>}>
        {proofViewer && (proofViewer.mime === "application/pdf" ? <iframe src={proofViewer.url} title="Bukti pembayaran PDF" className="w-full h-[65vh] rounded border" /> : <img src={proofViewer.url} alt="Bukti pembayaran" className="max-w-full max-h-[65vh] mx-auto object-contain rounded" />)}
      </AppModal>

      <AppModal open={Boolean(notice)} title={notice?.title} onClose={() => setNotice(null)} footer={<div className="flex justify-end"><Button type="button" onClick={() => setNotice(null)}>Tutup</Button></div>}><p className="text-sm text-slate-700">{notice?.message}</p></AppModal>
    </div>
  );
}
