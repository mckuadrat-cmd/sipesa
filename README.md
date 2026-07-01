# SIPESA - CRM untuk WhatsApp Business API (WABA) Resmi Meta

SIPESA adalah platform Customer Relationship Management (CRM) berbasis WhatsApp Business Platform (WABA) resmi dari Meta. Aplikasi ini dirancang untuk memudahkan manajemen kontak, kotak masuk percakapan (live chat inbox), pembuatan dan sinkronisasi template pesan resmi, pengiriman pesan massal (broadcast) dengan parameter dinamis, serta sistem pengisian saldo token (billing) terintegrasi.

---

## 🚀 Fitur Utama

Aplikasi SIPESA dilengkapi dengan berbagai modul utama untuk operasional bisnis, di antaranya:

### 1. **Dashboard & Analitik**
*   **Ringkasan Statistik**: Menampilkan metrik utama seperti total pesan terkirim/diterima, total kontak, sisa saldo token, token yang telah digunakan, dan jumlah nomor WhatsApp yang aktif.
*   **Grafik Penggunaan**: Visualisasi riwayat penggunaan pesan harian (tren 7 hari terakhir).
*   **Aktivitas Terbaru**: Log real-time dari aktivitas pengiriman atau status sistem.

### 2. **Manajemen Nomor WhatsApp (Multi-WABA)**
*   Mendukung integrasi banyak nomor WhatsApp resmi sekaligus.
*   Konfigurasi detail Meta Graph API (Business ID, WABA ID, Phone Number ID, dan Access Token).
*   Fitur pengujian nomor (test sending) untuk memvalidasi status koneksi API.

### 3. **Kotak Masuk Percakapan (Inbox & Chat Interface)**
*   Antarmuka live chat multi-agen untuk membalas pesan pelanggan secara real-time.
*   Dukungan status percakapan (belum dibaca/read, filter berdasarkan nomor WABA, filter kontak).
*   Fitur membersihkan percakapan (delete conversations) dan menandai semua telah dibaca (read all).

### 4. **Manajemen Kontak & Pelabelan**
*   Manajemen daftar pelanggan lengkap dengan info nama, nomor WhatsApp (format internasional otomatis), dan riwayat pesan terakhir.
*   Impor kontak secara massal melalui file CSV/Excel dengan format templat khusus (`formatdatabroadcast - excel.csv`).
*   Pengelompokan kontak menggunakan label khusus (Contact Labels).

### 5. **Manajemen Template Resmi Meta**
*   **Sinkronisasi Otomatis**: Menarik data template pesan resmi langsung dari Meta Cloud.
*   **Pembuatan Template**: Membuat template baru langsung dari dashboard dan mengirimkannya ke Meta untuk proses peninjauan (approval).
*   **Parameter Dinamis**: Deteksi otomatis variabel (`{{1}}`, `{{2}}`, dst.) pada konten template untuk diisi secara dinamis saat broadcast.

### 6. **Mesin Broadcast Massal (Broadcast Engine)**
*   Mengirim pesan massal ke ratusan atau ribuan nomor kontak secara terjadwal atau instan.
*   Dukungan file media dinamis (Gambar, PDF, Dokumen) dengan *custom variables* untuk tiap penerima.
*   **Pemantauan Real-time**: Indikator persentase kemajuan pengiriman beserta status pengiriman detail (Sent, Delivered, Read, Failed).

### 7. **Sistem Billing & Token (Midtrans)**
*   Metode pembayaran otomatis untuk top-up saldo token menggunakan payment gateway **Midtrans** (mendukung virtual account, e-wallet, kartu kredit, dll.).
*   Riwayat transaksi keuangan lengkap (top-up, penyesuaian/adjustment, penggunaan token untuk broadcast, dan pengembalian dana/refund).

### 8. **Halaman Kepatuhan & Regulasi (Compliance)**
*   Ketentuan kebijakan penggunaan broadcast resmi Meta (menghindari blokir/spam) yang dapat diakses langsung oleh pengguna melalui dashboard (`Rules & Regulations`).

### 9. **Portal Superadmin**
*   **Pengelolaan Organisasi (Klien)**: Menambah, mengubah, dan menonaktifkan organisasi/perusahaan yang menyewa platform.
*   **Manajemen Saldo Token**: Menambahkan saldo token secara manual ke akun klien.
*   **Aktivasi Registrasi**: Menyetujui pendaftaran pengguna baru (signup activation) dan mengirim ulang email verifikasi.
*   **Permintaan Top-Up Manual**: Menyetujui atau menolak bukti pembayaran manual dari klien.
*   **Pengaturan Pembayaran & Harga**: Mengubah nilai tukar/harga per token.

