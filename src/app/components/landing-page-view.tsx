import { useState } from "react";
import { 
  Zap, 
  MessageSquare, 
  Send, 
  History, 
  ShieldCheck, 
  Coins, 
  Users, 
  Check, 
  ArrowRight, 
  ChevronDown, 
  Calculator,
  MessageCircle,
  CheckCircle2
} from "lucide-react";

interface LandingPageViewProps {
  onNavigateToLogin: () => void;
  onNavigateToRegister: () => void;
}

export function LandingPageView({ onNavigateToLogin, onNavigateToRegister }: LandingPageViewProps) {
  // Calculator state
  const [messageCount, setMessageCount] = useState<number>(5000);
  const tokenPrice = 1500; // Rp 1.500 per message/token
  const monthlyCompetitorAvg = 450000; // Rp 450.000 / month subscription

  // FAQ state
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

  const formattedSipesaCost = (messageCount * tokenPrice).toLocaleString("id-ID");
  const formattedCompetitorCost = monthlyCompetitorAvg.toLocaleString("id-ID");
  const annualSaving = Math.max(0, (monthlyCompetitorAvg * 12) - (messageCount * tokenPrice));
  const formattedSaving = annualSaving.toLocaleString("id-ID");

  const waAdminLink = "https://wa.me/6281211112222?text=Halo%20Admin%20SIPESA%2C%20saya%20ingin%20bertanya%20lebih%20lanjut%20mengenai%20layanan%20WhatsApp%20Business%20API%20SIPESA%20tanpa%20biaya%20langganan%20bulanan.";

  const faqs = [
    {
      q: "Apa itu SIPESA?",
      a: "SIPESA adalah platform CRM WhatsApp Business API (WABA) resmi dari Meta yang dirancang untuk sekolah, instansi, dan bisnis. SIPESA membantu Anda mengirim pesan massal (broadcast), berkolaborasi membalas obrolan pelanggan (shared inbox), dan mensinkronisasikan template pesan resmi langsung dari Meta Cloud."
    },
    {
      q: "Bagaimana cara kerja skema 'Tanpa Biaya Bulanan'?",
      a: "Di SIPESA, Anda tidak dibebani biaya sewa dashboard bulanan atau tahunan. Anda cukup melakukan top-up token (saldo). 1 token setara dengan 1 pesan terkirim. Saldo Anda hanya akan terpotong saat Anda benar-benar mengirim pesan. Saldo token tidak memiliki masa kedaluwarsa."
    },
    {
      q: "Apakah aman dari risiko blokir WhatsApp?",
      a: "Ya, 100% aman. SIPESA terhubung langsung secara resmi dengan WhatsApp Business API (WABA) milik Meta. Berbeda dengan WhatsApp Gateway tidak resmi (yang menggunakan web scraping dan rentan blokir), nomor Anda dijamin aman karena mematuhi seluruh kebijakan resmi WhatsApp."
    },
    {
      q: "Bagaimana cara menghubungkan nomor WhatsApp saya ke SIPESA?",
      a: "Anda memerlukan akun Facebook Business Manager dan mendaftarkan nomor Anda ke WhatsApp Business API Meta. Setelah mendapatkan Access Token, WABA ID, dan Phone Number ID, Anda dapat menginputnya ke dashboard SIPESA dalam hitungan menit. Admin kami siap memandu proses integrasi ini sepenuhnya hingga aktif."
    },
    {
      q: "Bisakah satu akun diakses oleh banyak admin?",
      a: "Tentu saja. SIPESA dirancang dengan fitur Multi-Tenant per Instansi. Anda dapat menambahkan anggota tim/agen ke instansi Anda, sehingga mereka dapat membalas pesan masuk bersama-sama melalui fitur Shared Inbox menggunakan satu nomor WhatsApp terpusat."
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 selection:bg-[#DF7A5E] selection:text-white">
      {/* Header / Navbar */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo-sipesa.png" alt="SIPESA Logo" className="h-12 w-auto" />
            <span className="text-xl font-bold tracking-tight text-[#3C405B]">SIPESA</span>
          </div>

          <nav className="hidden md:flex items-center gap-8">
            <a href="#fitur" className="text-sm font-medium text-slate-600 hover:text-[#DF7A5E] transition-colors">Fitur</a>
            <a href="#keunggulan" className="text-sm font-medium text-slate-600 hover:text-[#DF7A5E] transition-colors">Keunggulan</a>
            <a href="#harga" className="text-sm font-medium text-slate-600 hover:text-[#DF7A5E] transition-colors">Harga</a>
            <a href="#faq" className="text-sm font-medium text-slate-600 hover:text-[#DF7A5E] transition-colors">FAQ</a>
          </nav>

          <div className="flex items-center gap-3">
            <button 
              onClick={onNavigateToLogin}
              className="px-4 py-2 text-sm font-semibold text-[#3C405B] hover:text-[#DF7A5E] transition-colors cursor-pointer"
            >
              Masuk
            </button>
            <button 
              onClick={onNavigateToRegister}
              className="px-5 py-2.5 text-sm font-semibold bg-[#DF7A5E] hover:bg-[#DF7A5E]/90 text-white rounded-full shadow-md shadow-[#DF7A5E]/20 transition-all duration-200 cursor-pointer"
            >
              Daftar Gratis
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-12 pb-20 lg:pt-20 lg:pb-32 bg-gradient-to-br from-white via-slate-50 to-[#F0EAC6]/20">
        <div className="absolute inset-0 z-0 opacity-40 bg-[radial-gradient(#DF7A5E_1px,transparent_1px)] [background-size:24px_24px]"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            
            {/* Left Copywriting */}
            <div className="lg:col-span-6 flex flex-col text-left space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#DF7A5E]/10 border border-[#DF7A5E]/20 w-fit">
                <span className="flex h-2 w-2 rounded-full bg-[#DF7A5E] animate-pulse"></span>
                <span className="text-xs font-semibold text-[#DF7A5E] uppercase tracking-wider">No Subscription Fees</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#3C405B] leading-[1.1]">
                Kirim Broadcast WA Massal, <span className="text-[#DF7A5E]">Cukup Bayar per Pesan!</span>
              </h1>

              <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl">
                Bebas biaya bulanan selamanya. Kelola inbox kolaboratif, template Meta, dan kirim ribuan pesan broadcast resmi secara terjadwal dengan dashboard multi-tenant yang super hemat.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <a 
                  href={waAdminLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#25D366] hover:bg-[#20ba5a] text-white text-base font-bold rounded-2xl shadow-lg shadow-emerald-500/25 transition-all duration-200 transform hover:-translate-y-0.5 cursor-pointer"
                >
                  <MessageCircle className="w-5 h-5 fill-current" />
                  Hubungi WhatsApp Admin
                </a>
                <button 
                  onClick={onNavigateToRegister}
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#3C405B] hover:bg-[#3C405B]/90 text-white text-base font-bold rounded-2xl transition-all duration-200 cursor-pointer"
                >
                  Coba Akun Demo
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>

              {/* Badges / Social Proof */}
              <div className="grid grid-cols-3 gap-4 pt-8 border-t border-slate-200/80">
                <div>
                  <div className="text-2xl font-extrabold text-[#3C405B]">100%</div>
                  <div className="text-xs text-slate-500 font-medium">Anti Blokir (WABA Resmi)</div>
                </div>
                <div>
                  <div className="text-2xl font-extrabold text-[#3C405B]">Rp 0</div>
                  <div className="text-xs text-slate-500 font-medium">Biaya Langganan Bulanan</div>
                </div>
                <div>
                  <div className="text-2xl font-extrabold text-[#3C405B]">Unlimited</div>
                  <div className="text-xs text-slate-500 font-medium">Tim & Kontak Terdaftar</div>
                </div>
              </div>
            </div>

            {/* Right Graphic/Mockup */}
            <div className="lg:col-span-6 relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-[#DF7A5E]/20 to-[#F0EAC6]/30 rounded-3xl filter blur-3xl -z-10 transform scale-95"></div>
              <div className="relative border-8 border-slate-900 rounded-3xl shadow-2xl overflow-hidden bg-slate-900 aspect-[16/10] group">
                <img 
                  src="/dashboard_illustration.png" 
                  alt="SIPESA Dashboard" 
                  className="w-full h-full object-cover object-top hover:scale-102 transition-transform duration-700" 
                />
                <div className="absolute inset-0 bg-slate-900/10 group-hover:bg-transparent transition-all duration-300"></div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Keunggulan Utama */}
      <section id="keunggulan" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto space-y-4">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#3C405B]">
              Kenapa Memilih SIPESA?
            </h2>
            <p className="text-slate-600">
              Platform modern yang merevolusi cara Anda terhubung dengan pelanggan melalui solusi kirim pesan massal hemat biaya dan aman.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mt-16">
            
            {/* Card 1 */}
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 hover:border-[#DF7A5E]/30 transition-all duration-300 flex flex-col space-y-4">
              <div className="w-12 h-12 rounded-xl bg-[#DF7A5E]/10 flex items-center justify-center text-[#DF7A5E] shrink-0">
                <Coins className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-[#3C405B]">Tanpa Biaya Berlangganan</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Tidak ada komitmen biaya bulanan. Saldo token yang Anda beli tidak kedaluwarsa dan hanya terpotong saat mengirim pesan.
              </p>
            </div>

            {/* Card 2 */}
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 hover:border-[#DF7A5E]/30 transition-all duration-300 flex flex-col space-y-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-[#3C405B]">API Resmi Meta (WABA)</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Menghindari risiko pemblokiran nomor. Terkoneksi resmi dengan sistem Meta sehingga pesan dijamin terkirim secara stabil.
              </p>
            </div>

            {/* Card 3 */}
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 hover:border-[#DF7A5E]/30 transition-all duration-300 flex flex-col space-y-4">
              <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center text-purple-600 shrink-0">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-[#3C405B]">Multi-Tenant & Kolaboratif</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Undang tim Anda sebagai agen. Bagikan akses inbox nomor terpusat untuk membalas obrolan pelanggan secara bersamaan.
              </p>
            </div>

            {/* Card 4 */}
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 hover:border-[#DF7A5E]/30 transition-all duration-300 flex flex-col space-y-4">
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-[#3C405B]">Simpel & Cepat Diintegrasikan</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Tanpa setup ribet. Anda bisa mengaktifkan nomor, sinkronisasi template pesan, dan langsung meluncurkan broadcast dalam sekejap.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* Fitur Utama */}
      <section id="fitur" className="py-20 bg-slate-50 border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#3C405B]">
              Satu Dashboard, Semua Fitur CRM Terlengkap
            </h2>
            <p className="text-slate-600">
              Didesain khusus untuk efisiensi operasional tim dalam merespons, mengelola, dan menjangkau ribuan kontak WhatsApp dengan mudah.
            </p>
          </div>

          <div className="space-y-20">
            {/* Feature 1 */}
            <div className="grid lg:grid-cols-12 gap-12 items-center">
              <div className="lg:col-span-5 space-y-6 text-left order-2 lg:order-1">
                <div className="w-12 h-12 rounded-xl bg-[#DF7A5E]/10 flex items-center justify-center text-[#DF7A5E]">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-bold text-[#3C405B]">Kotak Masuk Terpadu (Shared Inbox)</h3>
                <p className="text-slate-600 leading-relaxed">
                  Semua obrolan dari pelanggan masuk ke satu inbox terpusat. Agen dapat membalas pesan secara kolaboratif, menandai obrolan sebagai dibaca, serta memfilter percakapan per nomor WhatsApp instansi secara langsung.
                </p>
                <ul className="space-y-3 font-medium text-slate-700 text-sm">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> Multi-Agen tanpa batas</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> Filter status percakapan (Read / Unread)</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> Profil informasi kontak real-time</li>
                </ul>
              </div>
              <div className="lg:col-span-7 bg-white p-4 rounded-3xl shadow-lg border border-slate-100 order-1 lg:order-2">
                <div className="bg-slate-100 rounded-2xl overflow-hidden aspect-[16/10] flex items-center justify-center">
                  {/* Mockup visual representing Chat Inbox */}
                  <div className="w-full h-full p-4 flex flex-col bg-slate-950 text-slate-300 font-mono text-[11px] overflow-hidden">
                    <div className="border-b border-slate-800 pb-2 mb-2 flex items-center justify-between">
                      <span>💬 Shared Inbox - SIPESA CRM</span>
                      <span className="bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded text-[9px]">Online</span>
                    </div>
                    <div className="flex-1 space-y-2 overflow-hidden">
                      <div className="p-2 rounded bg-slate-900 border-l-2 border-[#DF7A5E]">
                        <span className="text-slate-400 font-bold">[08:12] Pelanggan:</span> Halo admin, apakah bisa order token hari ini?
                      </div>
                      <div className="p-2 rounded bg-slate-900 border-l-2 border-emerald-500 text-right ml-8">
                        <span className="text-emerald-400 font-bold">[08:13] Agen Budi:</span> Halo! Bisa sekali. Silakan top-up dari dashboard billing Anda ya.
                      </div>
                      <div className="p-2 rounded bg-slate-900 border-l-2 border-[#DF7A5E]">
                        <span className="text-slate-400 font-bold">[08:15] Pelanggan:</span> Baik, terima kasih respon cepatnya!
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="grid lg:grid-cols-12 gap-12 items-center">
              <div className="lg:col-span-7 bg-white p-4 rounded-3xl shadow-lg border border-slate-100">
                <div className="bg-slate-100 rounded-2xl overflow-hidden aspect-[16/10] flex items-center justify-center">
                  {/* Mockup visual representing Broadcast */}
                  <div className="w-full h-full p-4 flex flex-col bg-slate-950 text-slate-300 font-mono text-[11px] overflow-hidden">
                    <div className="border-b border-slate-800 pb-2 mb-2 flex items-center justify-between">
                      <span>📢 Broadcast Campaign Engine</span>
                      <span className="text-amber-400">Status: Running (85%)</span>
                    </div>
                    <div className="flex-1 space-y-2 justify-center flex flex-col">
                      <div className="w-full bg-slate-800 h-4 rounded-full overflow-hidden">
                        <div className="bg-gradient-to-r from-[#DF7A5E] to-[#F0EAC6] h-full" style={{ width: "85%" }}></div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-[10px] mt-2">
                        <div className="p-2 bg-slate-900 rounded">
                          <div className="font-bold text-[#DF7A5E]">1.000</div>
                          <div>Target</div>
                        </div>
                        <div className="p-2 bg-slate-900 rounded">
                          <div className="font-bold text-emerald-400">850</div>
                          <div>Terkirim</div>
                        </div>
                        <div className="p-2 bg-slate-900 rounded">
                          <div className="font-bold text-red-400">0</div>
                          <div>Gagal</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-5 space-y-6 text-left">
                <div className="w-12 h-12 rounded-xl bg-sky-100 flex items-center justify-center text-sky-600">
                  <Send className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-bold text-[#3C405B]">Mesin Broadcast Massal Terjadwal</h3>
                <p className="text-slate-600 leading-relaxed">
                  Kirim pengumuman atau promosi secara terjadwal ke ribuan kontak sekaligus. Cukup upload file CSV kontak Anda, pilih template Meta, sesuaikan parameter nama secara dinamis, dan sistem kami akan memproses pengiriman dalam sekejap.
                </p>
                <ul className="space-y-3 font-medium text-slate-700 text-sm">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> Impor kontak CSV instan</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> Deteksi variabel dinamis otomatis</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> Grafik monitor progres pengiriman</li>
                </ul>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="grid lg:grid-cols-12 gap-12 items-center">
              <div className="lg:col-span-5 space-y-6 text-left order-2 lg:order-1">
                <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center text-purple-600">
                  <History className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-bold text-[#3C405B]">Sinkronisasi & Approval Template Resmi</h3>
                <p className="text-slate-600 leading-relaxed">
                  Buat draf template pesan WhatsApp lengkap dengan header gambar/dokumen dan tombol respons cepat (Interactive Buttons) langsung dari SIPESA. Dashboard tersinkronisasi dua arah ke Meta Business Cloud.
                </p>
                <ul className="space-y-3 font-medium text-slate-700 text-sm">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> Buat & sinkronisasi template Meta otomatis</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> Mendukung tombol Quick Reply & Call-to-Action</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> Validasi instan status peninjauan Meta</li>
                </ul>
              </div>
              <div className="lg:col-span-7 bg-white p-4 rounded-3xl shadow-lg border border-slate-100 order-1 lg:order-2">
                <div className="bg-slate-100 rounded-2xl overflow-hidden aspect-[16/10] flex items-center justify-center">
                  {/* Mockup visual representing template */}
                  <div className="w-full h-full p-4 flex flex-col bg-slate-950 text-slate-300 font-mono text-[11px] overflow-hidden justify-between">
                    <div className="border-b border-slate-800 pb-2 mb-2 flex items-center justify-between">
                      <span>📄 Meta WABA Templates</span>
                      <span className="bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded text-[9px]">Approved</span>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-[10px] space-y-2 max-w-sm mx-auto">
                      <div className="font-bold text-slate-400">Pemberitahuan Tagihan</div>
                      <div className="text-slate-300 font-sans">
                        Halo <span className="text-[#DF7A5E] font-mono">{"{{1}}"}</span>, ini adalah pengingat tagihan SPP untuk putra/putri Anda <span className="text-[#DF7A5E] font-mono">{"{{2}}"}</span> sebesar <span className="text-[#DF7A5E] font-mono">{"{{3}}"}</span>. Silakan lakukan pembayaran sebelum tanggal <span className="text-[#DF7A5E] font-mono">{"{{4}}"}</span>. Terima kasih.
                      </div>
                      <div className="border-t border-slate-800 pt-2 flex justify-between gap-2">
                        <button className="flex-1 bg-slate-800 text-slate-300 py-1 rounded text-center font-sans">Hubungi Sekolah</button>
                        <button className="flex-1 bg-slate-800 text-slate-300 py-1 rounded text-center font-sans">Bayar Sekarang</button>
                      </div>
                    </div>
                    <div></div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Kalkulator Simulasi & Skema Harga */}
      <section id="harga" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#DF7A5E]/10 border border-[#DF7A5E]/20 w-fit">
              <span className="text-xs font-semibold text-[#DF7A5E] uppercase tracking-wider">Pay-As-You-Go Pricing</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#3C405B]">
              Bayar Hanya untuk Apa yang Anda Kirim
            </h2>
            <p className="text-slate-600">
              Tidak ada biaya tersembunyi. Tidak ada iuran bulanan. Saldo Anda dipotong per pesan sukses, dengan harga token yang sangat terjangkau.
            </p>
          </div>

          <div className="grid lg:grid-cols-12 gap-8 items-stretch mt-12">
            
            {/* Pricing Model Info */}
            <div className="lg:col-span-5 flex flex-col justify-between bg-[#3C405B] text-white rounded-3xl p-8 lg:p-10 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 -mt-8 -mr-8 w-32 h-32 bg-white/5 rounded-full filter blur-xl"></div>
              
              <div className="space-y-6 text-left relative z-10">
                <span className="text-xs font-bold bg-[#DF7A5E] text-white px-3 py-1.5 rounded-full uppercase tracking-wider">Skema Tarif</span>
                <h3 className="text-3xl font-extrabold">Rp 1.500 <span className="text-sm font-normal text-white/70">/ pesan (token)</span></h3>
                
                <p className="text-white/80 text-sm leading-relaxed">
                  Seluruh fitur premium SIPESA dapat diakses penuh secara gratis. Anda hanya membeli saldo pesan (token). 
                </p>

                <div className="space-y-4 pt-4 border-t border-white/10 text-sm">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <span>Tanpa Biaya Registrasi / Setup</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <span>Masa Aktif Saldo Token Selamanya</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <span>Akses Seluruh Fitur Tanpa Dibatasi</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <span>Dukungan Teknis Integrasi Meta Gratis</span>
                  </div>
                </div>
              </div>

              <div className="pt-8 relative z-10">
                <a 
                  href={waAdminLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-[#DF7A5E] hover:bg-[#DF7A5E]/90 text-white font-bold rounded-2xl shadow-lg transition-all duration-200 cursor-pointer"
                >
                  <MessageCircle className="w-5 h-5 fill-current" />
                  Hubungi Admin untuk Pemesanan
                </a>
              </div>
            </div>

            {/* Interactive Calculator */}
            <div className="lg:col-span-7 bg-slate-50 border border-slate-100 rounded-3xl p-8 lg:p-10 shadow-md flex flex-col justify-between">
              <div className="space-y-6 text-left">
                <div className="flex items-center gap-3">
                  <span className="text-xl font-bold text-[#3C405B]">Kalkulator Simulasi Penghematan</span>
                </div>
                
                <p className="text-sm text-slate-600">
                  Geser slider di bawah untuk mensimulasikan estimasi volume pesan bulanan Anda dan bandingkan biayanya dengan CRM berlangganan konvensional.
                </p>

                {/* Slider */}
                <div className="space-y-4 pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-slate-700">Volume Pesan Bulanan:</span>
                    <span className="text-2xl font-black text-[#DF7A5E]">{messageCount.toLocaleString("id-ID")} <span className="text-xs font-normal text-slate-500">pesan</span></span>
                  </div>
                  <input 
                    type="range" 
                    min="500" 
                    max="50000" 
                    step="500"
                    value={messageCount}
                    onChange={(e) => setMessageCount(Number(e.target.value))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#DF7A5E]"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    <span>500</span>
                    <span>10.000</span>
                    <span>25.000</span>
                    <span>50.000+</span>
                  </div>
                </div>

                {/* Cost Comparison */}
                <div className="grid sm:grid-cols-2 gap-4 pt-6 border-t border-slate-200/80">
                  <div className="p-4 bg-white rounded-2xl border border-slate-100">
                    <div className="text-xs text-slate-500 font-semibold mb-1">Estimasi Biaya SIPESA</div>
                    <div className="text-xl font-black text-[#3C405B]">Rp {formattedSipesaCost}</div>
                    <div className="text-[10px] text-slate-400 mt-1">Hanya bayar sesuai pesan terkirim</div>
                  </div>

                  <div className="p-4 bg-white rounded-2xl border border-slate-100">
                    <div className="text-xs text-slate-500 font-semibold mb-1">Rata-Rata Langganan Bulanan</div>
                    <div className="text-xl font-black text-slate-400">Rp {formattedCompetitorCost}</div>
                    <div className="text-[10px] text-slate-400 mt-1">Harus bayar tiap bulan, dipakai atau tidak</div>
                  </div>
                </div>

                {/* Annual Savings Result */}
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                    <Zap className="w-5 h-5 fill-current" />
                  </div>
                  <div className="text-left">
                    <div className="text-[10px] font-bold uppercase text-emerald-700 tracking-wider">Estimasi Efisiensi</div>
                    <div className="text-sm text-slate-700 leading-normal">
                      Cocok untuk instansi yang tidak rutin mengirim pesan bulanan. Anda menghemat hingga <strong className="text-emerald-700 font-bold">Rp {formattedSaving}</strong> per tahun dibanding sistem berlangganan tetap!
                    </div>
                  </div>
                </div>

              </div>
              <div></div>
            </div>

          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-20 bg-slate-50 border-t border-slate-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center space-y-4 mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[#3C405B]">
              Frequently Asked Questions
            </h2>
            <p className="text-slate-600">
              Menjawab hal-hal yang sering ditanyakan seputar pendaftaran, aktivasi, dan penggunaan token SIPESA.
            </p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, index) => {
              const isOpen = activeFaq === index;
              return (
                <div 
                  key={index} 
                  className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden transition-all duration-200"
                >
                  <button
                    onClick={() => toggleFaq(index)}
                    className="w-full px-6 py-5 text-left flex justify-between items-center gap-4 hover:bg-slate-50/50 transition-colors"
                  >
                    <span className="font-bold text-slate-800 text-sm sm:text-base">{faq.q}</span>
                    <ChevronDown className={`w-5 h-5 text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? "transform rotate-180" : ""}`} />
                  </button>
                  
                  <div 
                    className={`transition-all duration-300 ease-in-out overflow-hidden ${isOpen ? "max-h-96 border-t border-slate-100" : "max-h-0"}`}
                  >
                    <p className="px-6 py-5 text-sm sm:text-base text-slate-600 leading-relaxed text-left">
                      {faq.a}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </section>

      {/* Final CTA Banner */}
      <section className="py-16 bg-[#DF7A5E] text-white relative overflow-hidden">
        {/* Background shapes */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,#3C405B_0%,transparent_50%)] opacity-30"></div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full filter blur-2xl transform translate-x-20 -translate-y-20"></div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10 space-y-6">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-tight">
            Mulai Kirim Pesan Tanpa Beban Biaya Bulanan!
          </h2>
          <p className="text-white/85 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            Daftarkan instansi atau sekolah Anda secara gratis hari ini. Nikmati integrasi WhatsApp API Meta resmi yang stabil, aman, dan super hemat.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <a 
              href={waAdminLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#25D366] hover:bg-[#20ba5a] text-[#3C405B] text-base font-bold rounded-2xl shadow-xl transition-all duration-200 cursor-pointer"
            >
              <MessageCircle className="w-5 h-5 fill-current text-white" />
              <span className="text-white font-bold">Hubungi WhatsApp Admin</span>
            </a>
            <button 
              onClick={onNavigateToRegister}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#3C405B] hover:bg-[#3C405B]/90 text-white text-base font-bold rounded-2xl shadow-xl transition-all duration-200 cursor-pointer"
            >
              Daftar Instansi Sekarang
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#3C405B] text-white/70 py-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          
          <div className="space-y-4 text-left">
            <div className="flex items-center gap-3">
              <img src="/sipesa-white.png" alt="SIPESA Logo" className="h-10 w-auto" />
              <span className="text-lg font-bold tracking-tight text-white">SIPESA</span>
            </div>
            <p className="text-xs text-white/60 leading-relaxed">
              Platform CRM terpadu berbasis WhatsApp Business API Meta Resmi. Membantu pengelolaan broadcast massal, shared inbox, dan billing instansi.
            </p>
          </div>

          <div className="space-y-4 text-left">
            <h4 className="text-sm font-bold text-white uppercase tracking-wider">Tautan Cepat</h4>
            <ul className="space-y-2 text-xs">
              <li><a href="#fitur" className="hover:text-white transition-colors">Fitur Utama</a></li>
              <li><a href="#keunggulan" className="hover:text-white transition-colors">Keunggulan Layanan</a></li>
              <li><a href="#harga" className="hover:text-white transition-colors">Skema Harga Token</a></li>
              <li><a href="#faq" className="hover:text-white transition-colors">Tanya Jawab</a></li>
            </ul>
          </div>

          <div className="space-y-4 text-left">
            <h4 className="text-sm font-bold text-white uppercase tracking-wider">Kebijakan & Regulasi</h4>
            <ul className="space-y-2 text-xs">
              <li><a href="#/login" onClick={(e) => { e.preventDefault(); onNavigateToLogin(); }} className="hover:text-white transition-colors">Ketentuan Layanan</a></li>
              <li><a href="#/login" onClick={(e) => { e.preventDefault(); onNavigateToLogin(); }} className="hover:text-white transition-colors">Kebijakan Privasi</a></li>
              <li><a href="#/login" onClick={(e) => { e.preventDefault(); onNavigateToLogin(); }} className="hover:text-white transition-colors">Meta WABA Guidelines</a></li>
            </ul>
          </div>

          <div className="space-y-4 text-left">
            <h4 className="text-sm font-bold text-white uppercase tracking-wider">Hubungi Kami</h4>
            <p className="text-xs leading-relaxed">
              Butuh panduan pendaftaran akun Meta Business Manager?
            </p>
            <div className="pt-2">
              <a 
                href={waAdminLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 font-semibold rounded-lg text-xs transition-colors"
              >
                <MessageCircle className="w-4 h-4 shrink-0 fill-current" />
                WhatsApp Support
              </a>
            </div>
          </div>

        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 mt-8 border-t border-white/5 text-center text-xs text-white/55">
          <p>© {new Date().getFullYear()} SIPESA. Didukung oleh MCKuadrat. Seluruh hak cipta dilindungi.</p>
        </div>
      </footer>

    </div>
  );
}
