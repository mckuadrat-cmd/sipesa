import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { AppModal } from "./AppModal";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import {
  MessageSquare,
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Eye,
  Upload,
  Image,
  Video,
  FileText,
  MapPin,
  RefreshCw,
  CloudUpload,
  ChevronLeft,
  ChevronRight,
  Send,
  Search,
  Link as LinkIcon,
  Phone,
  GripVertical,
  CheckCircle2,
  Bold,
  Italic,
  Strikethrough,
  Code,
  ShoppingBag,
} from "lucide-react";
import { api, TemplateItem, BroadcastHistoryItem, NumberItem } from "../lib/api";
import { META_TEMPLATE_LANGUAGES, type MetaTemplateLanguageCode } from "../lib/meta-template-languages";
import { currentRejectionReason } from "../lib/template-rejection";
import { useVisibilityRefresh } from "../hooks/use-visibility-refresh";
import { useDialogFocus } from "../hooks/use-dialog-focus";

type TemplateCategory = "marketing" | "utility" | "authentication";
type HeaderType = "none" | "text" | "image" | "video" | "document" | "location";
type TemplateButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE";
type TemplateButton = { id: string; type: TemplateButtonType; text: string; value: string; example?: string };
type MetaFlowOption = { id: string; name: string; categories: string[]; status: string; health: string; eligible: boolean; screens: string[] };
type MetaCatalogOption = { id: string; name: string; eligible: boolean };
type CommerceProductOption = { id: string; retailerId: string; name: string; imageUrl: string; price: string; currency: string; availability: string };
type CarouselCard = {
  id: string;
  headerType: "image" | "video";
  mediaSampleFileName: string;
  mediaSampleHandle: string;
  body: string;
  examples: Record<number, string>;
  buttons: TemplateButton[];
};
type TemplateExample = { title: string; purpose: string; header?: string; body: string; footer?: string; buttons: string[]; note?: string; cards?: Array<{ title: string; subtitle: string; button: string }> };

const TEMPLATE_TYPE_EXAMPLES: Record<string, TemplateExample> = {
  marketing_default: { title: "Marketing Default", purpose: "Promosi, penawaran, pengumuman, dan engagement pelanggan.", header: "Promo Spesial Bulan Ini", body: "Halo Kak 👋\nNikmati diskon 20% untuk produk pilihan sampai akhir minggu ini.\n\nJangan lewatkan kesempatan spesialnya!", footer: "Promo berlaku selama persediaan masih ada.", buttons: ["Lihat Penawaran"] },
  utility_default: { title: "Utility Default", purpose: "Informasi transaksi, pesanan, pembayaran, pengiriman, atau layanan.", body: "Halo Budi,\npesanan Anda dengan nomor INV-2026-001 sudah berhasil dikirim.\n\nNomor resi:\nJNE123456789\n\nTerima kasih telah menggunakan layanan kami.", buttons: ["Lacak Pesanan"] },
  authentication_otp: { title: "Kode OTP", purpose: "Kode OTP untuk login, verifikasi akun, atau autentikasi.", body: "123456 adalah kode verifikasi Anda.\n\nDemi keamanan, jangan berikan kode ini kepada siapa pun.\n\nKode berlaku selama 10 menit.", buttons: ["Salin Kode"] },
  flow: { title: "Flow", purpose: "Formulir, survei, pendaftaran, konfirmasi, atau proses interaktif.", body: "Halo 👋\nSilakan lengkapi formulir berikut untuk mengonfirmasi data Anda.", buttons: ["Isi Formulir"], note: "Tombol membuka WhatsApp Flow." },
  carousel: { title: "Carousel", purpose: "Menampilkan beberapa pilihan dalam kartu yang dapat digeser.", body: "Pilihan terbaik untuk Anda minggu ini 👇", buttons: [], cards: [{ title: "Paket Basic", subtitle: "Mulai Rp99.000", button: "Lihat Detail" }, { title: "Paket Pro", subtitle: "Mulai Rp199.000", button: "Lihat Detail" }, { title: "Paket Premium", subtitle: "Mulai Rp299.000", button: "Lihat Detail" }], note: "Contoh tampilan. Pengiriman Carousel dari SIPESA belum didukung." },
  catalog: { title: "Catalog", purpose: "Mengarahkan pelanggan ke katalog produk yang terhubung ke WhatsApp.", body: "Halo 👋\nLihat koleksi produk terbaru kami langsung melalui katalog WhatsApp.", buttons: ["Lihat Katalog"], note: "Contoh tampilan. Hubungkan katalog untuk menggunakan fitur ini." },
  multi_product: { title: "Multi-produk", purpose: "Menampilkan beberapa produk dari katalog dalam satu pesan.", body: "Berikut beberapa produk yang mungkin cocok untuk Anda.\n\nProduk A · Rp75.000\nProduk B · Rp125.000\nProduk C · Rp175.000", buttons: ["Lihat Produk"], note: "Contoh tampilan. Produk aktual tetap berasal dari katalog Meta." },
  calling_permission: { title: "Izin Panggilan WhatsApp", purpose: "Meminta izin pelanggan sebelum bisnis melakukan panggilan WhatsApp.", body: "Apakah Anda bersedia menerima panggilan WhatsApp dari kami terkait layanan ini?", buttons: ["Izinkan Panggilan"], note: "Contoh edukasi. Fitur ini bukan message-template yang dapat dibuat melalui builder SIPESA saat ini." },
  limited_time_offer: { title: "Penawaran Berbatas Waktu", purpose: "Penawaran promosi yang memiliki batas waktu.", body: "Promo spesial hanya hari ini 🎉\n\nDapatkan potongan Rp50.000 untuk transaksi minimum Rp300.000.", footer: "Berakhir pukul 23.59 WIB", buttons: ["Salin Kode · HEMAT50"], note: "Contoh tampilan. Eligibility dan kontrak akun akan diverifikasi Meta." },
};

const CAROUSEL_MIN_CARDS = 2;
const CAROUSEL_MAX_CARDS = 10;
const CAROUSEL_CARD_BODY_MAX = 160;

function createCarouselCard(index: number): CarouselCard {
  return {
    id: `carousel-card-${Date.now()}-${index}`,
    headerType: "image",
    mediaSampleFileName: "",
    mediaSampleHandle: "",
    body: "",
    examples: {},
    buttons: [{ id: `carousel-button-${Date.now()}-${index}`, type: "QUICK_REPLY", text: "Pilih", value: "" }],
  };
}

function isCommerceProductEligible(product: CommerceProductOption) {
  return !["OUT OF STOCK", "OUT_OF_STOCK", "DISCONTINUED", "RETIRED"].includes(String(product.availability || "").toUpperCase());
}

interface LocalTemplate extends TemplateItem {
  headerType?: HeaderType;
  headerText?: string;
  footerText?: string;
  buttons?: TemplateButton[];
  mediaSampleName?: string;
  mediaSampleHandle?: string;
  previewExamples?: Record<number, string>;
}

const PAGE_SIZE = 8;
type MediaHeaderType = "image" | "video" | "document";

const MEDIA_SAMPLE_RULES: Record<MediaHeaderType, {
  label: string;
  accept: string;
  mimeTypes: string[];
  extensions: string[];
  maxBytes: number;
}> = {
  image: {
    label: "gambar",
    accept: ".jpg,.jpeg,.png,image/jpeg,image/png",
    mimeTypes: ["image/jpeg", "image/png"],
    extensions: ["jpg", "jpeg", "png"],
    maxBytes: 5 * 1024 * 1024,
  },
  video: {
    label: "video",
    accept: ".mp4,.3gp,video/mp4,video/3gpp",
    mimeTypes: ["video/mp4", "video/3gpp"],
    extensions: ["mp4", "3gp"],
    maxBytes: 16 * 1024 * 1024,
  },
  document: {
    label: "dokumen",
    accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf,text/plain",
    mimeTypes: [
      "application/pdf", "text/plain", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    extensions: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"],
    maxBytes: 100 * 1024 * 1024,
  },
};

function validateMediaSampleFile(file: File, headerType: HeaderType): string | null {
  if (!["image", "video", "document"].includes(headerType)) return "Jenis header media tidak valid.";
  const rule = MEDIA_SAMPLE_RULES[headerType as MediaHeaderType];
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!rule.mimeTypes.includes(file.type) || !rule.extensions.includes(extension)) {
    return `Format ${rule.label} tidak didukung untuk header ${headerType}.`;
  }
  if (file.size <= 0) return "File contoh kosong.";
  if (file.size > rule.maxBytes) {
    return `Ukuran contoh ${rule.label} maksimal ${Math.round(rule.maxBytes / 1024 / 1024)}MB.`;
  }
  return null;
}

function extractBodyTextFromComponents(components: any): string {
  if (!Array.isArray(components)) return "";
  const body = components.find((c: any) => String(c?.type || "").toUpperCase() === "BODY");
  return typeof body?.text === "string" ? body.text : "";
}

function extractHeaderInfo(components: any): { type: HeaderType; text?: string } {
  if (!Array.isArray(components)) return { type: "none" };
  const header = components.find((c: any) => String(c?.type || "").toUpperCase() === "HEADER");
  if (!header) return { type: "none" };

  const format = String(header?.format || "").toUpperCase();
  if (format === "TEXT") return { type: "text", text: header?.text || "" };
  if (format === "IMAGE") return { type: "image" };
  if (format === "VIDEO") return { type: "video" };
  if (format === "DOCUMENT") return { type: "document" };
  if (format === "LOCATION") return { type: "location" };

  return { type: "none" };
}

function extractMediaSampleName(components: any, headerType?: HeaderType): string {
  if (!Array.isArray(components)) return defaultSampleName(headerType || "none");
  const header = components.find((c: any) => String(c?.type || "").toUpperCase() === "HEADER");
  const possible =
    header?.example?.file_name ||
    header?.example?.filename ||
    header?.example?.name ||
    header?.example?.header_text ||
    header?.example?.header_handle?.[0];

  if (typeof possible === "string" && possible.trim()) return possible.trim();
  return defaultSampleName(headerType || "none");
}

function extractMediaSampleHandle(components: any): string {
  if (!Array.isArray(components)) return "";
  const header = components.find((c: any) => String(c?.type || "").toUpperCase() === "HEADER");
  const possible = header?.example?.header_handle?.[0];
  if (typeof possible === "string" && possible.trim()) return possible.trim();
  return "";
}

function hasUsableMetaMediaHandle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function extractFooterText(components: any): string {
  if (!Array.isArray(components)) return "";
  const footer = components.find((c: any) => String(c?.type || "").toUpperCase() === "FOOTER");
  return typeof footer?.text === "string" ? footer.text : "";
}

function extractButtons(components: any): TemplateButton[] {
  if (!Array.isArray(components)) return [];
  const btnComp = components.find((c: any) => String(c?.type || "").toUpperCase() === "BUTTONS");
  if (!btnComp || !Array.isArray(btnComp.buttons)) return [];

  return btnComp.buttons.map((b: any, index: number) => {
    const type = String(b?.type || "").toUpperCase() as TemplateButtonType;
    return {
      id: `imported-${index}`,
      type,
      text: String(b?.text || (type === "COPY_CODE" ? "Salin kode promo" : "")),
      value: type === "URL" ? String(b?.url || "") : type === "PHONE_NUMBER" ? String(b?.phone_number || "") : "",
      example: Array.isArray(b?.example) ? String(b.example[0] || "") : "",
    };
  });
}

function extractPreviewExamples(components: any): Record<number, string> {
  if (!Array.isArray(components)) return {};
  const body = components.find((c: any) => String(c?.type || "").toUpperCase() === "BODY");
  const metaBodyText = body?.example?.body_text?.[0];
  if (Array.isArray(metaBodyText)) {
    return metaBodyText.reduce<Record<number, string>>((acc, value, index) => {
      if (typeof value === "string") acc[index + 1] = value;
      return acc;
    }, {});
  }
  const raw = body?.example_values || body?.examples || body?.preview_examples;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  return Object.entries(raw).reduce<Record<number, string>>((acc, [key, value]) => {
    const idx = Number(key);
    if (Number.isFinite(idx) && typeof value === "string") {
      acc[idx] = value;
    }
    return acc;
  }, {});
}

function extractVariables(content: string): number[] {
  const regex = /\{\{(\d+)\}\}/g;
  const matches = [...content.matchAll(regex)];
  const nums = matches.map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
  return [...new Set(nums)].sort((a, b) => a - b);
}

function defaultSampleName(type: HeaderType): string {
  if (type === "document") return "sample.pdf";
  if (type === "image") return "sample-image.jpg";
  if (type === "video") return "sample-video.mp4";
  if (type === "location") return "Lokasi sekolah";
  return "";
}

function guessVariableExample(text: string, idx: number) {
  const normalized = text.toLowerCase();
  const token = `{{${idx}}}`;
  const tokenIndex = normalized.indexOf(token.toLowerCase());
  const area = tokenIndex >= 0
    ? normalized.slice(Math.max(0, tokenIndex - 60), Math.min(normalized.length, tokenIndex + 60))
    : normalized;

  return `Contoh ${idx}`;
}

function buildInitialExamples(text: string): Record<number, string> {
  return extractVariables(text).reduce<Record<number, string>>((acc, idx) => {
    acc[idx] = guessVariableExample(text, idx);
    return acc;
  }, {});
}

function applyExamplesToText(text: string, examples: Record<number, string>, fallbackMode: "example" | "token" = "example") {
  let next = text || "";
  const vars = extractVariables(next);
  vars.forEach((idx) => {
    const replacement = examples[idx]?.trim() || (fallbackMode === "token" ? `{{${idx}}}` : guessVariableExample(text, idx));
    next = next.split(`{{${idx}}}`).join(replacement);
  });
  return next;
}

function validateTemplateName(value: string): string | null {
  if (!value.trim()) return "Nama template wajib diisi.";
  if (value.length > 512) return "Nama template maksimal 512 karakter.";
  if (!/^[a-z0-9_]+$/.test(value)) {
    return "Nama template hanya boleh huruf kecil, angka, dan underscore.";
  }
  return null;
}

function validateHeaderText(value: string): string | null {
  if (value.length > 60) return "Header text maksimal 60 karakter.";
  const vars = extractVariables(value);
  if (vars.length > 1 || (vars.length === 1 && vars[0] !== 1)) return "Header text hanya mendukung satu variabel {{1}}.";
  if (/\{\{[^}]*$|\{\{[^\d]|\{\{\d+[^}]|\{\{\d+\}(?!\})/.test(value)) return "Placeholder header tidak valid.";
  return null;
}

function validateFooterText(value: string): string | null {
  if (value.length > 60) return "Footer maksimal 60 karakter.";
  if (/\{\{.*?\}\}/.test(value)) return "Footer tidak boleh memiliki variabel.";
  return null;
}

function validateBody(body: string): string | null {
  const text = body || "";
  const trimmed = text.trim();

  if (!trimmed) return "Konten pesan wajib diisi.";
  if (text.length > 1024) return "Konten pesan maksimal 1024 karakter.";

  if (/^\s*\{\{\d+\}\}/.test(trimmed)) {
    return "Variabel tidak boleh berada tepat di awal pesan.";
  }

  if (/\{\{\d+\}\}\s*$/.test(trimmed)) {
    return "Variabel tidak boleh berada tepat di akhir pesan.";
  }

  const vars = extractVariables(text);
  for (let i = 0; i < vars.length; i++) {
    if (vars[i] !== i + 1) {
      return "Nomor variabel harus berurutan mulai dari {{1}}, {{2}}, dst.";
    }
  }

  return null;
}

function validateButtons(buttons: TemplateButton[], category: TemplateCategory = "marketing"): string | null {
  const quickReplies = buttons.filter((button) => button.type === "QUICK_REPLY");
  const actions = buttons.filter((button) => button.type !== "QUICK_REPLY");
  if (buttons.length > 10) return "Maksimal 10 tombol per template.";
  if (quickReplies.length > 10) return "Maksimal 10 tombol Quick Reply.";
  if (actions.length > 4) return "Maksimal 4 tombol tindakan (2 URL, 1 telepon, 1 Salin Kode).";
  if (buttons.filter((button) => button.type === "URL").length > 2) return "Maksimal dua tombol website.";
  if (buttons.filter((button) => button.type === "PHONE_NUMBER").length > 1) return "Maksimal satu tombol telepon.";
  if (buttons.filter((button) => button.type === "COPY_CODE").length > 1) return "Maksimal satu tombol Salin Kode.";
  if (category !== "marketing" && buttons.some((button) => button.type === "COPY_CODE")) return "Salin Kode hanya tersedia untuk kategori Marketing.";
  const groups = buttons.map((button) => button.type === "QUICK_REPLY" ? "QR" : "ACTION");
  if (groups.some((group, index) => index > 1 && group !== groups[index - 1] && groups[index - 1] !== groups[index - 2])) return "Kelompok tombol tidak boleh berselang-seling.";
  for (const btn of buttons) {
    if (btn.type !== "COPY_CODE" && !btn.text.trim()) return "Teks tombol wajib diisi.";
    if (btn.type !== "COPY_CODE" && btn.text.length > 25) return "Teks tombol maksimal 25 karakter.";
    if (btn.type === "URL") {
      const matches = [...btn.value.matchAll(/\{\{(\d+)\}\}/g)];
      if (matches.length && (matches.length !== 1 || matches[0][1] !== "1" || !btn.value.endsWith("{{1}}"))) return "URL dinamis hanya mendukung {{1}} di bagian akhir.";
      if (matches.length && !btn.example?.trim()) return "Contoh URL dinamis lengkap wajib diisi.";
      if (matches.length && btn.example?.trim()) {
        try {
          if (new URL(btn.example).protocol !== "https:" || !btn.example.startsWith(btn.value.slice(0, -5))) return "Contoh URL harus berupa HTTPS lengkap dengan base yang sama.";
        } catch { return "Contoh URL dinamis tidak valid."; }
      }
      try {
        if (new URL(btn.value.replace(/\{\{1\}\}$/, "contoh")).protocol !== "https:") return "URL website wajib menggunakan HTTPS.";
      } catch {
        return "URL website tidak valid.";
      }
    }
    if (btn.type === "COPY_CODE" && !btn.example?.trim()) return "Contoh kode promo wajib diisi.";
    if (btn.type === "PHONE_NUMBER" && !/^\+[1-9]\d{7,14}$/.test(btn.value)) {
      return "Nomor telepon wajib format E.164, contoh +628123456789.";
    }
  }
  return null;
}

function canAddButtonType(buttons: TemplateButton[], type: TemplateButtonType, category: TemplateCategory) {
  if (buttons.length >= 10) return false;
  const actions = buttons.filter((button) => button.type !== "QUICK_REPLY");
  if (type !== "QUICK_REPLY" && actions.length >= 4) return false;
  if (type === "URL" && buttons.filter((button) => button.type === "URL").length >= 2) return false;
  if (type === "PHONE_NUMBER" && buttons.some((button) => button.type === "PHONE_NUMBER")) return false;
  if (type === "COPY_CODE" && (category !== "marketing" || buttons.some((button) => button.type === "COPY_CODE"))) return false;
  const groups = buttons.map((button) => button.type === "QUICK_REPLY" ? "QR" : "ACTION");
  const switches = groups.slice(1).filter((group, index) => group !== groups[index]).length;
  const nextGroup = type === "QUICK_REPLY" ? "QR" : "ACTION";
  return !(switches >= 1 && groups.length > 0 && groups[groups.length - 1] !== nextGroup);
}

function validateCarouselCards(cards: CarouselCard[]): string | null {
  if (cards.length < CAROUSEL_MIN_CARDS) return `Carousel membutuhkan minimal ${CAROUSEL_MIN_CARDS} kartu.`;
  if (cards.length > CAROUSEL_MAX_CARDS) return `Maksimal ${CAROUSEL_MAX_CARDS} kartu.`;
  const signatures: string[] = [];
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    if (!hasUsableMetaMediaHandle(card.mediaSampleHandle)) return `Contoh media Card ${index + 1} belum diunggah.`;
    if (!card.body.trim() || card.body.length > CAROUSEL_CARD_BODY_MAX) return `Body Card ${index + 1} wajib dan maksimal ${CAROUSEL_CARD_BODY_MAX} karakter.`;
    const vars = extractVariables(card.body);
    if (vars.some((value, variableIndex) => value !== variableIndex + 1)) return `Nomor variabel Card ${index + 1} harus berurutan.`;
    if (vars.some((value) => !String(card.examples[value] ?? "").trim())) return `Contoh variabel Card ${index + 1} belum lengkap.`;
    if (card.buttons.length < 1 || card.buttons.length > 2) return `Card ${index + 1} wajib memiliki 1-2 tombol.`;
    const invalidButton = validateButtons(card.buttons, "marketing");
    if (invalidButton) return `Button pada Card ${index + 1}: ${invalidButton}`;
    if (card.buttons.some((button) => button.type === "COPY_CODE")) return `Button pada Card ${index + 1} tidak sesuai aturan Meta.`;
    signatures.push(`${card.headerType}|BODY_VARS:${extractVariables(card.body).length}|${card.buttons.map((button) => `${button.type}:${button.type === "URL" && button.value.endsWith("{{1}}") ? "DYNAMIC" : "STATIC"}`).join("|")}`);
  }
  if (signatures.some((signature) => signature !== signatures[0])) return "Struktur semua kartu harus konsisten.";
  return null;
}

function buildComponentsFromForm(form: {
  headerType: HeaderType;
  headerText: string;
  body: string;
  footerText: string;
  buttons: TemplateButton[];
  examples: Record<number, string>;
  headerExample?: string;
  mediaSampleFileName?: string;
  mediaSampleHandle?: string;
}) {
  const components: any[] = [];

  if (form.headerType === "text" && form.headerText.trim()) {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: form.headerText.trim(),
      ...(/\{\{1\}\}/.test(form.headerText) ? { example: { header_text: [form.headerExample || ""] } } : {}),
    });
  }

  if (form.headerType === "image") {
    components.push({
      type: "HEADER",
      format: "IMAGE",
      example: {
        header_handle: [form.mediaSampleHandle || "sample-image"],
        file_name: form.mediaSampleFileName || "sample-image",
      },
    });
  }

  if (form.headerType === "video") {
    components.push({
      type: "HEADER",
      format: "VIDEO",
      example: {
        header_handle: [form.mediaSampleHandle || "sample-video"],
        file_name: form.mediaSampleFileName || "sample-video",
      },
    });
  }

  if (form.headerType === "document") {
    components.push({
      type: "HEADER",
      format: "DOCUMENT",
      example: {
        header_handle: [form.mediaSampleHandle || "sample-document"],
        file_name: form.mediaSampleFileName || "sample-document",
      },
    });
  }

  if (form.headerType === "location") {
    components.push({
      type: "HEADER",
      format: "LOCATION",
    });
  }

  components.push({
    type: "BODY",
    text: form.body,
    example_values: form.examples,
  });

  if (form.footerText.trim()) {
    components.push({
      type: "FOOTER",
      text: form.footerText.trim(),
    });
  }

  if (form.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: form.buttons.map((button) => ({
        type: button.type,
        ...(button.type !== "COPY_CODE" ? { text: button.text.trim() } : {}),
        ...(button.type === "URL" ? { url: button.value.trim() } : {}),
        ...(button.type === "PHONE_NUMBER" ? { phone_number: button.value.trim() } : {}),
        ...(["URL", "COPY_CODE"].includes(button.type) && button.example?.trim() ? { example: [button.example.trim()] } : {}),
      })),
    });
  }

  return components;
}

