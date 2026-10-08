import { useState, useEffect, useMemo } from "react";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Building,
  Coins,
  Plus,
  Phone,
  Users,
  Edit,
  Search,
  Calendar,
  Check,
  X,
  ArrowUpRight,
  ArrowDownRight,
  User,
  Settings,
  Mail,
  Loader2,
  Eye,
  Upload,
  Scale,
} from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { AppModal } from "./AppModal";
import { ADVERTISED_PLAN_TOKEN_PRICE_IDR } from "../lib/pricingCatalog";
import { useVisibilityRefresh } from "../hooks/use-visibility-refresh";

interface WAConfig {
  id: string;
  label: string;
  phone: string;
  isActive: boolean;
  phoneNumberId?: string;
  wabaId?: string;
}

interface UserConfig {
  id: string;
  email: string;
  username: string;
  fullName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface OrgItem {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  supportEmail: string;
  sendDelayMs: number;
  throttlePerMin: number;
  createdAt: string;
  tokensBalance: number;
  tokenPrice: number;
  numbers: WAConfig[];
  users: UserConfig[];
}

interface SignupItem {
  id: string;
  email: string;
  username: string;
  fullName: string;
  createdAt: string;
  isActive: boolean;
  isEmailConfirmed: boolean;
  waNumber?: string | null;
  org: {
    id: string;
    name: string;
    slug: string;
    plan: string;
  } | null;
}

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

export function SuperadminDashboardView() {
  const [activeTab, setActiveTab] = useState<"orgs" | "signups" | "payments" | "settings">(
    () => (sessionStorage.getItem("superadminActiveTab") as any) || "orgs"
  );

  useEffect(() => {
    sessionStorage.setItem("superadminActiveTab", activeTab);
  }, [activeTab]);
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [signups, setSignups] = useState<SignupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [planFilter, setPlanFilter] = useState("all");

  // Manual payment state variables
  const [paymentRequests, setPaymentRequests] = useState<any[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("submitted");
  const [paymentDetail, setPaymentDetail] = useState<any | null>(null);
  const [bankTransferText, setBankTransferText] = useState("");
  const [gopayText, setGopayText] = useState("");
  const [qrisBase64, setQrisBase64] = useState<string | null>(null);
  const [qrisFileName, setQrisFileName] = useState("");
  const [submittingSettings, setSubmittingSettings] = useState(false);

  // Structured Payment Settings State
  const [bankEnabled, setBankEnabled] = useState(false);
  const [bankName, setBankName] = useState("BCA");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");

  const [ewalletEnabled, setEwalletEnabled] = useState(false);
  const [ewalletProvider, setEwalletProvider] = useState("GoPay");
  const [ewalletPhoneNumber, setEwalletPhoneNumber] = useState("");
  const [ewalletAccountName, setEwalletAccountName] = useState("");

  const [qrisEnabled, setQrisEnabled] = useState(false);

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [submittingProcess, setSubmittingProcess] = useState(false);
  const [receiptZoom, setReceiptZoom] = useState<{ url: string; mime: string | null; fileName: string | null } | null>(null);
  const [loadingProofId, setLoadingProofId] = useState<string | null>(null);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [requestToApprove, setRequestToApprove] = useState<any | null>(null);

  // Org detail stats states
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedDetailOrg, setSelectedDetailOrg] = useState<OrgItem | null>(null);
  const [orgStats, setOrgStats] = useState<any | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Modals state
  const [selectedOrg, setSelectedOrg] = useState<OrgItem | null>(null);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [numberModalOpen, setNumberModalOpen] = useState(false);

  // Forms state
  const [tokenDelta, setTokenDelta] = useState(100);
  const [tokenNote, setTokenNote] = useState("Manual top-up");
  const [submittingToken, setSubmittingToken] = useState(false);

  // Edit Org form state
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgPlan, setOrgPlan] = useState("core");
  const [orgIsActive, setOrgIsActive] = useState(true);
  const [orgSupportEmail, setOrgSupportEmail] = useState("");
  const [orgSendDelay, setOrgSendDelay] = useState(2000);
  const [orgThrottle, setOrgThrottle] = useState(30);
  const [orgTokenPrice, setOrgTokenPrice] = useState(0);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  // Add Number form state
  const [numLabel, setNumLabel] = useState("");
  const [numPhone, setNumPhone] = useState("");
  const [numBusinessId, setNumBusinessId] = useState("");
  const [numWabaId, setNumWabaId] = useState("");
  const [numPhoneId, setNumPhoneId] = useState("");
  const [numAccessToken, setNumAccessToken] = useState("");
  const [submittingNumber, setSubmittingNumber] = useState(false);
  const [processingSignupId, setProcessingSignupId] = useState<string | null>(null);
  const [signupToVerify, setSignupToVerify] = useState<SignupItem | null>(null);
  const [orgStatusConfirmOpen, setOrgStatusConfirmOpen] = useState(false);

  const handleActivateSignup = async () => {
    if (!signupToVerify || processingSignupId) return;
    setProcessingSignupId(signupToVerify.id);
    try {
      const res = await api.activateSuperadminUser(signupToVerify.id);
      if (res.success) {
        toast.success("Akun & instansi sekolah berhasil diverifikasi.");
        setSignupToVerify(null);
        void refreshSuperadminData();
      } else {
        const errorMsg = "error" in res ? res.error : "Gagal melakukan verifikasi";
        toast.error(errorMsg);
      }
    } catch (err) {
      console.error(err);
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setProcessingSignupId(null);
    }
  };

  const handleResendSignupVerification = async (userId: string) => {
    setProcessingSignupId(userId);
    try {
      const res = await api.resendSuperadminUserVerification(userId);
      if (res.success) {
        const msg = "data" in res && res.data?.message ? res.data.message : "Email verifikasi telah dikirim ulang.";
        toast.success(msg);
      } else {
        const errorMsg = "error" in res ? res.error : "Gagal mengirim ulang verifikasi";
        toast.error(errorMsg);
      }
    } catch (err) {
      console.error(err);
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setProcessingSignupId(null);
    }
  };

  useEffect(() => {
    loadOrgs(true);
    loadSignups();
    loadSuperadminRequests(true);
    loadSuperadminSettings();
  }, []);

  const refreshSuperadminData = useVisibilityRefresh(
    async () => {
      await Promise.all([
        loadOrgs(false),
        loadSignups(),
        loadSuperadminRequests(false),
      ]);
    },
    { intervalMs: 30_000 },
  );

