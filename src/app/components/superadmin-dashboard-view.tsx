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
  Trash2,
  Eye,
  Upload,
  Scale,
} from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { AppModal } from "./AppModal";

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
  const [activeTab, setActiveTab] = useState<"orgs" | "signups" | "payments" | "settings">("orgs");
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [signups, setSignups] = useState<SignupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [planFilter, setPlanFilter] = useState("all");

  // Manual payment state variables
  const [paymentRequests, setPaymentRequests] = useState<any[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
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
  const [receiptZoom, setReceiptZoom] = useState<string | null>(null);
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
  const [orgPlan, setOrgPlan] = useState("free");
  const [orgIsActive, setOrgIsActive] = useState(true);
  const [orgSupportEmail, setOrgSupportEmail] = useState("");
  const [orgSendDelay, setOrgSendDelay] = useState(2000);
  const [orgThrottle, setOrgThrottle] = useState(30);
  const [orgTokenPrice, setOrgTokenPrice] = useState(1500);
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

  const handleActivateSignup = async (userId: string) => {
    setProcessingSignupId(userId);
    try {
      const res = await api.activateSuperadminUser(userId);
      if (res.success) {
        toast.success("Akun & instansi sekolah berhasil diverifikasi.");
        loadOrgs();
        loadSignups();
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
    loadOrgs();
    loadSignups();
    loadSuperadminRequests();
    loadSuperadminSettings();
  }, []);

  const loadSuperadminRequests = async () => {
    setLoadingRequests(true);
    try {
      const res = await api.getSuperadminManualRequests();
      if (res.success) {
        setPaymentRequests(res.data);
      } else {
        toast.error("Gagal mengambil data pengajuan top-up.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Terjadi kesalahan koneksi saat mengambil pengajuan top-up.");
    } finally {
      setLoadingRequests(false);
    }
  };

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
        loadSuperadminRequests();
        loadOrgs(); // refresh org list to show updated token balance
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

  const handleConfirmReject = async () => {
    if (!selectedRequest) return;
    setSubmittingProcess(true);
    try {
      const res = await api.rejectManualRequest(selectedRequest.id, rejectNotes);
      if (res.success) {
        toast.success(`Pembayaran untuk ${selectedRequest.org_name} ditolak.`);
        setRejectModalOpen(false);
        setSelectedRequest(null);
        loadSuperadminRequests();
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

        loadOrgs();

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

  const loadOrgs = async () => {
    setLoading(true);
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
      setLoading(false);
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
        loadOrgs();
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
    setOrgTokenPrice(org.tokenPrice ?? 1500);
    setEditModalOpen(true);
  };

  const handleUpdateOrgDetails = async () => {
    if (!selectedOrg) return;
    if (!orgName.trim() || !orgSlug.trim()) {
      toast.error("Nama instansi dan Slug wajib diisi");
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
        setEditModalOpen(false);
        loadOrgs();
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
        loadOrgs();
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
    <div className="p-8 max-w-7xl mx-auto space-y-8">
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
          Sekolah & Instansi ({orgs.length})
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
          Persetujuan Pembayaran ({paymentRequests.filter((r) => r.status === "pending").length})
        </button>
        <button
          onClick={() => setActiveTab("settings")}
          className={`px-5 py-3 text-sm font-semibold border-b-2 transition-all ${activeTab === "settings"
            ? "border-primary text-primary"
            : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
        >
          Pengaturan Pembayaran
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
                placeholder="Cari sekolah, slug, atau email..."
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
                <option value="free">Free</option>
                <option value="pro">Pro</option>
              </select>
              <Button onClick={loadOrgs} variant="outline" className="h-9 px-4 text-xs font-semibold flex items-center gap-1">
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
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50/70">
                  <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="px-5 py-3 text-left">Nama Sekolah</th>
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
                          <div className="text-xs text-slate-400 font-mono mt-0.5">/{org.slug}</div>
                        </td>
                        {/* Plan & Status */}
                        <td className="px-5 py-4">
                          <div className="flex flex-col gap-1.5">
                            <span className={`inline-flex items-center w-fit px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${org.plan === "pro"
                              ? "bg-purple-100 text-purple-700"
                              : "bg-slate-100 text-slate-700"
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
                          <div className="text-[10px] text-amber-600 font-semibold mt-0.5">Rp {(org.tokenPrice ?? 1500).toLocaleString("id-ID")}/token</div>
                        </td>
                        {/* WhatsApp configs */}
                        <td className="px-5 py-4">
                          <div className="space-y-1">
                            {org.numbers.length === 0 ? (
                              <span className="text-xs italic text-slate-400">Belum ada nomor</span>
                            ) : (
                              org.numbers.map((num) => (
                                <div key={num.id} className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                                  <span className={`w-1.5 h-1.5 rounded-full ${num.isActive ? "bg-green-500" : "bg-slate-300"}`} />
                                  <span>{num.label}</span>
                                  <span className="text-slate-400 font-mono">({num.phone})</span>
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
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-slate-800">Daftar Registrasi Form Baru</h3>
            <Button onClick={loadSignups} variant="outline" className="h-8 text-xs">
              Refresh Pendaftar
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/70">
                <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left">Tanggal Daftar</th>
                  <th className="px-5 py-3 text-left">Nama Lengkap</th>
                  <th className="px-5 py-3 text-left">Username</th>
                  <th className="px-5 py-3 text-left">Email</th>
                  <th className="px-5 py-3 text-left">Instansi Sekolah</th>
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
                    {/* Instansi info */}
                    <td className="px-5 py-4">
                      {signup.org ? (
                        <div>
                          <div className="font-semibold text-slate-800">{signup.org.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">/{signup.org.slug} • {signup.org.plan.toUpperCase()}</div>
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
                            onClick={() => handleActivateSignup(signup.id)}
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

      {/* Tab Contents: Manual Topup Payments Approvals */}
      {activeTab === "payments" && (
        <Card className="p-6 space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-slate-800">Persetujuan Pembayaran Top-up Manual</h3>
            <Button onClick={loadSuperadminRequests} variant="outline" className="h-8 text-xs">
              Refresh Pengajuan
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/70">
                <tr className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left">Tanggal</th>
                  <th className="px-5 py-3 text-left">Nama Instansi</th>
                  <th className="px-5 py-3 text-left">Jumlah Token</th>
                  <th className="px-5 py-3 text-left">Nominal Transfer (Referral)</th>
                  <th className="px-5 py-3 text-left">Diajukan Oleh</th>
                  <th className="px-5 py-3 text-left">Bukti</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {paymentRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-4 font-medium text-slate-600">
                      {formatDate(req.created_at)}
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-800">
                      {req.org_name}
                    </td>
                    <td className="px-5 py-4 font-bold text-slate-700">
                      {Number(req.amount_tokens ?? 0).toLocaleString()} token
                    </td>
                    <td className="px-5 py-4 font-mono font-bold text-primary">
                      Rp {Number(req.amount_idr ?? 0).toLocaleString("id-ID")}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {req.created_by_email}
                    </td>
                    <td className="px-5 py-4">
                      {req.receipt_url && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setReceiptZoom(req.receipt_url)}
                          className="h-8 text-xs font-semibold flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Lihat Bukti
                        </Button>
                      )}
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
                        {req.status === "approved"
                          ? "Disetujui"
                          : req.status === "rejected"
                            ? "Ditolak"
                            : "Menunggu"}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-right">
                      {req.status === "pending" ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleApproveRequest(req)}
                            disabled={submittingProcess}
                            className="h-8 text-xs font-semibold px-3 bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            Setujui
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRejectRequest(req)}
                            disabled={submittingProcess}
                            className="h-8 text-xs font-semibold px-3 text-rose-600 border-rose-200 hover:bg-rose-50"
                          >
                            Tolak
                          </Button>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400">
                          {req.notes ? (
                            <span className="truncate max-w-[150px] inline-block" title={req.notes}>
                              Catatan: {req.notes}
                            </span>
                          ) : (
                            <span>Oleh {req.approved_by}</span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {paymentRequests.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-slate-400">
                      Belum ada pengajuan top-up manual.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === "settings" && (
        <Card className="p-6 max-w-2xl space-y-6">
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-1">Pengaturan Akun Transfer Pembayaran</h3>
            <p className="text-xs text-slate-400">Atur metode pembayaran, bank transfer, e-wallet, dan QRIS yang akan ditampilkan kepada pengguna di halaman billing.</p>
          </div>

          <div className="space-y-6">
            {/* 1. BANK TRANSFER METHOD */}
            <div className="p-5 border rounded-2xl bg-slate-50/30 space-y-4 hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <Building className="w-4 h-4" />
                  </span>
                  <div>
                    <h4 className="text-sm font-bold text-slate-800">1. Transfer Bank Resmi</h4>
                    <p className="text-[11px] text-slate-400">Terima pembayaran via transfer antar bank</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={bankEnabled}
                  onChange={(e) => setBankEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-primary focus:ring-primary cursor-pointer animate-pulse-once"
                />
              </div>

              {bankEnabled && (
                <div className="space-y-4 pt-3 border-t border-slate-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="bank-select" className="text-xs font-semibold text-slate-600">Pilih Bank</Label>
                      <div className="flex items-center gap-2">
                        <select
                          id="bank-select"
                          value={bankName}
                          onChange={(e) => setBankName(e.target.value)}
                          className="flex-1 h-10 px-3 border rounded-lg text-sm bg-white font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                        >
                          <option value="BCA">BCA (Bank Central Asia)</option>
                          <option value="Mandiri">Bank Mandiri</option>
                          <option value="BRI">BRI (Bank Rakyat Indonesia)</option>
                          <option value="BNI">BNI (Bank Negara Indonesia)</option>
                          <option value="BSI">BSI (Bank Syariah Indonesia)</option>
                        </select>
                        <div className="flex-shrink-0">
                          <BankBrandLogo name={bankName} />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bank-norek" className="text-xs font-semibold text-slate-600">Nomor Rekening</Label>
                      <Input
                        id="bank-norek"
                        placeholder="Contoh: 1234567890"
                        value={bankAccountNumber}
                        onChange={(e) => setBankAccountNumber(e.target.value)}
                        className="h-10 text-sm font-mono"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bank-an" className="text-xs font-semibold text-slate-600">Atas Nama (A/N) Pemilik Rekening</Label>
                    <Input
                      id="bank-an"
                      placeholder="Contoh: PT MCKUADRAT"
                      value={bankAccountName}
                      onChange={(e) => setBankAccountName(e.target.value)}
                      className="h-10 text-sm"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 2. E-WALLET METHOD */}
            <div className="p-5 border rounded-2xl bg-slate-50/30 space-y-4 hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                    <Coins className="w-4 h-4" />
                  </span>
                  <div>
                    <h4 className="text-sm font-bold text-slate-800">2. E-Wallet / QR Payment</h4>
                    <p className="text-[11px] text-slate-400">Terima pembayaran via OVO, GoPay, Dana, dll</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={ewalletEnabled}
                  onChange={(e) => setEwalletEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-primary focus:ring-primary cursor-pointer"
                />
              </div>

              {ewalletEnabled && (
                <div className="space-y-4 pt-3 border-t border-slate-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ewallet-provider" className="text-xs font-semibold text-slate-600">Provider E-Wallet</Label>
                      <div className="flex items-center gap-2">
                        <select
                          id="ewallet-provider"
                          value={ewalletProvider}
                          onChange={(e) => setEwalletProvider(e.target.value)}
                          className="flex-1 h-10 px-3 border rounded-lg text-sm bg-white font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                        >
                          <option value="GoPay">GoPay</option>
                          <option value="OVO">OVO</option>
                          <option value="Dana">Dana</option>
                          <option value="LinkAja">LinkAja</option>
                        </select>
                        <div className="flex-shrink-0">
                          <EWalletBrandLogo name={ewalletProvider} />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ewallet-phone" className="text-xs font-semibold text-slate-600">Nomor Handphone / Akun</Label>
                      <Input
                        id="ewallet-phone"
                        placeholder="Contoh: 081234567890"
                        value={ewalletPhoneNumber}
                        onChange={(e) => setEwalletPhoneNumber(e.target.value)}
                        className="h-10 text-sm font-mono"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ewallet-an" className="text-xs font-semibold text-slate-600">Atas Nama (A/N) Akun</Label>
                    <Input
                      id="ewallet-an"
                      placeholder="Contoh: PT MCKUADRAT"
                      value={ewalletAccountName}
                      onChange={(e) => setEwalletAccountName(e.target.value)}
                      className="h-10 text-sm"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 3. QRIS METHOD */}
            <div className="p-5 border rounded-2xl bg-slate-50/30 space-y-4 hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-red-50 text-red-600 rounded-lg">
                    <Scale className="w-4 h-4" />
                  </span>
                  <div>
                    <h4 className="text-sm font-bold text-slate-800">3. Kode QRIS Pembayaran</h4>
                    <p className="text-[11px] text-slate-400">Scan QR Code untuk pembayaran langsung</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={qrisEnabled}
                  onChange={(e) => setQrisEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-primary focus:ring-primary cursor-pointer"
                />
              </div>

              {qrisEnabled && (
                <div className="space-y-4 pt-3 border-t border-slate-100">
                  <Label className="text-xs font-semibold text-slate-600">Barcode QRIS Pembayaran (Gambar)</Label>
                  <div className="flex flex-col gap-3">
                    <label className="border-2 border-dashed border-slate-200 hover:border-primary/50 transition-colors rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer bg-slate-50/50 hover:bg-slate-50 group">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleQrisUpload}
                        className="hidden"
                      />
                      <Upload className="w-8 h-8 text-slate-400 group-hover:text-primary transition-colors mb-2" />
                      <span className="text-sm font-semibold text-slate-600 group-hover:text-primary transition-colors">
                        {qrisFileName || "Pilih gambar barcode QRIS"}
                      </span>
                      <span className="text-xs text-slate-400 mt-1">Format gambar (PNG, JPG), maks. 2MB</span>
                    </label>

                    {qrisBase64 && (
                      <div className="border rounded-lg p-3 bg-white flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-500">Preview QRIS:</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setQrisBase64(null);
                              setQrisFileName("");
                            }}
                            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-7 text-xs"
                          >
                            Hapus QRIS
                          </Button>
                        </div>
                        <img
                          src={qrisBase64}
                          alt="QRIS Preview"
                          className="max-w-[200px] h-auto object-contain border rounded p-1 mx-auto bg-white"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Save Button */}
            <div className="pt-2 flex justify-end">
              <Button
                onClick={handleSaveSettings}
                disabled={submittingSettings}
                className="bg-primary hover:bg-primary/90 text-white font-semibold"
              >
                {submittingSettings ? "Menyimpan..." : "Simpan Pengaturan"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Modal 1: Update Token Balance */}
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

      {/* Modal 2: Edit Org Details */}
      <AppModal
        open={editModalOpen && !!selectedOrg}
        title="Edit Profil Instansi Sekolah"
        onClose={() => setEditModalOpen(false)}
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
                <Label htmlFor="org-slug" className="text-slate-700">Slug Subdomain</Label>
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
                  onChange={(e) => setOrgPlan(e.target.value)}
                  className="w-full mt-2 p-2.5 border rounded-lg text-sm bg-white font-semibold text-slate-700 focus:outline-none"
                >
                  <option value="free">FREE</option>
                  <option value="pro">PRO</option>
                </select>
              </div>
              <div>
                <Label htmlFor="org-support" className="text-slate-700">Email Bantuan (Support Email)</Label>
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
                <Label htmlFor="org-delay" className="text-slate-700">Jeda Kirim Broadcast (ms)</Label>
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
                <Label htmlFor="org-throttle" className="text-slate-700">Limit Kirim per Menit (Throttle)</Label>
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
                Sekolah/Instansi Aktif (Izinkan Login & Pengiriman)
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
              <p className="text-[10px] text-muted-foreground mt-1">
                Contoh: 1500 = Rp 1.500 per token. Berlaku untuk billing tampilan user (tidak memotong token).
              </p>
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
                <Label htmlFor="num-phone" className="text-slate-700">Nomor WA (Format Internasional)</Label>
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
                <Label htmlFor="num-biz" className="text-slate-700">WhatsApp Business ID</Label>
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

      {/* Rejection Notes Modal */}
      <AppModal
        open={rejectModalOpen}
        title="Tolak Pembayaran Top-up"
        onClose={() => setRejectModalOpen(false)}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setRejectModalOpen(false)} disabled={submittingProcess}>
              Batal
            </Button>
            <Button
              onClick={handleConfirmReject}
              disabled={submittingProcess || !rejectNotes.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
            >
              {submittingProcess ? "Menolak..." : "Ya, Tolak Pembayaran"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Berikan alasan mengapa pembayaran top-up untuk <span className="font-semibold">{selectedRequest?.org_name}</span> ditolak. Pengguna akan melihat catatan ini di halaman billing mereka.
          </p>
          <div>
            <Label htmlFor="reject-notes" className="text-slate-700">Catatan Penolakan</Label>
            <textarea
              id="reject-notes"
              rows={3}
              placeholder="Contoh: Bukti transfer tidak valid / tidak terbaca, Nominal transfer kurang dari Rp..."
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              className="w-full text-sm mt-2 p-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary bg-white"
            />
          </div>
        </div>
      </AppModal>

      {/* Zoom Receipt Modal */}
      <AppModal
        open={!!receiptZoom}
        title="Bukti Transfer"
        onClose={() => setReceiptZoom(null)}
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setReceiptZoom(null)}>Tutup</Button>
          </div>
        }
      >
        {receiptZoom && (
          <div className="flex items-center justify-center p-2 bg-slate-900/5 rounded-lg overflow-hidden border">
            <img
              src={receiptZoom}
              alt="Zoom Bukti Transfer"
              className="max-w-full max-h-[70vh] object-contain rounded"
            />
          </div>
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
                <Badge className={selectedDetailOrg.plan === "pro" ? "bg-purple-500 text-white animate-pulse" : "bg-slate-500 text-white"}>
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
              {submittingProcess ? "Memproses..." : "Setujui"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Apakah Anda yakin ingin menyetujui pengajuan top-up sebesar{" "}
          <strong className="text-slate-800 font-bold">
            {requestToApprove?.amount_tokens?.toLocaleString("id-ID")} token
          </strong>{" "}
          untuk <strong className="text-slate-800 font-bold">{requestToApprove?.org_name}</strong>?
        </p>
      </AppModal>
    </div>
  );
}
