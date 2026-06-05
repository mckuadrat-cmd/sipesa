import { useState, useRef, useEffect } from "react";
import {
  LayoutDashboard,
  FileText,
  Send,
  MessageSquare,
  History,
  CreditCard,
  Settings,
  Plus,
  LogOut,
  Bell,
  Mail,
  User,
  ChevronDown,
  Building,
  Users,
} from "lucide-react";
import { Button } from "./ui/button";
import logoFull from "/logo-sipesa.png";

interface HeaderNavProps {
  activeView: string;
  onViewChange: (view: string) => void;
  onLogout?: () => void;
  user: any;
  activities?: any[];
  numbers?: any[];
}

export function HeaderNav({
  activeView,
  onViewChange,
  onLogout,
  user,
  activities = [],
  numbers = [],
}: HeaderNavProps) {
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [showMailDropdown, setShowMailDropdown] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [hasNewNotifs, setHasNewNotifs] = useState(false);
  const [prevTotalUnread, setPrevTotalUnread] = useState(0);
  const [prevLatestNotifId, setPrevLatestNotifId] = useState<string | null>(null);

  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const mailRef = useRef<HTMLDivElement>(null);

  const totalUnread = numbers.reduce((acc, curr) => acc + (curr.unreadCount || 0), 0);

  useEffect(() => {
    if (totalUnread > prevTotalUnread) {
      setHasNewMessages(true);
    } else if (totalUnread === 0) {
      setHasNewMessages(false);
    }
    setPrevTotalUnread(totalUnread);
  }, [totalUnread]);

  useEffect(() => {
    const latestId = activities[0]?.id || activities[0]?.created_at || null;
    if (latestId && latestId !== prevLatestNotifId) {
      setHasNewNotifs(true);
    } else if (activities.length === 0) {
      setHasNewNotifs(false);
    }
    setPrevLatestNotifId(latestId);
  }, [activities]);

  useEffect(() => {
    const loadAvatar = () => {
      if (!user?.id) {
        setAvatar(null);
        return;
      }
      const avatarKey = `sipesa_avatar_${user.id}`;
      let avatarVal = localStorage.getItem(avatarKey);
      if (!avatarVal) {
        const oldAvatar = localStorage.getItem("sipesa_avatar");
        if (oldAvatar) {
          localStorage.setItem(avatarKey, oldAvatar);
          avatarVal = oldAvatar;
        }
      }
      setAvatar(avatarVal);
    };
    loadAvatar();
    window.addEventListener("sipesa-avatar-updated", loadAvatar);
    return () => window.removeEventListener("sipesa-avatar-updated", loadAvatar);
  }, [user?.id]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setShowProfileDropdown(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifDropdown(false);
      }
      if (mailRef.current && !mailRef.current.contains(event.target as Node)) {
        setShowMailDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isSuperadmin = user?.email?.toLowerCase() === "mckuadratid@gmail.com";

  const navItems = isSuperadmin
    ? [{ id: "superadmin", label: "Manajemen User", icon: LayoutDashboard }]
    : [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "contacts", label: "Daftar Kontak", icon: Users },
      { id: "templates", label: "Template Pesan", icon: FileText },
      { id: "broadcast", label: "Broadcast", icon: Send },
      { id: "inbox", label: "Kotak Masuk", icon: MessageSquare },
      { id: "history", label: "Riwayat Broadcast", icon: History },
      { id: "billing", label: "Billing & Token", icon: CreditCard },
    ];

  // Formatting date for notification items
  const formatTimeAgo = (dateStr?: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return "Baru saja";
    if (diffMins < 60) return `${diffMins} m lalu`;
    if (diffHours < 24) return `${diffHours} jam lalu`;
    return date.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  };

  // Get notifications from activities (take top 5)
  const notifications = activities.slice(0, 5).map((act) => ({
    id: act.id || Math.random().toString(),
    text: act.message || "Aktivitas tercatat",
    time: formatTimeAgo(act.created_at || act.createdAt),
    read: false,
  }));

  // Get mail/numbers mock info
  const activeNumberItems = numbers.slice(0, 3).map((num) => ({
    id: num.id,
    name: num.name || "WhatsApp Business",
    phone: num.number || "-",
    unread: num.unreadCount || 0,
  }));

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-100 bg-white/80 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between px-6">
        {/* Brand Logo */}
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => onViewChange(isSuperadmin ? "superadmin" : "dashboard")}>
          <img src={logoFull} alt="Sipesa" className="h-9 w-auto object-contain" />
        </div>

        {/* Center Navigation links */}
        <nav className="hidden xl:flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id || (item.id === "history" && activeView === "broadcast-detail");
            return (
              <button
                key={item.id}
                onClick={() => {
                  onViewChange(item.id);
                  setShowProfileDropdown(false);
                  setShowNotifDropdown(false);
                  setShowMailDropdown(false);
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 relative ${isActive
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
              >
                <div className="relative">
                  <Icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-slate-400"}`} />
                  {item.id === "inbox" && totalUnread > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                  )}
                </div>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right Action Menu */}
        <div className="flex items-center gap-3">
          {/* Tambah Nomor WA Shortcut */}
          {!isSuperadmin && (
            <Button
              size="sm"
              onClick={() => onViewChange("add-number")}
              className="bg-primary hover:bg-primary/95 text-primary-foreground font-medium rounded-lg shadow-sm hidden md:flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              Tambah Nomor
            </Button>
          )}

          {/* Mail Dropdown (Inbox shortcuts) */}
          {!isSuperadmin && (
            <div className="relative" ref={mailRef}>
              <button
                onClick={() => {
                  setShowMailDropdown(!showMailDropdown);
                  setShowNotifDropdown(false);
                  setShowProfileDropdown(false);
                  setHasNewMessages(false); // Clear red dot when opened
                }}
                className="relative p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors"
              >
                <Mail className="w-5 h-5" />
                {hasNewMessages && (
                  <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                  </span>
                )}
              </button>

              {showMailDropdown && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-100 bg-white p-2 shadow-xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="px-3 py-2 border-b border-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Kotak Masuk WhatsApp
                  </div>
                  <div className="divide-y divide-slate-50 max-h-60 overflow-y-auto mt-1">
                    {activeNumberItems.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-slate-400">
                        Belum ada nomor WA terdaftar
                      </div>
                    ) : (
                      activeNumberItems.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            onViewChange("inbox");
                            setShowMailDropdown(false);
                          }}
                          className="w-full flex items-center justify-between text-left px-3 py-2.5 hover:bg-slate-50 rounded-lg transition-colors"
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <div className="text-sm font-medium text-slate-800 truncate">{item.name}</div>
                            <div className="text-xs text-slate-400 truncate">{item.phone}</div>
                          </div>
                          {item.unread > 0 && (
                            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                              {item.unread}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="mt-1 pt-1 border-t border-slate-50">
                    <button
                      onClick={() => {
                        onViewChange("inbox");
                        setShowMailDropdown(false);
                      }}
                      className="w-full text-center text-xs font-medium text-primary hover:text-primary/90 py-2"
                    >
                      Buka Semua Kotak Masuk
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notifications Dropdown */}
          {!isSuperadmin && (
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => {
                  setShowNotifDropdown(!showNotifDropdown);
                  setShowMailDropdown(false);
                  setShowProfileDropdown(false);
                  setHasNewNotifs(false); // Clear red dot when opened
                }}
                className="relative p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors"
              >
                <Bell className="w-5 h-5" />
                {hasNewNotifs && (
                  <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                  </span>
                )}
              </button>

              {showNotifDropdown && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-100 bg-white p-2 shadow-xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="px-3 py-2 border-b border-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Notifikasi Aktivitas
                  </div>
                  <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto mt-1">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-slate-400">
                        Tidak ada aktivitas baru
                      </div>
                    ) : (
                      notifications.map((notif) => (
                        <div key={notif.id} className="px-3 py-3 hover:bg-slate-50 rounded-lg transition-colors">
                          <p className="text-xs text-slate-700 leading-normal">{notif.text}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{notif.time}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-1 pt-1 border-t border-slate-50">
                    <button
                      onClick={() => {
                        onViewChange("dashboard");
                        setShowNotifDropdown(false);
                      }}
                      className="w-full text-center text-xs font-medium text-slate-600 hover:text-slate-900 py-2"
                    >
                      Tutup Notifikasi
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* User Profile Menu */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => {
                setShowProfileDropdown(!showProfileDropdown);
                setShowMailDropdown(false);
                setShowNotifDropdown(false);
              }}
              className="flex items-center gap-1.5 p-1 rounded-full hover:bg-slate-50 border border-slate-100 transition-colors"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 uppercase overflow-hidden">
                {avatar ? (
                  <img src={avatar} alt="Profile" className="h-full w-full object-cover" />
                ) : user?.name ? (
                  user.name.slice(0, 2)
                ) : (
                  <User className="w-4 h-4" />
                )}
              </div>
              <span className="hidden md:inline text-sm font-medium text-slate-700 pr-1 truncate max-w-[120px]">
                {user?.name || "Profil"}
              </span>
              <ChevronDown className="w-4 h-4 text-slate-400 hidden md:block" />
            </button>

            {showProfileDropdown && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-100 bg-white p-2 shadow-xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2 duration-200">
                {/* Profile brief summary */}
                <div className="px-3 py-2.5 border-b border-slate-50">
                  <div className="text-sm font-semibold text-slate-800">{user?.name || "Nama Pengguna"}</div>
                  <div className="text-xs text-slate-400 mt-0.5 truncate">{user?.email || "email@sekolah.sch.id"}</div>
                  {user?.org_name && (
                    <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/10 px-2 py-1 rounded-md w-fit max-w-full">
                      <Building className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{user.org_name}</span>
                    </div>
                  )}
                </div>

                {/* Profile actions */}
                {!isSuperadmin && (
                  <div className="mt-1 space-y-0.5">
                    <button
                      onClick={() => {
                        onViewChange("settings");
                        setShowProfileDropdown(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors"
                    >
                      <Settings className="w-4 h-4 text-slate-400" />
                      Pengaturan Akun
                    </button>

                    <button
                      onClick={() => {
                        onViewChange("add-number");
                        setShowProfileDropdown(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors md:hidden"
                    >
                      <Plus className="w-4 h-4 text-slate-400" />
                      Tambah Nomor WA
                    </button>
                  </div>
                )}

                <div className="mt-1 pt-1 border-t border-slate-50">
                  {onLogout && (
                    <button
                      onClick={() => {
                        setShowProfileDropdown(false);
                        onLogout();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50/50 rounded-lg transition-colors"
                    >
                      <LogOut className="w-4 h-4 text-red-400" />
                      Logout
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
