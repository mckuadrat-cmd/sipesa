import { useState } from "react";
import {
  Scale,
  ShieldAlert,
  Search,
  BookOpen,
  CheckCircle,
  AlertTriangle,
  UserCheck,
  UserX,
  ShieldCheck,
  Ban,
  ArrowLeft,
  ChevronRight,
  Info,
  ExternalLink,
} from "lucide-react";
import { Card } from "./ui/card";

interface RulesViewProps {
  onBack?: () => void;
}

export function RulesView({ onBack }: RulesViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "tujuan" | "ketentuan" | "larangan" | "hak-tanggung-jawab" | "sanksi">("all");

  const rulesData = {
    tujuan: {
      title: "Tujuan Penggunaan",
      icon: ShieldCheck,
      color: "text-emerald-600 bg-emerald-50 border-emerald-100",
      content: [
        "Fitur Broadcast WhatsApp disediakan untuk membantu pengguna menyampaikan informasi, pemberitahuan, pengingat, layanan pelanggan, promosi, maupun komunikasi bisnis secara efektif kepada pelanggan yang telah memiliki hubungan sebelumnya dengan pengguna.",
        "Seluruh pengiriman pesan melalui platform ini menggunakan WhatsApp Business Platform (WABA) resmi dan Template Message yang telah mendapatkan persetujuan dari Meta.",
      ],
    },
    ketentuan: {
      title: "Ketentuan Penggunaan",
      icon: UserCheck,
      color: "text-sky-600 bg-sky-50 border-sky-100",
      subsections: [
        {
          title: "1. Penerima Pesan Merupakan Kontak yang Relevan",
          items: [
            "Telah menjadi pelanggan, anggota, peserta, atau kontak resmi pengguna.",
            "Pernah berinteraksi dengan bisnis atau organisasi pengguna.",
            "Telah memberikan nomor WhatsApp kepada pengguna melalui proses yang sah.",
            "Memiliki hubungan yang relevan dengan informasi yang dikirimkan.",
          ],
        },
        {
          title: "2. Memiliki Persetujuan atau Dasar Komunikasi yang Wajar",
          items: [
            "Pengguna bertanggung jawab memastikan bahwa penerima mengetahui nomor WhatsApp mereka digunakan untuk komunikasi bisnis atau layanan.",
            "Penerima tidak keberatan menerima informasi yang berkaitan dengan produk, layanan, kegiatan, atau komunikasi operasional dari pengguna.",
          ],
        },
        {
          title: "3. Menggunakan Template Resmi Meta",
          items: [
            "Seluruh pesan broadcast wajib menggunakan Template Message yang telah disetujui oleh Meta.",
            "Pengguna tidak diperkenankan melakukan modifikasi atau penggunaan template yang bertentangan dengan kebijakan WhatsApp Business Platform.",
          ],
        },
        {
          title: "4. Menyampaikan Informasi yang Relevan",
          items: [
            "Pesan yang dikirim harus sesuai dengan kebutuhan penerima.",
            "Pesan tidak menyesatkan dan tidak mengandung informasi palsu.",
            "Pesan tidak mengandung unsur penipuan, manipulasi, atau klaim yang tidak dapat dipertanggungjawabkan.",
          ],
        },
      ],
    },
    larangan: {
      title: "Larangan Penggunaan",
      icon: AlertTriangle,
      color: "text-amber-600 bg-amber-50 border-amber-100",
      subsections: [
        {
          title: "1. Pengiriman Spam",
          items: [
            "Pengiriman pesan massal kepada penerima yang tidak dikenal.",
            "Pengiriman berulang secara berlebihan.",
            "Pengiriman pesan yang tidak relevan dengan penerima.",
          ],
        },
        {
          title: "2. Penggunaan Database Tidak Sah",
          items: [
            "Membeli database nomor telepon.",
            "Mengambil nomor dari internet tanpa izin.",
            "Mengumpulkan nomor melalui scraping atau metode tidak sah lainnya.",
          ],
        },
        {
          title: "3. Konten Terlarang",
          items: [
            "Dilarang mengirimkan pesan yang mengandung penipuan atau judi.",
            "Dilarang mengirimkan malware atau tautan berbahaya.",
            "Dilarang mengirimkan konten ilegal, ujaran kebencian, atau pelanggaran hak cipta.",
            "Dilarang mengirimkan konten yang melanggar hukum yang berlaku.",
          ],
        },
        {
          title: "4. Upaya Mengakali Kebijakan WhatsApp",
          items: [
            "Mengirim template yang tidak sesuai tujuan persetujuannya.",
            "Menggunakan bahasa yang menyesatkan untuk meningkatkan respons.",
            "Menghindari mekanisme pelaporan atau penghentian langganan penerima.",
          ],
        },
      ],
    },
    hakTanggungJawab: {
      title: "Hak Penerima & Tanggung Jawab",
      icon: UserX,
      color: "text-indigo-600 bg-indigo-50 border-indigo-100",
      sections: [
        {
          title: "Hak Penerima Pesan",
          desc: "Setiap penerima berhak untuk mengabaikan pesan yang diterima, meminta penghentian komunikasi, memblokir nomor pengirim, serta melaporkan pesan yang dianggap tidak relevan atau mengganggu. Pengguna wajib menghormati permintaan penghentian komunikasi dari penerima.",
        },
        {
          title: "Tanggung Jawab Pengguna",
          desc: "Pengguna bertanggung jawab penuh atas daftar kontak yang digunakan, isi pesan yang dikirim, dan kepatuhan terhadap kebijakan Meta, WhatsApp Business Platform, serta peraturan perundang-undangan yang berlaku. Platform hanya menyediakan sarana pengiriman pesan dan tidak bertanggung jawab atas pelanggaran yang dilakukan oleh pengguna.",
        },
      ],
    },
    sanksi: {
      title: "Sanksi Pelanggaran",
      icon: Ban,
      color: "text-red-600 bg-red-50 border-red-100",
      content: [
        "Kami berhak membatasi, menangguhkan, atau menghentikan akses pengguna apabila ditemukan penggunaan yang melanggar kebijakan ini.",
        "Sanksi juga berlaku jika ditemukan tingkat keluhan atau laporan spam yang tinggi dari penerima.",
        "Aktivitas apa pun yang berpotensi merugikan penerima, platform, maupun ekosistem WhatsApp Business akan ditindak tegas dengan penutupan akun.",
      ],
    },
  };

  // Helper filter function
  const matchesSearch = (text: string) => {
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  };

  const hasMatchingContent = (sectionKey: keyof typeof rulesData) => {
    if (!searchQuery) return true;
    const sec = rulesData[sectionKey];
    
    // Check main title
    if (matchesSearch(sec.title)) return true;

    // Check main content array if exists
    if ("content" in sec && sec.content) {
      if (sec.content.some(text => matchesSearch(text))) return true;
    }

    // Check subsections if exists
    if ("subsections" in sec && sec.subsections) {
      return sec.subsections.some(sub => 
        matchesSearch(sub.title) || sub.items.some(item => matchesSearch(item))
      );
    }

    // Check sections if exists
    if ("sections" in sec && sec.sections) {
      return sec.sections.some(s => 
        matchesSearch(s.title) || matchesSearch(s.desc)
      );
    }

    return false;
  };

  return (
    <div className="bg-slate-50/50 min-h-screen pb-16">
      {/* PROMINENT HEADER WITH GRADIENT AND PATTERN */}
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white py-12 px-6 md:px-12 shadow-md">
        {/* Background elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl -mr-20 -mt-20 opacity-60" />
        <div className="absolute -bottom-10 left-10 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl opacity-40" />
        
        {/* Subtle grid pattern Overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-3">
              {/* Back Link if nested view */}
              {onBack && (
                <button
                  onClick={onBack}
                  className="inline-flex items-center gap-1.5 text-slate-300 hover:text-white transition-colors text-xs font-semibold mb-2 bg-white/10 hover:bg-white/15 px-3 py-1.5 rounded-lg backdrop-blur-sm"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Kembali
                </button>
              )}

              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold tracking-wide backdrop-blur-sm">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Meta WABA Compliance Policy
              </div>
              
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
                Kebijakan Penggunaan Fitur Broadcast WhatsApp
              </h1>
              
              <p className="text-slate-300 max-w-3xl text-sm md:text-base font-normal leading-relaxed">
                Panduan resmi dan ketentuan hukum untuk menjaga kepatuhan, keandalan, dan reputasi pengiriman pesan bisnis Anda melalui platform WhatsApp Business resmi (WABA).
              </p>
            </div>

            <div className="flex-shrink-0 bg-white/5 border border-white/10 backdrop-blur-md rounded-2xl p-5 md:max-w-xs">
              <div className="flex items-center gap-2 mb-2">
                <Scale className="w-5 h-5 text-primary" />
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Status Akun</span>
              </div>
              <p className="text-xs text-slate-300">
                Setiap pengguna wajib mematuhi ketentuan ini. Pelanggaran berulang dapat mengakibatkan penangguhan permanen oleh Meta atau pihak Sipesa.
              </p>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-400 font-bold">
                <ShieldCheck className="w-4 h-4" />
                <span>Terintegrasi dengan Kebijakan Meta 2026</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FILTER & SEARCH BAR */}
      <div className="max-w-6xl mx-auto px-6 mt-8">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
          {/* Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
            {[
              { id: "all", label: "Semua Kebijakan" },
              { id: "tujuan", label: "Tujuan" },
              { id: "ketentuan", label: "Ketentuan" },
              { id: "larangan", label: "Larangan" },
              { id: "hak-tanggung-jawab", label: "Hak & Tanggung Jawab" },
              { id: "sanksi", label: "Sanksi" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                  activeTab === tab.id
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Cari peraturan..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-slate-400 text-slate-700"
            />
          </div>
        </div>
      </div>

      {/* RULES CONTENT CONTAINER */}
      <div className="max-w-6xl mx-auto px-6 mt-6 grid grid-cols-1 gap-6">
        
        {/* TUJUAN PENGGUNAAN */}
        {(activeTab === "all" || activeTab === "tujuan") && hasMatchingContent("tujuan") && (
          <Card className="p-6 md:p-8 bg-white border border-slate-100 hover:border-emerald-100 hover:shadow-md transition-all duration-300 rounded-2xl group">
            <div className="flex items-start gap-4">
              <span className={`p-3 rounded-2xl border ${rulesData.tujuan.color} group-hover:scale-105 transition-transform duration-300`}>
                <ShieldCheck className="w-6 h-6" />
              </span>
              <div className="space-y-3 flex-1">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  {rulesData.tujuan.title}
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-600 font-semibold px-2 py-0.5 rounded-full">Penting</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {rulesData.tujuan.content.map((p, i) => (
                    <p key={i} className="text-slate-600 text-sm leading-relaxed font-normal bg-slate-50/30 p-3.5 rounded-xl border border-slate-50">
                      {p}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* KETENTUAN PENGGUNAAN */}
        {(activeTab === "all" || activeTab === "ketentuan") && hasMatchingContent("ketentuan") && (
          <Card className="p-6 md:p-8 bg-white border border-slate-100 hover:border-sky-100 hover:shadow-md transition-all duration-300 rounded-2xl group">
            <div className="flex items-start gap-4">
              <span className={`p-3 rounded-2xl border ${rulesData.ketentuan.color} group-hover:scale-105 transition-transform duration-300`}>
                <UserCheck className="w-6 h-6" />
              </span>
              <div className="space-y-4 flex-1">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">
                    {rulesData.ketentuan.title}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">Syarat mutlak pengiriman pesan broadcast</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                  {rulesData.ketentuan.subsections.map((sub, idx) => {
                    const isSubMatch = matchesSearch(sub.title) || sub.items.some(item => matchesSearch(item));
                    if (!isSubMatch) return null;

                    return (
                      <div key={idx} className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 flex flex-col justify-between hover:bg-slate-50 transition-colors">
                        <div>
                          <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center justify-between">
                            <span>{sub.title}</span>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                          </h3>
                          <ul className="space-y-2">
                            {sub.items.map((item, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-slate-600 leading-relaxed">
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* LARANGAN PENGGUNAAN */}
        {(activeTab === "all" || activeTab === "larangan") && hasMatchingContent("larangan") && (
          <Card className="p-6 md:p-8 bg-white border border-slate-100 hover:border-amber-100 hover:shadow-md transition-all duration-300 rounded-2xl group">
            <div className="flex items-start gap-4">
              <span className={`p-3 rounded-2xl border ${rulesData.larangan.color} group-hover:scale-105 transition-transform duration-300`}>
                <AlertTriangle className="w-6 h-6" />
              </span>
              <div className="space-y-4 flex-1">
                <div>
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    {rulesData.larangan.title}
                    <span className="text-[10px] bg-amber-500/10 text-amber-600 font-semibold px-2 py-0.5 rounded-full">Dilarang</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">Tindakan berikut akan memicu pemblokiran otomatis oleh WhatsApp</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                  {rulesData.larangan.subsections.map((sub, idx) => {
                    const isSubMatch = matchesSearch(sub.title) || sub.items.some(item => matchesSearch(item));
                    if (!isSubMatch) return null;

                    return (
                      <div key={idx} className="bg-amber-50/20 p-5 rounded-2xl border border-amber-100/30 flex flex-col justify-between hover:bg-amber-50/30 transition-colors">
                        <div>
                          <h3 className="text-sm font-bold text-amber-900 mb-3 flex items-center justify-between">
                            <span>{sub.title}</span>
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          </h3>
                          <ul className="space-y-2">
                            {sub.items.map((item, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-amber-800 leading-relaxed">
                                <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-200/60 text-amber-700 font-bold text-[8px] flex-shrink-0 mt-0.5">X</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* HAK PENERIMA & TANGGUNG JAWAB PENGGUNA */}
        {(activeTab === "all" || activeTab === "hak-tanggung-jawab") && hasMatchingContent("hakTanggungJawab") && (
          <Card className="p-6 md:p-8 bg-white border border-slate-100 hover:border-indigo-100 hover:shadow-md transition-all duration-300 rounded-2xl group">
            <div className="flex items-start gap-4">
              <span className={`p-3 rounded-2xl border ${rulesData.hakTanggungJawab.color} group-hover:scale-105 transition-transform duration-300`}>
                <UserX className="w-6 h-6" />
              </span>
              <div className="space-y-4 flex-1">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">
                    {rulesData.hakTanggungJawab.title}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">Keseimbangan hak konsumen dan kewajiban pengirim</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                  {rulesData.hakTanggungJawab.sections.map((sec, idx) => {
                    const isSecMatch = matchesSearch(sec.title) || matchesSearch(sec.desc);
                    if (!isSecMatch) return null;

                    return (
                      <div key={idx} className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 flex flex-col justify-between hover:bg-slate-50 transition-colors">
                        <div>
                          <h3 className="text-sm font-bold text-slate-800 mb-2.5 flex items-center justify-between">
                            <span>{sec.title}</span>
                            <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-md">Regulasi</span>
                          </h3>
                          <p className="text-xs text-slate-600 leading-relaxed font-normal">
                            {sec.desc}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* SANKSI PELANGGARAN */}
        {(activeTab === "all" || activeTab === "sanksi") && hasMatchingContent("sanksi") && (
          <Card className="p-6 md:p-8 bg-white border border-slate-100 hover:border-red-100 hover:shadow-md transition-all duration-300 rounded-2xl group">
            <div className="flex items-start gap-4">
              <span className={`p-3 rounded-2xl border ${rulesData.sanksi.color} group-hover:scale-105 transition-transform duration-300`}>
                <Ban className="w-6 h-6" />
              </span>
              <div className="space-y-4 flex-1">
                <div>
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    {rulesData.sanksi.title}
                    <span className="text-[10px] bg-red-500/10 text-red-600 font-semibold px-2 py-0.5 rounded-full">Kritikal</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">Konsekuensi hukum dan teknis jika melanggar ketentuan</p>
                </div>

                <div className="bg-red-50/30 p-5 border border-red-100/50 rounded-2xl space-y-3.5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {rulesData.sanksi.content.map((text, idx) => (
                      <div key={idx} className="flex gap-2 text-xs text-red-800 leading-relaxed bg-white/70 p-3.5 rounded-xl border border-red-100/30 shadow-sm">
                        <span className="text-red-500 font-bold text-sm leading-none">•</span>
                        <span>{text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* PENUTUP (Only show when tab is all) */}
        {activeTab === "all" && !searchQuery && (
          <div className="bg-gradient-to-r from-indigo-900 to-slate-900 text-white rounded-2xl p-6 md:p-8 mt-4 relative overflow-hidden border border-slate-800">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-2xl pointer-events-none" />
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                  <Info className="w-4 h-4" />
                  <span>Kesimpulan</span>
                </div>
                <h3 className="text-lg md:text-xl font-bold">Mari Ciptakan Komunikasi yang Relevan</h3>
                <p className="text-slate-300 text-xs md:text-sm max-w-3xl leading-relaxed">
                  Kami mendorong setiap pengguna untuk menggunakan fitur Broadcast WhatsApp secara bertanggung jawab, profesional, dan berorientasi pada manfaat bagi penerima pesan. Komunikasi yang relevan dan berkualitas akan membantu menjaga reputasi bisnis, meningkatkan kepercayaan pelanggan, serta mendukung keberlangsungan layanan WhatsApp Business Platform.
                </p>
              </div>

              <div className="flex-shrink-0">
                <a
                  href="https://developers.facebook.com/docs/whatsapp/policies"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 bg-primary hover:bg-primary/95 text-white text-xs font-semibold px-4.5 py-2.5 rounded-xl shadow-sm transition-all"
                >
                  Kebijakan Meta
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* NO RESULTS FOUND STATE */}
        {searchQuery && 
          !(hasMatchingContent("tujuan") || 
            hasMatchingContent("ketentuan") || 
            hasMatchingContent("larangan") || 
            hasMatchingContent("hakTanggungJawab") || 
            hasMatchingContent("sanksi")) && (
          <div className="text-center py-16 bg-white border border-slate-100 rounded-2xl shadow-sm">
            <Search className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-slate-800">Pencarian Tidak Ditemukan</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              Tidak ada bagian peraturan yang cocok dengan kata kunci &ldquo;{searchQuery}&rdquo;. Silakan coba kata kunci lain.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
