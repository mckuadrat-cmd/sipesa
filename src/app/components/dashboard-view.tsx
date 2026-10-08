import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
  AlertCircle,
  RefreshCcw,
} from "lucide-react";
import { api, DashboardBroadcastItem } from "../lib/api";

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

interface DashboardViewProps {
  stats?: DashboardStats;
  activities?: ActivityItem[];
  usage7d?: UsageItem[];
  tokenPrice?: number;
  user?: any;
  onViewChange?: (view: string) => void;
  statsState?: DashboardSectionState;
  usageState?: DashboardSectionState;
  onRetryStats?: () => void;
  onRetryUsage?: () => void;
}

interface DashboardSectionState {
  loading: boolean;
  hasData: boolean;
  error: boolean;
}

const SUCCESS_STATE: DashboardSectionState = { loading: false, hasData: true, error: false };

function SectionStateMessage({
  stale,
  onRetry,
}: {
  stale: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border p-3 text-xs ${stale ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700"}`} role="status">
      <span className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {stale ? "Data terakhir ditampilkan. Gagal memperbarui." : "Data belum dapat dimuat."}
      </span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-current/20 bg-white px-3 py-1.5 font-semibold hover:bg-white/70">
          <RefreshCcw className="h-3.5 w-3.5" />
          Coba Lagi
        </button>
      )}
    </div>
  );
}

function safeNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatUsageDateLabel(dateKey: string): string {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return new Date(year, month - 1, day).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function DashboardView({
  stats,
  activities = [],
  usage7d = [],
  tokenPrice = 0,
  user,
  onViewChange,
  statsState = SUCCESS_STATE,
  usageState = SUCCESS_STATE,
  onRetryStats,
  onRetryUsage,
}: DashboardViewProps) {
  const addressKey = user?.org_id ? `sipesa_address_${user.org_id}` : "sipesa_address";
  const totalMessages = safeNum(stats?.totalMessages);
  const totalContacts = safeNum(stats?.totalContacts);
  const tokensRemaining = safeNum(stats?.tokensRemaining);
  const tokensUsed = safeNum(stats?.tokensUsed);
  const activeNumbers = safeNum(stats?.activeNumbers);
  const canonicalTokenPrice = safeNum(tokenPrice);
  const usageCost = usage7d.reduce((sum, row) => sum + safeNum(row.amountIdr), 0);
  const usage7dTotal = usage7d.reduce((sum, row) => sum + safeNum(row.tokens), 0);
  const usage7dAverage = usage7dTotal / 7;

  const totalTokenBase = tokensUsed + tokensRemaining;
  const usagePercent = totalTokenBase > 0 ? (tokensRemaining / totalTokenBase) * 100 : 0;

  // Dynamic token status
  let tokenStatusTitle = "Token Tersedia";
  let tokenStatusDesc = "Sistem Kuota Aman";
  let progressColor = "#22c55e"; // Green

  if (tokensRemaining === 0) {
    tokenStatusTitle = "Token Habis";
    tokenStatusDesc = "Silakan top-up saldo";
    progressColor = "#ef4444"; // Red
  } else if (tokensRemaining < 100) {
    tokenStatusTitle = "Token Hampir Habis";
    tokenStatusDesc = "Kuota menipis";
    progressColor = "#f97316"; // Orange/Amber
  }

  // Calendar State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarBroadcasts, setCalendarBroadcasts] = useState<DashboardBroadcastItem[]>([]);
  const [recentBroadcasts, setRecentBroadcasts] = useState<DashboardBroadcastItem[]>([]);
  const [rangeTotalRecipients, setRangeTotalRecipients] = useState(0);
  const [summaryState, setSummaryState] = useState<DashboardSectionState>({ loading: true, hasData: false, error: false });
  const [calendarState, setCalendarState] = useState<DashboardSectionState>({ loading: true, hasData: false, error: false });
  const summaryRequestRef = useRef(0);
  const calendarRequestRef = useRef(0);

  // Date Filter State
  const [daysFilter, setDaysFilter] = useState("30");
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  const filteredTotalMessages = daysFilter === "all" ? totalMessages : rangeTotalRecipients;

  // Fetch only the authoritative aggregate and three recent rows for the
  // selected rolling range. No broadcast history page is used as a summary.
  const fetchSummary = useCallback(async () => {
      const requestVersion = ++summaryRequestRef.current;
      setSummaryState((previous) => ({ ...previous, loading: true, error: false }));
      try {
        let rangeStart: string | null = null;
        if (daysFilter !== "all") {
          const start = new Date();
          start.setDate(start.getDate() - Number(daysFilter));
          rangeStart = start.toISOString();
        }
        const result = await api.getDashboardBroadcastSummary(rangeStart);
        if (requestVersion !== summaryRequestRef.current) return;
        if (!result.success) throw new Error(result.error);
        setRangeTotalRecipients(result.data.totalRecipients);
        setRecentBroadcasts(result.data.recent);
        setSummaryState({ loading: false, hasData: true, error: false });
      } catch (err) {
        if (requestVersion !== summaryRequestRef.current) return;
        console.error("Error fetching broadcast summary for dashboard:", err);
        setSummaryState((previous) => ({ ...previous, loading: false, error: true }));
      }
  }, [daysFilter]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  // 1. Stat cards with modern pastel backgrounds
  const statCards = [
    {
      title: "Total Penerima",
      value: filteredTotalMessages >= 1000 ? `${(filteredTotalMessages / 1000).toFixed(1)}k` : filteredTotalMessages.toString(),
      subtext: daysFilter === "all" ? "Semua target campaign" : `Target campaign (${daysFilter} hari terakhir)`,
      icon: MessageSquare,
      bgColor: "bg-sky-50/70 border-sky-100/50",
      iconColor: "text-sky-500 bg-sky-100/80",
      state: daysFilter === "all" ? statsState : summaryState,
      retry: daysFilter === "all" ? onRetryStats : fetchSummary,
    },
    {
      title: "Token Tersisa",
      value: tokensRemaining.toLocaleString("id-ID"),
      subtext: canonicalTokenPrice > 0
        ? `Value: Rp ${(tokensRemaining * canonicalTokenPrice).toLocaleString("id-ID")}`
        : "Harga token belum tersedia",
      icon: Coins,
      bgColor: "bg-purple-50/70 border-purple-100/50",
      iconColor: "text-purple-500 bg-purple-100/80",
      state: statsState,
      retry: onRetryStats,
    },
    {
      title: "Kontak Aktif",
      value: totalContacts >= 1000 ? `${(totalContacts / 1000).toFixed(1)}k` : totalContacts.toString(),
      subtext: "Kontak terdaftar",
      icon: Users,
      bgColor: "bg-emerald-50/70 border-emerald-100/50",
      iconColor: "text-emerald-500 bg-emerald-100/80",
      state: statsState,
      retry: onRetryStats,
    },
    {
      title: "Nomor Aktif",
      value: activeNumbers.toString(),
      subtext: "WhatsApp terhubung",
      icon: TrendingUp,
      bgColor: "bg-amber-50/70 border-amber-100/50",
      iconColor: "text-amber-500 bg-amber-100/80",
      state: statsState,
      retry: onRetryStats,
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

  // The calendar always requests its visible 42-day grid and nothing outside
  // that bounded local-browser date range.
  const fetchCalendar = useCallback(async () => {
    const requestVersion = ++calendarRequestRef.current;
    setCalendarState((previous) => ({ ...previous, loading: true, error: false }));
    const gridStart = new Date(year, month, 1 - firstDayIndex);
    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridEnd.getDate() + 42);
    try {
      const result = await api.getDashboardBroadcastCalendar(gridStart.toISOString(), gridEnd.toISOString());
      if (requestVersion !== calendarRequestRef.current) return;
      if (!result.success) throw new Error(result.error);
      setCalendarBroadcasts(result.data);
      setCalendarState({ loading: false, hasData: true, error: false });
    } catch (error) {
      if (requestVersion !== calendarRequestRef.current) return;
      console.error("Error fetching broadcast calendar for dashboard:", error);
      setCalendarState((previous) => ({ ...previous, loading: false, error: true }));
    }
  }, [firstDayIndex, month, year]);

  useEffect(() => {
    void fetchCalendar();
  }, [fetchCalendar]);

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
    return calendarBroadcasts.some((broadcast) => {
      const effectiveAt = broadcast.scheduledAt || broadcast.createdAt;
      const date = new Date(effectiveAt);
      return Number.isFinite(date.getTime())
        && formatDateLocal(date.getFullYear(), date.getMonth(), date.getDate()) === dateStr;
    });
  };

  // The server already applies the selected range, deterministic ordering,
  // and a hard limit of three rows.
  const sortedSchedules = recentBroadcasts;

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
          <button
            type="button"
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            aria-expanded={showFilterDropdown}
            aria-haspopup="menu"
            className="flex items-center gap-1.5 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-500 bg-slate-50/50 hover:bg-slate-100 cursor-pointer transition-colors"
          >
            <span>{daysFilter === "all" ? "All Time" : `${daysFilter} Days`}</span>
            <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform ${showFilterDropdown ? "-rotate-90" : "rotate-90"}`} />
          </button>

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
                SIPESA adalah platform berbasis WhatsApp Business Platform (WABA) resmi dari Meta.
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
                  <span className="truncate">{localStorage.getItem(addressKey) || "Alamat belum diatur"}</span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* Circular Progress */}
                <div className="relative flex items-center justify-center">
                  <svg className="w-14 h-14 transform -rotate-90">
                    <circle cx="28" cy="28" r="23" stroke="#f1f5f9" strokeWidth="4" fill="transparent" />
                    <circle
                      cx="28"
                      cy="28"
                      r="23"
                      stroke={progressColor}
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
                  <p className="text-xs font-bold text-slate-700">{tokenStatusTitle}</p>
                  <p className="text-xs text-slate-400">{tokenStatusDesc}</p>
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
              className="w-full max-w-[280px] h-auto object-contain"
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
                  className={`p-5 border shadow-sm rounded-2xl flex flex-col justify-between ${card.bgColor}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-500">{card.title}</span>
                    <span className={`p-2.5 rounded-xl ${card.iconColor}`}>
                      <Icon className="w-4.5 h-4.5" />
                    </span>
                  </div>
                  <div>
                    {!card.state.hasData && card.state.loading ? (
                      <p className="text-xs text-slate-500" role="status">Memuat data...</p>
                    ) : !card.state.hasData && card.state.error ? (
                      <div className="space-y-2" role="status">
                        <p className="text-xs text-red-600">Data belum dapat dimuat.</p>
                        <button type="button" onClick={card.retry} className="text-xs font-semibold text-primary hover:underline">
                          Coba Lagi
                        </button>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-2xl font-bold text-slate-800 leading-none">{card.value}</h3>
                        <p className="text-xs text-slate-400 mt-1.5 break-words">{card.subtext}</p>
                        {card.state.error && (
                          <div className="mt-2 text-xs text-amber-700" role="status">
                            <p>Data terakhir ditampilkan. Gagal memperbarui.</p>
                            <button type="button" onClick={card.retry} className="mt-1 font-semibold hover:underline">Coba Lagi</button>
                          </div>
                        )}
                        {card.state.loading && card.state.hasData && !card.state.error && (
                          <p className="mt-2 text-xs text-slate-400" role="status">Memperbarui...</p>
                        )}
                      </>
                    )}
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
                  {usage7dTotal.toLocaleString("id-ID")} Terpakai
                </span>
              </div>
            </div>

            {/* Smooth line chart */}
            {usageState.error && <SectionStateMessage stale={usageState.hasData} onRetry={onRetryUsage} />}
            {usageState.loading && usageState.hasData && !usageState.error && (
              <p className="mb-2 text-xs text-slate-400" role="status">Memperbarui data penggunaan...</p>
            )}

            <div className="flex-1 flex items-center justify-center min-h-[160px] relative">
              {!usageState.hasData && usageState.loading ? (
                <p className="text-sm text-slate-400" role="status">Memuat data penggunaan...</p>
              ) : !usageState.hasData && usageState.error ? null : chartPoints.length === 0 ? (
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
                      <g key={i}>
                        <circle cx={p.x} cy={p.y} r="5" fill="#ffffff" stroke="#25d366" strokeWidth="3" />
                      </g>
                    ))}
                  </svg>

                  {/* X-Axis labels */}
                  <div className="flex justify-between px-6 mt-2">
                    {chartPoints.map((p, idx) => {
                      return (
                        <span key={idx} className="text-xs font-semibold text-slate-400">
                          {formatUsageDateLabel(p.label)}
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
                <p className="text-base font-bold text-slate-700">Rp {usageCost.toLocaleString("id-ID")}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Rata-rata / Hari (7 Hari)</p>
                <p className="text-base font-bold text-slate-700">{Math.round(usage7dAverage).toLocaleString("id-ID")} token</p>
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
                  type="button"
                  onClick={() => changeMonth("prev")}
                  aria-label="Bulan sebelumnya"
                  className="p-1.5 hover:bg-slate-50 border border-slate-100 rounded-lg text-slate-500 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => changeMonth("next")}
                  aria-label="Bulan berikutnya"
                  className="p-1.5 hover:bg-slate-50 border border-slate-100 rounded-lg text-slate-500 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {calendarState.error && (
              <div className="mb-3">
                <SectionStateMessage stale={calendarState.hasData} onRetry={fetchCalendar} />
              </div>
            )}
            {calendarState.loading && calendarState.hasData && !calendarState.error && (
              <p className="mb-3 text-xs text-slate-400" role="status">Memperbarui kalender...</p>
            )}

            {/* Days of Week header */}
            {calendarState.hasData && <div className="grid grid-cols-7 gap-y-2 text-center mb-2">
              {["M", "S", "S", "R", "K", "J", "S"].map((d, i) => (
                <span key={i} className="text-xs font-bold text-slate-400">
                  {d}
                </span>
              ))}
            </div>}

            {/* Calendar grid */}
            {!calendarState.hasData && calendarState.loading ? (
              <p className="py-10 text-center text-sm text-slate-400" role="status">Memuat kalender...</p>
            ) : !calendarState.hasData && calendarState.error ? null : <div className="grid grid-cols-7 gap-y-1 text-center">
              {allCalendarDays.map((cell, idx) => {
                const hasBroadcast = dayHasBroadcast(cell.dateStr);
                const isToday = cell.dateStr === todayStr;

                return (
                  <div
                    key={idx}
                    className="flex flex-col items-center justify-center py-1.5 relative"
                  >
                    <span
                      className={`text-xs w-7 h-7 flex items-center justify-center rounded-full font-medium transition-all ${cell.isCurrentMonth ? "text-slate-700" : "text-slate-300"
                        } ${isToday
                          ? "bg-primary text-primary-foreground font-bold shadow-sm"
                          : ""
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
            </div>}
          </Card>

          {/* Schedule & History campaigns list */}
          <Card className="p-5 border border-slate-100 shadow-sm rounded-2xl bg-white flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-800">Broadcast Terbaru</h3>
              {onViewChange && (
                <button
                  onClick={() => onViewChange("history")}
                  className="text-xs font-bold text-primary hover:underline"
                >
                  Lihat Semua
                </button>
              )}
            </div>

            {summaryState.error && (
              <div className="mb-3">
                <SectionStateMessage stale={summaryState.hasData} onRetry={fetchSummary} />
              </div>
            )}
            {summaryState.loading && summaryState.hasData && !summaryState.error && (
              <p className="mb-3 text-xs text-slate-400" role="status">Memperbarui kampanye...</p>
            )}

            <div className="space-y-3 flex-1 overflow-y-auto max-h-[280px] pr-1">
              {!summaryState.hasData && summaryState.loading ? (
                <p className="py-10 text-center text-sm text-slate-400" role="status">Memuat kampanye...</p>
              ) : !summaryState.hasData && summaryState.error ? null : sortedSchedules.length === 0 ? (
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
                      className="flex items-center justify-between p-3 border border-slate-50 rounded-xl"
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
                            {dateStr} | {timeStr} • {item.totalRecipients} penerima
                          </p>
                        </div>
                      </div>
                      {onViewChange && (
                        <button
                          type="button"
                          onClick={() => {
                            // View detail or history
                            onViewChange("history");
                          }}
                          aria-label={`Buka riwayat ${item.title || "broadcast"}`}
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