---

## 🛠️ Tech Stack

Platform ini menggunakan teknologi modern dengan arsitektur terpisah antara Frontend dan Backend:

*   **Frontend (Single Page Application)**:
    *   **React 18** (TypeScript)
    *   **Vite 6** (Build tool & development server)
    *   **Tailwind CSS v4** (Desain responsif & modern)
    *   **Radix UI** (Komponen primitif unstyled yang aksesibel)
    *   **Material UI Icons** & **Lucide React** (Set ikon aplikasi)
    *   **Recharts** (Grafik & statistik interaktif)
    *   **Sonner** (Notifikasi toast mengambang)

*   **Backend (Serverless REST API)**:
    *   **Hono Web Framework** (Dijalankan di atas runtime **Deno**)
    *   **Supabase Edge Functions** (Skalabilitas tinggi & responsif)

*   **Database & Layanan Cloud**:
    *   **Supabase** (PostgreSQL Database, Supabase Auth untuk manajemen sesi pengguna)
    *   **Midtrans** (Gerbang pembayaran top-up)

---

## 📂 Struktur Proyek

```bash
sipesa/
├── .env.local                  # Konfigurasi environment variables lokal
├── package.json                # Dependensi NPM dan skrip build
├── tsconfig.json               # Konfigurasi compiler TypeScript
├── vite.config.ts              # Konfigurasi build Vite
├── supabase/
│   ├── functions/
│   │   └── server/             # Source code Deno API (Hono, router & controllers)
│   └── migrations/             # Skrip migrasi database PostgreSQL Supabase
├── src/
│   ├── main.tsx                # Entry point aplikasi React
│   ├── styles/                 # File styling global / CSS
│   └── app/
│       ├── App.tsx             # Manajemen rute & state aplikasi utama
│       ├── lib/                # Client helper (api.ts, supabaseClient.ts, apiClient.ts)
│       └── components/         # Komponen UI modular (inbox, broadcast, billing, settings, dll.)
└── public/                     # Aset statis public
```

---

## ⚙️ Cara Menjalankan Project Secara Lokal

### Prasyarat
Pastikan Anda sudah menginstal perangkat lunak berikut di komputer Anda:
*   [Node.js](https://nodejs.org/) (versi 18 ke atas disarankan)
*   [Supabase CLI](https://supabase.com/docs/guides/resources/supabase-cli) (opsional, untuk pengembangan database/edge functions)

### Langkah-Langkah

1.  **Kloning atau Buka Repositori**
    Masuk ke direktori proyek `sipesa`:
    ```bash
    cd sipesa
    ```

2.  **Instal Dependensi**
    Instal semua pustaka yang dibutuhkan menggunakan NPM:
    ```bash
    npm install
    ```

3.  **Konfigurasi Environment Variables**
    Buat file `.env.local` di direktori utama proyek (jika belum ada) dan isi variabel berikut sesuai dengan project Supabase & Midtrans Anda:
    ```env
    VITE_API_BASE_URL=https://<ref_supabase>.supabase.co/functions/v1/server
    VITE_SUPABASE_URL=https://<ref_supabase>.supabase.co
    VITE_SUPABASE_ANON_KEY=<anon_key_supabase>
    VITE_MIDTRANS_CLIENT_KEY=<midtrans_client_key_sandbox_atau_production>
    VITE_MIDTRANS_IS_PRODUCTION=false
    ```

4.  **Jalankan Development Server**
    Mulai server pengembangan lokal dengan perintah berikut:
    ```bash
    npm run dev
    ```
    Aplikasi akan berjalan secara lokal di alamat yang tertera di terminal Anda (biasanya `http://localhost:5173`).

5.  **Build untuk Produksi**
    Untuk membangun aplikasi siap pakai (production build), jalankan perintah:
    ```bash
    npm run build
    ```
    Hasil build akan tersimpan di dalam direktori `dist/`.

---

## 📄 Kebijakan Broadcast & Kepatuhan
Harap diperhatikan bahwa seluruh penggunaan fitur broadcast WhatsApp pada aplikasi SIPESA wajib mematuhi aturan WABA resmi untuk mencegah pemblokiran nomor oleh Meta. Silakan baca berkas [peraturan.txt](file:///d:/Buildapps/sipesa/peraturan.txt) untuk informasi selengkapnya terkait larangan spamming, hak penerima pesan, dan panduan manajemen database kontak.