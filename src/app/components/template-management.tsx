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
} from "lucide-react";
import { api, TemplateItem, BroadcastHistoryItem, NumberItem } from "../lib/api";
import { META_TEMPLATE_LANGUAGES, type MetaTemplateLanguageCode } from "../lib/meta-template-languages";
import { useVisibilityRefresh } from "../hooks/use-visibility-refresh";
import { useDialogFocus } from "../hooks/use-dialog-focus";

type TemplateCategory = "marketing" | "utility" | "authentication";
type HeaderType = "none" | "text" | "image" | "video" | "document" | "location";
type TemplateButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
type TemplateButton = { id: string; type: TemplateButtonType; text: string; value: string };

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
  if (typeof possible === "string" && possible.startsWith("4::")) return possible;
  return "";
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
      text: String(b?.text || ""),
      value: type === "URL" ? String(b?.url || "") : type === "PHONE_NUMBER" ? String(b?.phone_number || "") : "",
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

function validateButtons(buttons: TemplateButton[]): string | null {
  const quickReplies = buttons.filter((button) => button.type === "QUICK_REPLY");
  const actions = buttons.filter((button) => button.type !== "QUICK_REPLY");
  if (quickReplies.length && actions.length) return "Quick Reply dan tombol tindakan belum dapat digabung di SIPESA.";
  if (quickReplies.length > 3) return "Maksimal 3 tombol Quick Reply di SIPESA.";
  if (actions.length > 2) return "Maksimal 2 tombol tindakan di SIPESA.";
  if (buttons.filter((button) => button.type === "URL").length > 1) return "Maksimal satu tombol website.";
  if (buttons.filter((button) => button.type === "PHONE_NUMBER").length > 1) return "Maksimal satu tombol telepon.";
  for (const btn of buttons) {
    if (!btn.text.trim()) return "Teks tombol wajib diisi.";
    if (btn.text.length > 25) return "Teks tombol maksimal 25 karakter.";
    if (btn.type === "URL") {
      if (/\{\{\d+\}\}/.test(btn.value)) return "URL dinamis belum didukung di SIPESA.";
      try {
        if (new URL(btn.value).protocol !== "https:") return "URL website wajib menggunakan HTTPS.";
      } catch {
        return "URL website tidak valid.";
      }
    }
    if (btn.type === "PHONE_NUMBER" && !/^\+[1-9]\d{7,14}$/.test(btn.value)) {
      return "Nomor telepon wajib format E.164, contoh +628123456789.";
    }
  }
  return null;
}