function getStatusColor(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (s === "pending") return "bg-amber-100 text-amber-700 border-amber-200";
  if (s === "rejected") return "bg-red-100 text-red-700 border-red-200";
  if (s === "draft") return "bg-slate-100 text-slate-700 border-slate-200";
  if (s === "paused") return "bg-orange-100 text-orange-700 border-orange-200";
  if (s === "disabled" || s === "deleted" || s === "missing") return "bg-zinc-200 text-zinc-700 border-zinc-300";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function getStatusLabel(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "Disetujui";
  if (s === "pending") return "Menunggu";
  if (s === "rejected") return "Ditolak";
  if (s === "draft") return "Draf";
  if (s === "paused") return "Dijeda";
  if (s === "disabled") return "Dinonaktifkan";
  if (s === "deleted") return "Dihapus di Meta";
  if (s === "missing") return "Tidak ditemukan di Meta";
  return status ? `Tidak dikenal (${status})` : "Status tidak dikenal";
}

function getTemplateDateValue(template: any) {
  const raw = template?.created_at || template?.createdAt;

  if (raw) {
    const date = new Date(raw).getTime();
    if (!Number.isNaN(date)) return date;
  }

  return 0;
}

function compareTemplates(a: any, b: any) {
  const timeDiff = getTemplateDateValue(b) - getTemplateDateValue(a);
  if (timeDiff !== 0) return timeDiff;
  return String(b.id || "").localeCompare(String(a.id || ""));
}

function formatTemplateDate(iso?: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function HeaderPreviewBox({
  type,
  text,
  fileName,
}: {
  type: HeaderType;
  text?: string;
  fileName?: string;
}) {
  if (type === "none") return null;

  if (type === "text") {
    return <div className="mb-2 text-[13px] font-semibold text-slate-900">{text || "Header text"}</div>;
  }

  if (type === "image") {
    return (
      <div className="mb-2 overflow-hidden rounded-t-xl rounded-b-md bg-slate-200">
        <div className="h-36 flex items-center justify-center bg-gradient-to-b from-slate-200 to-slate-300">
          <Image className="w-10 h-10 text-slate-500" />
        </div>
        <div className="px-3 py-2 text-[11px] text-slate-600 bg-white/70">{fileName || defaultSampleName(type)}</div>
      </div>
    );
  }

  if (type === "video") {
    return (
      <div className="mb-2 overflow-hidden rounded-t-xl rounded-b-md bg-slate-200">
        <div className="h-36 flex items-center justify-center bg-gradient-to-b from-slate-200 to-slate-300">
          <Video className="w-10 h-10 text-slate-500" />
        </div>
        <div className="px-3 py-2 text-[11px] text-slate-600 bg-white/70">{fileName || defaultSampleName(type)}</div>
      </div>
    );
  }

  if (type === "document") {
    return (
      <div className="mb-2 rounded-xl bg-[#f4efdf] p-4">
        <div className="flex flex-col items-center justify-center py-3 text-center">
          <FileText className="w-10 h-10 text-slate-700 mb-3" />
          <div className="w-full text-left">
            <div className="text-[13px] font-medium text-slate-800">Dokumen</div>
          </div>
        </div>
      </div>
    );
  }

  if (type === "location") {
    return (
      <div className="mb-2 rounded-xl bg-[#eef3f7] p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm">
            <MapPin className="w-5 h-5 text-slate-700" />
          </div>
          <div>
            <div className="text-[13px] font-medium text-slate-800">Lokasi</div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function renderFormattedText(text: string): React.ReactNode {
  if (!text) return "";

  // Split by formatting tokens: ```code```, *bold*, _italic_, ~strike~
  const regex = /(\`\`\`[\s\S]+?\`\`\`|\*[^*]+?\*|_[^_]+?_|~[^~]+?~)/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      return (
        <code key={index} className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs text-rose-600 break-all">
          {part.slice(3, -3)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <strong key={index} className="font-bold">
          {renderFormattedText(part.slice(1, -1))}
        </strong>
      );
    }
    if (part.startsWith("_") && part.endsWith("_")) {
      return (
        <em key={index} className="italic">
          {renderFormattedText(part.slice(1, -1))}
        </em>
      );
    }
    if (part.startsWith("~") && part.endsWith("~")) {
      return (
        <span key={index} className="line-through text-slate-500">
          {renderFormattedText(part.slice(1, -1))}
        </span>
      );
    }
    return part;
  });
}

function WhatsAppBubblePreview({
  headerType,
  headerText,
  mediaSampleName,
  body,
  footer,
  buttons,
}: {
  headerType: HeaderType;
  headerText?: string;
  mediaSampleName?: string;
  body: string;
  footer?: string;
  buttons?: TemplateButton[];
}) {
  const activeButtons = buttons?.filter((btn) => btn.text?.trim()) || [];

  return (
    <div className="rounded-[28px] bg-[#e7ddd4] p-4 md:p-5">
      <div className="max-w-[360px] ml-auto">
        <div className="rounded-[18px] rounded-tr-md bg-white shadow-sm overflow-hidden border border-black/5">
          <div className="px-3 pt-3 pb-2">
            <HeaderPreviewBox
              type={headerType}
              text={headerText}
              fileName={mediaSampleName}
            />

            <div className="text-[13.5px] leading-6 text-slate-800 whitespace-pre-wrap break-words">
              {body ? renderFormattedText(body) : "Masukkan konten untuk melihat preview"}
            </div>

            {footer?.trim() && (
              <div className="mt-2 text-[11px] text-slate-500 leading-4">{footer}</div>
            )}
          </div>

          {activeButtons.length > 0 && (
            <div className="border-t bg-white">
              {activeButtons.map((btn, idx) => (
                <button
                  key={`${btn.text}-${idx}`}
                  type="button"
                  className={`w-full flex items-center justify-center gap-2 px-3 py-3 text-[13px] font-medium text-[#1677f2] ${idx !== 0 ? "border-t" : ""
                    }`}
                >
                  {btn.type === "URL" ? <LinkIcon className="w-4 h-4" /> : btn.type === "PHONE_NUMBER" ? <Phone className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                  <span>{btn.text}</span>
                </button>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function AuthenticationPreview({
  method,
  securityRecommendation,
  expiryMinutes,
}: {
  method: "copy_code" | "one_tap" | "zero_tap";
  securityRecommendation: boolean;
  expiryMinutes: number;
}) {
  return (
    <div className="rounded-[28px] bg-[#e7ddd4] p-4 md:p-5">
      <div className="ml-auto max-w-[360px]">
        <div className="overflow-hidden rounded-[18px] rounded-tr-md border border-black/5 bg-white shadow-sm">
          <div className="space-y-2 px-3 pb-3 pt-3 text-[13.5px] leading-6 text-slate-800">
            <p><strong>{`{{1}}`}</strong> adalah kode verifikasi Anda.</p>
            {securityRecommendation && <p className="text-slate-600">Demi keamanan, jangan bagikan kode ini.</p>}
            <p className="text-[11px] text-slate-500">Kode ini kedaluwarsa dalam {expiryMinutes} menit.</p>
          </div>
          <div className="border-t bg-white px-3 py-3 text-center text-[13px] font-medium text-[#1677f2]">
            {method === "one_tap" ? "Isi Otomatis" : "Salin Kode"}
          </div>
        </div>
      </div>
    </div>
  );
}

function FlowPreview({ body, footer, buttonText }: { body: string; footer?: string; buttonText: string }) {
  return (
    <div className="rounded-[28px] bg-[#e7ddd4] p-4 md:p-5">
      <div className="ml-auto max-w-[360px]">
        <div className="overflow-hidden rounded-[18px] rounded-tr-md border border-black/5 bg-white shadow-sm">
          <div className="px-3 pb-3 pt-3 text-[13.5px] leading-6 text-slate-800">
            <p className="whitespace-pre-wrap break-words">{body || "Masukkan konten untuk melihat preview"}</p>
            {footer?.trim() && <p className="mt-2 text-[11px] text-slate-500">{footer}</p>}
          </div>
          <div className="border-t bg-white px-3 py-3 text-center text-[13px] font-medium text-[#1677f2]">{buttonText || "Buka Flow"}</div>
        </div>
        <p className="mt-2 text-center text-xs text-slate-600">Tombol ini membuka WhatsApp Flow.</p>
      </div>
    </div>
  );
}

function CommercePreview({ type, body, footer, buttonText, products }: { type: "catalog" | "multi_product"; body: string; footer?: string; buttonText: string; products: CommerceProductOption[] }) {
  return (
    <div className="rounded-[28px] bg-[#e7ddd4] p-4 md:p-5">
      <div className="ml-auto max-w-[360px]">
        <div className="overflow-hidden rounded-[18px] rounded-tr-md border border-black/5 bg-white shadow-sm">
          <div className="px-3 pb-3 pt-3 text-[13.5px] leading-6 text-slate-800">
            <p className="whitespace-pre-wrap break-words">{body || "Masukkan konten untuk melihat preview"}</p>
            {type === "multi_product" && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(products.length ? products.slice(0, 4) : [{ id: "sample", name: "Produk Meta", retailerId: "", imageUrl: "", price: "", currency: "", availability: "" }]).map((product) => (
                  <div key={product.id} className="overflow-hidden rounded-lg border bg-slate-50">
                    {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-20 w-full object-cover" /> : <div className="flex h-20 items-center justify-center bg-slate-100"><ShoppingBag className="h-6 w-6 text-slate-400" /></div>}
                    <div className="truncate p-2 text-[11px] font-medium">{product.name}</div>
                  </div>
                ))}
              </div>
            )}
            {footer?.trim() && <p className="mt-2 text-[11px] text-slate-500">{footer}</p>}
          </div>
          <div className="border-t bg-white px-3 py-3 text-center text-[13px] font-medium text-[#1677f2]">{buttonText || (type === "catalog" ? "Lihat katalog" : "Lihat produk")}</div>
        </div>
        <p className="mt-2 text-center text-xs text-slate-600">{type === "catalog" ? "Tombol membuka katalog Meta yang terhubung." : "Produk dipilih kembali saat pengiriman; kartu ini hanya preview."}</p>
      </div>
    </div>
  );
}

function CarouselPreview({ body, cards }: { body: string; cards: CarouselCard[] }) {
  return <div className="min-w-0 overflow-hidden rounded-2xl bg-[#efeae2] p-3">
    <div className="mb-3 max-w-[92%] rounded-lg bg-white p-3 text-sm shadow-sm">{body || "Pesan utama Carousel"}</div>
    <div className="flex max-w-full snap-x gap-3 overflow-x-auto pb-2" aria-label="Preview kartu Carousel">
      {cards.map((card, index) => <article key={card.id} className="w-[230px] min-w-[230px] snap-start overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="flex h-28 items-center justify-center bg-slate-100 text-slate-500">{card.headerType === "video" ? <Video className="h-8 w-8" /> : <Image className="h-8 w-8" />}<span className="ml-2 text-xs">{card.mediaSampleFileName || `Media Card ${index + 1}`}</span></div>
        <p className="min-h-16 whitespace-pre-wrap p-3 text-sm">{applyExamplesToText(card.body, card.examples) || `Body Card ${index + 1}`}</p>
        <div className="border-t">{card.buttons.map((button) => <div key={button.id} className="border-b px-3 py-2 text-center text-xs font-medium text-blue-600 last:border-b-0">{button.text || "Tombol"}</div>)}</div>
      </article>)}
    </div>
    <p className="mt-1 text-center text-[11px] text-slate-500">Geser kartu secara horizontal · {cards.length} kartu</p>
  </div>;
}

function StepOneExamplePreview({ category, templateType, available }: { category: TemplateCategory; templateType: string; available: boolean }) {
  const key = category === "authentication" ? "authentication_otp" : templateType === "default" ? `${category}_default` : templateType;
  const example = TEMPLATE_TYPE_EXAMPLES[key];
  if (!example) return <div className="rounded-xl border border-dashed bg-white p-6 text-center text-sm text-slate-500">Pilih jenis template untuk melihat contoh pesan.</div>;
  const buttons: TemplateButton[] = example.buttons.map((text, index) => ({ id: `example-${key}-${index}`, type: "QUICK_REPLY", text, value: "" }));
  return <div className="space-y-3" data-example-only="true">
    <div><strong className="text-sm">{example.title}</strong><p className="mt-1 text-xs text-slate-600">{example.purpose}</p></div>
    {key === "authentication_otp" ? <AuthenticationPreview method="copy_code" securityRecommendation expiryMinutes={10} />
      : key === "flow" ? <FlowPreview body={example.body} buttonText={example.buttons[0]} />
      : key === "carousel" ? <div className="min-w-0 overflow-hidden rounded-2xl bg-[#efeae2] p-3"><div className="mb-3 rounded-lg bg-white p-3 text-sm shadow-sm">{example.body}</div><div className="relative max-w-full overflow-hidden"><div className="flex max-w-full snap-x gap-3 overflow-x-auto pb-2 pr-10">{example.cards?.slice(0, 2).map((card) => <div key={card.title} className="w-[184px] min-w-[184px] snap-start overflow-hidden rounded-xl bg-white shadow-sm"><div className="flex h-20 items-center justify-center bg-slate-100"><Image className="h-7 w-7 text-slate-400" /></div><div className="p-3"><strong className="block text-sm">{card.title}</strong><span className="text-xs text-slate-500">{card.subtitle}</span></div><div className="border-t p-2 text-center text-xs font-medium text-blue-600">{card.button}</div></div>)}</div><div className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-end bg-gradient-to-l from-[#efeae2] to-transparent pr-1 text-lg text-slate-500" aria-hidden="true">›</div></div><p className="mt-1 text-center text-[11px] text-slate-500">Geser untuk melihat kartu lainnya</p></div>
      : <WhatsAppBubblePreview headerType={example.header ? "text" : "none"} headerText={example.header} body={example.body} footer={example.footer} buttons={buttons} />}
    {(example.note || !available) && <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{!available ? "Contoh tampilan. Fitur ini belum tersedia pada akun Anda." : example.note}</p>}
    <p className="text-[11px] text-slate-500">Contoh edukasi saja — tidak disimpan dan tidak dikirim ke Meta.</p>
  </div>;
}

type CapabilityTone = "available" | "conditional" | "no_resource" | "unsupported" | "deferred";

function capabilityBadgeClasses(tone: CapabilityTone) {
  if (tone === "available") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "conditional") return "border-amber-200 bg-amber-50 text-amber-800";
  if (tone === "no_resource") return "border-orange-200 bg-orange-50 text-orange-800";
  if (tone === "deferred") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

function CategoryCard({ value, title, description, selected, onSelect }: { value: TemplateCategory; title: string; description: string; selected: boolean; onSelect: () => void }) {
  return <button type="button" role="radio" aria-checked={selected} aria-label={`${title}: ${description}`} onClick={onSelect} className={`flex min-h-[124px] w-full flex-col rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${selected ? "border-emerald-500 bg-emerald-50 shadow-sm ring-1 ring-emerald-200" : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50"}`} data-category={value}>
    <span className="flex items-center justify-between gap-2"><span className="text-base font-semibold text-slate-900">{title}</span><span className={`h-4 w-4 shrink-0 rounded-full border-2 ${selected ? "border-emerald-600 bg-emerald-600 shadow-[inset_0_0_0_3px_white]" : "border-slate-300"}`} aria-hidden="true" /></span>
    <span className="mt-2 overflow-hidden text-sm leading-5 text-slate-600 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{description}</span>
  </button>;
}

function TemplateTypeCard({ title, description, status, tone, selected, unavailable = false, onSelect }: { title: string; description: string; status: string; tone: CapabilityTone; selected: boolean; unavailable?: boolean; onSelect: () => void }) {
  return <button type="button" role="radio" aria-checked={selected} aria-disabled={unavailable} onClick={onSelect} className={`group flex w-full items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${selected ? "border-emerald-500 bg-emerald-50 shadow-sm" : unavailable ? "border-slate-200 bg-slate-50 hover:border-slate-300" : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50"}`}>
    <span className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${selected ? "border-emerald-600 bg-emerald-600 shadow-[inset_0_0_0_3px_white]" : "border-slate-300 bg-white"}`} aria-hidden="true" />
    <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">{title}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${capabilityBadgeClasses(tone)}`}>{status}</span></span><span className="mt-1 block overflow-hidden text-sm leading-5 text-slate-600 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{description}</span>{unavailable && <span className="mt-1 block text-[11px] font-medium text-slate-500">Tetap dapat dipilih untuk melihat contoh.</span>}</span>
  </button>;
}

function StepOnePreviewPanel({ category, templateType, available }: { category: TemplateCategory; templateType: string; available: boolean }) {
  return <section aria-labelledby="step-one-preview-title" className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm sm:p-5">
    <div className="mb-4 flex items-start gap-3 border-b border-slate-200 pb-4"><div className="rounded-lg bg-white p-2 shadow-sm"><Eye className="h-4 w-4 text-emerald-700" /></div><div><h4 id="step-one-preview-title" className="font-semibold text-slate-900">Preview Template</h4><p className="mt-0.5 text-xs leading-5 text-slate-500">Contoh berubah mengikuti kategori dan tipe yang dipilih.</p></div></div>
    <StepOneExamplePreview category={category} templateType={templateType} available={available} />
  </section>;
}

export function TemplateManagement() {
  const [templates, setTemplates] = useState<LocalTemplate[]>([]);
  const [numbers, setNumbers] = useState<NumberItem[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<LocalTemplate | null>(null);
  const [sentCounts, setSentCounts] = useState<Record<string, number>>({});
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<LocalTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedExamples, setSelectedExamples] = useState<Record<number, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [templateIdToDelete, setTemplateIdToDelete] = useState<string | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState(false);
  const [templateToSubmit, setTemplateToSubmit] = useState<LocalTemplate | null>(null);
  const [builderStep, setBuilderStep] = useState<1 | 2 | 3>(1);

  const [formData, setFormData] = useState({
    name: "",
    category: "marketing" as TemplateCategory,
    templateType: "default",
    variableType: "number",
    language: "id" as MetaTemplateLanguageCode,
    headerType: "none" as HeaderType,
    headerText: "",
    headerExample: "",
    body: "",
    footerText: "",
    buttons: [] as TemplateButton[],
    mediaSampleFileName: "",
    mediaSampleHandle: "",
    otpButtonType: "copy_code" as "copy_code" | "one_tap" | "zero_tap",
    securityRecommendation: true,
    codeExpirationMinutes: 10,
    packageName: "",
    signatureHash: "",
    flowId: "",
    flowName: "",
    flowStatus: "",
    flowButtonText: "Buka Formulir",
    flowAction: "navigate",
    flowScreen: "",
    catalogId: "",
    catalogName: "",
    commerceButtonText: "Lihat katalog",
    commerceSectionTitle: "",
    commerceProducts: [] as CommerceProductOption[],
    carouselCards: [createCarouselCard(0), createCarouselCard(1)] as CarouselCard[],
    wabaId: "",
  });

  const [examples, setExamples] = useState<Record<number, string>>({});
  const [nameError, setNameError] = useState<string | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [footerError, setFooterError] = useState<string | null>(null);
  const [buttonError, setButtonError] = useState<string | null>(null);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null);
  const [metaFlows, setMetaFlows] = useState<MetaFlowOption[]>([]);
  const [flowsLoading, setFlowsLoading] = useState(false);
  const [flowsError, setFlowsError] = useState<string | null>(null);
  const [metaCatalogs, setMetaCatalogs] = useState<MetaCatalogOption[]>([]);
  const [commerceCapability, setCommerceCapability] = useState<null | { catalogAvailable: boolean; catalogEligible: boolean; catalogCount: number; productDiscoveryAvailable: boolean; catalogTemplateSupported: boolean; multiProductSupported: boolean; runtimeSupport: { broadcast: boolean; chat: boolean } }>(null);
  const [catalogsLoading, setCatalogsLoading] = useState(false);
  const [catalogsError, setCatalogsError] = useState<string | null>(null);
  const [commerceProducts, setCommerceProducts] = useState<CommerceProductOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productsNextCursor, setProductsNextCursor] = useState<string | null>(null);
  const [carouselUploadIndex, setCarouselUploadIndex] = useState<number | null>(null);
  const [templateCapabilities, setTemplateCapabilities] = useState<Record<string, any> | null>(null);
  const [capabilityStatus, setCapabilityStatus] = useState<"idle" | "loading" | "ready" | "unknown">("idle");

  const sampleInputRef = useRef<HTMLInputElement | null>(null);
  const bodyInputRef = useRef<HTMLTextAreaElement | null>(null);

  const loadTemplates = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [result, historyResult, numbersResult] = await Promise.all([
        api.getBroadcastTemplates(),
        api.getBroadcastHistory({ page: 1, pageSize: 50 }),
        api.getNumbers(),
      ]);

      if ("error" in result) {
        console.error("Gagal memuat template:", result.error);
        setLoadError(true);
        return;
      }

      const counts: Record<string, number> = {};
      if (historyResult && !("error" in historyResult)) {
        (historyResult.data?.items ?? []).forEach((b) => {
          if (b.templateId) {
            counts[b.templateId] = (counts[b.templateId] || 0) + (b.totalSent || 0);
          }
        });
      }
      setSentCounts(counts);
      if (numbersResult.success) {
        setNumbers(numbersResult.data.filter((number) => Boolean(number.wabaId)));
      }

      const mapped: LocalTemplate[] = (result.data ?? []).map((tpl) => {
        const header = extractHeaderInfo(tpl.components);
        const handle = extractMediaSampleHandle(tpl.components);

        return {
          ...tpl,
          headerType: header.type,
          headerText: header.text || "",
          footerText: extractFooterText(tpl.components),
          buttons: extractButtons(tpl.components),
          mediaSampleName: extractMediaSampleName(tpl.components, header.type),
          mediaSampleHandle: handle,
          previewExamples: extractPreviewExamples(tpl.components),
        };
      });

      setTemplates(mapped);
      setLoadError(false);
      setCurrentPage(1);
      setSelectedTemplate((prev) => {
        const nextSorted = [...mapped].sort(compareTemplates);
        if (prev) {
          return nextSorted.find((x) => x.id === prev.id) ?? nextSorted[0] ?? null;
        }
        return nextSorted[0] ?? null;
      });
    } catch (error) {
      console.error("Error loading templates:", error);
      setLoadError(true);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const refreshTemplates = useVisibilityRefresh(
    () => loadTemplates(false),
    { intervalMs: 30_000 },
  );

  useEffect(() => {
    setLoading(true);
    void refreshTemplates().finally(() => setLoading(false));
  }, [refreshTemplates]);

  const filteredTemplates = useMemo(() => {
    return templates.filter((tpl) => {
      const matchesSearch = tpl.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = categoryFilter === "all" || String(tpl.category).toLowerCase() === categoryFilter.toLowerCase();
      const matchesStatus = statusFilter === "all" || String(tpl.status).toLowerCase() === statusFilter.toLowerCase();
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [templates, searchQuery, categoryFilter, statusFilter]);

  const sortedTemplates = useMemo(() => {
    const sorted = [...filteredTemplates].sort(compareTemplates);
    return sorted;
  }, [filteredTemplates]);

  const totalPages = Math.max(1, Math.ceil(sortedTemplates.length / PAGE_SIZE));

  const pagedTemplates = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedTemplates.slice(start, start + PAGE_SIZE);
  }, [sortedTemplates, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, categoryFilter, statusFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const exists = sortedTemplates.some((tpl) => tpl.id === selectedTemplate.id);
    if (!exists) {
      setSelectedTemplate(sortedTemplates[0] ?? null);
    }
  }, [selectedTemplate, sortedTemplates]);

  useEffect(() => {
    if (!selectedTemplate) {
      setSelectedExamples({});
      return;
    }

    const body = selectedTemplate.content || extractBodyTextFromComponents(selectedTemplate.components) || "";
    const storedExamples = selectedTemplate.previewExamples || {};
    setSelectedExamples(Object.keys(storedExamples).length > 0 ? storedExamples : buildInitialExamples(body));
  }, [selectedTemplate]);

  const variables = useMemo(() => extractVariables(formData.body), [formData.body]);

  const wabaContexts = useMemo(
    () => [...new Map(
      numbers
        .filter((number) => Boolean(number.wabaId))
        .map((number) => [String(number.wabaId), number] as const),
    ).values()],
    [numbers],
  );

  useEffect(() => {
    if (!showModal || !formData.wabaId) return;
    let active = true;
    setCapabilityStatus("loading");
    void api.getTemplateCapabilities(formData.wabaId).then((result) => {
      if (!active) return;
      if ("error" in result) { setTemplateCapabilities(null); setCapabilityStatus("unknown"); }
      else { setTemplateCapabilities(result.data.capabilities); setCapabilityStatus(result.data.degraded ? "unknown" : "ready"); }
    }).catch(() => { if (active) { setTemplateCapabilities(null); setCapabilityStatus("unknown"); } });
    return () => { active = false; };
  }, [showModal, formData.wabaId]);

  useEffect(() => {
    if (!showModal || formData.templateType !== "flow" || !formData.wabaId) return;
    let active = true;
    setFlowsLoading(true);
    setFlowsError(null);
    void api.getMetaFlows(formData.wabaId).then((result) => {
      if (!active) return;
      if ("error" in result) {
        setMetaFlows([]);
        setFlowsError(result.error);
      } else {
        setMetaFlows(result.data.flows);
        const selected = result.data.flows.find((flow) => flow.id === formData.flowId);
        if (selected) setFormData((prev) => ({ ...prev, flowName: selected.name, flowStatus: selected.status }));
        else if (formData.flowId) setFlowsError("Flow tidak lagi tersedia pada akun WhatsApp Business ini.");
      }
    }).finally(() => { if (active) setFlowsLoading(false); });
    return () => { active = false; };
  }, [showModal, formData.templateType, formData.wabaId]);

  useEffect(() => {
    if (!showModal || formData.category !== "marketing" || !formData.wabaId) return;
    let active = true;
    setCatalogsLoading(true);
    setCatalogsError(null);
    void api.getCommerceCatalogs(formData.wabaId).then((result) => {
      if (!active) return;
      if ("error" in result) {
        setMetaCatalogs([]);
        setCommerceCapability(null);
        setCatalogsError(result.error);
      } else {
        setMetaCatalogs(result.data.catalogs);
        setCommerceCapability(result.data.capability);
        const selected = result.data.catalogs.find((catalog) => catalog.id === formData.catalogId);
        if (selected) setFormData((prev) => ({ ...prev, catalogName: selected.name }));
        else if (formData.catalogId && ["catalog", "multi_product"].includes(formData.templateType)) setCatalogsError("Katalog tidak lagi tersedia.");
      }
    }).finally(() => { if (active) setCatalogsLoading(false); });
    return () => { active = false; };
  }, [showModal, formData.category, formData.wabaId]);

  useEffect(() => {
    if (!showModal || formData.templateType !== "multi_product" || !formData.wabaId || !formData.catalogId) {
      setCommerceProducts([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setProductsLoading(true);
      setProductsError(null);
      void api.getCommerceProducts({ wabaId: formData.wabaId, catalogId: formData.catalogId, q: productSearch, limit: 25 }).then((result) => {
        if (!active) return;
        if ("error" in result) { setCommerceProducts([]); setProductsError(result.error); }
        else { setCommerceProducts(result.data.products); setProductsNextCursor(result.data.nextCursor); }
      }).finally(() => { if (active) setProductsLoading(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [showModal, formData.templateType, formData.wabaId, formData.catalogId, productSearch]);

  const loadMoreCommerceProducts = async () => {
    if (!productsNextCursor || productsLoading) return;
    setProductsLoading(true);
    const result = await api.getCommerceProducts({ wabaId: formData.wabaId, catalogId: formData.catalogId, q: productSearch, after: productsNextCursor, limit: 25 });
    if ("error" in result) setProductsError(result.error);
    else {
      setCommerceProducts((current) => [...new Map([...current, ...result.data.products].map((product) => [product.id, product])).values()]);
      setProductsNextCursor(result.data.nextCursor);
    }
    setProductsLoading(false);
  };

  const previewBody = useMemo(() => {
    return formData.body || "Masukkan konten untuk melihat preview";
  }, [formData.body]);

  const selectedTemplateBody = useMemo(() => {
    if (!selectedTemplate) return "Pilih template untuk melihat preview";
    return selectedTemplate.content || extractBodyTextFromComponents(selectedTemplate.components) || "";
  }, [selectedTemplate]);

  const previewSelectedBody = useMemo(() => {
    if (!selectedTemplate) return "Pilih template untuk melihat preview";
    return selectedTemplateBody || "(Kosong)";
  }, [selectedTemplate, selectedTemplateBody]);

  const openCreateModal = () => {
    if (wabaContexts.length === 0) {
      toast.error("Belum ada akun WhatsApp Business yang terhubung.");
      return;
    }
    setEditingTemplate(null);
    setFormData({
      name: "",
      category: "marketing",
      templateType: "default",
      variableType: "number",
      language: "id",
      headerType: "none",
      headerText: "",
      headerExample: "",
      body: "",
      footerText: "",
      buttons: [],
      mediaSampleFileName: "",
      mediaSampleHandle: "",
      otpButtonType: "copy_code",
      securityRecommendation: true,
      codeExpirationMinutes: 10,
      packageName: "",
      signatureHash: "",
      flowId: "", flowName: "", flowStatus: "", flowButtonText: "Buka Formulir", flowAction: "navigate", flowScreen: "",
      catalogId: "", catalogName: "", commerceButtonText: "Lihat katalog", commerceSectionTitle: "", commerceProducts: [], carouselCards: [createCarouselCard(0), createCarouselCard(1)],
      wabaId: wabaContexts.length === 1 ? String(wabaContexts[0].wabaId) : "",
    });
    setExamples({});
    setNameError(null);
    setHeaderError(null);
    setBodyError(null);
    setFooterError(null);
    setButtonError(null);
    setMediaUploading(false);
    setMediaUploadError(null);
    setBuilderStep(1);
    setShowModal(true);
  };

  const openEditModal = (tpl: LocalTemplate) => {
    if (tpl.category?.toLowerCase() === "authentication") {
      if (!tpl.authenticationConfig?.supported) {
        toast.info("Varian Authentication ini belum didukung dan hanya dapat dilihat secara read-only.");
        setSelectedTemplate(tpl);
        return;
      }
      setEditingTemplate(tpl);
      setFormData({
        name: tpl.name, category: "authentication", templateType: "authentication_otp", variableType: "number",
        language: (tpl.language as MetaTemplateLanguageCode) || "id", headerType: "none", headerText: "", headerExample: "",
        body: "", footerText: "", buttons: [], mediaSampleFileName: "", mediaSampleHandle: "",
        otpButtonType: tpl.authenticationConfig.otpButtonType === "one_tap" ? "one_tap" : "copy_code",
        securityRecommendation: tpl.authenticationConfig.securityRecommendation,
        codeExpirationMinutes: tpl.authenticationConfig.codeExpirationMinutes,
        packageName: tpl.authenticationConfig.packageName,
        signatureHash: tpl.authenticationConfig.signatureHash,
        flowId: "", flowName: "", flowStatus: "", flowButtonText: "Buka Formulir", flowAction: "navigate", flowScreen: "",
        catalogId: "", catalogName: "", commerceButtonText: "Lihat katalog", commerceSectionTitle: "", commerceProducts: [], carouselCards: [createCarouselCard(0), createCarouselCard(1)],
        wabaId: tpl.wabaId || "",
      });
      setNameError(null); setHeaderError(null); setBodyError(null); setFooterError(null); setButtonError(null);
      setBuilderStep(tpl.metaTemplateId ? 3 : 2); setShowModal(true);
      return;
    }
    if (tpl.flowConfig) {
      if (!tpl.flowConfig.supported) {
        toast.info("Varian template Flow ini belum didukung dan hanya dapat dilihat secara read-only.");
        setSelectedTemplate(tpl);
        return;
      }
      setEditingTemplate(tpl);
      setFormData({
        name: tpl.name, category: (tpl.category?.toLowerCase() as TemplateCategory) || "marketing", templateType: "flow", variableType: "number",
        language: (tpl.language as MetaTemplateLanguageCode) || "id", headerType: "none", headerText: "", headerExample: "",
        body: tpl.flowConfig.body, footerText: tpl.flowConfig.footer, buttons: [], mediaSampleFileName: "", mediaSampleHandle: "",
        otpButtonType: "copy_code", securityRecommendation: true, codeExpirationMinutes: 10, packageName: "", signatureHash: "",
        flowId: tpl.flowConfig.flowId, flowName: `Flow ${tpl.flowConfig.flowId}`, flowStatus: "PUBLISHED",
        flowButtonText: tpl.flowConfig.buttonText, flowAction: tpl.flowConfig.action || "navigate", flowScreen: tpl.flowConfig.screen,
        catalogId: "", catalogName: "", commerceButtonText: "Lihat katalog", commerceSectionTitle: "", commerceProducts: [], carouselCards: [createCarouselCard(0), createCarouselCard(1)],
        wabaId: tpl.wabaId || "",
      });
      setNameError(null); setHeaderError(null); setBodyError(null); setFooterError(null); setButtonError(null);
      setBuilderStep(2); setShowModal(true);
      return;
    }
    if (tpl.commerceConfig) {
      if (!tpl.commerceConfig.supported) {
        toast.info("Template Commerce ini kehilangan referensi katalog/produk dan hanya dapat dilihat secara read-only.");
        setSelectedTemplate(tpl);
        return;
      }
      const selectedProducts = tpl.commerceConfig.sections.flatMap((section) => section.products).map((product) => ({
        ...product, price: "", currency: "", availability: "UNKNOWN",
      }));
      setEditingTemplate(tpl);
      setFormData({
        name: tpl.name, category: "marketing", templateType: tpl.commerceConfig.type, variableType: "number",
        language: (tpl.language as MetaTemplateLanguageCode) || "id", headerType: "none", headerText: "", headerExample: "",
        body: tpl.commerceConfig.body, footerText: tpl.commerceConfig.footer, buttons: [], mediaSampleFileName: "", mediaSampleHandle: "",
        otpButtonType: "copy_code", securityRecommendation: true, codeExpirationMinutes: 10, packageName: "", signatureHash: "",
        flowId: "", flowName: "", flowStatus: "", flowButtonText: "Buka Formulir", flowAction: "navigate", flowScreen: "",
        catalogId: tpl.commerceConfig.catalogId, catalogName: `Catalog ${tpl.commerceConfig.catalogId}`,
        commerceButtonText: tpl.commerceConfig.buttonText,
        commerceSectionTitle: tpl.commerceConfig.sections[0]?.title || "",
        commerceProducts: selectedProducts, carouselCards: [createCarouselCard(0), createCarouselCard(1)],
        wabaId: tpl.wabaId || "",
      });
      setNameError(null); setHeaderError(null); setBodyError(null); setFooterError(null); setButtonError(null);
      setBuilderStep(tpl.metaTemplateId ? 3 : 2); setShowModal(true);
      return;
    }
    if (tpl.carouselConfig) {
      if (!tpl.carouselConfig.supported) {
        toast.info("Varian Carousel ini memiliki komponen yang belum didukung dan hanya dapat dilihat read-only.");
        setSelectedTemplate(tpl);
        return;
      }
      setEditingTemplate(tpl);
      setFormData({
        name: tpl.name, category: "marketing", templateType: "carousel", variableType: "number",
        language: (tpl.language as MetaTemplateLanguageCode) || "id", headerType: "none", headerText: "", headerExample: "",
        body: tpl.carouselConfig.body, footerText: "", buttons: [], mediaSampleFileName: "", mediaSampleHandle: "",
        otpButtonType: "copy_code", securityRecommendation: true, codeExpirationMinutes: 10, packageName: "", signatureHash: "",
        flowId: "", flowName: "", flowStatus: "", flowButtonText: "Buka Formulir", flowAction: "navigate", flowScreen: "",
        catalogId: "", catalogName: "", commerceButtonText: "Lihat katalog", commerceSectionTitle: "", commerceProducts: [],
        carouselCards: tpl.carouselConfig.cards.map((card, index) => ({
          id: `carousel-import-${index}`, headerType: card.header.type === "video" ? "video" : "image",
          mediaSampleFileName: card.header.fileName || `Media Card ${index + 1}`, mediaSampleHandle: card.header.mediaHandle,
          body: card.body.text, examples: card.body.examples || {},
          buttons: card.buttons.map((button, buttonIndex) => ({ id: `carousel-import-${index}-${buttonIndex}`, type: button.type as TemplateButtonType, text: button.text, value: button.value, example: button.example })),
        })),
        wabaId: tpl.wabaId || "",
      });
      setNameError(null); setHeaderError(null); setBodyError(null); setFooterError(null); setButtonError(null);
      setBuilderStep(tpl.metaTemplateId ? 3 : 2); setShowModal(true);
      return;
    }
    if (tpl.runtimeSupport?.supported === false) {
      toast.info("Template ini memiliki komponen Meta yang belum dapat diedit di SIPESA.");
      setSelectedTemplate(tpl);
      return;
    }
    if (tpl.metaTemplateId && !["approved", "rejected", "paused"].includes(String(tpl.status).toLowerCase())) {
      toast.info(`Template berstatus ${getStatusLabel(tpl.status)} belum dapat diedit.`);
      return;
    }
    setEditingTemplate(tpl);

    const body = tpl.content || extractBodyTextFromComponents(tpl.components);
    const buttons = (tpl.buttons ?? []).map((button, index) => ({
      ...button,
      id: button.id || `edit-${index}`,
    }));

    setFormData({
      name: tpl.name,
      category: (tpl.category?.toLowerCase() as TemplateCategory) || "marketing",
      templateType: "default",
      variableType: "number",
      language: (tpl.language as MetaTemplateLanguageCode) || "id",
      headerType: tpl.headerType || "none",
      headerText: tpl.headerText || "",
      headerExample: String(tpl.components?.find?.((component: any) => String(component?.type).toUpperCase() === "HEADER")?.example?.header_text?.[0] || ""),
      body,
      footerText: tpl.footerText || "",
      buttons,
      mediaSampleFileName: tpl.mediaSampleName || "",
      mediaSampleHandle: tpl.mediaSampleHandle || "",
      otpButtonType: "copy_code",
      securityRecommendation: true,
      codeExpirationMinutes: 10,
      packageName: "",
      signatureHash: "",
      flowId: "", flowName: "", flowStatus: "", flowButtonText: "Buka Formulir", flowAction: "navigate", flowScreen: "",
      catalogId: "", catalogName: "", commerceButtonText: "Lihat katalog", commerceSectionTitle: "", commerceProducts: [], carouselCards: [createCarouselCard(0), createCarouselCard(1)],
      wabaId: tpl.wabaId || "",
    });

    const storedExamples = tpl.previewExamples || {};
    const initialExamples = buildInitialExamples(body);
    setExamples({ ...initialExamples, ...storedExamples });
    setNameError(null);
    setHeaderError(null);
    setBodyError(null);
    setFooterError(null);
    setButtonError(null);
    setMediaUploading(false);
    setMediaUploadError(null);
    setBuilderStep(2);
    setShowModal(true);
  };

  const closeModal = () => {
    if (saving) return;
    setShowModal(false);
    setEditingTemplate(null);
  };
  const editorDialogRef = useDialogFocus<HTMLDivElement>(showModal, closeModal, saving);

  const validateAll = () => {
    const nextNameError = validateTemplateName(formData.name);
    if (formData.templateType === "carousel") {
      const nextBodyError = !formData.body.trim() ? "Body utama Carousel wajib diisi." : formData.body.length > 1024 ? "Body utama Carousel maksimal 1024 karakter." : /\{\{.*?\}\}/.test(formData.body) ? "Variabel body utama Carousel belum didukung." : null;
      const carouselError = validateCarouselCards(formData.carouselCards);
      setNameError(nextNameError); setBodyError(nextBodyError); setHeaderError(carouselError); setButtonError(carouselError); setFooterError(null);
      return !nextNameError && !nextBodyError && !carouselError && carouselUploadIndex === null;
    }
    if (formData.templateType === "flow") {
      const nextBodyError = !formData.body.trim() ? "Body template Flow wajib diisi." : formData.body.length > 1024 ? "Body template Flow maksimal 1024 karakter." : /\{\{.*?\}\}/.test(formData.body) ? "Variabel body pada template Flow belum didukung." : null;
      const nextFooterError = validateFooterText(formData.footerText);
      const selectedFlow = metaFlows.find((flow) => flow.id === formData.flowId);
      const nextFlowError = !formData.flowId ? "Pilih Flow yang sudah dipublikasikan." : !selectedFlow?.eligible ? "Flow ini belum dipublikasikan atau tidak lagi tersedia." : !selectedFlow.screens.includes(formData.flowScreen) ? "Pilih destination screen yang valid." : !formData.flowButtonText.trim() || formData.flowButtonText.length > 25 ? "Label tombol Flow wajib dan maksimal 25 karakter." : null;
      setNameError(nextNameError); setBodyError(nextBodyError); setFooterError(nextFooterError); setButtonError(nextFlowError); setHeaderError(null);
      return !nextNameError && !nextBodyError && !nextFooterError && !nextFlowError;
    }
    if (["catalog", "multi_product"].includes(formData.templateType)) {
      const nextBodyError = !formData.body.trim() ? "Body template Commerce wajib diisi." : formData.body.length > 1024 ? "Body template Commerce maksimal 1024 karakter." : /\{\{.*?\}\}/.test(formData.body) ? "Variabel body Commerce belum didukung." : null;
      const nextFooterError = validateFooterText(formData.footerText);
      const selectedCatalog = metaCatalogs.find((catalog) => catalog.id === formData.catalogId);
      let commerceError: string | null = !formData.catalogId ? "Pilih katalog Meta yang terhubung." : !selectedCatalog?.eligible ? "Katalog tidak lagi tersedia." : !formData.commerceButtonText.trim() || formData.commerceButtonText.length > 25 ? "Label tombol Commerce wajib dan maksimal 25 karakter." : null;
      if (!commerceError && formData.templateType === "multi_product") {
        if (formData.commerceProducts.length < 2 || formData.commerceProducts.length > 30) commerceError = "Multi-product memerlukan 2-30 produk.";
        else if (new Set(formData.commerceProducts.map((product) => product.id)).size !== formData.commerceProducts.length) commerceError = "Produk tidak boleh duplikat.";
        else if (formData.commerceSectionTitle.length > 24) commerceError = "Judul section maksimal 24 karakter.";
      }
      setNameError(nextNameError); setBodyError(nextBodyError); setFooterError(nextFooterError); setButtonError(commerceError); setHeaderError(null);
      return !nextNameError && !nextBodyError && !nextFooterError && !commerceError;
    }
    if (formData.category === "authentication") {
      let authError: string | null = null;
      if (!["copy_code", "one_tap"].includes(formData.otpButtonType)) authError = "Metode OTP belum didukung.";
      else if (!Number.isInteger(formData.codeExpirationMinutes) || formData.codeExpirationMinutes < 1 || formData.codeExpirationMinutes > 90) authError = "Masa berlaku kode wajib 1-90 menit.";
      else if (formData.otpButtonType === "one_tap" && !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(formData.packageName)) authError = "Android package name tidak valid.";
      else if (formData.otpButtonType === "one_tap" && !/^[A-Za-z0-9+/]{11}$/.test(formData.signatureHash)) authError = "App signature hash wajib 11 karakter Base64.";
      setNameError(nextNameError); setButtonError(authError); setHeaderError(null); setBodyError(null); setFooterError(null);
      return !nextNameError && !authError;
    }
    let nextHeaderError =
      formData.headerType === "text"
        ? validateHeaderText(formData.headerText)
        : ["image", "video", "document"].includes(formData.headerType) && !formData.mediaSampleFileName
          ? "Pilih file media contoh terlebih dahulu."
          : ["image", "video", "document"].includes(formData.headerType) && !hasUsableMetaMediaHandle(formData.mediaSampleHandle)
          ? "File media contoh wajib diunggah sebelum menyimpan."
          : null;
    const nextBodyError = validateBody(formData.body);
    const nextFooterError = validateFooterText(formData.footerText);
    const nextButtonError = validateButtons(formData.buttons, formData.category);
    if (formData.headerType === "text" && /\{\{1\}\}/.test(formData.headerText) && !formData.headerExample.trim()) {
      nextHeaderError = "Contoh variabel header wajib diisi.";
    }

    setNameError(nextNameError);
    setHeaderError(nextHeaderError);
    setBodyError(nextBodyError);
    setFooterError(nextFooterError);
    setButtonError(nextButtonError);

    if (nextHeaderError && ["image", "video", "document"].includes(formData.headerType)) {
      toast.warning("Silakan unggah file media contoh terlebih dahulu.");
    }

    const missingExample = variables.find((index) => !String(examples[index] ?? "").trim());
    if (missingExample) {
      toast.warning(`Contoh untuk variabel {{${missingExample}}} wajib diisi.`);
    }

    return !mediaUploading && !nextNameError && !nextHeaderError && !nextBodyError && !nextFooterError && !nextButtonError && !missingExample;
  };

  const persistTemplate = async (submitForReview: boolean) => {
    if (saving) return;
    if (!validateAll()) return;
    if (editingTemplate?.metaTemplateId && formData.category === "authentication") {
      toast.info("Template Authentication yang sudah dikirim ke Meta bersifat read-only di SIPESA.");
      return;
    }
    if (editingTemplate?.metaTemplateId && formData.templateType === "flow") {
      toast.info("Template Flow yang sudah dikirim ke Meta bersifat read-only di SIPESA.");
      return;
    }
    if (editingTemplate?.metaTemplateId && ["catalog", "multi_product"].includes(formData.templateType)) {
      toast.info("Template Commerce yang sudah dikirim ke Meta bersifat read-only di SIPESA.");
      return;
    }
    if (editingTemplate?.metaTemplateId && formData.templateType === "carousel") {
      toast.info("Template Carousel yang sudah dikirim ke Meta bersifat read-only di SIPESA.");
      return;
    }
    if (!formData.wabaId) {
      toast.error("Pilih WABA pemilik template.");
      return;
    }

    setSaving(true);
    try {
      const payload = formData.category === "authentication" ? {
        name: formData.name.trim(), category: "authentication", language: formData.language, content: "", variables: [], wabaId: formData.wabaId,
        normalizedModel: {
          templateType: "authentication_otp",
          otpButtonType: formData.otpButtonType,
          securityRecommendation: formData.securityRecommendation,
          codeExpirationMinutes: formData.codeExpirationMinutes,
          packageName: formData.otpButtonType === "one_tap" ? formData.packageName.trim() : undefined,
          signatureHash: formData.otpButtonType === "one_tap" ? formData.signatureHash.trim() : undefined,
        },
      } : formData.templateType === "flow" ? {
        name: formData.name.trim(), category: formData.category, language: formData.language, content: formData.body.trim(), variables: [], wabaId: formData.wabaId,
        normalizedModel: {
          templateType: "flow",
          body: { text: formData.body.trim() },
          footer: { text: formData.footerText.trim() },
          flow: { id: formData.flowId, buttonText: formData.flowButtonText.trim(), action: "navigate", screen: formData.flowScreen },
        },
      } : formData.templateType === "carousel" ? {
        name: formData.name.trim(), category: "marketing", language: formData.language, content: formData.body.trim(), variables: [], wabaId: formData.wabaId,
        normalizedModel: {
          templateType: "carousel",
          body: { text: formData.body.trim() },
          cards: formData.carouselCards.map((card) => ({
            header: { type: card.headerType, mediaHandle: card.mediaSampleHandle, fileName: card.mediaSampleFileName },
            body: { text: card.body.trim(), examples: card.examples },
            buttons: card.buttons.map((button) => ({ type: button.type, text: button.text.trim(), value: button.value.trim(), example: button.example?.trim() || "" })),
          })),
        },
      } : ["catalog", "multi_product"].includes(formData.templateType) ? {
        name: formData.name.trim(), category: "marketing", language: formData.language, content: formData.body.trim(), variables: [], wabaId: formData.wabaId,
        normalizedModel: {
          templateType: formData.templateType,
          body: { text: formData.body.trim() },
          footer: { text: formData.footerText.trim() },
          commerce: {
            catalogId: formData.catalogId,
            buttonText: formData.commerceButtonText.trim(),
            sections: formData.templateType === "multi_product" ? [{
              title: formData.commerceSectionTitle.trim(),
              products: formData.commerceProducts.map((product) => ({ id: product.id, retailerId: product.retailerId, name: product.name, imageUrl: product.imageUrl })),
            }] : [],
          },
        },
      } : {
        name: formData.name.trim(),
        category: formData.category,
        language: formData.language,
        content: formData.body.trim(),
        variables: variables.map((v) => `{{${v}}}`),
        wabaId: formData.wabaId,
        normalizedModel: {
          templateType: formData.templateType,
          variableType: formData.variableType,
          header: {
            type: formData.headerType,
            text: formData.headerText,
            example: formData.headerExample,
            mediaHandle: formData.mediaSampleHandle,
            fileName: formData.mediaSampleFileName,
          },
          body: { text: formData.body.trim(), examples },
          footer: { text: formData.footerText },
          buttons: formData.buttons.map((button) => ({
            type: button.type,
            text: button.text,
            ...(button.type === "URL" ? { url: button.value } : {}),
            ...(button.type === "PHONE_NUMBER" ? { phone: button.value } : {}),
            ...(["URL", "COPY_CODE"].includes(button.type) ? { example: button.example || "" } : {}),
          })),
        },
      };

      const result = editingTemplate
        ? await api.updateBroadcastTemplate(editingTemplate.id, payload)
        : await api.saveBroadcastTemplate(payload);

      if ("error" in result) {
        toast.error("Gagal menyimpan template: " + result.error);
        return;
      }

      const targetId = editingTemplate?.id || String(result.data?.id || "");
      const shouldPush = submitForReview && !editingTemplate?.metaTemplateId;
      if (shouldPush) {
        const pushResult = await api.pushTemplateToMeta(targetId);
        if ("error" in pushResult) {
          toast.error("Draf tersimpan, tetapi gagal dikirim ke Meta: " + pushResult.error);
          await refreshTemplates();
          return;
        }
      }

      toast.success(submitForReview ? "Template berhasil dikirim untuk ditinjau Meta." : editingTemplate ? "Template berhasil diupdate!" : "Draf template berhasil disimpan!");
      setShowModal(false);
      setEditingTemplate(null);
      await refreshTemplates();
    } catch (error) {
      console.error("Error saving template:", error);
      toast.error("Gagal menyimpan template");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => persistTemplate(false);
  const handleSubmitReview = async () => persistTemplate(true);

  const handleDelete = (templateId: string) => {
    setTemplateIdToDelete(templateId);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!templateIdToDelete || deletingTemplate) return;

    setDeletingTemplate(true);
    try {
      const result = await api.deleteBroadcastTemplate(templateIdToDelete);
      if ("error" in result) {
        toast.error("Gagal menghapus template: " + result.error);
        return;
      }

      toast.success("Template berhasil dihapus!");
      setDeleteModalOpen(false);
      setTemplateIdToDelete(null);
      await refreshTemplates();
    } catch (error) {
      console.error("Error deleting template:", error);
      toast.error("Gagal menghapus template");
    } finally {
      setDeletingTemplate(false);
    }
  };

  const handleSyncFromMeta = async () => {
    setSyncing(true);
    try {
      const result = await api.syncTemplatesDefault();

      if ("error" in result) {
        toast.error("Gagal sync template: " + result.error);
        return;
      }

      toast.success(`Berhasil sync ${result.data?.total ?? 0} template dari Meta`);
      await refreshTemplates();
    } catch (error) {
      console.error("Error sync templates:", error);
      toast.error("Terjadi kesalahan saat sync template");
    } finally {
      setSyncing(false);
    }
  };

  const handlePushToMeta = async (templateId: string) => {
    if (pushingId) return;
    setPushingId(templateId);
    try {
      const result = await api.pushTemplateToMeta(templateId);

      if ("error" in result) {
        toast.error("Gagal submit ke Meta: " + result.error);
        return;
      }

      toast.success("Template berhasil disubmit ke Meta");
      setTemplateToSubmit(null);
      await refreshTemplates();
    } catch (error) {
      console.error("Error pushing template:", error);
      toast.error("Terjadi kesalahan saat submit template ke Meta");
    } finally {
      setPushingId(null);
    }
  };

  const handleNameChange = (value: string) => {
    const normalized = value
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 512);

    setFormData((prev) => ({ ...prev, name: normalized }));
    setNameError(validateTemplateName(normalized));
  };

  const handleBodyChange = (value: string) => {
    setFormData((prev) => ({ ...prev, body: value }));
    setBodyError(validateBody(value));
    setExamples((prev) => {
      const base = { ...prev };
      extractVariables(value).forEach((idx) => {
        if (!base[idx]) base[idx] = guessVariableExample(value, idx);
      });
      return base;
    });
  };

  const clearMediaSample = () => {
    setFormData((prev) => ({ ...prev, mediaSampleFileName: "", mediaSampleHandle: "" }));
    setMediaUploadError(null);
    setHeaderError(null);
    if (sampleInputRef.current) sampleInputRef.current.value = "";
  };

  const handleMediaSampleFile = async (file: File) => {
    const error = validateMediaSampleFile(file, formData.headerType);
    setFormData((prev) => ({ ...prev, mediaSampleFileName: file.name, mediaSampleHandle: "" }));
    setMediaUploadError(error);
    setHeaderError(error);
    if (error) return;
    if (!formData.wabaId) {
      const ownershipError = "Akun WhatsApp Business template belum tersedia.";
      setMediaUploadError(ownershipError);
      setHeaderError(ownershipError);
      return;
    }

    setMediaUploading(true);
    setMediaUploadError(null);
    setHeaderError(null);
    try {
      const result = await api.uploadTemplateSample(file, formData.wabaId, formData.headerType as MediaHeaderType);
      if ("error" in result) {
        setMediaUploadError(result.error);
        setHeaderError(result.error);
        return;
      }
      if (!hasUsableMetaMediaHandle(result.data.handle)) {
        const invalidHandle = "Meta tidak mengembalikan media sample handle yang valid.";
        setMediaUploadError(invalidHandle);
        setHeaderError(invalidHandle);
        return;
      }
      setFormData((prev) => ({ ...prev, mediaSampleFileName: file.name, mediaSampleHandle: result.data.handle.trim() }));
      setHeaderError(null);
      toast.success("Contoh media siap");
    } catch (error) {
      console.error("Template media sample upload failed:", error);
      const message = "Layanan upload sementara tidak dapat dijangkau. Silakan coba lagi.";
      setMediaUploadError(message);
      setHeaderError(message);
    } finally {
      setMediaUploading(false);
    }
  };

  const handleCarouselMediaSample = async (cardIndex: number, file: File) => {
    const card = formData.carouselCards[cardIndex];
    if (!card) return;
    const error = validateMediaSampleFile(file, card.headerType);
    setFormData((prev) => ({ ...prev, carouselCards: prev.carouselCards.map((item, index) => index === cardIndex ? { ...item, mediaSampleFileName: file.name, mediaSampleHandle: "" } : item) }));
    if (error) { setHeaderError(error); return; }
    if (!formData.wabaId) { setHeaderError("Akun WhatsApp Business template belum tersedia."); return; }
    setCarouselUploadIndex(cardIndex); setHeaderError(null);
    try {
      const result = await api.uploadTemplateSample(file, formData.wabaId, card.headerType);
      if ("error" in result || !hasUsableMetaMediaHandle(result.data?.handle)) {
        setHeaderError("error" in result ? result.error : `Meta tidak mengembalikan handle media Card ${cardIndex + 1}.`);
        return;
      }
      setFormData((prev) => ({ ...prev, carouselCards: prev.carouselCards.map((item, index) => index === cardIndex ? { ...item, mediaSampleFileName: file.name, mediaSampleHandle: result.data.handle.trim() } : item) }));
      toast.success(`Contoh media Card ${cardIndex + 1} siap`);
    } catch {
      setHeaderError("Layanan upload media Carousel sementara tidak dapat dijangkau.");
    } finally { setCarouselUploadIndex(null); }
  };

  const handleAddVariable = () => {
    const current = formData.body || "";
    const nums = extractVariables(current);
    const nextIndex = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    const token = `{{${nextIndex}}}`;

    const textarea = bodyInputRef.current;
    const cursor = textarea?.selectionStart ?? current.length;
    const separator = cursor > 0 && !/\s$/.test(current.slice(0, cursor)) ? " " : "";
    const newBody = `${current.slice(0, cursor)}${separator}${token}${current.slice(cursor)}`;
    setFormData((prev) => ({ ...prev, body: newBody }));
    setBodyError(validateBody(newBody));
    setExamples((prev) => ({
      ...prev,
      [nextIndex]: prev[nextIndex] || guessVariableExample(newBody, nextIndex),
    }));
    requestAnimationFrame(() => {
      const nextCursor = cursor + separator.length + token.length;
      bodyInputRef.current?.focus();
      bodyInputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleButtonChange = (id: string, field: "text" | "value" | "type" | "example", value: string) => {
    const nextButtons = formData.buttons.map((button) => button.id === id ? { ...button, [field]: value } : button) as TemplateButton[];
    setFormData((prev) => ({ ...prev, buttons: nextButtons }));
    setButtonError(validateButtons(nextButtons, formData.category));
  };

  const addButton = (type: TemplateButtonType) => {
    if (!canAddButtonType(formData.buttons, type, formData.category)) {
      setButtonError("Tombol ini tidak dapat ditambahkan pada kombinasi saat ini.");
      return;
    }
    const existingQuick = formData.buttons.filter((button) => button.type === "QUICK_REPLY").length;
    const existingActions = formData.buttons.length - existingQuick;
    if (type === "QUICK_REPLY" && existingQuick >= 10) return setButtonError("Maksimal 10 tombol Quick Reply.");
    if (type !== "QUICK_REPLY" && existingActions >= 4) return setButtonError("Maksimal 4 tombol tindakan.");
    if (type === "URL" && formData.buttons.filter((button) => button.type === "URL").length >= 2) return setButtonError("Maksimal dua tombol website.");
    if (type === "PHONE_NUMBER" && formData.buttons.some((button) => button.type === "PHONE_NUMBER")) return setButtonError("Maksimal satu tombol telepon.");
    if (type === "COPY_CODE" && formData.category !== "marketing") return setButtonError("Salin Kode hanya tersedia untuk kategori Marketing.");
    if (type === "COPY_CODE" && formData.buttons.some((button) => button.type === "COPY_CODE")) return setButtonError("Maksimal satu tombol Salin Kode.");
    const next = [...formData.buttons, { id: crypto.randomUUID(), type, text: type === "COPY_CODE" ? "Salin kode promo" : "", value: "", example: "" }];
    setFormData((prev) => ({ ...prev, buttons: next }));
    setButtonError(null);
  };

  const removeButton = (id: string) => {
    const next = formData.buttons.filter((button) => button.id !== id);
    setFormData((prev) => ({ ...prev, buttons: next }));
    setButtonError(validateButtons(next, formData.category));
  };

  const moveButton = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= formData.buttons.length) return;
    const next = [...formData.buttons];
    [next[index], next[target]] = [next[target], next[index]];
    setFormData((prev) => ({ ...prev, buttons: next }));
  };

  const applyBodyFormatting = (marker: "*" | "_" | "~" | "```") => {
    const textarea = bodyInputRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = formData.body.slice(start, end) || "teks";
    const next = `${formData.body.slice(0, start)}${marker}${selected}${marker}${formData.body.slice(end)}`;
    handleBodyChange(next);
    requestAnimationFrame(() => textarea.focus());
  };

  const canAdvanceSetup = Boolean(formData.wabaId && (
    (["marketing", "utility"].includes(formData.category) && formData.templateType === "default")
    || (["marketing", "utility"].includes(formData.category) && formData.templateType === "flow" && templateCapabilities?.flow?.create === true)
    || (formData.category === "marketing" && formData.templateType === "carousel")
    || (formData.category === "marketing" && ["catalog", "multi_product"].includes(formData.templateType) && commerceCapability?.catalogEligible)
    || (formData.category === "authentication" && formData.templateType === "authentication_otp")
  ));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Memuat template...</p>
        </div>
      </div>
    );
  }

  const selectedVars = extractVariables(selectedTemplateBody);
  const selectedCurrentRejectionReason = selectedTemplate
    ? currentRejectionReason(selectedTemplate.status, selectedTemplate.rejectionReason)
    : null;
  const hasActiveTemplateFilter = searchQuery.trim().length > 0 || categoryFilter !== "all" || statusFilter !== "all";
  const templateToDelete = templates.find((template) => template.id === templateIdToDelete) ?? null;
  const resetTemplateFilters = () => {
    setSearchQuery("");
    setCategoryFilter("all");
    setStatusFilter("all");
  };

  return (
    <div className="w-full p-6 md:p-8 bg-white xl:h-full flex flex-col xl:overflow-hidden">
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">Template Pesan</h1>
          <p className="text-sm text-slate-500 mt-1.5 leading-relaxed break-words whitespace-normal max-w-2xl">
            Kelola template pesan untuk broadcast WhatsApp Anda.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={handleSyncFromMeta}
            disabled={syncing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Menyinkronkan..." : "Sinkronkan dari Meta"}
          </Button>

          <Button onClick={openCreateModal} className="bg-primary hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" />
            Buat Template Baru
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-6 flex-1 min-h-0 xl:overflow-hidden">
        <div className="overflow-hidden rounded-lg shadow-sm bg-white flex flex-col xl:h-full min-h-0">
          <div className="px-6 py-4 border-b bg-white">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex flex-col md:flex-row flex-1 md:items-center gap-3 w-full max-w-xl">
                <div className="relative w-full md:flex-1">
                  <Input
                    id="template-search"
                    aria-label="Cari template pesan"
                    type="text"
                    placeholder="Cari nama template..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 w-full"
                  />
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                </div>

                <div className="flex gap-2 w-full md:w-auto">
                  <select
                    aria-label="Filter kategori template"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="flex-1 md:flex-initial px-3 py-2 border rounded-lg bg-white text-sm text-slate-700 min-w-0 md:min-w-[130px]"
                  >
                    <option value="all">Semua Kategori</option>
                    <option value="marketing">Marketing</option>
                    <option value="utility">Utility</option>
                    <option value="authentication">Authentication</option>
                  </select>

                  <select
                    aria-label="Filter status template"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="flex-1 md:flex-initial px-3 py-2 border rounded-lg bg-white text-sm text-slate-700 min-w-0 md:min-w-[130px]"
                  >
                    <option value="all">Semua Status</option>
                    <option value="approved">Disetujui</option>
                    <option value="pending">Menunggu</option>
                    <option value="rejected">Ditolak</option>
                    <option value="draft">Draf</option>
                    <option value="paused">Dijeda</option>
                    <option value="disabled">Dinonaktifkan</option>
                    <option value="missing">Tidak ditemukan di Meta</option>
                    <option value="deleted">Dihapus di Meta</option>
                  </select>
                </div>
              </div>

              {sortedTemplates.length > PAGE_SIZE && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    aria-label="Halaman template sebelumnya"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <div className="text-sm text-slate-600 min-w-[72px] text-center">
                    {currentPage}/{totalPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    aria-label="Halaman template berikutnya"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {loadError && templates.length === 0 ? (
            <div className="p-12 text-center bg-white border-t" role="alert">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 text-red-300 opacity-70" aria-hidden="true" />
              <h3 className="mb-2 font-semibold text-slate-800">Template belum dapat dimuat.</h3>
              <p className="text-sm text-slate-500 mb-4">Periksa koneksi lalu coba lagi.</p>
              <Button variant="outline" onClick={() => void loadTemplates(true)}>Coba Lagi</Button>
            </div>
          ) : templates.length === 0 ? (
            <div className="p-12 text-center bg-white border-t">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-20" />
              <h3 className="mb-2">Belum ada template WhatsApp.</h3>
              <p className="text-muted-foreground mb-4">
                Buat template pertama Anda atau sync dari Meta
              </p>
              <Button onClick={openCreateModal} className="bg-primary hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                Buat Template
              </Button>
            </div>
          ) : sortedTemplates.length === 0 ? (
            <div className="p-12 text-center bg-white border-t">
              <Search className="w-12 h-12 mx-auto mb-4 text-slate-300" aria-hidden="true" />
              <h3 className="mb-2 font-semibold text-slate-800">Tidak ada template yang cocok.</h3>
              <p className="text-sm text-slate-500 mb-4">Ubah pencarian atau filter untuk melihat template lain.</p>
              {hasActiveTemplateFilter && <Button variant="outline" onClick={resetTemplateFilters}>Reset pencarian dan filter</Button>}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto overflow-x-auto bg-white border-t min-h-0">
              {loadError && (
                <div className="sticky left-0 flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800" role="status">
                  <span>Data terakhir ditampilkan. Gagal memperbarui template.</span>
                  <button type="button" className="font-semibold underline" onClick={() => void loadTemplates(false)}>Coba Lagi</button>
                </div>
              )}
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="px-5 py-3.5">Nama template</th>
                    <th className="px-5 py-3.5 hidden sm:table-cell">Kategori</th>
                    <th className="px-5 py-3.5 hidden sm:table-cell">Bahasa</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-center hidden md:table-cell" title="Jumlah pesan terkirim dari semua broadcast">Pesan Terkirim</th>
                    <th className="px-5 py-3.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedTemplates.map((template) => {
                    const isSelected = selectedTemplate?.id === template.id;
                    const sentCount = sentCounts[template.id] || 0;
                    const rejectionReason = currentRejectionReason(template.status, template.rejectionReason);

                    return (
                      <tr
                        key={template.id}
                        onClick={() => setSelectedTemplate(template)}
                        className={`group cursor-pointer transition-colors hover:bg-slate-50/80 ${isSelected ? "bg-slate-50" : ""
                          }`}
                      >
                        <td className="px-5 py-3 text-sm font-medium text-slate-900">
                          <span className="block truncate max-w-[200px]" title={template.name}>
                            {template.name}
                          </span>
                          <span className="block text-[11px] font-normal text-slate-500 mt-0.5">
                            {formatTemplateDate(template.createdAt)}{template.wabaId ? ` · WABA ${template.wabaId}` : " · WABA belum terselesaikan"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-600 hidden sm:table-cell">
                          <Badge variant="outline" className="capitalize text-xs font-normal">
                            {template.category} · {template.category?.toLowerCase() === "authentication" ? "OTP" : template.flowConfig ? "Flow" : template.commerceConfig ? (template.commerceConfig.type === "multi_product" ? "Multi-product" : "Catalog") : "Default"}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-600 hidden sm:table-cell">
                          <Badge variant="secondary" className="uppercase text-xs font-medium">
                            {template.language}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-sm">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusColor(template.status)}`}>
                            {getStatusLabel(template.status)}
                          </span>
                          {rejectionReason && <span className="block mt-1 text-[11px] text-red-600" title={rejectionReason}>Alasan penolakan tersedia</span>}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700 text-center font-medium hidden md:table-cell">
                          {sentCount.toLocaleString("id-ID")}
                        </td>
                        <td className="px-5 py-3 text-sm text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            {template.status === "draft" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setTemplateToSubmit(template)}
                                aria-label={`Kirim template ${template.name} untuk ditinjau Meta`}
                                className="h-8 px-2.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border-emerald-100 hover:border-emerald-200"
                                disabled={pushingId !== null}
                              >
                                <CloudUpload className={`w-3.5 h-3.5 sm:mr-1.5 ${pushingId === template.id ? "animate-spin" : ""}`} />
                                <span className="hidden sm:inline">Kirim ke Meta</span>
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditModal(template)}
                              aria-label={`Edit template ${template.name}`}
                              className="h-8 px-2.5"
                              disabled={(template.category?.toLowerCase() === "authentication"
                                ? !template.authenticationConfig?.supported
                                : template.flowConfig ? !template.flowConfig.supported : template.commerceConfig ? !template.commerceConfig.supported : template.runtimeSupport?.supported === false)
                                || Boolean(template.metaTemplateId && !["approved", "rejected", "paused"].includes(String(template.status).toLowerCase()))}
                            >
                              <Edit className="w-3.5 h-3.5 sm:mr-1.5" />
                              <span className="hidden sm:inline">Edit</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDelete(template.id)}
                              aria-label={`Hapus template ${template.name}`}
                              className="h-8 px-2.5 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-100 hover:border-red-200"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="p-6 bg-white rounded-lg shadow-sm flex flex-col xl:h-full min-h-0 xl:overflow-hidden">
          <div className="flex items-center gap-2 mb-4 flex-shrink-0">
            <Eye className="w-4 h-4" />
            <h3>Preview Template</h3>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 pr-1">
            {!selectedTemplate ? (
              <p className="text-sm text-muted-foreground">Pilih template untuk melihat preview</p>
            ) : (
              <div className="space-y-5">
                {selectedTemplate.category?.toLowerCase() === "authentication" && selectedTemplate.authenticationConfig?.supported && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900" role="status">
                    Template Authentication dikelola dengan builder OTP khusus. Pengiriman memerlukan workflow OTP khusus dan tidak tersedia di Broadcast atau Chat normal.
                  </div>
                )}
                {selectedTemplate.flowConfig?.supported && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" role="status">Template menggunakan Flow yang dikelola di Meta. Runtime Broadcast/Chat belum diaktifkan sampai lifecycle flow_token per penerima tersedia.</div>
                )}
                {selectedTemplate.commerceConfig?.supported && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">Template Commerce mereferensikan katalog Meta. Runtime Broadcast/Chat difilter sampai produk send-time dapat divalidasi terhadap sender.</div>
                )}
                {((selectedTemplate.category?.toLowerCase() === "authentication" && !selectedTemplate.authenticationConfig?.supported) || (selectedTemplate.category?.toLowerCase() !== "authentication" && !selectedTemplate.flowConfig?.supported && !selectedTemplate.commerceConfig?.supported && selectedTemplate.runtimeSupport?.supported === false)) && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
                    Template ini memiliki komponen Meta yang belum dapat diedit di SIPESA. Template ditampilkan read-only dan tidak didukung untuk pengiriman.
                  </div>
                )}
                {selectedCurrentRejectionReason && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <strong className="block">Alasan penolakan</strong>
                    <span>{selectedCurrentRejectionReason}</span>
                  </div>
                )}
                {selectedTemplate.category?.toLowerCase() === "authentication" && selectedTemplate.authenticationConfig?.supported ? (
                  <AuthenticationPreview
                    method={selectedTemplate.authenticationConfig.otpButtonType === "one_tap" ? "one_tap" : "copy_code"}
                    securityRecommendation={selectedTemplate.authenticationConfig.securityRecommendation}
                    expiryMinutes={selectedTemplate.authenticationConfig.codeExpirationMinutes}
                  />
                ) : selectedTemplate.flowConfig?.supported ? (
                  <FlowPreview body={selectedTemplate.flowConfig.body} footer={selectedTemplate.flowConfig.footer} buttonText={selectedTemplate.flowConfig.buttonText} />
                ) : selectedTemplate.commerceConfig?.supported ? (
                  <CommercePreview type={selectedTemplate.commerceConfig.type === "multi_product" ? "multi_product" : "catalog"} body={selectedTemplate.commerceConfig.body} footer={selectedTemplate.commerceConfig.footer} buttonText={selectedTemplate.commerceConfig.buttonText} products={selectedTemplate.commerceConfig.sections.flatMap((section) => section.products).map((product) => ({ ...product, price: "", currency: "", availability: "UNKNOWN" }))} />
                ) : selectedTemplate.carouselConfig?.supported ? (
                  <CarouselPreview body={selectedTemplate.carouselConfig.body} cards={selectedTemplate.carouselConfig.cards.map((card, index) => ({ id: `selected-carousel-${index}`, headerType: card.header.type === "video" ? "video" : "image", mediaSampleFileName: card.header.fileName, mediaSampleHandle: card.header.mediaHandle, body: card.body.text, examples: card.body.examples || {}, buttons: card.buttons.map((button, buttonIndex) => ({ id: `selected-carousel-button-${index}-${buttonIndex}`, type: button.type as TemplateButtonType, text: button.text, value: button.value, example: button.example })) }))} />
                ) : (
                  <WhatsAppBubblePreview
                    headerType={selectedTemplate.headerType || "none"}
                    headerText={selectedTemplate.headerText}
                    mediaSampleName={selectedTemplate.mediaSampleName}
                    body={previewSelectedBody}
                    footer={selectedTemplate.footerText}
                    buttons={selectedTemplate.buttons}
                  />
                )}

                {selectedTemplate.status === "draft" && (
                  <div className="mt-4 pt-4 border-t flex justify-end">
                    <Button
                      onClick={() => setTemplateToSubmit(selectedTemplate)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl"
                      disabled={pushingId !== null}
                    >
                      <CloudUpload className={`w-4 h-4 mr-2 ${pushingId === selectedTemplate.id ? "animate-spin" : ""}`} />
                      Kirim untuk Ditinjau Meta
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/50 p-2 sm:p-6">
          <div ref={editorDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="template-editor-title" className="w-full max-w-5xl bg-white rounded-lg shadow-lg flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <h3 id="template-editor-title">{editingTemplate ? "Edit Template" : "Buat Template Baru"}</h3>
              <Button variant="ghost" size="sm" aria-label="Tutup editor template" onClick={closeModal} disabled={saving}>
                <X className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
            <nav aria-label="Tahapan pembuatan template" className="border-b px-4 py-3 sm:px-6">
              <ol className="grid grid-cols-3 gap-2">
                {["Siapkan Template", "Edit Template", "Kirim untuk Ditinjau"].map((label, index) => {
                  const step = (index + 1) as 1 | 2 | 3;
                  return (
                    <li key={label} className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-xs sm:text-sm ${builderStep === step ? "bg-emerald-50 font-semibold text-emerald-700" : builderStep > step ? "text-emerald-700" : "text-slate-500"}`} aria-current={builderStep === step ? "step" : undefined}>
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${builderStep >= step ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"}`}>{builderStep > step ? "✓" : step}</span>
                      <span className="truncate">{label}</span>
                    </li>
                  );
                })}
              </ol>
            </nav>

            <div className={`grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto p-4 sm:p-6 ${builderStep === 1 ? "lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)] xl:gap-8" : "xl:grid-cols-[1.25fr_0.75fr]"}`}>
              <div className="space-y-6">
                {builderStep === 1 ? (
                  <div className="space-y-8">
                    <header className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Langkah 1 dari 3</p>
                      <h4 className="text-xl font-semibold tracking-tight text-slate-900">Siapkan template</h4>
                      <p className="max-w-2xl text-sm leading-6 text-slate-600">Pilih kategori dan tipe template. Periksa contoh di panel preview sebelum melanjutkan ke editor.</p>
                    </header>
                    {wabaContexts.length === 0 ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
                        Belum ada akun WhatsApp Business yang terhubung.
                      </div>
                    ) : wabaContexts.length > 1 ? (
                      <div>
                        <Label htmlFor="template-waba-setup">Akun WhatsApp Business *</Label>
                        <select id="template-waba-setup" aria-label="Akun WhatsApp Business pemilik template" className="mt-2 w-full rounded-lg border bg-white p-3" value={formData.wabaId} disabled={Boolean(editingTemplate)} onChange={(e) => setFormData((prev) => ({ ...prev, wabaId: e.target.value }))}>
                          <option value="">Pilih akun WhatsApp Business</option>
                          {wabaContexts.map((number) => (
                            <option key={number.wabaId!} value={number.wabaId!}>{number.name} · {number.wabaId}</option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    <fieldset className="space-y-3" role="radiogroup" aria-labelledby="template-category-heading">
                      <legend id="template-category-heading" className="text-sm font-semibold text-slate-900">1. Pilih kategori *</legend>
                      <p className="-mt-2 text-xs leading-5 text-slate-500">Kategori menentukan tujuan dan aturan template di Meta.</p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {([
                          ["marketing", "Marketing", "Promosi, penawaran, dan engagement pelanggan."],
                          ["utility", "Utility", "Pembaruan transaksi dan informasi layanan."],
                          ["authentication", "Authentication", "Kode OTP dengan struktur khusus Meta."],
                        ] as const).map(([value, label, description]) => <CategoryCard key={value} value={value} title={label} description={description} selected={formData.category === value} onSelect={() => setFormData((prev) => ({ ...prev, category: value, templateType: value === "authentication" ? "authentication_otp" : "default" }))} />)}
                      </div>
                    </fieldset>
                    <fieldset className="space-y-3" role="radiogroup" aria-labelledby="template-type-heading">
                      <legend id="template-type-heading" className="text-sm font-semibold text-slate-900">2. Pilih tipe template *</legend>
                      <p className="-mt-2 text-xs leading-5 text-slate-500">Status menunjukkan dukungan builder dan kesiapan resource akun.</p>
                      {capabilityStatus === "unknown" && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Status ketersediaan belum dapat diperiksa. Template Default tetap dapat digunakan.</div>}
                      <div className="space-y-2.5">
                        <TemplateTypeCard title={formData.category === "authentication" ? "One-time passcode" : "Default"} description={formData.category === "authentication" ? "Builder OTP khusus dengan struktur resmi Meta." : "Template normal dengan komponen yang didukung end-to-end."} status="Available" tone="available" selected={formData.category === "authentication" ? formData.templateType === "authentication_otp" : formData.templateType === "default"} onSelect={() => setFormData((prev) => ({ ...prev, templateType: prev.category === "authentication" ? "authentication_otp" : "default" }))} />
                        {formData.category !== "authentication" && <TemplateTypeCard title="Flow" description={templateCapabilities?.flow?.state === "supported" ? `${templateCapabilities.flow.eligibleResourceCount} Flow published siap digunakan.` : templateCapabilities?.flow?.state === "no_resource" ? "Belum ada Flow published yang siap digunakan." : "Gunakan Flow yang sudah dibuat dan dikelola di Meta."} status={capabilityStatus === "loading" ? "Checking" : templateCapabilities?.flow?.state === "supported" ? "Available" : templateCapabilities?.flow?.state === "no_resource" ? "No resource" : "Conditional"} tone={templateCapabilities?.flow?.state === "supported" ? "available" : templateCapabilities?.flow?.state === "no_resource" ? "no_resource" : "conditional"} unavailable={templateCapabilities?.flow?.create !== true} selected={formData.templateType === "flow"} onSelect={() => setFormData((prev) => ({ ...prev, templateType: "flow" }))} />}
                        {formData.category === "marketing" && <TemplateTypeCard title="Carousel" description="Pesan dengan beberapa kartu yang dapat digeser." status="Runtime deferred" tone="deferred" selected={formData.templateType === "carousel"} onSelect={() => setFormData((prev) => ({ ...prev, templateType: "carousel", carouselCards: prev.carouselCards.length >= CAROUSEL_MIN_CARDS ? prev.carouselCards : [createCarouselCard(0), createCarouselCard(1)] }))} />}
                        {formData.category === "marketing" && <TemplateTypeCard title="Izin Panggilan WhatsApp" description="Bukan kontrak message-template yang dapat diverifikasi untuk builder SIPESA." status="Unsupported" tone="unsupported" unavailable selected={formData.templateType === "calling_permission"} onSelect={() => setFormData((prev) => ({ ...prev, templateType: "calling_permission" }))} />}
                        {formData.category === "marketing" && <TemplateTypeCard title="Penawaran Berbatas Waktu" description="Contoh tersedia, tetapi pembuatan tetap ditutup sampai kontrak Meta terverifikasi." status="Conditional" tone="conditional" unavailable selected={formData.templateType === "limited_time_offer"} onSelect={() => setFormData((prev) => ({ ...prev, templateType: "limited_time_offer" }))} />}
                        {formData.category === "marketing" && ([
                          ["catalog", "Catalog", "Buka katalog Meta yang terhubung."],
                          ["multi_product", "Multi-product", "Preview pilihan produk Meta; produk final tetap parameter send-time."],
                        ] as const).map(([value, label, description]) => {
                          const unavailable = !catalogsLoading && commerceCapability !== null && !commerceCapability.catalogEligible;
                          return <TemplateTypeCard key={value} title={label} description={description} status={catalogsLoading ? "Checking" : unavailable ? "No resource" : "Available"} tone={catalogsLoading ? "conditional" : unavailable ? "no_resource" : "available"} unavailable={catalogsLoading || unavailable} selected={formData.templateType === value} onSelect={() => setFormData((prev) => ({ ...prev, templateType: value, commerceButtonText: value === "catalog" ? "Lihat katalog" : "Lihat produk", commerceProducts: value === "catalog" ? [] : prev.commerceProducts }))} />;
                        })}
                        {formData.category === "utility" && <><TemplateTypeCard title="Carousel" description="Meta tidak menyediakan Carousel untuk kategori Utility." status="Unsupported" tone="unsupported" unavailable selected={formData.templateType === "carousel"} onSelect={() => setFormData((prev) => ({ ...prev, templateType: "carousel" }))} /><TemplateTypeCard title="Catalog" description="Commerce template hanya tersedia untuk kategori yang didukung Meta." status="Unsupported" tone="unsupported" unavailable selected={formData.templateType === "catalog"} onSelect={() => setFormData((prev) => ({ ...prev, templateType: "catalog" }))} /><TemplateTypeCard title="Multi-product" description="Commerce template hanya tersedia untuk kategori yang didukung Meta." status="Unsupported" tone="unsupported" unavailable selected={formData.templateType === "multi_product"} onSelect={() => setFormData((prev) => ({ ...prev, templateType: "multi_product" }))} /></>}
                        {catalogsError && formData.category === "marketing" && <p className="text-xs text-red-600" role="alert">{catalogsError}</p>}
                      </div>
                    </fieldset>
                    {formData.category === "authentication" && <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="status" aria-label="Ketersediaan metode OTP"><div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm"><strong>Copy Code</strong><span className="mt-1 block text-xs text-emerald-700">Available</span></div><div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><strong>One Tap</strong><span className="mt-1 block text-xs text-amber-800">Conditional · Meta verifies eligibility</span></div><div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600"><strong>Zero Tap</strong><span className="mt-1 block text-xs">Belum didukung</span></div></div>}
                  </div>
                ) : builderStep === 3 ? (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" /><h4 className="font-semibold">Tinjau template sebelum dikirim</h4></div>
                    {formData.category === "authentication" ? <>
                      <dl className="grid grid-cols-1 gap-3 rounded-xl border bg-slate-50 p-4 text-sm sm:grid-cols-2">
                        <div><dt className="text-slate-500">WABA</dt><dd className="break-all font-medium">{formData.wabaId}</dd></div>
                        <div><dt className="text-slate-500">Kategori</dt><dd className="font-medium">Authentication</dd></div>
                        <div><dt className="text-slate-500">Tipe</dt><dd className="font-medium">One-time passcode</dd></div>
                        <div><dt className="text-slate-500">Nama</dt><dd className="break-words font-medium">{formData.name}</dd></div>
                        <div><dt className="text-slate-500">Bahasa</dt><dd className="font-medium">{META_TEMPLATE_LANGUAGES.find(([code]) => code === formData.language)?.[1]} ({formData.language})</dd></div>
                        <div><dt className="text-slate-500">Metode OTP</dt><dd className="font-medium">{formData.otpButtonType === "one_tap" ? "One Tap" : "Copy Code"}</dd></div>
                        <div><dt className="text-slate-500">Rekomendasi keamanan</dt><dd className="font-medium">{formData.securityRecommendation ? "Aktif" : "Tidak aktif"}</dd></div>
                        <div><dt className="text-slate-500">Masa berlaku</dt><dd className="font-medium">{formData.codeExpirationMinutes} menit</dd></div>
                        {formData.otpButtonType === "one_tap" && <><div><dt className="text-slate-500">Android package</dt><dd className="break-all font-medium">{formData.packageName}</dd></div><div><dt className="text-slate-500">Signature</dt><dd className="font-mono font-medium">{formData.signatureHash ? `${formData.signatureHash.slice(0, 3)}••••••${formData.signatureHash.slice(-2)}` : "—"}</dd></div></>}
                      </dl>
                      <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900"><strong>Runtime support:</strong> Memerlukan workflow OTP khusus. Template ini tidak ditawarkan di Broadcast atau Chat normal.</div>
                    </> : formData.templateType === "flow" ? <>
                      <dl className="grid grid-cols-1 gap-3 rounded-xl border bg-slate-50 p-4 text-sm sm:grid-cols-2">
                        <div><dt className="text-slate-500">Kategori · Tipe</dt><dd className="font-medium capitalize">{formData.category} · Flow</dd></div>
                        <div><dt className="text-slate-500">Bahasa</dt><dd className="font-medium">{META_TEMPLATE_LANGUAGES.find(([code]) => code === formData.language)?.[1]} ({formData.language})</dd></div>
                        <div><dt className="text-slate-500">Nama template</dt><dd className="font-medium">{formData.name}</dd></div>
                        <div><dt className="text-slate-500">Flow</dt><dd className="font-medium">{formData.flowName}</dd></div>
                        <div><dt className="text-slate-500">Status Flow</dt><dd className="font-medium">{formData.flowStatus}</dd></div>
                        <div><dt className="text-slate-500">Tombol</dt><dd className="font-medium">{formData.flowButtonText}</dd></div>
                        <div><dt className="text-slate-500">Action</dt><dd className="font-medium uppercase">{formData.flowAction}</dd></div>
                        <div><dt className="text-slate-500">Destination screen</dt><dd className="font-mono font-medium">{formData.flowScreen}</dd></div>
                        <div className="sm:col-span-2"><dt className="text-slate-500">Body</dt><dd className="whitespace-pre-wrap font-medium">{formData.body}</dd></div>
                        <div className="sm:col-span-2"><dt className="text-slate-500">Footer</dt><dd className="font-medium">{formData.footerText || "Tidak ada"}</dd></div>
                      </dl>
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Flow dikelola di Meta; SIPESA tidak memiliki atau mengubah definisi Flow tersebut.</div>
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>Runtime compatibility:</strong> pembuatan dan pengelolaan tersedia. Broadcast/Chat tetap ditutup sampai lifecycle flow_token per penerima tersedia.</div>
                    </> : formData.templateType === "carousel" ? <>
                      <dl className="grid grid-cols-1 gap-3 rounded-xl border bg-slate-50 p-4 text-sm sm:grid-cols-2">
                        <div><dt className="text-slate-500">Kategori · Tipe</dt><dd className="font-medium">Marketing · Carousel</dd></div>
                        <div><dt className="text-slate-500">Bahasa</dt><dd className="font-medium">{META_TEMPLATE_LANGUAGES.find(([code]) => code === formData.language)?.[1]} ({formData.language})</dd></div>
                        <div><dt className="text-slate-500">Nama template</dt><dd className="font-medium">{formData.name}</dd></div>
                        <div><dt className="text-slate-500">Jumlah kartu</dt><dd className="font-medium">{formData.carouselCards.length}</dd></div>
                      </dl>
                      <div className="space-y-2">{formData.carouselCards.map((card, index) => <div key={card.id} className="rounded-lg border p-3 text-sm"><strong>Card {index + 1}</strong><span className="ml-2 capitalize text-slate-500">{card.headerType} · {card.mediaSampleHandle ? "sample siap" : "sample belum ada"} · {card.buttons.length} tombol</span><p className="mt-1 whitespace-pre-wrap">{applyExamplesToText(card.body, card.examples)}</p></div>)}</div>
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><strong>Review samples:</strong> media dan contoh variabel di atas hanya untuk peninjauan Meta.</div>
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>Runtime values:</strong> media, body, dan tombol dinamis wajib dipenuhi per card saat pengiriman. Broadcast/Chat saat ini difilter.</div>
                    </> : ["catalog", "multi_product"].includes(formData.templateType) ? <>
                      <dl className="grid grid-cols-1 gap-3 rounded-xl border bg-slate-50 p-4 text-sm sm:grid-cols-2">
                        <div><dt className="text-slate-500">Kategori · Tipe</dt><dd className="font-medium">Marketing · {formData.templateType === "catalog" ? "Catalog" : "Multi-product"}</dd></div>
                        <div><dt className="text-slate-500">Bahasa</dt><dd className="font-medium">{META_TEMPLATE_LANGUAGES.find(([code]) => code === formData.language)?.[1]} ({formData.language})</dd></div>
                        <div><dt className="text-slate-500">Nama template</dt><dd className="font-medium">{formData.name}</dd></div>
                        <div><dt className="text-slate-500">Katalog</dt><dd className="font-medium">{formData.catalogName} · {formData.catalogId}</dd></div>
                        <div><dt className="text-slate-500">Tombol</dt><dd className="font-medium">{formData.commerceButtonText}</dd></div>
                        <div><dt className="text-slate-500">Produk preview</dt><dd className="font-medium">{formData.templateType === "multi_product" ? formData.commerceProducts.length : "Tidak berlaku"}</dd></div>
                        <div className="sm:col-span-2"><dt className="text-slate-500">Body</dt><dd className="whitespace-pre-wrap font-medium">{formData.body}</dd></div>
                        <div className="sm:col-span-2"><dt className="text-slate-500">Footer</dt><dd className="font-medium">{formData.footerText || "Tidak ada"}</dd></div>
                      </dl>
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Katalog dan produk tetap dikelola di Meta Commerce. Daftar produk MPM merupakan kebutuhan send-time dan tidak menjadi isi tetap template Meta.</div>
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>Runtime compatibility:</strong> Broadcast/Chat difilter sampai validasi sender-catalog dan produk send-time tersedia.</div>
                    </> : <>
                      <dl className="grid grid-cols-1 gap-3 rounded-xl border bg-slate-50 p-4 text-sm sm:grid-cols-2">
                        <div><dt className="text-slate-500">WABA</dt><dd className="break-all font-medium">{formData.wabaId}</dd></div>
                        <div><dt className="text-slate-500">Kategori · Tipe</dt><dd className="font-medium capitalize">{formData.category} · {formData.templateType}</dd></div>
                        <div><dt className="text-slate-500">Nama</dt><dd className="break-words font-medium">{formData.name}</dd></div>
                        <div><dt className="text-slate-500">Bahasa</dt><dd className="font-medium">{META_TEMPLATE_LANGUAGES.find(([code]) => code === formData.language)?.[1]} ({formData.language})</dd></div>
                        <div><dt className="text-slate-500">Header</dt><dd className="font-medium capitalize">{formData.headerType}</dd></div>
                        <div><dt className="text-slate-500">Variabel body</dt><dd className="font-medium">{variables.length} positional</dd></div>
                        <div><dt className="text-slate-500">Variabel header</dt><dd className="font-medium">{/\{\{1\}\}/.test(formData.headerText) ? "1" : "0"}</dd></div>
                        <div><dt className="text-slate-500">Footer</dt><dd className="font-medium">{formData.footerText || "Tidak ada"}</dd></div>
                        <div><dt className="text-slate-500">Tombol</dt><dd className="font-medium">{formData.buttons.length}</dd></div>
                      </dl>
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><strong>Nilai contoh untuk review:</strong> dipakai Meta saat meninjau template. <strong>Nilai runtime:</strong> {(/\{\{1\}\}/.test(formData.headerText) || formData.buttons.some((button) => button.type === "COPY_CODE" || /\{\{1\}\}$/.test(button.value)) || formData.headerType === "location" || ["image", "video", "document"].includes(formData.headerType)) ? "wajib diisi kembali saat Broadcast/Chat." : "tidak ada tambahan di luar variabel body."}</div>
                    </>}
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><strong>VALID</strong> · Template siap disimpan atau dikirim untuk ditinjau Meta.</div>
                  </div>
                ) : formData.category === "authentication" ? (
                  <div className="space-y-5">
                    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900"><strong>Dedicated Authentication Builder</strong><span className="block text-xs">Meta menghasilkan isi OTP; header, body bebas, footer bebas, media, dan tombol generik tidak digunakan.</span></div>
                    {editingTemplate?.metaTemplateId && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Template Authentication yang sudah dikirim ke Meta ditampilkan read-only.</div>}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div><Label htmlFor="auth-template-name">Nama Template *</Label><Input id="auth-template-name" className="mt-2" disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.name} onChange={(e) => handleNameChange(e.target.value)} />{nameError && <p className="mt-1 text-xs text-red-600">{nameError}</p>}</div>
                      <div><Label htmlFor="auth-language">Bahasa *</Label><select id="auth-language" className="mt-2 w-full rounded-lg border bg-white p-3" disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.language} onChange={(e) => setFormData((prev) => ({ ...prev, language: e.target.value as MetaTemplateLanguageCode }))}>{META_TEMPLATE_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label} ({code})</option>)}</select></div>
                    </div>
                    <fieldset disabled={Boolean(editingTemplate?.metaTemplateId)}><legend className="mb-2 text-sm font-medium">Metode OTP</legend><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{([['copy_code','Copy Code','Available'],['one_tap','One Tap','Conditional'],['zero_tap','Zero Tap','Belum didukung']] as const).map(([value,label,state]) => <button key={value} type="button" disabled={value === 'zero_tap'} aria-pressed={formData.otpButtonType === value} onClick={() => setFormData((prev) => ({ ...prev, otpButtonType: value }))} className={`rounded-xl border p-3 text-left ${formData.otpButtonType === value ? 'border-violet-500 bg-violet-50' : 'border-slate-200'} disabled:cursor-not-allowed disabled:opacity-60`}><strong className="block text-sm">{label}</strong><span className="text-xs text-slate-500">{state}</span></button>)}</div></fieldset>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <label className="flex items-center gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" disabled={Boolean(editingTemplate?.metaTemplateId)} checked={formData.securityRecommendation} onChange={(e) => setFormData((prev) => ({ ...prev, securityRecommendation: e.target.checked }))} /><span><strong className="block">Rekomendasi keamanan</strong><span className="text-xs text-slate-500">Tambahkan anjuran untuk tidak membagikan kode.</span></span></label>
                      <div><Label htmlFor="auth-expiry">Masa berlaku kode (menit)</Label><Input id="auth-expiry" className="mt-2" type="number" min={1} max={90} disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.codeExpirationMinutes} onChange={(e) => setFormData((prev) => ({ ...prev, codeExpirationMinutes: Number(e.target.value) }))} /></div>
                    </div>
                    {formData.otpButtonType === "one_tap" && <div className="space-y-4 rounded-xl border p-4"><div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">Eligibility akan diverifikasi oleh Meta.</div><div><Label htmlFor="auth-package">Android package name *</Label><Input id="auth-package" className="mt-2" disabled={Boolean(editingTemplate?.metaTemplateId)} placeholder="com.example.app" value={formData.packageName} onChange={(e) => setFormData((prev) => ({ ...prev, packageName: e.target.value }))} /></div><div><Label htmlFor="auth-signature">App signature hash *</Label><Input id="auth-signature" className="mt-2 font-mono" disabled={Boolean(editingTemplate?.metaTemplateId)} maxLength={11} placeholder="K8a/AINcGX7" value={formData.signatureHash} onChange={(e) => setFormData((prev) => ({ ...prev, signatureHash: e.target.value }))} /></div></div>}
                    {buttonError && <p className="text-sm text-red-600" role="alert">{buttonError}</p>}
                  </div>
                ) : formData.templateType === "flow" ? (
                  <div className="space-y-5">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><strong>Dedicated Flow Builder</strong><span className="block text-xs">Gunakan Flow yang sudah dibuat dan dipublikasikan di Meta. SIPESA tidak membuat atau mengubah Flow.</span></div>
                    {editingTemplate?.metaTemplateId && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Template Flow yang sudah dikirim ke Meta ditampilkan read-only.</div>}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div><Label htmlFor="flow-template-name">Nama Template *</Label><Input id="flow-template-name" className="mt-2" disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.name} onChange={(e) => handleNameChange(e.target.value)} />{nameError && <p className="mt-1 text-xs text-red-600">{nameError}</p>}</div>
                      <div><Label htmlFor="flow-language">Bahasa *</Label><select id="flow-language" className="mt-2 w-full rounded-lg border bg-white p-3" disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.language} onChange={(e) => setFormData((prev) => ({ ...prev, language: e.target.value as MetaTemplateLanguageCode }))}>{META_TEMPLATE_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label} ({code})</option>)}</select></div>
                    </div>
                    <div><Label htmlFor="flow-selector">Flow *</Label><select id="flow-selector" className="mt-2 w-full rounded-lg border bg-white p-3" disabled={flowsLoading || Boolean(editingTemplate?.metaTemplateId)} value={formData.flowId} onChange={(e) => { const flow = metaFlows.find((item) => item.id === e.target.value); setFormData((prev) => ({ ...prev, flowId: flow?.id || "", flowName: flow?.name || "", flowStatus: flow?.status || "", flowScreen: flow?.screens[0] || "" })); }}><option value="">{flowsLoading ? "Mengambil Flow dari Meta..." : "Pilih Flow"}</option>{metaFlows.map((flow) => <option key={flow.id} value={flow.id} disabled={!flow.eligible}>{flow.name} · {flow.status}{flow.eligible ? "" : " · Tidak tersedia"}</option>)}</select>{flowsError && <p className="mt-1 text-xs text-red-600">{flowsError}</p>}{!flowsLoading && !flowsError && !metaFlows.some((flow) => flow.eligible) && <p className="mt-1 text-xs text-amber-700">Belum ada Flow yang dapat digunakan.</p>}{formData.flowId && <p className="mt-1 text-xs text-slate-500">Flow ID: {formData.flowId} · Status: {formData.flowStatus}</p>}</div>
                    <div><Label htmlFor="flow-screen">Destination screen *</Label><select id="flow-screen" className="mt-2 w-full rounded-lg border bg-white p-3" disabled={Boolean(editingTemplate?.metaTemplateId) || !formData.flowId} value={formData.flowScreen} onChange={(e) => setFormData((prev) => ({ ...prev, flowScreen: e.target.value }))}><option value="">Pilih screen</option>{(metaFlows.find((flow) => flow.id === formData.flowId)?.screens || (formData.flowScreen ? [formData.flowScreen] : [])).map((screen) => <option key={screen} value={screen}>{screen}</option>)}</select></div>
                    <div><Label htmlFor="flow-body">Body *</Label><Textarea id="flow-body" className="mt-2" rows={6} maxLength={1024} disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.body} onChange={(e) => setFormData((prev) => ({ ...prev, body: e.target.value }))} />{bodyError && <p className="mt-1 text-xs text-red-600">{bodyError}</p>}</div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><Label htmlFor="flow-footer">Footer</Label><Input id="flow-footer" className="mt-2" maxLength={60} disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.footerText} onChange={(e) => setFormData((prev) => ({ ...prev, footerText: e.target.value }))} />{footerError && <p className="mt-1 text-xs text-red-600">{footerError}</p>}</div><div><Label htmlFor="flow-button-text">Label tombol *</Label><Input id="flow-button-text" className="mt-2" maxLength={25} disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.flowButtonText} onChange={(e) => setFormData((prev) => ({ ...prev, flowButtonText: e.target.value }))} /></div></div>
                    <div className="rounded-lg border bg-slate-50 p-3 text-sm"><strong>Action:</strong> NAVIGATE · destination screen dipilih dari asset Flow Meta.</div>
                    {buttonError && <p className="text-sm text-red-600" role="alert">{buttonError}</p>}
                  </div>
                ) : formData.templateType === "carousel" ? (
                  <div className="min-w-0 space-y-5">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><strong>Dedicated Carousel Builder</strong><span className="block text-xs">Marketing · {CAROUSEL_MIN_CARDS}-{CAROUSEL_MAX_CARDS} kartu · header Image/Video dan pola tombol harus konsisten.</span></div>
                    {editingTemplate?.metaTemplateId && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Template Carousel yang sudah dikirim ke Meta ditampilkan read-only untuk mencegah perubahan struktur yang tidak didukung.</div>}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><Label htmlFor="carousel-name">Nama Template *</Label><Input id="carousel-name" className="mt-2" disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.name} onChange={(e) => handleNameChange(e.target.value)} />{nameError && <p className="mt-1 text-xs text-red-600">{nameError}</p>}</div><div><Label htmlFor="carousel-language">Bahasa *</Label><select id="carousel-language" className="mt-2 w-full rounded-lg border bg-white p-3" disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.language} onChange={(e) => setFormData((prev) => ({ ...prev, language: e.target.value as MetaTemplateLanguageCode }))}>{META_TEMPLATE_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label} ({code})</option>)}</select></div></div>
                    <div><Label htmlFor="carousel-main-body">Body utama *</Label><Textarea id="carousel-main-body" className="mt-2" rows={4} maxLength={1024} disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.body} onChange={(e) => setFormData((prev) => ({ ...prev, body: e.target.value }))} /><p className="mt-1 text-right text-xs text-slate-500">{formData.body.length}/1024</p>{bodyError && <p className="text-xs text-red-600">{bodyError}</p>}</div>
                    <div className="flex flex-wrap items-center justify-between gap-2"><div><h5 className="font-semibold">Kartu</h5><p className="text-xs text-slate-500">{formData.carouselCards.length}/{CAROUSEL_MAX_CARDS} kartu</p></div><Button type="button" variant="outline" disabled={Boolean(editingTemplate?.metaTemplateId) || formData.carouselCards.length >= CAROUSEL_MAX_CARDS} onClick={() => setFormData((prev) => ({ ...prev, carouselCards: [...prev.carouselCards, createCarouselCard(prev.carouselCards.length)] }))}><Plus className="mr-1 h-4 w-4" />Tambah Kartu</Button></div>
                    <div className="space-y-4">{formData.carouselCards.map((card, cardIndex) => <section key={card.id} className="min-w-0 rounded-xl border p-4">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><strong>Card {cardIndex + 1}</strong><div className="flex gap-1"><Button type="button" variant="ghost" size="sm" disabled={Boolean(editingTemplate?.metaTemplateId) || cardIndex === 0} onClick={() => setFormData((prev) => { const next = [...prev.carouselCards]; [next[cardIndex - 1], next[cardIndex]] = [next[cardIndex], next[cardIndex - 1]]; return { ...prev, carouselCards: next }; })}>↑</Button><Button type="button" variant="ghost" size="sm" disabled={Boolean(editingTemplate?.metaTemplateId) || cardIndex === formData.carouselCards.length - 1} onClick={() => setFormData((prev) => { const next = [...prev.carouselCards]; [next[cardIndex + 1], next[cardIndex]] = [next[cardIndex], next[cardIndex + 1]]; return { ...prev, carouselCards: next }; })}>↓</Button><Button type="button" variant="ghost" size="sm" disabled={Boolean(editingTemplate?.metaTemplateId) || formData.carouselCards.length <= CAROUSEL_MIN_CARDS} onClick={() => setFormData((prev) => ({ ...prev, carouselCards: prev.carouselCards.filter((_, index) => index !== cardIndex) }))}><Trash2 className="h-4 w-4 text-red-600" /></Button></div></div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><Label htmlFor={`carousel-header-${cardIndex}`}>Header media *</Label><select id={`carousel-header-${cardIndex}`} className="mt-2 w-full rounded-lg border bg-white p-3" disabled={Boolean(editingTemplate?.metaTemplateId)} value={card.headerType} onChange={(e) => setFormData((prev) => ({ ...prev, carouselCards: prev.carouselCards.map((item, index) => index === cardIndex ? { ...item, headerType: e.target.value as "image" | "video", mediaSampleFileName: "", mediaSampleHandle: "" } : item) }))}><option value="image">Image</option><option value="video">Video</option></select></div><div><Label htmlFor={`carousel-file-${cardIndex}`}>Contoh media *</Label><Input id={`carousel-file-${cardIndex}`} className="mt-2" type="file" accept={MEDIA_SAMPLE_RULES[card.headerType].accept} disabled={Boolean(editingTemplate?.metaTemplateId) || carouselUploadIndex !== null} onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleCarouselMediaSample(cardIndex, file); }} /><p className={`mt-1 text-xs ${card.mediaSampleHandle ? "text-emerald-700" : "text-slate-500"}`}>{carouselUploadIndex === cardIndex ? "Mengunggah contoh ke Meta..." : card.mediaSampleHandle ? `${card.mediaSampleFileName} · Contoh media siap` : "Unggah contoh media"}</p></div></div>
                      <div className="mt-4"><Label htmlFor={`carousel-body-${cardIndex}`}>Body Card *</Label><Textarea id={`carousel-body-${cardIndex}`} className="mt-2" rows={3} maxLength={CAROUSEL_CARD_BODY_MAX} disabled={Boolean(editingTemplate?.metaTemplateId)} value={card.body} onChange={(e) => setFormData((prev) => ({ ...prev, carouselCards: prev.carouselCards.map((item, index) => index === cardIndex ? { ...item, body: e.target.value, examples: { ...item.examples, ...buildInitialExamples(e.target.value) } } : item) }))} /><p className="mt-1 text-right text-xs text-slate-500">{card.body.length}/{CAROUSEL_CARD_BODY_MAX}</p>{extractVariables(card.body).map((variable) => <div key={variable} className="mt-2"><Label htmlFor={`carousel-example-${cardIndex}-${variable}`}>Contoh {`{{${variable}}}`}</Label><Input id={`carousel-example-${cardIndex}-${variable}`} className="mt-1" disabled={Boolean(editingTemplate?.metaTemplateId)} value={card.examples[variable] || ""} onChange={(e) => setFormData((prev) => ({ ...prev, carouselCards: prev.carouselCards.map((item, index) => index === cardIndex ? { ...item, examples: { ...item.examples, [variable]: e.target.value } } : item) }))} /></div>)}</div>
                      <div className="mt-4 space-y-2"><div className="flex items-center justify-between"><Label>Tombol (1-2)</Label><Button type="button" size="sm" variant="outline" disabled={Boolean(editingTemplate?.metaTemplateId) || card.buttons.length >= 2} onClick={() => setFormData((prev) => ({ ...prev, carouselCards: prev.carouselCards.map((item, index) => index === cardIndex ? { ...item, buttons: [...item.buttons, { id: `carousel-button-${Date.now()}`, type: "QUICK_REPLY", text: "Pilih", value: "" }] } : item) }))}>Tambah</Button></div>{card.buttons.map((button, buttonIndex) => <div key={button.id} className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[140px_1fr_1fr_auto]"><select aria-label={`Tipe tombol Card ${cardIndex + 1}`} className="rounded-lg border bg-white p-2" disabled={Boolean(editingTemplate?.metaTemplateId)} value={button.type} onChange={(e) => setFormData((prev) => ({ ...prev, carouselCards: prev.carouselCards.map((item, index) => index === cardIndex ? { ...item, buttons: item.buttons.map((candidate, idx) => idx === buttonIndex ? { ...candidate, type: e.target.value as TemplateButtonType, value: "", example: "" } : candidate) } : item) }))}><option value="QUICK_REPLY">Quick Reply</option><option value="URL">Website</option><option value="PHONE_NUMBER">Telepon</option></select><Input aria-label={`Label tombol Card ${cardIndex + 1}`} maxLength={25} disabled={Boolean(editingTemplate?.metaTemplateId)} value={button.text} onChange={(e) => setFormData((prev) => ({ ...prev, carouselCards: prev.carouselCards.map((item, index) => index === cardIndex ? { ...item, buttons: item.buttons.map((candidate, idx) => idx === buttonIndex ? { ...candidate, text: e.target.value } : candidate) } : item) }))} />{button.type === "URL" ? <Input aria-label={`URL Card ${cardIndex + 1}`} placeholder="https://example.com/{{1}}" disabled={Boolean(editingTemplate?.metaTemplateId)} value={button.value} onChange={(e) => setFormData((prev) => ({ ...prev, carouselCards: prev.carouselCards.map((item, index) => index === cardIndex ? { ...item, buttons: item.buttons.map((candidate, idx) => idx === buttonIndex ? { ...candidate, value: e.target.value } : candidate) } : item) }))} /> : button.type === "PHONE_NUMBER" ? <Input aria-label={`Telepon Card ${cardIndex + 1}`} placeholder="+628123456789" disabled={Boolean(editingTemplate?.metaTemplateId)} value={button.value} onChange={(e) => setFormData((prev) => ({ ...prev, carouselCards: prev.carouselCards.map((item, index) => index === cardIndex ? { ...item, buttons: item.buttons.map((candidate, idx) => idx === buttonIndex ? { ...candidate, value: e.target.value } : candidate) } : item) }))} /> : <span /> }<Button type="button" variant="ghost" size="sm" disabled={Boolean(editingTemplate?.metaTemplateId) || card.buttons.length <= 1} onClick={() => setFormData((prev) => ({ ...prev, carouselCards: prev.carouselCards.map((item, index) => index === cardIndex ? { ...item, buttons: item.buttons.filter((_, idx) => idx !== buttonIndex) } : item) }))}><X className="h-4 w-4" /></Button>{button.type === "URL" && button.value.endsWith("{{1}}") && <Input className="sm:col-start-3" aria-label={`Contoh URL Card ${cardIndex + 1}`} placeholder="https://example.com/produk-1" disabled={Boolean(editingTemplate?.metaTemplateId)} value={button.example || ""} onChange={(e) => setFormData((prev) => ({ ...prev, carouselCards: prev.carouselCards.map((item, index) => index === cardIndex ? { ...item, buttons: item.buttons.map((candidate, idx) => idx === buttonIndex ? { ...candidate, example: e.target.value } : candidate) } : item) }))} />}</div>)}</div>
                    </section>)}</div>
                    {(headerError || buttonError) && <p className="text-sm text-red-600" role="alert">{headerError || buttonError}</p>}
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Runtime Broadcast/Chat belum tersedia karena parameter header, body, dan tombol harus dipetakan per card. Template Carousel tidak akan ditawarkan untuk pengiriman.</div>
                  </div>
                ) : ["catalog", "multi_product"].includes(formData.templateType) ? (
                  <div className="space-y-5">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><strong>Dedicated Commerce Builder</strong><span className="block text-xs">Katalog dan produk tetap dikelola di Meta Commerce. SIPESA hanya membaca dan mereferensikannya.</span></div>
                    {editingTemplate?.metaTemplateId && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Template Commerce yang sudah dikirim ke Meta ditampilkan read-only.</div>}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div><Label htmlFor="commerce-template-name">Nama Template *</Label><Input id="commerce-template-name" className="mt-2" disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.name} onChange={(e) => handleNameChange(e.target.value)} />{nameError && <p className="mt-1 text-xs text-red-600">{nameError}</p>}</div>
                      <div><Label htmlFor="commerce-language">Bahasa *</Label><select id="commerce-language" className="mt-2 w-full rounded-lg border bg-white p-3" disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.language} onChange={(e) => setFormData((prev) => ({ ...prev, language: e.target.value as MetaTemplateLanguageCode }))}>{META_TEMPLATE_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label} ({code})</option>)}</select></div>
                    </div>
                    <div><Label htmlFor="catalog-selector">Katalog *</Label><select id="catalog-selector" className="mt-2 w-full rounded-lg border bg-white p-3" disabled={catalogsLoading || Boolean(editingTemplate?.metaTemplateId)} value={formData.catalogId} onChange={(e) => { const catalog = metaCatalogs.find((item) => item.id === e.target.value); setFormData((prev) => ({ ...prev, catalogId: catalog?.id || "", catalogName: catalog?.name || "", commerceProducts: [] })); }}><option value="">{catalogsLoading ? "Mengambil katalog dari Meta..." : "Pilih katalog"}</option>{metaCatalogs.map((catalog) => <option key={catalog.id} value={catalog.id} disabled={!catalog.eligible}>{catalog.name}{catalog.eligible ? "" : " · Tidak tersedia"}</option>)}</select>{catalogsError && <p className="mt-1 text-xs text-red-600">{catalogsError}</p>}{!catalogsLoading && !catalogsError && !metaCatalogs.some((catalog) => catalog.eligible) && <p className="mt-1 text-xs text-amber-700">Belum ada katalog yang terhubung.</p>}{formData.catalogId && <p className="mt-1 text-xs text-slate-500">Catalog ID: {formData.catalogId}</p>}</div>
                    <div><Label htmlFor="commerce-body">Body *</Label><Textarea id="commerce-body" className="mt-2" rows={6} maxLength={1024} disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.body} onChange={(e) => setFormData((prev) => ({ ...prev, body: e.target.value }))} />{bodyError && <p className="mt-1 text-xs text-red-600">{bodyError}</p>}</div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><Label htmlFor="commerce-footer">Footer</Label><Input id="commerce-footer" className="mt-2" maxLength={60} disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.footerText} onChange={(e) => setFormData((prev) => ({ ...prev, footerText: e.target.value }))} />{footerError && <p className="mt-1 text-xs text-red-600">{footerError}</p>}</div><div><Label htmlFor="commerce-button-text">Label tombol *</Label><Input id="commerce-button-text" className="mt-2" maxLength={25} disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.commerceButtonText} onChange={(e) => setFormData((prev) => ({ ...prev, commerceButtonText: e.target.value }))} /></div></div>
                    {formData.templateType === "multi_product" && <div className="space-y-3 rounded-xl border p-4">
                      <div className="flex flex-wrap items-end justify-between gap-3"><div><Label htmlFor="commerce-section-title">Judul section</Label><Input id="commerce-section-title" className="mt-1" maxLength={24} disabled={Boolean(editingTemplate?.metaTemplateId)} value={formData.commerceSectionTitle} onChange={(e) => setFormData((prev) => ({ ...prev, commerceSectionTitle: e.target.value }))} /></div><div className="text-xs text-slate-500">{formData.commerceProducts.length}/30 produk</div></div>
                      <div><Label htmlFor="product-search">Cari produk Meta</Label><Input id="product-search" className="mt-1" placeholder="Nama atau retailer ID" disabled={!formData.catalogId || Boolean(editingTemplate?.metaTemplateId)} value={productSearch} onChange={(e) => setProductSearch(e.target.value)} /></div>
                      {productsError && <p className="text-xs text-red-600">{productsError}</p>}
                      <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border p-2">
                        {commerceProducts.map((product) => { const selected = formData.commerceProducts.some((item) => item.id === product.id); const eligible = isCommerceProductEligible(product); return <button key={product.id} type="button" disabled={Boolean(editingTemplate?.metaTemplateId) || !eligible || (!selected && formData.commerceProducts.length >= 30)} onClick={() => setFormData((prev) => ({ ...prev, commerceProducts: selected ? prev.commerceProducts.filter((item) => item.id !== product.id) : [...prev.commerceProducts, product] }))} className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left ${selected ? "border-emerald-500 bg-emerald-50" : "border-slate-200"} disabled:cursor-not-allowed disabled:opacity-60`}><div className="h-10 w-10 overflow-hidden rounded bg-slate-100">{product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" /> : <ShoppingBag className="m-2 h-6 w-6 text-slate-400" />}</div><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{product.name}</strong><span className="block truncate text-xs text-slate-500">Retailer ID: {product.retailerId}{product.availability ? ` · ${product.availability}` : ""}</span></span><span className="text-xs font-medium">{!eligible ? "Tidak tersedia" : selected ? "Dipilih" : "Pilih"}</span></button>; })}
                        {!productsLoading && commerceProducts.length === 0 && <p className="p-3 text-center text-xs text-slate-500">Tidak ada produk yang cocok.</p>}
                        {!productsLoading && commerceProducts.length > 0 && !commerceProducts.some(isCommerceProductEligible) && <p className="p-3 text-center text-xs text-amber-700">NO ELIGIBLE PRODUCTS</p>}
                      </div>
                      {productsNextCursor && <Button type="button" variant="outline" size="sm" disabled={productsLoading} onClick={() => void loadMoreCommerceProducts()}>{productsLoading ? "Memuat..." : "Muat berikutnya"}</Button>}
                      {formData.commerceProducts.length > 0 && <div className="space-y-2"><p className="text-xs font-medium">Urutan preview produk</p>{formData.commerceProducts.map((product, index) => <div key={product.id} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm"><span className="flex-1 truncate">{index + 1}. {product.name}</span><Button type="button" variant="ghost" size="sm" disabled={index === 0 || Boolean(editingTemplate?.metaTemplateId)} onClick={() => setFormData((prev) => { const next = [...prev.commerceProducts]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return { ...prev, commerceProducts: next }; })}>↑</Button><Button type="button" variant="ghost" size="sm" disabled={index === formData.commerceProducts.length - 1 || Boolean(editingTemplate?.metaTemplateId)} onClick={() => setFormData((prev) => { const next = [...prev.commerceProducts]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return { ...prev, commerceProducts: next }; })}>↓</Button><Button type="button" variant="ghost" size="sm" disabled={Boolean(editingTemplate?.metaTemplateId)} onClick={() => setFormData((prev) => ({ ...prev, commerceProducts: prev.commerceProducts.filter((item) => item.id !== product.id) }))}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>)}</div>}
                      <p className="text-xs text-slate-500">Meta memilih produk MPM saat message dikirim. Pilihan ini disimpan sebagai referensi default/preview dan divalidasi ulang, tetapi runtime SIPESA masih dinonaktifkan.</p>
                    </div>}
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Runtime Broadcast/Chat belum tersedia. Template tetap dapat dibuat, disinkronkan, dan dipreview tanpa memungkinkan send yang tidak aman.</div>
                    {buttonError && <p className="text-sm text-red-600" role="alert">{buttonError}</p>}
                  </div>
                ) : (<>
                <div className="rounded-lg border bg-slate-50 px-4 py-3 text-sm">
                  <span className="font-semibold capitalize">{formData.category} · {formData.templateType}</span>
                  <span className="ml-2 text-slate-500">Variabel: Positional (angka)</span>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="template-name">Nama Template *</Label>
                    <span className={`text-xs ${formData.name.length > 500 ? "text-red-600" : "text-muted-foreground"}`}>
                      {formData.name.length}/512
                    </span>
                  </div>
                  <Input
                    id="template-name"
                    required
                    aria-invalid={Boolean(nameError)}
                    aria-describedby={nameError ? "template-name-error" : undefined}
                    placeholder="contoh: reminder_pembayaran"
                    value={formData.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    disabled={Boolean(editingTemplate?.metaTemplateId)}
                  />
                  {nameError && <p id="template-name-error" className="text-xs text-red-600 mt-1">{nameError}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="hidden">
                    <Label htmlFor="template-waba">WABA Pemilik *</Label>
                    <select
                      id="template-waba"
                      required
                      className="w-full p-3 border rounded-lg mt-2 bg-white"
                      value={formData.wabaId}
                      disabled={Boolean(editingTemplate)}
                      onChange={(e) => setFormData((prev) => ({ ...prev, wabaId: e.target.value }))}
                    >
                      <option value="">Pilih WABA</option>
                      {[...new Map(numbers.filter((number) => number.wabaId).map((number) => [number.wabaId, number])).values()].map((number) => (
                        <option key={number.wabaId!} value={number.wabaId!}>{number.name} · {number.wabaId}</option>
                      ))}
                    </select>
                  </div>
                  <div className="hidden">
                    <Label htmlFor="template-category">Kategori *</Label>
                    <select
                      id="template-category"
                      required
                      className="w-full p-3 border rounded-lg mt-2 bg-white"
                      value={formData.category}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          category: e.target.value as TemplateCategory,
                        }))
                      }
                    >
                      <option value="marketing">Marketing</option>
                      <option value="utility">Utility</option>
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="template-language">Bahasa *</Label>
                    <select
                      id="template-language"
                      required
                      className="w-full p-3 border rounded-lg mt-2 bg-white"
                      value={formData.language}
                      disabled={Boolean(editingTemplate?.metaTemplateId)}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          language: e.target.value as MetaTemplateLanguageCode,
                        }))
                      }
                    >
                      {META_TEMPLATE_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label} ({code})</option>)}
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="template-header-type">Jenis Header</Label>
                    <select
                      id="template-header-type"
                      className="w-full p-3 border rounded-lg mt-2 bg-white"
                      value={formData.headerType}
                      onChange={(e) => {
                        const headerType = e.target.value as HeaderType;
                        setFormData((prev) => ({
                          ...prev,
                          headerType,
                          mediaSampleFileName: "",
                          mediaSampleHandle: "",
                        }));
                        setHeaderError(null);
                        setMediaUploadError(null);
                        if (sampleInputRef.current) sampleInputRef.current.value = "";
                      }}
                    >
                      <option value="none">None</option>
                      <option value="text">Text Header</option>
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                      <option value="document">Document</option>
                      <option value="location">Location</option>
                    </select>
                  </div>
                </div>

                {formData.headerType === "text" && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2"><Label htmlFor="template-header-text">Teks Header</Label><Button type="button" variant="outline" size="sm" disabled={/\{\{1\}\}/.test(formData.headerText)} onClick={() => setFormData((prev) => ({ ...prev, headerText: `${prev.headerText}${prev.headerText && !prev.headerText.endsWith(" ") ? " " : ""}{{1}}` }))}>+ Variabel</Button></div>
                      <span className={`text-xs ${formData.headerText.length > 55 ? "text-red-600" : "text-muted-foreground"}`}>
                        {formData.headerText.length}/60
                      </span>
                    </div>
                    <Input
                      id="template-header-text"
                      aria-invalid={Boolean(headerError)}
                      aria-describedby={headerError ? "template-header-error" : undefined}
                      placeholder="Header singkat"
                      value={formData.headerText}
                      onChange={(e) => {
                        setFormData((prev) => ({ ...prev, headerText: e.target.value }));
                        setHeaderError(validateHeaderText(e.target.value));
                      }}
                    />
                    {/\{\{1\}\}/.test(formData.headerText) && <div className="mt-2"><Label htmlFor="template-header-example">Contoh Header {`{{1}}`}</Label><Input id="template-header-example" className="mt-1" placeholder="INV-2026-001" value={formData.headerExample} onChange={(e) => setFormData((prev) => ({ ...prev, headerExample: e.target.value }))} /></div>}
                    {headerError && <p id="template-header-error" className="text-xs text-red-600 mt-1">{headerError}</p>}
                  </div>
                )}

                {["image", "video", "document"].includes(formData.headerType) && (
                  <div>
                    <Label htmlFor="template-media-sample">Contoh Media</Label>
                    <div className="mt-2 border-2 border-dashed rounded-xl p-4 bg-slate-50">
                      <input
                        ref={sampleInputRef}
                        type="file"
                        className="hidden"
                        id="template-media-sample"
                        accept={MEDIA_SAMPLE_RULES[formData.headerType as MediaHeaderType].accept}
                        disabled={mediaUploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleMediaSampleFile(file);
                        }}
                      />
                      <label
                        htmlFor="template-media-sample"
                        aria-disabled={mediaUploading}
                        className={`flex items-center justify-center gap-3 text-sm text-slate-600 ${mediaUploading ? "cursor-wait opacity-60" : "cursor-pointer"}`}
                      >
                        <Upload className="w-4 h-4" />
                        {mediaUploading
                          ? "Mengunggah contoh ke Meta..."
                          : formData.mediaSampleFileName
                            ? formData.mediaSampleFileName
                            : `Unggah contoh ${MEDIA_SAMPLE_RULES[formData.headerType as MediaHeaderType].label}`}
                      </label>
                    </div>
                    {hasUsableMetaMediaHandle(formData.mediaSampleHandle) && !mediaUploading && (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-emerald-700">Contoh media siap</span>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => sampleInputRef.current?.click()}>Ganti File</Button>
                          <Button type="button" variant="ghost" size="sm" onClick={clearMediaSample}>Hapus</Button>
                        </div>
                      </div>
                    )}
                    {formData.mediaSampleFileName && !hasUsableMetaMediaHandle(formData.mediaSampleHandle) && !mediaUploading && (
                      <div className="mt-2 flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => sampleInputRef.current?.click()}>Ganti File</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={clearMediaSample}>Hapus</Button>
                      </div>
                    )}
                    {mediaUploadError && <p className="mt-2 text-xs text-red-600" role="alert">{mediaUploadError}</p>}
                    {!mediaUploadError && headerError && <p className="mt-2 text-xs text-red-600" role="alert">{headerError}</p>}
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <Label htmlFor="template-body">Konten Pesan *</Label>
                      <Button type="button" variant="outline" size="sm" onClick={handleAddVariable}>
                        + Variabel
                      </Button>
                    </div>
                    <span className={`text-xs ${formData.body.length > 1000 ? "text-red-600" : "text-muted-foreground"}`}>
                      {formData.body.length}/1024
                    </span>
                  </div>

                  <div className="mb-2 flex flex-wrap gap-1" role="toolbar" aria-label="Format teks body">
                    <Button type="button" variant="outline" size="sm" aria-label="Format tebal" onClick={() => applyBodyFormatting("*")}><Bold className="h-4 w-4" /></Button>
                    <Button type="button" variant="outline" size="sm" aria-label="Format miring" onClick={() => applyBodyFormatting("_")}><Italic className="h-4 w-4" /></Button>
                    <Button type="button" variant="outline" size="sm" aria-label="Format coret" onClick={() => applyBodyFormatting("~")}><Strikethrough className="h-4 w-4" /></Button>
                    <Button type="button" variant="outline" size="sm" aria-label="Format monospace" onClick={() => applyBodyFormatting("```")}><Code className="h-4 w-4" /></Button>
                  </div>

                  <Textarea
                    ref={bodyInputRef}
                    id="template-body"
                    required
                    aria-invalid={Boolean(bodyError)}
                    aria-describedby={bodyError ? "template-body-error" : "template-body-help"}
                    rows={7}
                    placeholder="Contoh: Halo {{1}}, terima kasih telah bergabung dengan {{2}}."
                    value={formData.body}
                    onChange={(e) => handleBodyChange(e.target.value)}
                  />
                  {bodyError ? (
                    <p id="template-body-error" className="text-xs text-red-600 mt-1">{bodyError}</p>
                  ) : (
                    <p id="template-body-help" className="text-xs text-muted-foreground mt-1">
                      Gunakan format variabel seperti {`{{1}}`}, {`{{2}}`}, dst.
                    </p>
                  )}
                </div>

                <div>
                  <Label>Contoh isi variabel</Label>
                  <div className="mt-2 space-y-2">
                    {variables.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Tambahkan variabel di body untuk mengisi contoh.
                      </p>
                    ) : (
                      variables.map((idx) => (
                        <div key={idx} className="flex items-center gap-3">
                          <div className="px-3 py-2 rounded bg-slate-100 text-xs font-mono min-w-[70px] text-center">
                            {`{{${idx}}}`}
                          </div>
                          <Input
                            placeholder={`Contoh untuk {{${idx}}}`}
                            value={examples[idx] || ""}
                            onChange={(e) =>
                              setExamples((prev) => ({
                                ...prev,
                                [idx]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="template-footer">Footer</Label>
                    <span className={`text-xs ${formData.footerText.length > 55 ? "text-red-600" : "text-muted-foreground"}`}>
                      {formData.footerText.length}/60
                    </span>
                  </div>
                  <Input
                    id="template-footer"
                    aria-invalid={Boolean(footerError)}
                    aria-describedby={footerError ? "template-footer-error" : undefined}
                    placeholder="Footer opsional"
                    value={formData.footerText}
                    onChange={(e) => {
                      setFormData((prev) => ({ ...prev, footerText: e.target.value }));
                      setFooterError(validateFooterText(e.target.value));
                    }}
                  />
                  {footerError && <p id="template-footer-error" className="text-xs text-red-600 mt-1">{footerError}</p>}
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><Label>Tombol · Opsional</Label><p className="text-xs text-slate-500">Maksimal 10 total; hingga 2 URL, 1 telepon, dan 1 Salin Kode.</p></div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={!canAddButtonType(formData.buttons, "QUICK_REPLY", formData.category)} onClick={() => addButton("QUICK_REPLY")}><Plus className="mr-1 h-4 w-4" />Quick Reply</Button>
                      <Button type="button" variant="outline" size="sm" disabled={!canAddButtonType(formData.buttons, "URL", formData.category)} onClick={() => addButton("URL")}><LinkIcon className="mr-1 h-4 w-4" />Website</Button>
                      <Button type="button" variant="outline" size="sm" disabled={!canAddButtonType(formData.buttons, "PHONE_NUMBER", formData.category)} onClick={() => addButton("PHONE_NUMBER")}><Phone className="mr-1 h-4 w-4" />Telepon</Button>
                      <Button type="button" variant="outline" size="sm" disabled={!canAddButtonType(formData.buttons, "COPY_CODE", formData.category)} onClick={() => addButton("COPY_CODE")}><Code className="mr-1 h-4 w-4" />Salin Kode</Button>
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    {formData.buttons.map((button, index) => (
                      <div key={button.id} className="rounded-xl border p-3">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm font-medium"><GripVertical className="h-4 w-4 text-slate-400" />Tombol {index + 1} · {button.type}</div>
                          <div className="flex gap-1">
                            <Button type="button" variant="ghost" size="sm" aria-label={`Naikkan tombol ${index + 1}`} disabled={index === 0} onClick={() => moveButton(index, -1)}>↑</Button>
                            <Button type="button" variant="ghost" size="sm" aria-label={`Turunkan tombol ${index + 1}`} disabled={index === formData.buttons.length - 1} onClick={() => moveButton(index, 1)}>↓</Button>
                            <Button type="button" variant="ghost" size="sm" aria-label={`Hapus tombol ${index + 1}`} onClick={() => removeButton(button.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div><Label htmlFor={`button-text-${button.id}`}>{button.type === "COPY_CODE" ? "Label Meta" : "Teks"}</Label><Input id={`button-text-${button.id}`} className="mt-1" maxLength={25} disabled={button.type === "COPY_CODE"} value={button.type === "COPY_CODE" ? "Salin kode promo" : button.text} onChange={(e) => handleButtonChange(button.id, "text", e.target.value)} /></div>
                          {button.type === "URL" && <div><Label htmlFor={`button-value-${button.id}`}>URL HTTPS (opsional suffix {`{{1}}`})</Label><Input id={`button-value-${button.id}`} className="mt-1" placeholder="https://example.com/order/{{1}}" value={button.value} onChange={(e) => handleButtonChange(button.id, "value", e.target.value)} /></div>}
                          {button.type === "PHONE_NUMBER" && <div><Label htmlFor={`button-value-${button.id}`}>Nomor E.164</Label><Input id={`button-value-${button.id}`} className="mt-1" placeholder="+628123456789" value={button.value} onChange={(e) => handleButtonChange(button.id, "value", e.target.value)} /></div>}
                          {button.type === "URL" && /\{\{1\}\}$/.test(button.value) && <div><Label htmlFor={`button-example-${button.id}`}>Contoh URL lengkap</Label><Input id={`button-example-${button.id}`} className="mt-1" placeholder="https://example.com/order/ABC123" value={button.example || ""} onChange={(e) => handleButtonChange(button.id, "example", e.target.value)} /></div>}
                          {button.type === "COPY_CODE" && <div><Label htmlFor={`button-example-${button.id}`}>Contoh kode promo</Label><Input id={`button-example-${button.id}`} className="mt-1" placeholder="PROMO2026" value={button.example || ""} onChange={(e) => handleButtonChange(button.id, "example", e.target.value)} /></div>}
                        </div>
                      </div>
                    ))}
                    {formData.buttons.length === 0 && <p className="rounded-lg border border-dashed p-3 text-sm text-slate-500">Belum ada tombol.</p>}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">URL dinamis memakai satu suffix {`{{1}}`}. Salin Kode hanya untuk Marketing. Flow dan Commerce tersedia melalui builder khusus.</div>
                  {buttonError && <p className="mt-1 text-xs text-red-600">{buttonError}</p>}
                </div>
                </>)}
              </div>

              <div className="h-fit min-w-0 space-y-4 lg:sticky lg:top-0">
                {builderStep === 1 ? (
                  <StepOnePreviewPanel
                      category={formData.category}
                      templateType={formData.templateType}
                      available={formData.templateType === "default"
                        || formData.templateType === "authentication_otp"
                        || formData.templateType === "carousel"
                        || (formData.templateType === "flow" && templateCapabilities?.flow?.create === true)
                        || (["catalog", "multi_product"].includes(formData.templateType) && commerceCapability?.catalogEligible === true)}
                  />
                ) : <div className="rounded-xl border bg-slate-50 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    <strong className="text-sm">Preview Template</strong>
                  </div>
                  {formData.category === "authentication" ? (
                    <AuthenticationPreview
                      method={formData.otpButtonType}
                      securityRecommendation={formData.securityRecommendation}
                      expiryMinutes={formData.codeExpirationMinutes}
                    />
                  ) : formData.templateType === "flow" ? (
                    <FlowPreview body={formData.body} footer={formData.footerText} buttonText={formData.flowButtonText} />
                  ) : formData.templateType === "carousel" ? (
                    <CarouselPreview body={formData.body} cards={formData.carouselCards} />
                  ) : ["catalog", "multi_product"].includes(formData.templateType) ? (
                    <CommercePreview type={formData.templateType === "multi_product" ? "multi_product" : "catalog"} body={formData.body} footer={formData.footerText} buttonText={formData.commerceButtonText} products={formData.commerceProducts} />
                  ) : (
                    <WhatsAppBubblePreview
                      headerType={formData.headerType}
                      headerText={applyExamplesToText(formData.headerText, { 1: formData.headerExample }, "token")}
                      mediaSampleName={formData.mediaSampleFileName || defaultSampleName(formData.headerType)}
                      body={applyExamplesToText(previewBody, examples, "token")}
                      footer={formData.footerText}
                      buttons={formData.buttons}
                    />
                  )}
                </div>}

                {/*   <div className="rounded-xl border bg-white p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <Send className="w-4 h-4" />
                    Ringkasan template
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-xs text-slate-500 mb-1">Variabel</div>
                      <div className="flex flex-wrap gap-2">
                        {variables.length === 0 ? (
                          <span className="text-slate-500">Tidak ada</span>
                        ) : (
                          variables.map((idx) => (
                            <Badge key={idx} variant="outline">
                              {`{{${idx}}}`}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-xs text-slate-500 mb-1">Header</div>
                      <div className="text-slate-700">
                        {formData.headerType === "none"
                          ? "Tidak ada"
                          : formData.headerType === "text"
                          ? formData.headerText || "Text Header"
                          : `${formData.headerType} · ${formData.mediaSampleFileName || defaultSampleName(formData.headerType)}`}
                      </div>
                    </div>
                  </div>
                </div> */}
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                {builderStep > 1 && <Button type="button" variant="outline" onClick={() => setBuilderStep((builderStep - 1) as 1 | 2)} disabled={saving}>Sebelumnya</Button>}
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="ghost" onClick={closeModal} disabled={saving}>Batal</Button>
                {builderStep === 1 && <Button type="button" disabled={!canAdvanceSetup || saving} onClick={() => setBuilderStep(2)}>Lanjut ke Editor</Button>}
                {builderStep === 2 && <Button type="button" disabled={saving || mediaUploading || carouselUploadIndex !== null} onClick={() => { if (validateAll()) setBuilderStep(3); }}>{mediaUploading || carouselUploadIndex !== null ? "Mengunggah contoh..." : "Tinjau Template"}</Button>}
                {builderStep === 3 && editingTemplate?.metaTemplateId && (formData.category === "authentication" || formData.templateType === "flow" || formData.templateType === "carousel" || ["catalog", "multi_product"].includes(formData.templateType)) ? (
                  <Button type="button" onClick={closeModal}>Tutup</Button>
                ) : builderStep === 3 && <>
                    <Button type="button" variant="outline" disabled={saving || mediaUploading} onClick={() => void handleSave()}><Save className="mr-2 h-4 w-4" />Simpan Draf</Button>
                    <Button type="button" disabled={saving || mediaUploading} onClick={() => void handleSubmitReview()}><CloudUpload className="mr-2 h-4 w-4" />{saving ? "Memproses..." : editingTemplate?.metaTemplateId ? "Simpan Perubahan" : "Kirim untuk Ditinjau"}</Button>
                  </>}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Delete Template Confirmation Modal */}
      <AppModal
        open={deleteModalOpen}
        title="Konfirmasi Hapus Template"
        closeDisabled={deletingTemplate}
        onClose={() => {
          if (!deletingTemplate) {
            setDeleteModalOpen(false);
            setTemplateIdToDelete(null);
          }
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={deletingTemplate}
              onClick={() => {
                setDeleteModalOpen(false);
                setTemplateIdToDelete(null);
              }}
            >
              Batal
            </Button>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={handleConfirmDelete}
              disabled={deletingTemplate}
            >
              {deletingTemplate ? "Menghapus..." : "Hapus Template"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Hapus template <strong>{templateToDelete?.name || "ini"}</strong>? Template yang sudah terhubung akan dihapus di Meta terlebih dahulu. Jika Meta menolak, data SIPESA tetap dipertahankan dan pesan kegagalan akan ditampilkan.
        </p>
      </AppModal>

      <AppModal
        open={!!templateToSubmit}
        title="Kirim Template untuk Ditinjau"
        closeDisabled={pushingId !== null}
        onClose={() => {
          if (!pushingId) setTemplateToSubmit(null);
        }}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={pushingId !== null} onClick={() => setTemplateToSubmit(null)}>Batal</Button>
            <Button disabled={pushingId !== null} onClick={() => templateToSubmit && void handlePushToMeta(templateToSubmit.id)}>
              {pushingId ? "Mengirim..." : "Ya, Kirim untuk Ditinjau"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 break-words">
          Kirim template <strong className="text-slate-800">{templateToSubmit?.name}</strong> untuk ditinjau Meta? Pengiriman ini tidak menjamin template akan disetujui.
        </p>
      </AppModal>
    </div>
  );
}
