import { useState, useEffect, useMemo } from "react";
import { Card } from "./ui/card";
import {
  MessageSquare,
  Users,
  Coins,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Building,
  User,
  Sparkles,
  ArrowRight,
  Clock,
  CheckCircle,
} from "lucide-react";
import { api } from "../lib/api";

interface DashboardStats {
  totalMessages?: number;
  totalContacts?: number;
  tokensRemaining?: number;
  tokensUsed?: number;
  activeNumbers?: number;
}

interface ActivityItem {
  id?: string;
  type?: string;
  message?: string;
  created_at?: string;
}

interface UsageItem {
  date: string;
  tokens: number;
  amountIdr?: number;
}

interface BroadcastHistoryItem {
  id: string;
  title: string;
  status: string;
  totalRecipients: number;
  createdAt: string;
  scheduledAt?: string | null;
}

interface DashboardViewProps {
  stats?: DashboardStats;
  activities?: ActivityItem[];
  usage7d?: UsageItem[];
  user?: any;
  onViewChange?: (view: string) => void;
}

function safeNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function DashboardView({
  stats,
  activities = [],
  usage7d = [],
  user,
  onViewChange,
}: DashboardViewProps) {
  const addressKey = user?.org_id ? `sipesa_address_${user.org_id}` : "sipesa_address";
  const totalMessages = safeNum(stats?.totalMessages);
  const totalContacts = safeNum(stats?.totalContacts);
  const tokensRemaining = safeNum(stats?.tokensRemaining);
  const tokensUsed = safeNum(stats?.tokensUsed);
  const activeNumbers = safeNum(stats?.activeNumbers);

  const totalTokenBase = tokensUsed + tokensRemaining;
  const usagePercent = totalTokenBase > 0 ? (tokensRemaining / totalTokenBase) * 100 : 80;

  // Calendar State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [broadcastHistory, setBroadcastHistory] = useState<BroadcastHistoryItem[]>([]);

  // Date Filter State
  const [daysFilter, setDaysFilter] = useState("30");
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // Filtered total messages sent in the day range
  const filteredTotalMessages = useMemo(() => {
    if (daysFilter === "all") {
      return totalMessages;
    }
    const daysLimit = Number(daysFilter);
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - daysLimit);

    const sum = broadcastHistory
      .filter((item) => new Date(item.createdAt).getTime() >= limitDate.getTime())
      .reduce((acc, item) => acc + safeNum(item.totalRecipients), 0);

    return sum;
  }, [broadcastHistory, daysFilter, totalMessages]);

  // Fetch Broadcast History for Calendar indicators and Schedule List
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const result = await api.getBroadcastHistory();
        if (result.success && Array.isArray(result.data)) {
          setBroadcastHistory(result.data);
        }
      } catch (err) {
        console.error("Error fetching broadcast history for dashboard:", err);
      }
    };
    fetchHistory();
  }, []);

  // 1. Stat cards with modern pastel backgrounds
  const statCards = [
    {
      title: "Total Pesan",
      value: filteredTotalMessages >= 1000 ? `${(filteredTotalMessages / 1000).toFixed(1)}k` : filteredTotalMessages.toString(),
      subtext: daysFilter === "all" ? "Semua pesan terkirim" : `Pesan terkirim (${daysFilter} hari terakhir)`,
      icon: MessageSquare,
      bgColor: "bg-sky-50/70 border-sky-100/50",
      iconColor: "text-sky-500 bg-sky-100/80",
    },
    {
      title: "Token Tersisa",
      value: tokensRemaining.toLocaleString("id-ID"),
      subtext: `Value: Rp ${(tokensRemaining * 1500).toLocaleString("id-ID")}`,
      icon: Coins,
      bgColor: "bg-purple-50/70 border-purple-100/50",
      iconColor: "text-purple-500 bg-purple-100/80",
    },
    {
      title: "Kontak Aktif",
      value: totalContacts >= 1000 ? `${(totalContacts / 1000).toFixed(1)}k` : totalContacts.toString(),
      subtext: "Kontak terdaftar",
      icon: Users,
      bgColor: "bg-emerald-50/70 border-emerald-100/50",
      iconColor: "text-emerald-500 bg-emerald-100/80",
    },
    {
      title: "Nomor Aktif",
      value: activeNumbers.toString(),
      subtext: "WhatsApp terhubung",
      icon: TrendingUp,
      bgColor: "bg-amber-50/70 border-amber-100/50",
      iconColor: "text-amber-500 bg-amber-100/80",
    },
  ];

  // 2. Generate smooth bezier curve coordinates for the SVG usage chart
  const chartPoints = useMemo(() => {
    if (usage7d.length === 0) return [];

    const width = 500;
    const height = 140;
    const paddingX = 40;
    const paddingY = 20;

    const maxVal = Math.max(1, ...usage7d.map((x) => safeNum(x.tokens)));

    return usage7d.map((item, idx) => {
      const x = paddingX + (idx * (width - 2 * paddingX)) / Math.max(1, usage7d.length - 1);
      const y = height - paddingY - (safeNum(item.tokens) / maxVal) * (height - 2 * paddingY);
      return { x, y, tokens: item.tokens, label: item.date };
    });
  }, [usage7d]);

  const chartPath = useMemo(() => {
    if (chartPoints.length === 0) return "";
    let path = `M ${chartPoints[0].x} ${chartPoints[0].y}`;
    for (let i = 1; i < chartPoints.length; i++) {
      const prev = chartPoints[i - 1];
      const curr = chartPoints[i];
      const cpX1 = prev.x + (curr.x - prev.x) / 2;
      const cpY1 = prev.y;
      const cpX2 = prev.x + (curr.x - prev.x) / 2;
      const cpY2 = curr.y;
      path += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${curr.x} ${curr.y}`;
    }
    return path;
  }, [chartPoints]);

  const chartAreaPath = useMemo(() => {
    if (chartPoints.length === 0) return "";
    const height = 140;
    return `${chartPath} L ${chartPoints[chartPoints.length - 1].x} ${height - 20} L ${chartPoints[0].x} ${height - 20} Z`;
  }, [chartPath, chartPoints]);

  // 3. Calendar helpers
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const formatDateLocal = (y: number, m: number, d: number) => {
    const mm = String(m + 1).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  };

  const today = new Date();
  const todayStr = formatDateLocal(today.getFullYear(), today.getMonth(), today.getDate());

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay();

  const prevMonthDays = Array.from({ length: firstDayIndex }, (_, i) => {
    const d = new Date(year, month, -i);
    return {
      day: d.getDate(),
      isCurrentMonth: false,
      dateStr: formatDateLocal(d.getFullYear(), d.getMonth(), d.getDate())
    };
  }).reverse();

  const currentMonthDays = Array.from({ length: daysInMonth }, (_, i) => {
    const dayNum = i + 1;
    const d = new Date(year, month, dayNum);
    return {
      day: dayNum,
      isCurrentMonth: true,
      dateStr: formatDateLocal(d.getFullYear(), d.getMonth(), d.getDate())
    };
  });

  const nextMonthDaysCount = 42 - (prevMonthDays.length + currentMonthDays.length);
  const nextMonthDays = Array.from({ length: nextMonthDaysCount }, (_, i) => {
    const dayNum = i + 1;
    const d = new Date(year, month + 1, dayNum);
    return {
      day: dayNum,
      isCurrentMonth: false,
      dateStr: formatDateLocal(d.getFullYear(), d.getMonth(), d.getDate())
    };
  });

  const allCalendarDays = [...prevMonthDays, ...currentMonthDays, ...nextMonthDays];

  const changeMonth = (direction: "prev" | "next") => {
    const nextDate = new Date(currentDate);
    nextDate.setMonth(currentDate.getMonth() + (direction === "next" ? 1 : -1));
    setCurrentDate(nextDate);
  };

  const getCalendarMonthLabel = () => {
    return currentDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  };

  // Check if a calendar day has broadcasts
  const dayHasBroadcast = (dateStr: string) => {
    return broadcastHistory.some((b) => {
      const bDate = (b.scheduledAt || b.createdAt || "").split("T")[0];
      return bDate === dateStr;
    });
  };

  // 4. Upcoming schedules or recent history campaigns (top 3)
  const sortedSchedules = useMemo(() => {
    let list = [...broadcastHistory];
    if (daysFilter !== "all") {
      const daysLimit = Number(daysFilter);
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() - daysLimit);
      list = list.filter((item) => new Date(item.createdAt).getTime() >= limitDate.getTime());
    }
    return list
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3);
  }, [broadcastHistory, daysFilter]);

  return (
    <div className="w-full p-6 md:p-8 bg-white min-h-screen">
      {/* Dashboard Title Header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1.5 leading-relaxed break-words whitespace-normal max-w-2xl">
            Kelola WABA sekolah Anda.
          </p>
        </div>

        {/* Date Filter selector dropdown matching reference image */}
        <div className="relative">
          <div
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            className="flex items-center gap-1.5 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-500 bg-slate-50/50 hover:bg-slate-100 cursor-pointer transition-colors"
          >
            <span>{daysFilter === "all" ? "All Time" : `${daysFilter} Days`}</span>
            <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform ${showFilterDropdown ? "-rotate-90" : "rotate-90"}`} />
          </div>

          {showFilterDropdown && (
            <div className="absolute right-0 mt-1.5 w-32 bg-white border border-slate-100 rounded-xl shadow-xl z-50 p-1 flex flex-col space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
              {[
                { label: "7 Days", value: "7" },
                { label: "30 Days", value: "30" },
                { label: "90 Days", value: "90" },
                { label: "All Time", value: "all" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setDaysFilter(opt.value);
                    setShowFilterDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs font-medium rounded-lg transition-colors ${daysFilter === opt.value
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.8fr_1.3fr] gap-8">
        {/* LEFT COLUMN: Welcome Profile & Illustration */}
        <div className="flex flex-col gap-6">
          {/* Welcome Profile Card */}
          <Card className="p-6 relative overflow-hidden bg-gradient-to-br from-slate-50 to-white border border-slate-100 shadow-sm rounded-2xl flex flex-col justify-between min-h-[300px]">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl -mr-10 -mt-10" />

            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="w-4 h-4" />
                </span>
                <span className="text-xs font-semibold tracking-wide text-primary uppercase">Workspace</span>
              </div>

              <h2 className="text-2xl font-bold text-slate-800 leading-tight">
                Hai, {user?.name || "Saepul R."}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Semua sistem operasional dan gateway WABA Meta Anda berjalan normal.
              </p>

              <div className="mt-5 space-y-2 border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Building className="w-4 h-4 text-slate-400" />
                  <span className="font-medium truncate">{user?.org_name || "Institusi Sipesa"}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <User className="w-4 h-4 text-slate-400" />
                  <span className="truncate">Administrator</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <MapPin className="w-4 h-4 text-slate-400" />
                  <span className="truncate">{localStorage.getItem(addressKey) || "Jl. Raya Sekolah No. 123, Jakarta"}</span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* Circular Progress (Green) */}
                <div className="relative flex items-center justify-center">
                  <svg className="w-14 h-14 transform -rotate-90">
                    <circle cx="28" cy="28" r="23" stroke="#f1f5f9" strokeWidth="4" fill="transparent" />
                    <circle
                      cx="28"
                      cy="28"
                      r="23"
                      stroke="#22c55e"
                      strokeWidth="4"
                      fill="transparent"
                      strokeDasharray={2 * Math.PI * 23}
                      strokeDashoffset={2 * Math.PI * 23 * (1 - usagePercent / 100)}
                      strokeLinecap="round"
                      className="transition-all duration-500"
                    />
                  </svg>
                  <span className="absolute text-xs font-bold text-slate-700">{Math.round(usagePercent)}%</span>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-700">Token Ready</p>
                  <p className="text-xs text-slate-400">Sistem Kuota Aman</p>
                </div>
              </div>

              {onViewChange && (
                <button
                  onClick={() => onViewChange("broadcast")}
                  className="flex h-10 px-4 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/95 font-medium text-xs shadow-sm transition-all"
                >
                  Kirim Broadcast
                </button>
              )}
            </div>
          </Card>

          {/* Dashboard Illustration Box */}
          <Card className="flex-1 overflow-hidden border border-slate-100 shadow-sm rounded-2xl bg-white p-4 flex flex-col items-center justify-center">
            <img
              src="/dashboard_illustration.png"
              alt="Sipesa Illustration"
              className="w-full max-w-[280px] h-auto object-contain transition-transform hover:scale-105 duration-300"
            />
          </Card>
        </div>

        {/* MIDDLE COLUMN: Stats Grid & Smooth bezier chart */}
        <div className="flex flex-col gap-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4">
            {statCards.map((card) => {
              const Icon = card.icon;
              return (
                <Card
                  key={card.title}
                  className={`p-5 border shadow-sm rounded-2xl flex flex-col justify-between transition-all hover:-translate-y-0.5 duration-200 ${card.bgColor}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-500">{card.title}</span>
                    <span className={`p-2.5 rounded-xl ${card.iconColor}`}>
                      <Icon className="w-4.5 h-4.5" />
                    </span>
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-slate-800 leading-none">{card.value}</h3>
                    <p className="text-xs text-slate-400 mt-1.5 truncate">{card.subtext}</p>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* SVG Bezier curve line chart card */}
          <Card className="p-6 border border-slate-100 shadow-sm rounded-2xl bg-white flex flex-col justify-between flex-1">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Statistik Penggunaan Token</h3>
                <p className="text-xs text-slate-400 mt-0.5">Pemakaian 7 hari terakhir</p>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-md">
                  {tokensUsed.toLocaleString("id-ID")} Terpakai
                </span>
              </div>
            </div>

            {/* Smooth line chart */}
            <div className="flex-1 flex items-center justify-center min-h-[160px] relative">
              {chartPoints.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm text-slate-400">Belum ada data pemakaian.</p>
                </div>
              ) : (
                <div className="w-full">
                  <svg viewBox="0 0 500 140" className="w-full h-auto overflow-visible">
                    <defs>
                      <linearGradient id="chart-area-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#25d366" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#25d366" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Grid lines */}
                    <line x1="40" y1="20" x2="460" y2="20" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
                    <line x1="40" y1="60" x2="460" y2="60" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
                    <line x1="40" y1="100" x2="460" y2="100" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
                    <line x1="40" y1="120" x2="460" y2="120" stroke="#e2e8f0" strokeWidth="1" />

                    {/* Area fill under curve */}
                    <path d={chartAreaPath} fill="url(#chart-area-grad)" />

                    {/* Smooth bezier stroke */}
                    <path d={chartPath} fill="none" stroke="#25d366" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />

                    {/* Dots at vertices */}
                    {chartPoints.map((p, i) => (
                      <g key={i} className="group cursor-pointer">
                        <circle cx={p.x} cy={p.y} r="5" fill="#ffffff" stroke="#25d366" strokeWidth="3" />
                        <circle cx={p.x} cy={p.y} r="10" fill="#25d366" className="opacity-0 group-hover:opacity-20 transition-opacity" />
                      </g>
                    ))}
                  </svg>

                  {/* X-Axis labels */}
                  <div className="flex justify-between px-6 mt-2">
                    {chartPoints.map((p, idx) => {
                      const date = new Date(p.label);
                      const labelStr = date.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit" });
                      return (
                        <span key={idx} className="text-xs font-semibold text-slate-400">
                          {labelStr}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-50 mt-4">
              <div>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Total Biaya</p>
                <p className="text-base font-bold text-slate-700">Rp {(tokensUsed * 1500).toLocaleString("id-ID")}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Rata-rata Harian</p>
                <p className="text-base font-bold text-slate-700">{Math.round(tokensUsed / 7).toLocaleString("id-ID")} token</p>
              </div>
            </div>
          </Card>
        </div>

        {/* RIGHT COLUMN: Calendar Widget & Upcoming Campaigns */}
        <div className="flex flex-col gap-6">
          {/* Calendar Card */}
          <Card className="p-5 border border-slate-100 shadow-sm rounded-2xl bg-white">
            {/* Calendar Header */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold text-slate-800">{getCalendarMonthLabel()}</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => changeMonth("prev")}
                  className="p-1.5 hover:bg-slate-50 border border-slate-100 rounded-lg text-slate-500 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => changeMonth("next")}
                  className="p-1.5 hover:bg-slate-50 border border-slate-100 rounded-lg text-slate-500 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Days of Week header */}
            <div className="grid grid-cols-7 gap-y-2 text-center mb-2">
              {["M", "S", "S", "R", "K", "J", "S"].map((d, i) => (
                <span key={i} className="text-xs font-bold text-slate-400">
                  {d}
                </span>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-y-1 text-center">
              {allCalendarDays.map((cell, idx) => {
                const hasBroadcast = dayHasBroadcast(cell.dateStr);
                const isToday = cell.dateStr === todayStr;

                return (
                  <div
                    key={idx}
                    className="flex flex-col items-center justify-center py-1.5 relative cursor-pointer group"
                  >
                    <span
                      className={`text-xs w-7 h-7 flex items-center justify-center rounded-full font-medium transition-all ${cell.isCurrentMonth ? "text-slate-700" : "text-slate-300"
                        } ${isToday
                          ? "bg-primary text-primary-foreground font-bold shadow-sm"
                          : "hover:bg-slate-50"
                        }`}
                    >
                      {cell.day}
                    </span>

                    {/* Broadcast indicator dot */}
                    {hasBroadcast && !isToday && (
                      <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Schedule & History campaigns list */}
          <Card className="p-5 border border-slate-100 shadow-sm rounded-2xl bg-white flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-800">Kampanye Terbaru</h3>
              {onViewChange && (
                <button
                  onClick={() => onViewChange("history")}
                  className="text-xs font-bold text-primary hover:underline"
                >
                  Lihat Semua
                </button>
              )}
            </div>

            <div className="space-y-3 flex-1 overflow-y-auto max-h-[280px] pr-1">
              {sortedSchedules.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center h-full">
                  <Clock className="w-8 h-8 text-slate-300 mb-2" />
                  <p className="text-xs text-slate-400">Belum ada riwayat broadcast</p>
                </div>
              ) : (
                sortedSchedules.map((item) => {
                  const date = new Date(item.createdAt);
                  const timeStr = date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
                  const dateStr = date.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });

                  const isScheduled = item.status === "scheduled";

                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 border border-slate-50 hover:bg-slate-50/50 rounded-xl transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Icon representation */}
                        <span className={`flex h-9 w-9 items-center justify-center rounded-xl flex-shrink-0 ${isScheduled ? "bg-blue-50 text-blue-500" : "bg-emerald-50 text-emerald-500"
                          }`}>
                          {isScheduled ? <Clock className="w-4.5 h-4.5" /> : <CheckCircle className="w-4.5 h-4.5" />}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-700 truncate">
                            {item.title || "Broadcast Pesan"}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {dateStr} | {timeStr} • {item.totalRecipients} Kontak
                          </p>
                        </div>
                      </div>
                      {onViewChange && (
                        <button
                          onClick={() => {
                            // View detail or history
                            onViewChange("history");
                          }}
                          className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}