function buildComponentsFromForm(form: {
  headerType: HeaderType;
  headerText: string;
  body: string;
  footerText: string;
  buttons: TemplateButton[];
  examples: Record<number, string>;
  mediaSampleFileName?: string;
  mediaSampleHandle?: string;
}) {
  const components: any[] = [];

  if (form.headerType === "text" && form.headerText.trim()) {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: form.headerText.trim(),
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
        text: button.text.trim(),
        ...(button.type === "URL" ? { url: button.value.trim() } : {}),
        ...(button.type === "PHONE_NUMBER" ? { phone_number: button.value.trim() } : {}),
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
    body: "",
    footerText: "",
    buttons: [] as TemplateButton[],
    mediaSampleFileName: "",
    mediaSampleHandle: "",
    wabaId: "",
  });

  const [examples, setExamples] = useState<Record<number, string>>({});
  const [nameError, setNameError] = useState<string | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [footerError, setFooterError] = useState<string | null>(null);
  const [buttonError, setButtonError] = useState<string | null>(null);

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
    setEditingTemplate(null);
    setFormData({
      name: "",
      category: "marketing",
      templateType: "default",
      variableType: "number",
      language: "id",
      headerType: "none",
      headerText: "",
      body: "",
      footerText: "",
      buttons: [],
      mediaSampleFileName: "",
      mediaSampleHandle: "",
      wabaId: numbers.find((number) => number.wabaId)?.wabaId || "",
    });
    setExamples({});
    setNameError(null);
    setHeaderError(null);
    setBodyError(null);
    setFooterError(null);
    setButtonError(null);
    setBuilderStep(1);
    setShowModal(true);
  };

  const openEditModal = (tpl: LocalTemplate) => {
    if (tpl.category?.toLowerCase() === "authentication" || tpl.runtimeSupport?.supported === false) {
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
      body,
      footerText: tpl.footerText || "",
      buttons,
      mediaSampleFileName: tpl.mediaSampleName || "",
      mediaSampleHandle: tpl.mediaSampleHandle || "",
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
    const nextHeaderError =
      formData.headerType === "text"
        ? validateHeaderText(formData.headerText)
        : ["image", "video", "document"].includes(formData.headerType) && !formData.mediaSampleHandle
          ? "File media contoh wajib diunggah sebelum menyimpan."
          : null;
    const nextBodyError = validateBody(formData.body);
    const nextFooterError = validateFooterText(formData.footerText);
    const nextButtonError = validateButtons(formData.buttons);

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

    return !nextNameError && !nextHeaderError && !nextBodyError && !nextFooterError && !nextButtonError && !missingExample;
  };

  const persistTemplate = async (submitForReview: boolean) => {
    if (saving) return;
    if (!validateAll()) return;
    if (!formData.wabaId) {
      toast.error("Pilih WABA pemilik template.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
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

  const handleButtonChange = (id: string, field: "text" | "value" | "type", value: string) => {
    const nextButtons = formData.buttons.map((button) => button.id === id ? { ...button, [field]: value } : button) as TemplateButton[];
    setFormData((prev) => ({ ...prev, buttons: nextButtons }));
    setButtonError(validateButtons(nextButtons));
  };

  const addButton = (type: TemplateButtonType) => {
    const existingQuick = formData.buttons.filter((button) => button.type === "QUICK_REPLY").length;
    const existingActions = formData.buttons.length - existingQuick;
    if ((type === "QUICK_REPLY" && existingActions > 0) || (type !== "QUICK_REPLY" && existingQuick > 0)) {
      setButtonError("Quick Reply dan tombol tindakan belum dapat digabung di SIPESA.");
      return;
    }
    if (type === "QUICK_REPLY" && existingQuick >= 3) return setButtonError("Maksimal 3 tombol Quick Reply di SIPESA.");
    if (type !== "QUICK_REPLY" && existingActions >= 2) return setButtonError("Maksimal 2 tombol tindakan di SIPESA.");
    if (type === "URL" && formData.buttons.some((button) => button.type === "URL")) return setButtonError("Maksimal satu tombol website.");
    if (type === "PHONE_NUMBER" && formData.buttons.some((button) => button.type === "PHONE_NUMBER")) return setButtonError("Maksimal satu tombol telepon.");
    const next = [...formData.buttons, { id: crypto.randomUUID(), type, text: "", value: "" }];
    setFormData((prev) => ({ ...prev, buttons: next }));
    setButtonError(null);
  };

  const removeButton = (id: string) => {
    const next = formData.buttons.filter((button) => button.id !== id);
    setFormData((prev) => ({ ...prev, buttons: next }));
    setButtonError(validateButtons(next));
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

  const canAdvanceSetup = Boolean(formData.wabaId && ["marketing", "utility"].includes(formData.category) && formData.templateType === "default");

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
                    <th className="px-5 py-3.5 text-center hidden md:table-cell" title="Jumlah terkirim dari maksimal 50 broadcast terbaru">Terkirim (50 broadcast terbaru)</th>
                    <th className="px-5 py-3.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedTemplates.map((template) => {
                    const isSelected = selectedTemplate?.id === template.id;
                    const sentCount = sentCounts[template.id] || 0;

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
                            {template.category} · {template.category?.toLowerCase() === "authentication" ? "OTP" : "Default"}
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
                          {template.rejectionReason && <span className="block mt-1 text-[11px] text-red-600" title={template.rejectionReason}>Alasan penolakan tersedia</span>}
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
                              disabled={template.category?.toLowerCase() === "authentication" || template.runtimeSupport?.supported === false || Boolean(template.metaTemplateId && !["approved", "rejected", "paused"].includes(String(template.status).toLowerCase()))}
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
                {(selectedTemplate.category?.toLowerCase() === "authentication" || selectedTemplate.runtimeSupport?.supported === false) && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
                    Template ini memiliki komponen Meta yang belum dapat diedit di SIPESA. Template ditampilkan read-only dan tidak didukung untuk pengiriman.
                  </div>
                )}
                {selectedTemplate.rejectionReason && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <strong>Alasan penolakan:</strong> {selectedTemplate.rejectionReason}
                  </div>
                )}
                <WhatsAppBubblePreview
                  headerType={selectedTemplate.headerType || "none"}
                  headerText={selectedTemplate.headerText}
                  mediaSampleName={selectedTemplate.mediaSampleName}
                  body={previewSelectedBody}
                  footer={selectedTemplate.footerText}
                  buttons={selectedTemplate.buttons}
                />

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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-80 p-6">
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

            <div className="p-6 grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-6 flex-1 overflow-y-auto min-h-0">
              <div className="space-y-6">
                {builderStep === 1 ? (
                  <div className="space-y-6">
                    <div>
                      <Label htmlFor="template-waba-setup">WABA Pemilik *</Label>
                      <select id="template-waba-setup" aria-label="WABA pemilik template" className="mt-2 w-full rounded-lg border bg-white p-3" value={formData.wabaId} disabled={Boolean(editingTemplate)} onChange={(e) => setFormData((prev) => ({ ...prev, wabaId: e.target.value }))}>
                        <option value="">Pilih WABA</option>
                        {[...new Map(numbers.filter((number) => number.wabaId).map((number) => [number.wabaId, number])).values()].map((number) => (
                          <option key={number.wabaId!} value={number.wabaId!}>{number.name} · {number.wabaId}</option>
                        ))}
                      </select>
                    </div>
                    <fieldset>
                      <legend className="mb-3 text-sm font-medium">Kategori *</legend>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {([
                          ["marketing", "Marketing", "Promosi, penawaran, dan engagement pelanggan."],
                          ["utility", "Utility", "Pembaruan transaksi dan informasi layanan."],
                          ["authentication", "Authentication", "Kode OTP dengan struktur khusus Meta."],
                        ] as const).map(([value, label, description]) => (
                          <button key={value} type="button" aria-pressed={formData.category === value} onClick={() => setFormData((prev) => ({ ...prev, category: value, templateType: value === "authentication" ? "otp" : "default" }))} className={`rounded-xl border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${formData.category === value ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-slate-300"}`}>
                            <span className="block font-semibold">{label}</span>
                            <span className="mt-1 block text-xs text-slate-500">{description}</span>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend className="mb-3 text-sm font-medium">Tipe Template *</legend>
                      <div className="space-y-2">
                        <button type="button" disabled={formData.category === "authentication"} aria-pressed={formData.templateType === "default"} onClick={() => setFormData((prev) => ({ ...prev, templateType: "default" }))} className={`w-full rounded-xl border p-4 text-left ${formData.templateType === "default" && formData.category !== "authentication" ? "border-emerald-500 bg-emerald-50" : "border-slate-200"} disabled:cursor-not-allowed disabled:opacity-60`}>
                          <span className="font-semibold">{formData.category === "authentication" ? "One-time passcode" : "Default"}</span>
                          <span className="ml-2 text-xs text-slate-500">{formData.category === "authentication" ? "Belum didukung di SIPESA" : "Template normal dengan komponen yang didukung end-to-end."}</span>
                        </button>
                        {formData.category !== "authentication" && ["Flows", formData.category === "marketing" ? "Catalogue" : null, "Calling permissions request"].filter(Boolean).map((label) => (
                          <button key={label} type="button" disabled className="w-full cursor-not-allowed rounded-xl border border-dashed border-slate-200 p-3 text-left text-sm text-slate-500"><span className="font-medium text-slate-700">{label}</span> · Belum didukung di SIPESA</button>
                        ))}
                      </div>
                    </fieldset>
                    {formData.category === "authentication" && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">Template Authentication menggunakan struktur OTP khusus Meta dan belum dapat dibuat dari SIPESA.</div>}
                  </div>
                ) : builderStep === 3 ? (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" /><h4 className="font-semibold">Tinjau template sebelum dikirim</h4></div>
                    <dl className="grid grid-cols-1 gap-3 rounded-xl border bg-slate-50 p-4 text-sm sm:grid-cols-2">
                      <div><dt className="text-slate-500">WABA</dt><dd className="break-all font-medium">{formData.wabaId}</dd></div>
                      <div><dt className="text-slate-500">Kategori · Tipe</dt><dd className="font-medium capitalize">{formData.category} · {formData.templateType}</dd></div>
                      <div><dt className="text-slate-500">Nama</dt><dd className="break-words font-medium">{formData.name}</dd></div>
                      <div><dt className="text-slate-500">Bahasa</dt><dd className="font-medium">{META_TEMPLATE_LANGUAGES.find(([code]) => code === formData.language)?.[1]} ({formData.language})</dd></div>
                      <div><dt className="text-slate-500">Header</dt><dd className="font-medium capitalize">{formData.headerType}</dd></div>
                      <div><dt className="text-slate-500">Variabel</dt><dd className="font-medium">{variables.length} positional</dd></div>
                      <div><dt className="text-slate-500">Footer</dt><dd className="font-medium">{formData.footerText || "Tidak ada"}</dd></div>
                      <div><dt className="text-slate-500">Tombol</dt><dd className="font-medium">{formData.buttons.length}</dd></div>
                    </dl>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><strong>VALID</strong> · Template siap disimpan atau dikirim untuk ditinjau Meta.</div>
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
                    <Label htmlFor="template-header-type">Jenis Header / Contoh Media</Label>
                    <select
                      id="template-header-type"
                      className="w-full p-3 border rounded-lg mt-2 bg-white"
                      value={formData.headerType}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          headerType: e.target.value as HeaderType,
                          mediaSampleFileName:
                            ["image", "video", "document", "location"].includes(e.target.value)
                              ? defaultSampleName(e.target.value as HeaderType)
                              : prev.mediaSampleFileName,
                        }))
                      }
                    >
                      <option value="none">None</option>
                      <option value="text">Text Header</option>
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                      <option value="document">Document</option>
                      <option value="location" disabled>Location — Belum didukung</option>
                    </select>
                    {formData.headerType === "text" && (
                      <p className="mt-1 text-xs text-slate-500">Variabel pada text header belum didukung dan akan ditolak oleh server.</p>
                    )}
                  </div>
                </div>

                {formData.headerType === "text" && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="template-header-text">Teks Header</Label>
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
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;

                          if (file.size > 5 * 1024 * 1024) {
                            toast.error("Ukuran file contoh maksimal 5MB");
                            return;
                          }

                          const toastId = toast.loading("Mengunggah file contoh ke Meta...");
                          try {
                            if (!formData.wabaId) {
                              toast.error("Pilih WABA sebelum mengunggah media.", { id: toastId });
                              return;
                            }
                            const result = await api.uploadTemplateSample(file, formData.wabaId);
                            if ("error" in result) {
                              toast.error("Gagal mengunggah ke Meta: " + result.error, { id: toastId });
                              return;
                            }

                            setFormData((prev) => ({
                              ...prev,
                              mediaSampleFileName: file.name,
                              mediaSampleHandle: result.data.handle,
                            }));
                            toast.success("File contoh berhasil diunggah ke Meta", { id: toastId });
                          } catch (err) {
                            console.error(err);
                            toast.error("Gagal mengunggah file contoh ke Meta", { id: toastId });
                          }
                        }}
                      />
                      <label
                        htmlFor="template-media-sample"
                        className="flex items-center justify-center gap-3 cursor-pointer text-sm text-slate-600"
                      >
                        <Upload className="w-4 h-4" />
                        {formData.mediaSampleFileName
                          ? `Sample: ${formData.mediaSampleFileName}`
                          : "Upload sample media"}
                      </label>
                    </div>
                    {headerError && <p className="text-xs text-red-600 mt-1">{headerError}</p>}
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
                    <div><Label>Tombol · Opsional</Label><p className="text-xs text-slate-500">Quick Reply atau maksimal dua tombol tindakan.</p></div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => addButton("QUICK_REPLY")}><Plus className="mr-1 h-4 w-4" />Quick Reply</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => addButton("URL")}><LinkIcon className="mr-1 h-4 w-4" />Website</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => addButton("PHONE_NUMBER")}><Phone className="mr-1 h-4 w-4" />Telepon</Button>
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
                          <div><Label htmlFor={`button-text-${button.id}`}>Teks</Label><Input id={`button-text-${button.id}`} className="mt-1" maxLength={25} value={button.text} onChange={(e) => handleButtonChange(button.id, "text", e.target.value)} /></div>
                          {button.type === "URL" && <div><Label htmlFor={`button-value-${button.id}`}>URL statis HTTPS</Label><Input id={`button-value-${button.id}`} className="mt-1" placeholder="https://example.com" value={button.value} onChange={(e) => handleButtonChange(button.id, "value", e.target.value)} /></div>}
                          {button.type === "PHONE_NUMBER" && <div><Label htmlFor={`button-value-${button.id}`}>Nomor E.164</Label><Input id={`button-value-${button.id}`} className="mt-1" placeholder="+628123456789" value={button.value} onChange={(e) => handleButtonChange(button.id, "value", e.target.value)} /></div>}
                        </div>
                      </div>
                    ))}
                    {formData.buttons.length === 0 && <p className="rounded-lg border border-dashed p-3 text-sm text-slate-500">Belum ada tombol.</p>}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">URL dinamis, Copy Code, Flow, katalog, dan tombol conditional lain belum didukung.</div>
                  {buttonError && <p className="mt-1 text-xs text-red-600">{buttonError}</p>}
                </div>
                </>)}
              </div>

              <div className="space-y-4 xl:sticky xl:top-0 h-fit">
                <div className="rounded-xl border bg-slate-50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Eye className="w-4 h-4" />
                    <strong className="text-sm">Preview Template</strong>
                  </div>

                  {builderStep === 1 ? (
                    <div className="rounded-xl border border-dashed bg-white p-6 text-center text-sm text-slate-500">Preview aktif setelah setup template selesai.</div>
                  ) : (
                    <WhatsAppBubblePreview
                      headerType={formData.headerType}
                      headerText={formData.headerText}
                      mediaSampleName={formData.mediaSampleFileName || defaultSampleName(formData.headerType)}
                      body={applyExamplesToText(previewBody, examples, "token")}
                      footer={formData.footerText}
                      buttons={formData.buttons}
                    />
                  )}
                </div>

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
                {builderStep === 2 && <Button type="button" disabled={saving} onClick={() => { if (validateAll()) setBuilderStep(3); }}>Tinjau Template</Button>}
                {builderStep === 3 && <>
                  <Button type="button" variant="outline" disabled={saving} onClick={() => void handleSave()}><Save className="mr-2 h-4 w-4" />Simpan Draf</Button>
                  <Button type="button" disabled={saving} onClick={() => void handleSubmitReview()}><CloudUpload className="mr-2 h-4 w-4" />{saving ? "Memproses..." : editingTemplate?.metaTemplateId ? "Simpan Perubahan" : "Kirim untuk Ditinjau"}</Button>
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
