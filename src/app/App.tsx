import { useState, useEffect } from "react";
import { HeaderNav } from "./components/header-nav";
import { DashboardView } from "./components/dashboard-view";
import { InboxView } from "./components/inbox-view";
import { ChatInterface } from "./components/chat-interface";
import { BillingView } from "./components/billing-view";
import { SettingsView } from "./components/settings-view";
import { AddNumberView } from "./components/add-number-view";
import { BroadcastView } from "./components/broadcast-view";
import { TemplateManagement } from "./components/template-management";
import { BroadcastHistory } from "./components/broadcast-history";
import { BroadcastDetailView } from "./components/broadcast-detail-view";
import { LoginView } from "./components/login-view";
import { LandingPageView } from "./components/landing-page-view";
import { ContactListView } from "./components/contact-list-view";
import { SuperadminDashboardView } from "./components/superadmin-dashboard-view";
import { RulesView } from "./components/rules-view";
import { VerifiedView } from "./components/verified-view";
import { api } from "./lib/api";
import { toast } from "sonner";
import { Lock } from "lucide-react";

type DashboardStats = {
  totalMessages: number;
  totalContacts: number;
  tokensRemaining: number;
  tokensUsed: number;
  activeNumbers: number;
};

type BillingData = {
  currentTokens: number;
  totalSpent: number;
  tokenPrice: number;
};

type Transaction = {
  id: string;
  type: "topup" | "usage" | "adjustment" | "refund" | "midtrans";
  amount: number;
  date: string;
  description: string;
  status?: string;
  snapToken?: string;
  snapUrl?: string;
  amountIdr?: number;
};

function parseHash() {
  const hash = window.location.hash;
  let view = "dashboard";
  let numId: string | null = null;
  let bcId: string | null = null;

  // Tangkap callback dari Supabase Auth (setelah user klik link email)
  if (hash.includes("access_token=") || hash.includes("error_description=") || hash.includes("type=signup") || hash.includes("type=recovery")) {
    return { view: "callback", numId: null, bcId: null, isSignup: hash.includes("type=signup") };
  }

  if (hash.startsWith("#/")) {
    const parts = hash.slice(2).split("?");
    view = parts[0] || "dashboard";
    if (parts[1]) {
      const params = new URLSearchParams(parts[1]);
      numId = params.get("numberId");
      bcId = params.get("broadcastId");
    }
  } else if (hash === "" || hash === "#") {
    view = "landing";
  }
  return { view, numId, bcId, isSignup: false };
}