  const loadSuperadminRequests = async (showLoading = true) => {
    if (showLoading) setLoadingRequests(true);
    try {
      const res = await api.getSuperadminManualRequests(paymentStatusFilter);
      if (res.success) {
        setPaymentRequests(res.data);
      } else {
        toast.error("Gagal mengambil data pengajuan top-up.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Terjadi kesalahan koneksi saat mengambil pengajuan top-up.");
    } finally {
      if (showLoading) setLoadingRequests(false);
    }
  };

  useEffect(() => {
    if (activeTab === "payments") void loadSuperadminRequests(true);
  }, [activeTab, paymentStatusFilter]);

  const loadSuperadminSettings = async () => {
    try {
      const res = await api.getSuperadminPaymentSettings();
      if (res.success && res.data) {
        const d = res.data;
        setBankTransferText(d.bank_transfer || "");
        setGopayText(d.gopay || "");
        setQrisBase64(d.qris_url || null);
        setQrisFileName(d.qris_url ? "QRIS_Barcode.png" : "");

        setBankEnabled(!!d.bank?.enabled);
        setBankName(d.bank?.bank_name || "BCA");
        setBankAccountNumber(d.bank?.account_number || "");
        setBankAccountName(d.bank?.account_name || "");

        setEwalletEnabled(!!d.ewallet?.enabled);
        setEwalletProvider(d.ewallet?.provider || "GoPay");
        setEwalletPhoneNumber(d.ewallet?.phone_number || "");
        setEwalletAccountName(d.ewallet?.account_name || "");

        setQrisEnabled(!!d.qris?.enabled);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveSettings = async () => {
    setSubmittingSettings(true);
    try {
      const legacyBankText = bankEnabled
        ? `Bank ${bankName}\nNo Rek: ${bankAccountNumber}\na/n ${bankAccountName}`
        : "";
      const legacyGopayText = ewalletEnabled
        ? `${ewalletProvider} - ${ewalletPhoneNumber} (a/n ${ewalletAccountName})`
        : "";

      const res = await api.updateSuperadminPaymentSettings({
        bank: {
          enabled: bankEnabled,
          bank_name: bankName,
          account_number: bankAccountNumber,
          account_name: bankAccountName,
        },
        ewallet: {
          enabled: ewalletEnabled,
          provider: ewalletProvider,
          phone_number: ewalletPhoneNumber,
          account_name: ewalletAccountName,
        },
        qris: {
          enabled: qrisEnabled,
          qris_url: qrisEnabled ? qrisBase64 : null,
        },
        bank_transfer: legacyBankText,
        gopay: legacyGopayText,
        qris_url: qrisEnabled ? qrisBase64 : null,
      });

      if (res.success) {
        toast.success("Pengaturan pembayaran manual berhasil disimpan.");
        setBankTransferText(legacyBankText);
        setGopayText(legacyGopayText);
      } else {
        const errorMsg = "error" in res ? res.error : "Gagal menyimpan";
        toast.error("Gagal menyimpan pengaturan: " + errorMsg);
      }
    } catch (err) {
      console.error(err);
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setSubmittingSettings(false);
    }
  };

  const handleQrisUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Ukuran barcode QRIS maksimal 2MB");
      return;
    }

    setQrisFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => {
      setQrisBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleApproveRequest = (req: any) => {
    setRequestToApprove(req);
    setApproveModalOpen(true);
  };

  const handleConfirmApprove = async () => {
    if (!requestToApprove) return;
    setSubmittingProcess(true);
    try {
      const res = await api.approveManualRequest(requestToApprove.id);
      if (res.success) {
        toast.success(`Pembayaran disetujui. Saldo token ${requestToApprove.org_name} bertambah.`);
        setApproveModalOpen(false);
        setRequestToApprove(null);
        void refreshSuperadminData();
      } else {
        const errorMsg = "error" in res ? res.error : "Gagal memproses";
        toast.error("Gagal menyetujui: " + errorMsg);
      }
    } catch (err) {
      console.error(err);
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setSubmittingProcess(false);
    }
  };

  const handleRejectRequest = (req: any) => {
    setSelectedRequest(req);
    setRejectNotes("");
    setRejectModalOpen(true);
  };

  const handleViewPaymentProof = async (req: any) => {
    if (!req?.proof_available || loadingProofId) return;
    setLoadingProofId(req.id);
    const result = await api.getManualPaymentProofObjectUrl(req.id);
    if (result.success) {
      setReceiptZoom((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return { url: result.data, mime: req.proof_mime_type ?? null, fileName: req.proof_file_name ?? null };
      });
    } else {
      toast.error(result.error);
    }
    setLoadingProofId(null);
  };

  const handleConfirmReject = async () => {
    if (!selectedRequest) return;
    setSubmittingProcess(true);
    try {
      const res = await api.rejectManualRequest(selectedRequest.id, rejectNotes);
      if (res.success) {
        toast.success(`Pembayaran untuk ${selectedRequest.org_name} ditolak.`);
        setRejectModalOpen(false);
        setSelectedRequest(null);
        void refreshSuperadminData();
      } else {
        const errorMsg = "error" in res ? res.error : "Gagal memproses";
        toast.error("Gagal menolak: " + errorMsg);
      }
    } catch (err) {
      console.error(err);
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setSubmittingProcess(false);
    }
  };

  const handleOpenDetailModal = async (org: OrgItem) => {
    setSelectedDetailOrg(org);
    setOrgStats(null);
    setDetailModalOpen(true);
    setLoadingStats(true);
    try {
      const res = await api.getSuperadminOrgStats(org.id);
      if (res.success) {
        setOrgStats(res.data);
      } else {
        toast.error("Gagal mengambil statistik instansi.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setLoadingStats(false);
    }
  };

  const handleUpdateDetailTokens = async () => {
    if (!selectedDetailOrg) return;
    if (tokenDelta === 0) {
      toast.error("Nominal penyesuaian token tidak boleh 0");
      return;
    }

    setSubmittingToken(true);
    try {
      const res = await api.updateSuperadminOrgTokens(selectedDetailOrg.id, tokenDelta, tokenNote);
      if (res.success) {
        toast.success(`Berhasil menyesuaikan token sebesar ${tokenDelta > 0 ? "+" : ""}${tokenDelta} untuk ${selectedDetailOrg.name}`);

        const updatedOrg = {
          ...selectedDetailOrg,
          tokensBalance: res.data.tokensBalance ?? (selectedDetailOrg.tokensBalance + tokenDelta),
        };
        setSelectedDetailOrg(updatedOrg);

        void refreshSuperadminData();

        const statsRes = await api.getSuperadminOrgStats(selectedDetailOrg.id);
        if (statsRes.success) {
          setOrgStats(statsRes.data);
        }

        setTokenDelta(100);
        setTokenNote("Top-up token manual");
      } else {
        const errorMsg = "error" in res ? res.error : "Terjadi kesalahan";
        toast.error("Gagal update token: " + errorMsg);
      }
    } catch (err) {
      console.error(err);
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setSubmittingToken(false);
    }
  };

  const loadOrgs = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await api.getSuperadminOrgs();
      if (res.success) {
        setOrgs(res.data);
      } else {
        const errorMsg = "error" in res ? res.error : "Terjadi kesalahan";
        toast.error("Gagal mengambil data instansi: " + errorMsg);
      }
    } catch (err) {
      console.error(err);
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const loadSignups = async () => {
    try {
      const res = await api.getSuperadminSignups();
      if (res.success) {
        setSignups(res.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Stats calculation
  const stats = useMemo(() => {
    const totalSchools = orgs.length;
    const activeSchools = orgs.filter((o) => o.isActive).length;
    const totalTokens = orgs.reduce((sum, o) => sum + o.tokensBalance, 0);
    const totalWA = orgs.reduce((sum, o) => sum + o.numbers.length, 0);
    const activeWA = orgs.reduce((sum, o) => sum + o.numbers.filter((n) => n.isActive).length, 0);

    return {
      totalSchools,
      activeSchools,
      totalTokens,
      totalWA,
      activeWA,
    };
  }, [orgs]);

  const filteredPaymentRequests = useMemo(
    () => paymentStatusFilter === "all"
      ? paymentRequests
      : paymentRequests.filter((request) => request.status === paymentStatusFilter),
    [paymentRequests, paymentStatusFilter],
  );

  // Filtering orgs
  const filteredOrgs = useMemo(() => {
    return orgs.filter((o) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        o.name.toLowerCase().includes(q) ||
        o.slug.toLowerCase().includes(q) ||
        o.supportEmail.toLowerCase().includes(q);

      const matchesPlan = planFilter === "all" || o.plan === planFilter;

      return matchesSearch && matchesPlan;
    });
  }, [orgs, searchQuery, planFilter]);

  const handleOpenTokenModal = (org: OrgItem) => {
    setSelectedOrg(org);
    setTokenDelta(100);
    setTokenNote("Top-up token manual");
    setTokenModalOpen(true);
  };

  const handleUpdateTokens = async () => {
    if (!selectedOrg) return;
    if (tokenDelta === 0) {
      toast.error("Nominal penyesuaian token tidak boleh 0");
      return;
    }

    setSubmittingToken(true);
    try {
      const res = await api.updateSuperadminOrgTokens(selectedOrg.id, tokenDelta, tokenNote);
      if (res.success) {
        toast.success(`Berhasil menyesuaikan token sebesar ${tokenDelta > 0 ? "+" : ""}${tokenDelta} untuk ${selectedOrg.name}`);
        setTokenModalOpen(false);
        void refreshSuperadminData();
      } else {
        const errorMsg = "error" in res ? res.error : "Terjadi kesalahan";
        toast.error("Gagal update token: " + errorMsg);
      }
    } catch (err) {
      console.error(err);
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setSubmittingToken(false);
    }
  };

  const handleOpenEditModal = (org: OrgItem) => {
    setSelectedOrg(org);
    setOrgName(org.name);
    setOrgSlug(org.slug);
    setOrgPlan(org.plan);
    setOrgIsActive(org.isActive);
    setOrgSupportEmail(org.supportEmail);
    setOrgSendDelay(org.sendDelayMs);
    setOrgThrottle(org.throttlePerMin);
    setOrgTokenPrice(Number(org.tokenPrice ?? 0));
    setOrgStatusConfirmOpen(false);
    setEditModalOpen(true);
  };

  const performUpdateOrgDetails = async () => {
    if (!selectedOrg) return;
    if (submittingEdit) return;
    if (!orgName.trim() || !orgSlug.trim()) {
      toast.error("Nama instansi dan Slug wajib diisi");
      return;
    }
    if (!Number.isFinite(orgTokenPrice) || orgTokenPrice <= 0) {
      toast.error("Harga token wajib lebih besar dari nol");
      return;
    }

    setSubmittingEdit(true);
    try {
      const res = await api.updateSuperadminOrgDetails(selectedOrg.id, {
        name: orgName,
        slug: orgSlug,
        plan: orgPlan,
        isActive: orgIsActive,
        supportEmail: orgSupportEmail,
        sendDelayMs: orgSendDelay,
        throttlePerMin: orgThrottle,
        tokenPrice: orgTokenPrice,
      });

      if (res.success) {
        toast.success(`Profil ${orgName} berhasil diperbarui.`);
        setOrgStatusConfirmOpen(false);
        setEditModalOpen(false);
        void refreshSuperadminData();
      } else {
        const errorMsg = "error" in res ? res.error : "Terjadi kesalahan";
        toast.error("Gagal update instansi: " + errorMsg);
      }
    } catch (err) {
      console.error(err);
      toast.error("Terjadi kesalahan jaringan.");
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleUpdateOrgDetails = () => {
    if (!selectedOrg || submittingEdit) return;
    if (!orgName.trim() || !orgSlug.trim()) {
      toast.error("Nama instansi dan Slug wajib diisi");
      return;
    }
    if (!Number.isFinite(orgTokenPrice) || orgTokenPrice <= 0) {
      toast.error("Harga token wajib lebih besar dari nol");
      return;
    }
    if (orgIsActive !== selectedOrg.isActive) {
      setOrgStatusConfirmOpen(true);
      return;
    }
    void performUpdateOrgDetails();
  };

  const handleOpenNumberModal = (org: OrgItem) => {
    setSelectedOrg(org);
    setNumLabel("WhatsApp " + org.name);
    setNumPhone("");
    setNumBusinessId("");
    setNumWabaId("");
    setNumPhoneId("");
    setNumAccessToken("");
    setNumberModalOpen(true);
  };

  const handleAddNumber = async () => {
    if (!selectedOrg) return;
    if (!numPhone.trim() || !numPhoneId.trim() || !numAccessToken.trim()) {
      toast.error("Nomor, Phone Number ID, dan Access Token wajib diisi");
      return;
    }

    setSubmittingNumber(true);
    try {
      const res = await api.addSuperadminOrgNumber(selectedOrg.id, {
        name: numLabel,
        number: numPhone,
        businessId: numBusinessId,
        wabaId: numWabaId,
        phoneNumberId: numPhoneId,
        accessToken: numAccessToken,
      });

      if (res.success) {
        toast.success(`Nomor WA berhasil dihubungkan ke instansi ${selectedOrg.name}`);
        setNumberModalOpen(false);
        void refreshSuperadminData();
      } else {
        const errorMsg = "error" in res ? res.error : "Terjadi kesalahan";
        toast.error("Gagal menghubungkan nomor WA: " + errorMsg);
      }
    } catch (err) {
      console.error(err);
      toast.error("Gagal menghubungkan nomor: Nomor tidak merespon Meta API.");
    } finally {
      setSubmittingNumber(false);
    }
  };

  const formatDate = (isoStr?: string) => {
    if (!isoStr) return "-";
    return new Date(isoStr).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8 overflow-x-hidden">
      {/* Title */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Manajemen User</h1>
        <p className="text-muted-foreground mt-1">Kelola akun-akun sekolah, balance token, konfigurasi nomor Meta, dan pendaftaran baru.</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="p-5 flex items-center gap-4 border border-slate-100 hover:shadow-md transition-shadow">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <Building className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Instansi</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">{stats.totalSchools}</h3>
            <p className="text-[10px] text-green-600 font-semibold mt-0.5">{stats.activeSchools} Akun Aktif</p>
          </div>
        </Card>

        <Card className="p-5 flex items-center gap-4 border border-slate-100 hover:shadow-md transition-shadow">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <Coins className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Saldo Token</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">{stats.totalTokens.toLocaleString("id-ID")}</h3>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">Saldo gabungan sekolah</p>
          </div>
        </Card>

        <Card className="p-5 flex items-center gap-4 border border-slate-100 hover:shadow-md transition-shadow">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <Phone className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nomor WA Meta</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">{stats.totalWA}</h3>
            <p className="text-[10px] text-green-600 font-semibold mt-0.5">{stats.activeWA} Nomor Aktif</p>
          </div>
        </Card>

        <Card className="p-5 flex items-center gap-4 border border-slate-100 hover:shadow-md transition-shadow">
          <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Pendaftar</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">{signups.length}</h3>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">Owner terdaftar di sistem</p>
          </div>
        </Card>
      </div>

      {/* Tabs Selector */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab("orgs")}
          className={`px-5 py-3 text-sm font-semibold border-b-2 transition-all ${activeTab === "orgs"
            ? "border-primary text-primary"
            : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
        >
          Instansi ({orgs.length})
        </button>
        <button
          onClick={() => setActiveTab("signups")}
          className={`px-5 py-3 text-sm font-semibold border-b-2 transition-all ${activeTab === "signups"
            ? "border-primary text-primary"
            : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
        >
          Pendaftaran Baru ({signups.length})
        </button>
        <button
          onClick={() => setActiveTab("payments")}
          className={`px-5 py-3 text-sm font-semibold border-b-2 transition-all ${activeTab === "payments"
            ? "border-primary text-primary"
            : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
        >
          Verifikasi Pembayaran
        </button>
      </div>

      {/* Tab Contents: Orgs List */}
      {activeTab === "orgs" && (
        <Card className="p-6 space-y-6">
          {/* Controls Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Cari instansi, email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 rounded-lg text-sm bg-slate-50/50 border-slate-200 focus:bg-white"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Plan:</span>
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className="p-2 border rounded-lg text-xs bg-white font-medium text-slate-700 focus:outline-none"
              >
                <option value="all">Semua Plan</option>
                <option value="core">Core</option>
                <option value="full">Full</option>
              </select>
              <Button onClick={() => loadOrgs(true)} variant="outline" className="h-9 px-4 text-xs font-semibold flex items-center gap-1">
                Refresh Data
              </Button>
            </div>
          </div>

          {/* Table Container */}
          {loading && orgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
              <Loader2 className="w-8 h-8 animate-spin" />
              <span className="text-sm font-medium">Memuat data instansi...</span>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="min-w-full divide-y divide-slate-100 text-sm whitespace-nowrap">
                <thead className="bg-slate-50/70">
                  <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="px-5 py-3 text-left">Instansi</th>
                    <th className="px-5 py-3 text-left">Plan / Status</th>
                    <th className="px-5 py-3 text-center">Token</th>
                    <th className="px-5 py-3 text-left">Nomor WhatsApp</th>
                    <th className="px-5 py-3 text-left">Pengelola (Owner)</th>
                    <th className="px-5 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredOrgs.map((org) => {
                    const owner = org.users.find((u) => u.role === "owner") || org.users[0];

                    return (
                      <tr key={org.id} className="hover:bg-slate-50/50 transition-colors">
                        {/* Name / Slug */}
                        <td className="px-5 py-4">
                          <button
                            onClick={() => handleOpenDetailModal(org)}
                            className="font-semibold text-slate-800 hover:text-primary hover:underline text-left cursor-pointer transition-colors font-medium bg-transparent border-0 p-0"
                          >
                            {org.name}
                          </button>
                        </td>
                        {/* Plan & Status */}
                        <td className="px-5 py-4">
                          <div className="flex flex-col gap-1.5">
                            <span className={`inline-flex items-center w-fit px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${org.plan === "full"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-blue-100 text-blue-700"
                              }`}>
                              {org.plan}
                            </span>
                            <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${org.isActive ? "text-green-600" : "text-red-500"
                              }`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${org.isActive ? "bg-green-500 animate-pulse" : "bg-red-500"
                                }`} />
                              {org.isActive ? "Aktif" : "Non-aktif"}
                            </span>
                          </div>
                        </td>
                        {/* Tokens */}
                        <td className="px-5 py-4 text-center">
                          <div className="text-base font-bold text-slate-700">{org.tokensBalance.toLocaleString("id-ID")}</div>
                          <div className="text-[10px] text-amber-600 font-semibold mt-0.5">
                            {Number(org.tokenPrice) > 0
                              ? `Rp ${Number(org.tokenPrice).toLocaleString("id-ID")}/token`
                              : "Harga belum dikonfigurasi"}
                          </div>
                        </td>
                        {/* WhatsApp configs */}
                        <td className="px-5 py-4">
                          <div className="space-y-1">
                            {org.numbers.length === 0 ? (
                              <span className="text-xs italic text-slate-400">Belum ada nomor</span>
                            ) : (
                              org.numbers.map((num) => (
                                <div key={num.id} className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                                  <span className={`w-1.5 h-1.5 rounded-full ${num.isActive ? "bg-green-500" : "bg-slate-300"} flex-shrink-0`} />
                                  <span>{num.phone} - {num.label}</span>
                                </div>
                              ))
                            )}
                          </div>
                        </td>
                        {/* Owner details */}
                        <td className="px-5 py-4">
                          {owner ? (
                            <div>
                              <button
                                onClick={() => handleOpenDetailModal(org)}
                                className="font-medium text-slate-800 hover:text-primary hover:underline text-left cursor-pointer transition-colors flex items-center gap-1 bg-transparent border-0 p-0"
                              >
                                <User className="w-3.5 h-3.5 text-slate-400" />
                                <span>{owner.fullName}</span>
                              </button>
                              <div className="text-xs text-slate-400 mt-0.5">{owner.email}</div>
                            </div>
                          ) : (
                            <span className="text-xs italic text-slate-400">Tidak ada user</span>
                          )}
                        </td>
                        {/* Actions */}
                        <td className="px-5 py-4 text-right">
                          <div className="flex justify-end gap-1.5">
                            {/* Manage tokens */}
                            <button
                              onClick={() => handleOpenTokenModal(org)}
                              className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                              title="Update Token"
                            >
                              <Coins className="w-4 h-4" />
                            </button>
                            {/* Connect new WA number */}
                            <button
                              onClick={() => handleOpenNumberModal(org)}
                              className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                              title="Hubungkan Nomor WA"
                            >
                              <Phone className="w-4 h-4" />
                            </button>
                            {/* Edit org details */}
                            <button
                              onClick={() => handleOpenEditModal(org)}
                              className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="Edit Detail Sekolah"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredOrgs.length === 0 && !loading && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                        Tidak ada instansi sekolah yang cocok dengan pencarian Anda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Tab Contents: Signups */}
      {activeTab === "signups" && (
        <Card className="p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <h3 className="text-lg font-bold text-slate-800">Daftar Registrasi Form Baru</h3>
            <Button onClick={loadSignups} variant="outline" className="h-8 text-xs">
              Refresh Pendaftar
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="min-w-full divide-y divide-slate-100 text-sm whitespace-nowrap">
              <thead className="bg-slate-50/70">
                <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left">Tanggal Daftar</th>
                  <th className="px-5 py-3 text-left">Nama Lengkap</th>
                  <th className="px-5 py-3 text-left">Username</th>
                  <th className="px-5 py-3 text-left">Email</th>
                  <th className="px-5 py-3 text-left">No. WhatsApp</th>
                  <th className="px-5 py-3 text-left">Instansi</th>
                  <th className="px-5 py-3 text-left">Status Email</th>
                  <th className="px-5 py-3 text-left">Status Akun</th>
                  <th className="px-5 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {signups.map((signup) => (
                  <tr key={signup.id} className="hover:bg-slate-50/50 transition-colors">
                    {/* Registered date */}
                    <td className="px-5 py-4 font-medium text-slate-600">
                      {formatDate(signup.createdAt)}
                    </td>
                    {/* Full Name */}
                    <td className="px-5 py-4 font-semibold text-slate-800">
                      {signup.fullName}
                    </td>
                    {/* Username */}
                    <td className="px-5 py-4 font-mono text-xs text-slate-500">
                      @{signup.username}
                    </td>
                    {/* Email */}
                    <td className="px-5 py-4 text-slate-600">
                      {signup.email}
                    </td>
                    {/* WhatsApp */}
                    <td className="px-5 py-4 font-mono text-xs text-slate-600">
                      {signup.waNumber || "-"}
                    </td>
                    {/* Instansi info */}
                    <td className="px-5 py-4">
                      {signup.org ? (
                        <div>
                          <div className="font-semibold text-slate-800">{signup.org.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">Plan: {signup.org.plan.toUpperCase()}</div>
                        </div>
                      ) : (
                        <span className="text-xs italic text-slate-400">Tidak ada data instansi</span>
                      )}
                    </td>
                    {/* Status Email */}
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${signup.isEmailConfirmed
                        ? "bg-green-100 text-green-700"
                        : "bg-amber-100 text-amber-700"
                        }`}>
                        {signup.isEmailConfirmed ? "Terverifikasi" : "Belum Verifikasi"}
                      </span>
                    </td>
                    {/* Status Akun */}
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${signup.isActive
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                        }`}>
                        {signup.isActive ? "Aktif" : "Belum Aktif"}
                      </span>
                    </td>
                    {/* Actions */}
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {/* Verify / Activate user */}
                        {(!signup.isActive || !signup.isEmailConfirmed) && (
                          <Button
                            size="sm"
                            onClick={() => setSignupToVerify(signup)}
                            disabled={processingSignupId !== null}
                            className="h-8 text-xs font-semibold px-3 bg-emerald-600 hover:bg-emerald-700"
                          >
                            Verifikasi
                          </Button>
                        )}
                        {/* Resend verification email */}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleResendSignupVerification(signup.id)}
                          disabled={processingSignupId !== null}
                          className="h-8 text-xs font-semibold px-3"
                        >
                          Kirim Ulang
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {signups.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-slate-400">
                      Belum ada pendaftaran akun sekolah baru.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Tab Contents: Unified Purchases History */}
      {activeTab === "payments" && (
        <Card className="p-6 space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-bold text-slate-800">Verifikasi Pembayaran Manual</h3>
              <p className="text-xs text-slate-500">Review bukti sebelum menambahkan saldo melalui Billing Core.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="payment-status-filter" className="text-xs font-semibold text-slate-600">Status</label>
              <select id="payment-status-filter" value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs">
                <option value="submitted">Menunggu Verifikasi</option>
                <option value="approved">Disetujui</option>
                <option value="rejected">Ditolak</option>
                <option value="draft">Menunggu Bukti</option>
                <option value="all">Semua Status</option>
              </select>
              <Button onClick={() => loadSuperadminRequests(true)} variant="outline" className="h-9 text-xs">Perbarui</Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="min-w-full divide-y divide-slate-100 text-sm whitespace-nowrap">
              <thead className="bg-slate-50/70">
                <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left">Tanggal</th>
                  <th className="px-5 py-3 text-left">Instansi</th>
                  <th className="px-5 py-3 text-left">Referensi</th>
                  <th className="px-5 py-3 text-left">Jumlah Token</th>
                  <th className="px-5 py-3 text-left">Total Transfer</th>
                  <th className="px-5 py-3 text-left">Metode</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredPaymentRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-4 font-medium text-slate-600">
                      {formatDate(req.created_at)}
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-800">
                      {req.org_name}
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-600">
                      {req.payment_reference || req.id}
                    </td>
                    <td className="px-5 py-4 font-bold text-slate-700">
                      {Number(req.amount_tokens ?? 0).toLocaleString()} token
                    </td>
                    <td className="px-5 py-4 font-mono font-bold text-primary">
                      Rp {Number(req.transfer_amount ?? req.amount_idr ?? 0).toLocaleString("id-ID")}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${req.legacy_gateway
                        ? "bg-purple-100 text-purple-700"
                        : "bg-slate-100 text-slate-700"
                        }`}>
                        {req.payment_method === "bank_transfer" ? "Transfer Bank" : req.payment_method === "qris_static" ? "QRIS Statis" : req.payment_method || "Manual"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <Badge
                        className={
                          req.status === "approved"
                            ? "bg-emerald-500 text-white"
                            : req.status === "rejected"
                              ? "bg-rose-500 text-white"
                              : "bg-amber-500 text-black"
                        }
                      >
                        {req.status_label || (req.status === "approved" ? "Disetujui" : req.status === "rejected" ? "Ditolak" : "Menunggu Verifikasi")}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end items-center gap-1">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setPaymentDetail(req)}>Detail</Button>
                        {req.proof_available && (
                          <Button type="button" size="sm" variant="outline" onClick={() => void handleViewPaymentProof(req)} disabled={loadingProofId === req.id || submittingProcess}>
                            <Eye className="w-4 h-4 mr-1" aria-hidden="true" />{loadingProofId === req.id ? "Memuat…" : "Bukti"}
                          </Button>
                        )}
                        {req.status === "submitted" && !req.legacy_gateway && (
                          <>
                            <Button type="button" size="sm" variant="outline" onClick={() => handleRejectRequest(req)} disabled={submittingProcess}>Tolak</Button>
                            <Button type="button" size="sm" onClick={() => handleApproveRequest(req)} disabled={submittingProcess}>Setujui</Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredPaymentRequests.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-slate-400">
                      {loadingRequests ? "Memuat antrean verifikasi…" : paymentRequests.length === 0 ? "Belum ada permintaan pembayaran." : "Tidak ada pembayaran dengan status ini."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}



      {/* Modal 1: Update Token Balance */}
      <AppModal
        open={!!signupToVerify}
        title="Verifikasi Organisasi"
        closeDisabled={processingSignupId !== null}
        onClose={() => {
          if (!processingSignupId) setSignupToVerify(null);
        }}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={processingSignupId !== null} onClick={() => setSignupToVerify(null)}>
              Batal
            </Button>
            <Button disabled={processingSignupId !== null} onClick={handleActivateSignup}>
              {processingSignupId ? "Memverifikasi..." : "Ya, Verifikasi"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 break-words">
          Verifikasi organisasi <strong className="text-slate-800">{signupToVerify?.org?.name || signupToVerify?.fullName}</strong>?
          Akun pendaftar akan dikonfirmasi dan diaktifkan sesuai proses verifikasi yang berlaku.
        </p>
      </AppModal>

      <AppModal
        open={tokenModalOpen && !!selectedOrg}
        title="Sesuaikan Saldo Token"
        onClose={() => setTokenModalOpen(false)}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setTokenModalOpen(false)} disabled={submittingToken}>
              Batal
            </Button>
            <Button onClick={handleUpdateTokens} disabled={submittingToken}>
              {submittingToken ? "Memproses..." : "Simpan Saldo"}
            </Button>
          </div>
        }
      >
        {selectedOrg && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Nama Instansi:</span>
                <span className="font-bold text-slate-800">{selectedOrg.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Saldo Saat Ini:</span>
                <span className="font-bold text-amber-600">{selectedOrg.tokensBalance.toLocaleString()} Token</span>
              </div>
            </div>

            <div>
              <Label htmlFor="token-delta" className="text-slate-700">Jumlah Penyesuaian Token</Label>
              <div className="relative mt-2">
                <Input
                  id="token-delta"
                  type="number"
                  placeholder="Gunakan tanda minus (-) untuk mengurangi token"
                  value={tokenDelta}
                  onChange={(e) => setTokenDelta(parseInt(e.target.value) || 0)}
                  className="h-10 text-sm font-bold text-slate-800"
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Contoh: isi <b>500</b> untuk menambah 500 token, atau <b>-300</b> untuk memotong 300 token.
              </p>
            </div>

            <div>
              <Label htmlFor="token-note" className="text-slate-700">Catatan Penyesuaian</Label>
              <Input
                id="token-note"
                type="text"
                placeholder="Alasan penyesuaian saldo token..."
                value={tokenNote}
                onChange={(e) => setTokenNote(e.target.value)}
                className="mt-2 text-sm"
              />
            </div>
          </div>
        )}
      </AppModal>

      <AppModal
        open={orgStatusConfirmOpen && !!selectedOrg}
        title={orgIsActive ? "Aktifkan Kembali Organisasi" : "Nonaktifkan Akses Organisasi"}
        closeDisabled={submittingEdit}
        onClose={() => {
          if (!submittingEdit) setOrgStatusConfirmOpen(false);
        }}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={submittingEdit} onClick={() => setOrgStatusConfirmOpen(false)}>
              Batal
            </Button>
            <Button
              disabled={submittingEdit}
              onClick={() => void performUpdateOrgDetails()}
              className={orgIsActive ? "" : "bg-red-600 text-white hover:bg-red-700"}
            >
              {submittingEdit
                ? "Memproses..."
                : orgIsActive
                  ? "Ya, Aktifkan Kembali"
                  : "Ya, Nonaktifkan Login & Pengiriman Baru"}
            </Button>
          </div>
        }
      >
        <div className="space-y-2 text-sm text-slate-600 break-words">
          <p>
            {orgIsActive ? "Aktifkan kembali" : "Nonaktifkan login dan pengiriman baru untuk"}{" "}
            <strong className="text-slate-800">{selectedOrg?.name}</strong>?
          </p>
          <p>
            {orgIsActive
              ? "Pengguna organisasi dapat kembali masuk dan menggunakan fitur pengiriman."
              : "Pengguna organisasi tidak dapat masuk atau memulai pengiriman baru sampai akses diaktifkan kembali. Broadcast yang sudah antre atau sedang diproses tidak otomatis dibatalkan."}
          </p>
        </div>
      </AppModal>

      {/* Modal 2: Edit Org Details */}
      <AppModal
        open={editModalOpen && !!selectedOrg}
        title="Edit Profil Instansi Sekolah"
        closeDisabled={submittingEdit}
        onClose={() => {
          if (!submittingEdit) setEditModalOpen(false);
        }}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setEditModalOpen(false)} disabled={submittingEdit}>
              Batal
            </Button>
            <Button onClick={handleUpdateOrgDetails} disabled={submittingEdit}>
              {submittingEdit ? "Menyimpan..." : "Update Profil"}
            </Button>
          </div>
        }
      >
        {selectedOrg && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="org-name" className="text-slate-700">Nama Instansi</Label>
                <Input
                  id="org-name"
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="mt-2 text-sm font-semibold"
                />
              </div>
              <div>
                <Label htmlFor="org-slug" className="text-slate-700">Slug</Label>
                <Input
                  id="org-slug"
                  type="text"
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  className="mt-2 text-sm font-mono text-slate-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="org-plan" className="text-slate-700">Plan Paket</Label>
                <select
                  id="org-plan"
                  value={orgPlan}
                  onChange={(e) => {
                    const nextPlan = e.target.value;
                    setOrgPlan(nextPlan);
                    if (nextPlan === "full") {
                      setOrgTokenPrice(ADVERTISED_PLAN_TOKEN_PRICE_IDR.full);
                    } else if (nextPlan === "core") {
                      setOrgTokenPrice(ADVERTISED_PLAN_TOKEN_PRICE_IDR.core);
                    }
                  }}
                  className="w-full mt-2 p-2.5 border rounded-lg text-sm bg-white font-semibold text-slate-700 focus:outline-none"
                >
                  <option value="core">CORE</option>
                  <option value="full">FULL</option>
                </select>
              </div>
              <div>
                <Label htmlFor="org-support" className="text-slate-700">Email</Label>
                <Input
                  id="org-support"
                  type="email"
                  value={orgSupportEmail}
                  onChange={(e) => setOrgSupportEmail(e.target.value)}
                  className="mt-2 text-sm"
                  placeholder="support@sekolah.sch.id"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="org-delay" className="text-slate-700">Jeda Kirim (ms)</Label>
                <Input
                  id="org-delay"
                  type="number"
                  value={orgSendDelay}
                  onChange={(e) => setOrgSendDelay(parseInt(e.target.value) || 0)}
                  className="mt-2 text-sm font-mono text-slate-600"
                  min="0"
                />
              </div>
              <div>
                <Label htmlFor="org-throttle" className="text-slate-700">Limit per Menit</Label>
                <Input
                  id="org-throttle"
                  type="number"
                  value={orgThrottle}
                  onChange={(e) => setOrgThrottle(parseInt(e.target.value) || 0)}
                  className="mt-2 text-sm font-mono text-slate-600"
                  min="1"
                  max="100"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                id="org-active"
                type="checkbox"
                checked={orgIsActive}
                onChange={(e) => setOrgIsActive(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary"
              />
              <Label htmlFor="org-active" className="text-slate-700 text-sm font-semibold cursor-pointer">
                Izinkan Login & Pengiriman
              </Label>
            </div>

            <div className="pt-1 border-t border-slate-100">
              <Label htmlFor="org-token-price" className="text-slate-700">Harga per Token (Rp)</Label>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm font-semibold text-slate-500">Rp</span>
                <Input
                  id="org-token-price"
                  type="number"
                  value={orgTokenPrice}
                  onChange={(e) => setOrgTokenPrice(parseInt(e.target.value) || 0)}
                  className="text-sm font-mono text-slate-700 font-bold flex-1"
                  min="0"
                  step="100"
                />
                <span className="text-xs text-slate-400 whitespace-nowrap">/ token</span>
              </div>
            </div>
          </div>
        )}
      </AppModal>

      {/* Modal 3: Add WA Number directly to org */}
      <AppModal
        open={numberModalOpen && !!selectedOrg}
        title="Hubungkan Nomor WA Sekolah ke Meta"
        onClose={() => setNumberModalOpen(false)}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setNumberModalOpen(false)} disabled={submittingNumber}>
              Batal
            </Button>
            <Button onClick={handleAddNumber} disabled={submittingNumber}>
              {submittingNumber ? "Menghubungkan..." : "Hubungkan Nomor"}
            </Button>
          </div>
        }
      >
        {selectedOrg && (
          <div className="space-y-4">
            <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs flex gap-2.5 items-start">
              <Phone className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-bold text-slate-800">Menghubungkan Nomor WhatsApp untuk {selectedOrg.name}</p>
                <p className="text-slate-500 mt-0.5">Pastikan nomor & kredensial Meta valid agar otomatis tersinkronisasi.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="num-label" className="text-slate-700">Label Nomor</Label>
                <Input
                  id="num-label"
                  type="text"
                  placeholder="Contoh: Admin Utama, WhatsApp BK"
                  value={numLabel}
                  onChange={(e) => setNumLabel(e.target.value)}
                  className="mt-2 text-sm font-semibold"
                />
              </div>
              <div>
                <Label htmlFor="num-phone" className="text-slate-700">Nomor WABA</Label>
                <Input
                  id="num-phone"
                  type="text"
                  placeholder="Contoh: 6281234567890"
                  value={numPhone}
                  onChange={(e) => setNumPhone(e.target.value)}
                  className="mt-2 text-sm font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1">
                <Label htmlFor="num-biz" className="text-slate-700">Business ID</Label>
                <Input
                  id="num-biz"
                  type="text"
                  placeholder="Opsional"
                  value={numBusinessId}
                  onChange={(e) => setNumBusinessId(e.target.value)}
                  className="mt-2 text-sm font-mono text-slate-600"
                />
              </div>
              <div className="md:col-span-1">
                <Label htmlFor="num-waba" className="text-slate-700">WABA ID</Label>
                <Input
                  id="num-waba"
                  type="text"
                  placeholder="Wajib untuk Sync Template"
                  value={numWabaId}
                  onChange={(e) => setNumWabaId(e.target.value)}
                  className="mt-2 text-sm font-mono text-slate-600"
                />
              </div>
              <div className="md:col-span-1">
                <Label htmlFor="num-phoneid" className="text-slate-700">Phone Number ID</Label>
                <Input
                  id="num-phoneid"
                  type="text"
                  placeholder="Wajib untuk Kirim Pesan"
                  value={numPhoneId}
                  onChange={(e) => setNumPhoneId(e.target.value)}
                  className="mt-2 text-sm font-mono text-slate-600"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="num-token" className="text-slate-700">Permanent System User Access Token</Label>
              <Input
                id="num-token"
                type="password"
                placeholder="EAAGxxxxx..."
                value={numAccessToken}
                onChange={(e) => setNumAccessToken(e.target.value)}
                className="mt-2 text-sm font-mono"
              />
            </div>
          </div>
        )}
      </AppModal>

      <AppModal
        open={Boolean(paymentDetail)}
        title="Detail Pembayaran"
        description={paymentDetail?.payment_reference}
        onClose={() => setPaymentDetail(null)}
        maxWidthClassName="max-w-xl"
        footer={
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPaymentDetail(null)}>Tutup</Button>
            {paymentDetail?.proof_available && <Button type="button" variant="outline" onClick={() => void handleViewPaymentProof(paymentDetail)} disabled={loadingProofId === paymentDetail?.id}>Lihat Bukti</Button>}
            {paymentDetail?.status === "submitted" && !paymentDetail?.legacy_gateway && <>
              <Button type="button" variant="outline" onClick={() => { handleRejectRequest(paymentDetail); setPaymentDetail(null); }}>Tolak</Button>
              <Button type="button" onClick={() => { handleApproveRequest(paymentDetail); setPaymentDetail(null); }}>Setujui</Button>
            </>}
          </div>
        }
      >
        {paymentDetail && <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div><dt className="text-slate-500">Organisasi</dt><dd className="font-semibold break-words">{paymentDetail.org_name}</dd></div>
          <div><dt className="text-slate-500">Pemohon</dt><dd className="font-semibold break-all">{paymentDetail.created_by_email || "-"}</dd></div>
          <div><dt className="text-slate-500">Token</dt><dd className="font-semibold">{Number(paymentDetail.amount_tokens || 0).toLocaleString("id-ID")}</dd></div>
          <div><dt className="text-slate-500">Nominal Top Up</dt><dd className="font-semibold">Rp {Number(paymentDetail.base_amount ?? paymentDetail.amount_idr ?? 0).toLocaleString("id-ID")}</dd></div>
          {paymentDetail.unique_code != null && <div><dt className="text-slate-500">Kode Unik</dt><dd className="font-semibold font-mono">{String(paymentDetail.unique_code).padStart(3, "0")}</dd></div>}
          <div><dt className="text-slate-500">Total Transfer</dt><dd className="font-bold text-primary">Rp {Number(paymentDetail.transfer_amount ?? paymentDetail.amount_idr ?? 0).toLocaleString("id-ID")}</dd></div>
          <div><dt className="text-slate-500">Saldo yang ditambahkan</dt><dd className="font-semibold">{Number(paymentDetail.amount_tokens || 0).toLocaleString("id-ID")} token</dd><dd className="text-xs text-slate-500">Berdasarkan nominal top-up; kode unik tidak dikreditkan.</dd></div>
          <div><dt className="text-slate-500">Metode</dt><dd className="font-semibold">{paymentDetail.destination?.provider_name || paymentDetail.payment_method}</dd></div>
          <div><dt className="text-slate-500">Dikirim</dt><dd className="font-semibold">{formatDate(paymentDetail.submitted_at)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-slate-500">Status</dt><dd className="font-semibold">{paymentDetail.status_label}</dd></div>
          {paymentDetail.proof_file_name && <div className="sm:col-span-2"><dt className="text-slate-500">File bukti</dt><dd className="font-semibold break-all">{paymentDetail.proof_file_name} <span className="font-normal text-slate-500">({paymentDetail.proof_mime_type || "tipe tidak tersedia"})</span></dd></div>}
          {paymentDetail.rejection_reason && <div className="sm:col-span-2"><dt className="text-slate-500">Alasan penolakan</dt><dd className="text-red-700 break-words">{paymentDetail.rejection_reason}</dd></div>}
          {paymentDetail.billing_ledger_id && <div className="sm:col-span-2"><dt className="text-slate-500">Referensi ledger</dt><dd className="font-mono text-xs break-all">{paymentDetail.billing_ledger_id}</dd></div>}
        </dl>}
      </AppModal>

      {/* Rejection Notes Modal */}
      <AppModal
        open={rejectModalOpen}
        title="Tolak Pembayaran Top-up"
        closeDisabled={submittingProcess}
        onClose={() => {
          if (!submittingProcess) setRejectModalOpen(false);
        }}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setRejectModalOpen(false)} disabled={submittingProcess}>
              Batal
            </Button>
            <Button
              onClick={handleConfirmReject}
              disabled={submittingProcess || rejectNotes.trim().length < 3}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
            >
              {submittingProcess ? "Menolak..." : "Ya, Tolak Pembayaran"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Tolak pembayaran <strong>{selectedRequest?.payment_reference}</strong> untuk <span className="font-semibold">{selectedRequest?.org_name}</span> dengan total transfer <strong>Rp {Number(selectedRequest?.transfer_amount ?? selectedRequest?.amount_idr ?? 0).toLocaleString("id-ID")}</strong>? Pengguna akan melihat alasan ini di halaman billing mereka.
          </p>
          <div>
            <Label htmlFor="reject-notes" className="text-slate-700">Catatan Penolakan</Label>
            <textarea
              id="reject-notes"
              rows={3}
              placeholder="Contoh: Bukti transfer tidak valid / tidak terbaca, Nominal transfer kurang dari Rp..."
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              required
              minLength={3}
              maxLength={500}
              aria-invalid={rejectNotes.length > 0 && rejectNotes.trim().length < 3}
              className="w-full text-sm mt-2 p-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary bg-white"
            />
          </div>
        </div>
      </AppModal>

      {/* Zoom Receipt Modal */}
      <AppModal
        open={!!receiptZoom}
        title="Bukti Pembayaran"
        onClose={() => {
          if (receiptZoom?.url) URL.revokeObjectURL(receiptZoom.url);
          setReceiptZoom(null);
        }}
        footer={
          <div className="flex justify-end">
            <Button onClick={() => {
              if (receiptZoom?.url) URL.revokeObjectURL(receiptZoom.url);
              setReceiptZoom(null);
            }}>Tutup</Button>
          </div>
        }
      >
        {receiptZoom?.fileName && <p className="mb-3 text-sm text-slate-600 break-all">File: <strong>{receiptZoom.fileName}</strong>{receiptZoom.mime ? ` (${receiptZoom.mime})` : ""}</p>}
        {receiptZoom && (
          receiptZoom.mime === "application/pdf" ? (
            <iframe src={receiptZoom.url} title="Bukti pembayaran PDF" className="w-full h-[70vh] rounded border" />
          ) : (
            <div className="flex items-center justify-center p-2 bg-slate-900/5 rounded-lg overflow-hidden border">
              <img src={receiptZoom.url} alt="Bukti pembayaran" className="max-w-full max-h-[70vh] object-contain rounded" />
            </div>
          )
        )}
      </AppModal>

      {/* Org / User Details & Statistics Modal */}
      <AppModal
        open={detailModalOpen && !!selectedDetailOrg}
        title="Detail & Statistik Instansi"
        onClose={() => setDetailModalOpen(false)}
        maxWidthClassName="max-w-4xl"
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setDetailModalOpen(false)}>Tutup</Button>
          </div>
        }
      >
        {selectedDetailOrg && (
          <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-1">
            {/* Header / Info Instansi */}
            <div className="border-b pb-4">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">{selectedDetailOrg.name}</h2>
                  <p className="text-sm text-slate-400 font-mono mt-0.5">Subdomain: /{selectedDetailOrg.slug}</p>
                </div>
                <Badge className={selectedDetailOrg.plan === "full" ? "bg-emerald-500 text-white" : "bg-blue-500 text-white"}>
                  PLAN: {selectedDetailOrg.plan.toUpperCase()}
                </Badge>
              </div>

              {/* Owner details */}
              {(() => {
                const owner = selectedDetailOrg.users.find((u) => u.role === "owner") || selectedDetailOrg.users[0];
                return owner ? (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs bg-slate-50/50 p-3 rounded-lg border">
                    <div>
                      <span className="text-slate-400 block">Pengelola (Owner)</span>
                      <span className="font-semibold text-slate-700">{owner.fullName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Email Pengelola</span>
                      <span className="font-semibold text-slate-700">{owner.email}</span>
                    </div>
                  </div>
                ) : null;
              })()}
            </div>

            {/* Statistics Section */}
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Statistik Penggunaan</h3>
              {loadingStats ? (
                <div className="flex items-center justify-center py-6 text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  <span className="text-xs">Memuat data statistik...</span>
                </div>
              ) : orgStats ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-slate-50/50 p-3 rounded-lg border text-center">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase block">Total Broadcast</span>
                    <span className="text-lg font-bold text-slate-800 mt-1 block">{orgStats.totalBroadcasts}</span>
                  </div>
                  <div className="bg-slate-50/50 p-3 rounded-lg border text-center">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase block">Pesan Terkirim</span>
                    <span className="text-lg font-bold text-slate-800 mt-1 block">{orgStats.messagesSent}</span>
                  </div>
                  <div className="bg-slate-50/50 p-3 rounded-lg border text-center">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase block">Pesan Masuk</span>
                    <span className="text-lg font-bold text-slate-800 mt-1 block">{orgStats.messagesReceived}</span>
                  </div>
                  <div className="bg-slate-50/50 p-3 rounded-lg border text-center">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase block">Total Kontak</span>
                    <span className="text-lg font-bold text-slate-800 mt-1 block">{orgStats.totalContacts}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-red-500">Gagal memuat statistik</p>
              )}
            </div>

            {/* Quick Token Adjuster */}
            <div className="bg-amber-50/50 border border-amber-200/60 rounded-xl p-4 space-y-3">
              <div>
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <Coins className="w-4 h-4 text-amber-500" />
                  Atur & Sesuaikan Saldo Token
                </h4>
                <p className="text-[11px] text-slate-400 font-medium">Tambah atau kurangi token untuk instansi ini secara manual.</p>
              </div>

              <div className="p-3 bg-white border border-amber-100 rounded-lg text-xs flex justify-between items-center mb-2">
                <span className="text-slate-500 font-medium">Saldo Token Saat Ini:</span>
                <span className="font-extrabold text-amber-600 text-sm">{selectedDetailOrg.tokensBalance.toLocaleString()} Token</span>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1">
                    <Label htmlFor="detail-token-delta" className="text-xs text-slate-500">Jumlah Penyesuaian</Label>
                    <Input
                      id="detail-token-delta"
                      type="number"
                      placeholder="Misal: 100 atau -50"
                      value={tokenDelta}
                      onChange={(e) => setTokenDelta(parseInt(e.target.value) || 0)}
                      className="h-9 text-xs font-bold mt-1.5"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="detail-token-note" className="text-xs text-slate-500">Catatan/Alasan</Label>
                    <Input
                      id="detail-token-note"
                      placeholder="Contoh: Top-up manual via WA / Koreksi sistem"
                      value={tokenNote}
                      onChange={(e) => setTokenNote(e.target.value)}
                      className="h-9 text-xs mt-1.5"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <Button
                    size="sm"
                    onClick={handleUpdateDetailTokens}
                    disabled={submittingToken || tokenDelta === 0}
                    className="bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs h-8 px-4"
                  >
                    {submittingToken ? "Memproses..." : "Sesuaikan Saldo Token"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Recent Transactions & Payments Logs */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Aktivitas Transaksi Terbaru</h4>
              {loadingStats ? (
                <div className="text-center py-6 text-slate-400 text-xs">Memuat log transaksi...</div>
              ) : orgStats?.recentTransactions && orgStats.recentTransactions.length > 0 ? (
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {orgStats.recentTransactions.map((tx: any) => (
                    <div key={tx.id} className="border rounded-lg p-3 text-xs flex justify-between items-center bg-white">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${tx.type === "usage" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
                            }`}>
                            {tx.type}
                          </span>
                          <span className="font-semibold text-slate-700">{tx.description}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 block mt-1">{formatDate(tx.createdAt)}</span>
                      </div>
                      <span className={`font-bold ${tx.tokensDelta >= 0 ? "text-green-600" : "text-rose-600"}`}>
                        {tx.tokensDelta >= 0 ? "+" : ""}{tx.tokensDelta}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs italic text-slate-400 text-center py-4 bg-slate-50 rounded border">Belum ada riwayat transaksi</p>
              )}
            </div>
          </div>
        )}
      </AppModal>

      {/* Approve Request Confirmation Modal */}
      <AppModal
        open={approveModalOpen}
        title="Konfirmasi Persetujuan Top-Up"
        onClose={() => {
          if (submittingProcess) return;
          setApproveModalOpen(false);
          setRequestToApprove(null);
        }}
        closeDisabled={submittingProcess}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={submittingProcess}
              onClick={() => {
                setApproveModalOpen(false);
                setRequestToApprove(null);
              }}
            >
              Batal
            </Button>
            <Button
              className="bg-primary hover:bg-primary/95 text-white"
              disabled={submittingProcess}
              onClick={handleConfirmApprove}
            >
              {submittingProcess ? "Memproses..." : "Setujui & Tambahkan Saldo"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>Setujui pembayaran <strong>{requestToApprove?.payment_reference}</strong> untuk <strong className="text-slate-800 font-bold">{requestToApprove?.org_name}</strong>?</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg border bg-slate-50 p-3">
            <div><dt>Nominal Top Up</dt><dd className="font-semibold text-slate-800">Rp {Number(requestToApprove?.base_amount ?? requestToApprove?.amount_idr ?? 0).toLocaleString("id-ID")}</dd></div>
            {requestToApprove?.unique_code != null && <div><dt>Kode Unik</dt><dd className="font-semibold font-mono text-slate-800">{String(requestToApprove.unique_code).padStart(3, "0")}</dd></div>}
            <div className="sm:col-span-2"><dt>Total Transfer</dt><dd className="text-xl font-bold text-primary">Rp {Number(requestToApprove?.transfer_amount ?? requestToApprove?.amount_idr ?? 0).toLocaleString("id-ID")}</dd></div>
          </dl>
          <p>Billing Core akan menambahkan <strong>{Number(requestToApprove?.amount_tokens || 0).toLocaleString("id-ID")} token</strong> berdasarkan nominal top-up, tepat satu kali setelah transaksi berhasil. Kode unik tidak menambah saldo.</p>
        </div>
      </AppModal>
    </div>
  );
}