export default function App() {
  const { view: initialView, numId: initialNum, bcId: initialBc, isSignup: initialIsSignup } = parseHash();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSignupCallback, setIsSignupCallback] = useState(initialIsSignup || false);
  const [user, setUser] = useState<any>(null);
  const [activeView, setActiveView] = useState(initialView);
  const [selectedNumber, setSelectedNumber] = useState<string | null>(initialNum);
  const [selectedBroadcast, setSelectedBroadcast] = useState<string | null>(initialBc);
  const [showAddNumberModal, setShowAddNumberModal] = useState(false);

  const [dashboardActivity, setDashboardActivity] = useState<any[]>([]);
  const [usage7d, setUsage7d] = useState<any[]>([]);

  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
    totalMessages: 0,
    totalContacts: 0,
    tokensRemaining: 0,
    tokensUsed: 0,
    activeNumbers: 0,
  });

  const [whatsappNumbers, setWhatsappNumbers] = useState<any[]>([]);
  const [billingData, setBillingData] = useState<BillingData>({
    currentTokens: 0,
    totalSpent: 0,
    tokenPrice: 1500,
  });

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const session = await api.checkSession();

        if ("error" in session) {
          const hasToken = !!localStorage.getItem("SIPESA_SESSION");
          if (!hasToken) return;

          setIsAuthenticated(false);
          setUser(null);
          return;
        }

        setIsAuthenticated(true);
        setUser(session.data);
        if (session.data?.email?.toLowerCase() === "mckuadratid@gmail.com") {
          setActiveView("superadmin");
        }

        const sData = session.data as any;
        const userIsActive = sData?.is_active ?? (sData?.status ? sData.status === "active" : true);
        if (userIsActive && session.data?.email?.toLowerCase() !== "mckuadratid@gmail.com") {
          await api.init();
          await loadData(session.data);
        }
      } catch (error) {
        console.error("Error initializing app:", error);
      } finally {
        setLoading(false);
      }
    };

    initializeApp();
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      setIsAuthenticated(false);
      setUser(null);
      setSelectedNumber(null);
      setSelectedBroadcast(null);
      setActiveView("dashboard");
      window.location.hash = "";
      toast.error("Sesi Anda telah berakhir. Silakan masuk kembali.");
    };

    window.addEventListener("sipesa-unauthorized", handleUnauthorized);
    return () => window.removeEventListener("sipesa-unauthorized", handleUnauthorized);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || user?.email?.toLowerCase() === "mckuadratid@gmail.com") return;

    const interval = setInterval(async () => {
      try {
        const [numbersRes, statsRes] = await Promise.all([
          api.getNumbers(),
          api.getStats(),
        ]);

        if (numbersRes.success) {
          setWhatsappNumbers(numbersRes.data ?? []);
        }
        if (statsRes.success) {
          const raw = statsRes.data ?? {};
          setDashboardStats({
            totalMessages: Number(raw.totalMessages ?? 0),
            totalContacts: Number(raw.totalContacts ?? 0),
            tokensRemaining: Number(raw.tokensRemaining ?? raw.tokenRemaining ?? 0),
            tokensUsed: Number(raw.tokensUsed ?? 0),
            activeNumbers: Number(raw.activeNumbers ?? 0),
          });
        }
      } catch (err) {
        console.error("Error polling real-time unread messages:", err);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  useEffect(() => {
    let hash = "";
    if (isAuthenticated) {
      hash = `#/${activeView}`;
      const params = new URLSearchParams();
      if (selectedNumber) params.set("numberId", selectedNumber);
      if (selectedBroadcast) params.set("broadcastId", selectedBroadcast);
      const paramStr = params.toString();
      if (paramStr) {
        hash += `?${paramStr}`;
      }
    } else {
      if (activeView === "login" || activeView === "register") {
        hash = `#/${activeView}`;
      } else if (activeView === "callback") {
        // Biarkan hash apa adanya agar Supabase bisa membaca tokennya
        return;
      } else if (activeView === "landing") {
        hash = "#/";
      } else {
        hash = "#/";
      }
    }
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
  }, [activeView, selectedNumber, selectedBroadcast, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      if (isSignupCallback) {
        setActiveView("verified");
      } else if (activeView === "login" || activeView === "register" || activeView === "" || activeView === "callback" || activeView === "landing") {
        setActiveView(user?.email?.toLowerCase() === "mckuadratid@gmail.com" ? "superadmin" : "dashboard");
      }
    } else if (!loading && activeView === "callback") {
      // Jika loading selesai tapi tidak terautentikasi (mungkin link kadaluarsa)
      setTimeout(() => {
        setActiveView("login");
      }, 3000);
    }
  }, [isAuthenticated, activeView, user, loading, isSignupCallback]);

  useEffect(() => {
    const handleHashChange = () => {
      const { view, numId, bcId } = parseHash();
      
      // Cegah hashchange mereset view jika sedang memproses callback signup
      setActiveView((prev) => {
        if ((prev === "callback" || prev === "verified") && isSignupCallback) {
          return "verified";
        }
        return view;
      });
      setSelectedNumber(numId);
      setSelectedBroadcast(bcId);
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const handleLogin = async (identifier: string, password: string) => {
    const result = await api.login(identifier, password);

    if ("error" in result) {
      throw new Error(result.error || "Login gagal");
    }

    if (result.data?.user) {
      setIsAuthenticated(true);
      setUser(result.data.user);
      if (result.data.user?.email?.toLowerCase() === "mckuadratid@gmail.com") {
        setActiveView("superadmin");
      }
      const u = result.data.user as any;
      const userIsActive = u?.is_active ?? (u?.status ? u.status === "active" : true);
      if (userIsActive && result.data.user?.email?.toLowerCase() !== "mckuadratid@gmail.com") {
        await api.init();
        await loadData(result.data.user);
      }
      return;
    }

    throw new Error("Login gagal");
  };

  const handleSignup = async (
    email: string,
    password: string,
    name: string,
    orgName: string,
    username: string,
    waNumber: string
  ) => {
    const result = await api.signup(email, password, name, orgName, username, waNumber);

    if ("error" in result) {
      throw new Error(result.error || "Registrasi gagal");
    }

    if (result.data?.user) {
      if (!result.data.session) {
        // Verification email sent, no session yet
        return { emailVerificationRequired: true };
      }
      setIsAuthenticated(true);
      setUser(result.data.user);
      if (result.data.user?.email?.toLowerCase() === "mckuadratid@gmail.com") {
        setActiveView("superadmin");
      }
      const u = result.data.user as any;
      const userIsActive = u?.is_active ?? (u?.status ? u.status === "active" : true);
      if (userIsActive && result.data.user?.email?.toLowerCase() !== "mckuadratid@gmail.com") {
        await api.init();
        await loadData(result.data.user);
      }
      return { emailVerificationRequired: false };
    }

    throw new Error("Registrasi gagal");
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      setIsAuthenticated(false);
      setUser(null);
      setSelectedNumber(null);
      setSelectedBroadcast(null);
      setActiveView("dashboard");
      window.location.hash = "";
    }
  };

  const loadData = async (currentUser?: any) => {
    const activeUser = currentUser || user;
    if (activeUser?.email?.toLowerCase() === "mckuadratid@gmail.com") return;
    try {
      const statsRes = await api.getStats();
      if (!("error" in statsRes)) {
        const raw = statsRes.data ?? {};
        setDashboardStats({
          totalMessages: Number(raw.totalMessages ?? 0),
          totalContacts: Number(raw.totalContacts ?? 0),
          tokensRemaining: Number(raw.tokensRemaining ?? raw.tokenRemaining ?? 0),
          tokensUsed: Number(raw.tokensUsed ?? 0),
          activeNumbers: Number(raw.activeNumbers ?? 0),
        });
      }

      const numbersRes = await api.getNumbers();
      if (!("error" in numbersRes)) {
        setWhatsappNumbers(numbersRes.data ?? []);
      }

      const billingRes = await api.getBilling();
      if (!("error" in billingRes)) {
        const raw = billingRes.data ?? {};

        const currentTokens = Number(
          raw.currentTokens ?? raw.tokens_remaining ?? raw.tokensRemaining ?? 0,
        );

        const totalSpent = Number(
          raw.totalSpent ??
            raw.rupiah_spent ??
            raw.rupiah_used ??
            raw.rupiah_balance_used ??
            0,
        );

        const tokenPrice = Number(raw.tokenPrice ?? 1500);

        setBillingData({
          currentTokens,
          totalSpent,
          tokenPrice,
        });
      }

      const txnRes = await api.getTransactions();
      if (!("error" in txnRes)) {
        const rows = (txnRes.data ?? []) as any[];

        const normalized: Transaction[] = rows.map((r) => {
          const amount = Number(r.amount ?? r.tokens ?? r.token_amount ?? r.token_delta ?? 0);

          const typeRaw = String(r.type ?? r.txn_type ?? r.kind ?? "");
          let type: Transaction["type"] = "usage";

          if (typeRaw === "midtrans") {
            type = "midtrans";
          } else if (typeRaw === "topup" || typeRaw === "credit" || amount > 0) {
            type = "topup";
          } else if (typeRaw === "refund") {
            type = "refund";
          } else if (typeRaw === "adjustment") {
            type = "adjustment";
          }

          const dateIso = r.date ?? r.created_at ?? r.createdAt ?? new Date().toISOString();
          const description =
            r.description ??
            r.note ??
            (type === "topup" ? "Top-up token" : "Pemakaian token");

          return {
            id: String(r.id ?? crypto.randomUUID()),
            type,
            amount: Math.abs(amount),
            date: dateIso,
            description,
            status: r.status,
            snapToken: r.snapToken ?? r.snap_token,
            snapUrl: r.snapUrl ?? r.snap_url,
            amountIdr: r.amountIdr ?? r.amount_idr,
          };
        });

        const activityRes = await api.getDashboardActivity();
          if (!("error" in activityRes)) {
            setDashboardActivity(activityRes.data ?? []);
          }

          const usageRes = await api.getUsage7d();
          if (!("error" in usageRes)) {
            setUsage7d(usageRes.data ?? []);
          }

        setTransactions(normalized);
      }

      const settingsRes = await api.getSettings();
      if (!("error" in settingsRes)) {
        const profile = settingsRes.data.profile;
        const org = settingsRes.data.org;
        const userId = profile?.id;
        const orgId = org?.id;

        if (userId) {
          const avatarKey = `sipesa_avatar_${userId}`;
          if (profile?.avatar) {
            localStorage.setItem(avatarKey, profile.avatar);
            window.dispatchEvent(new Event("sipesa-avatar-updated"));
          } else if (profile?.avatar === null) {
            localStorage.removeItem(avatarKey);
            window.dispatchEvent(new Event("sipesa-avatar-updated"));
          }
        }

        if (orgId) {
          const addressKey = `sipesa_address_${orgId}`;
          if (org?.address) {
            localStorage.setItem(addressKey, org.address);
          } else if (org?.address === null || org?.address === "") {
            localStorage.removeItem(addressKey);
          }
        }

        setUser((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            name: profile?.fullName || prev.name,
            orgName: org?.name || prev.orgName || prev.org_name,
            org_name: org?.name || prev.org_name || prev.orgName,
          };
        });
      }
    } catch (error) {
      console.error("Error loading data:", error);
    }
  };

  const handleSelectNumber = (numberId: string) => {
    setSelectedNumber(numberId);
  };

  const handleBackFromChat = () => {
    setSelectedNumber(null);
    loadData();
  };

  const handleAddNumber = async () => {
    await loadData();
    setActiveView("dashboard");
  };

  const handleViewChange = (view: string) => {
    if (view === "add-number") {
      setShowAddNumberModal(true);
    } else {
      setActiveView(view);
      loadData();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Memuat Sipesa...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (activeView === "callback") {
      return (
        <div className="flex items-center justify-center h-screen bg-gray-50">
          <div className="text-center p-8 bg-white shadow rounded-lg max-w-sm w-full mx-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Memverifikasi Sesi...</h3>
            <p className="text-sm text-gray-500">Mohon tunggu sebentar, Anda akan segera dialihkan.</p>
          </div>
        </div>
      );
    }

    if (activeView === "login" || activeView === "register") {
      return (
        <LoginView 
          onLogin={handleLogin} 
          onSignup={handleSignup} 
          initialIsLogin={activeView === "login"} 
        />
      );
    }
    return (
      <LandingPageView 
        onNavigateToLogin={() => setActiveView("login")} 
        onNavigateToRegister={() => setActiveView("register")} 
      />
    );
  }

  const isSuperadmin = user?.email?.toLowerCase() === "mckuadratid@gmail.com";
  const u = user as any;
  const userIsActive = u?.is_active ?? (u?.status ? u.status === "active" : true);

  if (isAuthenticated && !isSuperadmin && !userIsActive) {
    const waActivationLink = "https://wa.me/6282312006987?text=Halo%20Admin%20SIPESA%2C%20saya%20ingin%20mengkonfirmasi%20pendaftaran%20akun%20SIPESA%20saya%20dengan%20email%20" + encodeURIComponent(user?.email || "");
    return (
      <div className="flex flex-col h-[100dvh] bg-slate-50 overflow-hidden">
        <header className="h-16 border-b bg-white flex justify-between items-center px-6">
          <div className="flex items-center gap-2">
            <span className="text-xl font-black text-primary tracking-tight">SIPESA</span>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm font-semibold text-slate-600 hover:text-slate-900 border rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
          >
            Keluar (Logout)
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 shadow-xl rounded-2xl p-8 text-center space-y-6">
            <div className="mx-auto w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500 border border-amber-200">
              <Lock className="w-8 h-8" />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-slate-800">Akun Belum Disetujui</h2>
              <p className="text-sm text-slate-500 leading-relaxed">
                Pendaftaran Anda berhasil. Namun, dashboard Anda saat ini masih terkunci menunggu persetujuan (approval) oleh admin.
              </p>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 text-xs text-left space-y-2 text-slate-600">
              <p className="font-semibold text-slate-700">Detail Pendaftaran:</p>
              <div>• Email: <span className="font-mono font-medium">{user?.email}</span></div>
              <div>• Organisasi: <span className="font-medium">{user?.orgName || user?.org_name}</span></div>
              <div>• Status: <span className="font-medium text-amber-600">Belum disetujui admin</span></div>
            </div>

            <div className="pt-2">
              <a
                href={waActivationLink}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-md hover:shadow-lg"
              >
                Hubungi Admin (WhatsApp)
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const renderView = () => {
    if (user?.email?.toLowerCase() === "mckuadratid@gmail.com" && activeView !== "rules") {
      return <SuperadminDashboardView />;
    }

    // ChatInterface now handles WABA dropdown directly

    if (activeView === "history" || (activeView === "broadcast-detail" && selectedBroadcast)) {
      return (
        <>
          <BroadcastHistory
            onViewDetail={(broadcastId) => {
              setSelectedBroadcast(broadcastId);
              setActiveView("broadcast-detail");
            }}
          />
          {activeView === "broadcast-detail" && selectedBroadcast && (
            <BroadcastDetailView
              broadcastId={selectedBroadcast}
              onBack={() => {
                setSelectedBroadcast(null);
                setActiveView("history");
              }}
            />
          )}
        </>
      );
    }

    switch (activeView) {
      case "superadmin":
        return <SuperadminDashboardView />;

      case "verified":
        return <VerifiedView user={user} onContinue={() => {
          setIsSignupCallback(false);
          setActiveView("dashboard");
        }} />;

      case "dashboard":
        return (
          <DashboardView
            stats={dashboardStats}
            activities={dashboardActivity}
            usage7d={usage7d}
            user={user}
            onViewChange={handleViewChange}
          />
        );

      case "inbox":
        if (!selectedNumber) {
          return (
            <InboxView
              numbers={whatsappNumbers}
              onSelectNumber={(numId: string) => setSelectedNumber(numId)}
            />
          );
        }

        const currentNumber = whatsappNumbers.find((num) => num.id === selectedNumber);

        return (
          <ChatInterface
            numberId={selectedNumber}
            numberName={currentNumber?.name || "Nomor WA"}
            onBack={handleBackFromChat}
          />
        );

      case "broadcast":
        return (
          <BroadcastView
            onViewHistory={() => setActiveView("history")}
            onBroadcastSent={loadData}
            user={user}
          />
        );

      case "contacts":
        return <ContactListView user={user} />;

      case "templates":
        return <TemplateManagement />;

      case "billing":
        return (
          <BillingView
            billingData={billingData}
            transactions={transactions}
            onUpdate={loadData}
          />
        );

      case "settings":
        return (
          <SettingsView
            onUpdateUser={async () => {
              const session = await api.checkSession();
              if (!("error" in session)) {
                const settingsRes = await api.getSettings();
                if (!("error" in settingsRes)) {
                  setUser({
                    ...session.data,
                    name: settingsRes.data.profile?.fullName || session.data?.name,
                    orgName: settingsRes.data.org?.name || session.data?.orgName || session.data?.org_name,
                    org_name: settingsRes.data.org?.name || session.data?.org_name || session.data?.orgName,
                  });
                } else {
                  setUser(session.data);
                }
              }
            }}
          />
        );
      case "rules":
        return (
          <RulesView
            user={user}
            onBack={() => setActiveView(user?.email?.toLowerCase() === "mckuadratid@gmail.com" ? "superadmin" : "dashboard")}
          />
        );

      default:
        return <DashboardView stats={dashboardStats} />;
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-white overflow-hidden">
      <HeaderNav
        activeView={activeView}
        onViewChange={handleViewChange}
        onLogout={handleLogout}
        user={user}
        activities={dashboardActivity}
        numbers={whatsappNumbers}
      />
      <main className={`flex-1 min-h-0 bg-white ${activeView === "inbox" && selectedNumber ? "overflow-hidden flex flex-col" : "overflow-auto"}`}>{renderView()}</main>
      {showAddNumberModal && (
        <AddNumberView
          onBack={() => setShowAddNumberModal(false)}
          onAddNumber={async () => {
            await loadData();
            setShowAddNumberModal(false);
          }}
        />
      )}
    </div>
  );
}