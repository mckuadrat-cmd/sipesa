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
} from "lucide-react";
import { api, TemplateItem, BroadcastHistoryItem } from "../lib/api";

type TemplateCategory = "marketing" | "utility" | "authentication";
type HeaderType = "none" | "text" | "image" | "video" | "document" | "location";
type ButtonType = "none" | "quick_reply";
type LanguageCode = "id" | "en_US" | "en";

interface LocalTemplate extends TemplateItem {
  headerType?: HeaderType;
  headerText?: string;
  footerText?: string;
  buttons?: Array<{ type: "QUICK_REPLY"; text: string }>;
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

function extractButtons(components: any): Array<{ type: "QUICK_REPLY"; text: string }> {
  if (!Array.isArray(components)) return [];
  const btnComp = components.find((c: any) => String(c?.type || "").toUpperCase() === "BUTTONS");
  if (!btnComp || !Array.isArray(btnComp.buttons)) return [];

  return btnComp.buttons
    .filter((b: any) => String(b?.type || "").toUpperCase() === "QUICK_REPLY")
    .map((b: any) => ({
      type: "QUICK_REPLY",
      text: String(b?.text || ""),
    }));
}

function extractPreviewExamples(components: any): Record<number, string> {
  if (!Array.isArray(components)) return {};
  const body = components.find((c: any) => String(c?.type || "").toUpperCase() === "BODY");
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

function validateButtons(buttons: string[]): string | null {
  const clean = buttons.filter((b) => b.trim());
  if (clean.length > 10) return "Maksimal 10 tombol.";
  for (const btn of clean) {
    if (btn.length > 25) return "Teks tombol maksimal 25 karakter.";
  }
  return null;
}

function buildComponentsFromForm(form: {
  headerType: HeaderType;
  headerText: string;
  body: string;
  footerText: string;
  buttons: string[];
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

  const quickReplies = form.buttons
    .filter((b) => b.trim())
    .map((b) => ({
      type: "QUICK_REPLY",
      text: b.trim(),
    }));

  if (quickReplies.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: quickReplies,
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
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function getStatusLabel(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "Approved";
  if (s === "pending") return "Pending";
  if (s === "rejected") return "Rejected";
  if (s === "draft") return "Draft";
  return status;
}

function getTemplateDateValue(template: any) {
  const raw =
    template?.updated_at ||
    template?.updatedAt ||
    template?.created_at ||
    template?.createdAt ||
    template?.synced_at ||
    template?.submitted_at ||
    template?.timestamp;

  if (raw) {
    const date = new Date(raw).getTime();
    if (!Number.isNaN(date)) return date;
  }

  const numericId = Number(String(template?.id || "").replace(/\D/g, ""));
  return Number.isFinite(numericId) ? numericId : 0;
}

function compareTemplates(a: any, b: any) {
  const aHasMeta = !!(a.metaTemplateId || a.meta_template_id);
  const bHasMeta = !!(b.metaTemplateId || b.meta_template_id);

  // 1. Prioritize drafts (no metaTemplateId) to the top
  if (!aHasMeta && bHasMeta) return -1;
  if (aHasMeta && !bHasMeta) return 1;

  // 2. If both are drafts, sort by date (newest first)
  if (!aHasMeta && !bHasMeta) {
    const aTime = new Date(a.updatedAt || a.createdAt || a.updated_at || a.created_at || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || b.updated_at || b.created_at || 0).getTime();
    return bTime - aTime;
  }

  // 3. If both are synced, sort by metaTemplateId descending (newer Meta templates have larger IDs)
  const aMetaId = String(a.metaTemplateId || a.meta_template_id || "");
  const bMetaId = String(b.metaTemplateId || b.meta_template_id || "");
  return bMetaId.localeCompare(aMetaId, undefined, { numeric: true });
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
  buttons?: Array<{ type: "QUICK_REPLY"; text: string }>;
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
                  <MessageSquare className="w-4 h-4" />
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
  const [selectedTemplate, setSelectedTemplate] = useState<LocalTemplate | null>(null);
  const [sentCounts, setSentCounts] = useState<Record<string, number>>({});
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<LocalTemplate | null>(null);
  const [loading, setLoading] = useState(true);
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

  const [formData, setFormData] = useState({
    name: "",
    category: "marketing" as TemplateCategory,
    language: "id" as LanguageCode,
    headerType: "none" as HeaderType,
    headerText: "",
    body: "",
    footerText: "",
    buttonType: "none" as ButtonType,
    buttons: ["", "", ""],
    mediaSampleFileName: "",
    mediaSampleHandle: "",
  });

  const [examples, setExamples] = useState<Record<number, string>>({});
  const [nameError, setNameError] = useState<string | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [footerError, setFooterError] = useState<string | null>(null);
  const [buttonError, setButtonError] = useState<string | null>(null);

  const sampleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const [result, historyResult] = await Promise.all([
        api.getBroadcastTemplates(),
        api.getBroadcastHistory(),
      ]);

      if ("error" in result) {
        toast.error("Gagal memuat template: " + result.error);
        return;
      }

      const counts: Record<string, number> = {};
      if (historyResult && !("error" in historyResult)) {
        (historyResult.data ?? []).forEach((b) => {
          if (b.templateId) {
            counts[b.templateId] = (counts[b.templateId] || 0) + (b.totalSent || 0);
          }
        });
      }
      setSentCounts(counts);

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
    } finally {
      setLoading(false);
    }
  };

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
    console.log("TEMPLATE_MANAGEMENT sorted templates:", sorted.map(t => ({ name: t.name, updatedAt: t.updatedAt, createdAt: t.createdAt, metaTemplateId: t.metaTemplateId })));
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
      language: "id",
      headerType: "none",
      headerText: "",
      body: "",
      footerText: "",
      buttonType: "none",
      buttons: ["", "", ""],
      mediaSampleFileName: "",
      mediaSampleHandle: "",
    });
    setExamples({});
    setNameError(null);
    setHeaderError(null);
    setBodyError(null);
    setFooterError(null);
    setButtonError(null);
    setShowModal(true);
  };

  const openEditModal = (tpl: LocalTemplate) => {
    setEditingTemplate(tpl);

    const body = tpl.content || extractBodyTextFromComponents(tpl.components);
    const buttons = tpl.buttons?.map((b) => b.text) ?? [];

    setFormData({
      name: tpl.name,
      category: (tpl.category?.toLowerCase() as TemplateCategory) || "marketing",
      language: (tpl.language as LanguageCode) || "id",
      headerType: tpl.headerType || "none",
      headerText: tpl.headerText || "",
      body,
      footerText: tpl.footerText || "",
      buttonType: buttons.length > 0 ? "quick_reply" : "none",
      buttons: [buttons[0] || "", buttons[1] || "", buttons[2] || ""],
      mediaSampleFileName: tpl.mediaSampleName || "",
      mediaSampleHandle: tpl.mediaSampleHandle || "",
    });

    const storedExamples = tpl.previewExamples || {};
    const initialExamples = buildInitialExamples(body);
    setExamples({ ...initialExamples, ...storedExamples });
    setNameError(null);
    setHeaderError(null);
    setBodyError(null);
    setFooterError(null);
    setButtonError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    if (saving) return;
    setShowModal(false);
    setEditingTemplate(null);
  };

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
    const nextButtonError =
      formData.buttonType === "quick_reply" ? validateButtons(formData.buttons) : null;

    setNameError(nextNameError);
    setHeaderError(nextHeaderError);
    setBodyError(nextBodyError);
    setFooterError(nextFooterError);
    setButtonError(nextButtonError);

    if (nextHeaderError && ["image", "video", "document"].includes(formData.headerType)) {
      toast.warning("Silakan unggah file media contoh terlebih dahulu.");
    }

    return !nextNameError && !nextHeaderError && !nextBodyError && !nextFooterError && !nextButtonError;
  };

  const handleSave = async () => {
    if (!validateAll()) return;

    setSaving(true);
    try {
      const payload = {
        name: formData.name.trim(),
        category: formData.category,
        language: formData.language,
        content: formData.body.trim(),
        variables: variables.map((v) => `{{${v}}}`),
        components: buildComponentsFromForm({
          headerType: formData.headerType,
          headerText: formData.headerText,
          body: formData.body.trim(),
          footerText: formData.footerText,
          buttons: formData.buttonType === "quick_reply" ? formData.buttons : [],
          examples,
          mediaSampleFileName: formData.mediaSampleFileName,
          mediaSampleHandle: formData.mediaSampleHandle,
        }),
      };

      const result = editingTemplate
        ? await api.updateBroadcastTemplate(editingTemplate.id, payload)
        : await api.saveBroadcastTemplate(payload);

      if ("error" in result) {
        toast.error("Gagal menyimpan template: " + result.error);
        return;
      }

      toast.success(editingTemplate ? "Template berhasil diupdate!" : "Template berhasil dibuat!");
      setShowModal(false);
      setEditingTemplate(null);
      await loadTemplates();
    } catch (error) {
      console.error("Error saving template:", error);
      toast.error("Gagal menyimpan template");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (templateId: string) => {
    setTemplateIdToDelete(templateId);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!templateIdToDelete) return;

    try {
      const result = await api.deleteBroadcastTemplate(templateIdToDelete);
      if ("error" in result) {
        toast.error("Gagal menghapus template: " + result.error);
        return;
      }

      toast.success("Template berhasil dihapus!");
      setDeleteModalOpen(false);
      setTemplateIdToDelete(null);
      await loadTemplates();
    } catch (error) {
      console.error("Error deleting template:", error);
      toast.error("Gagal menghapus template");
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
      await loadTemplates();
    } catch (error) {
      console.error("Error sync templates:", error);
      toast.error("Terjadi kesalahan saat sync template");
    } finally {
      setSyncing(false);
    }
  };

  const handlePushToMeta = async (templateId: string) => {
    setPushingId(templateId);
    try {
      const result = await api.pushTemplateToMeta(templateId);

      if ("error" in result) {
        toast.error("Gagal submit ke Meta: " + result.error);
        return;
      }

      toast.success("Template berhasil disubmit ke Meta");
      await loadTemplates();
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

    const newBody = current ? `${current} ${token}` : token;
    setFormData((prev) => ({ ...prev, body: newBody }));
    setBodyError(validateBody(newBody));
    setExamples((prev) => ({
      ...prev,
      [nextIndex]: prev[nextIndex] || guessVariableExample(newBody, nextIndex),
    }));
  };

  const handleButtonChange = (index: number, value: string) => {
    const nextButtons = [...formData.buttons];
    nextButtons[index] = value;
    setFormData((prev) => ({ ...prev, buttons: nextButtons }));
    setButtonError(validateButtons(nextButtons));
  };

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

  return (
    <div className="w-full p-6 md:p-8 bg-white h-full flex flex-col overflow-hidden">
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
        <div>
          <h1 className="mb-2">Template Pesan</h1>
          <p className="text-muted-foreground">
            Kelola template pesan untuk broadcast WhatsApp
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={handleSyncFromMeta}
            disabled={syncing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync dari Meta"}
          </Button>

          <Button onClick={openCreateModal} className="bg-primary hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" />
            Buat Template Baru
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-6 flex-1 min-h-0 overflow-hidden">
        <div className="overflow-hidden rounded-lg shadow-sm bg-white flex flex-col h-full min-h-0">
          <div className="px-6 py-4 border-b bg-white">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex flex-1 items-center gap-3 min-w-[280px] max-w-xl">
                <div className="relative flex-1">
                  <Input
                    type="text"
                    placeholder="Cari nama template..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8"
                  />
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                </div>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg bg-white text-sm text-slate-700 min-w-[130px]"
                >
                  <option value="all">Semua Kategori</option>
                  <option value="marketing">Marketing</option>
                  <option value="utility">Utility</option>
                  <option value="authentication">Authentication</option>
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 border rounded-lg bg-white text-sm text-slate-700 min-w-[130px]"
                >
                  <option value="all">Semua Status</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="rejected">Rejected</option>
                  <option value="draft">Draft</option>
                </select>
              </div>

              {sortedTemplates.length > PAGE_SIZE && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
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
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {templates.length === 0 ? (
            <div className="p-12 text-center bg-white border-t">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-20" />
              <h3 className="mb-2">Belum Ada Template</h3>
              <p className="text-muted-foreground mb-4">
                Buat template pertama Anda atau sync dari Meta
              </p>
              <Button onClick={openCreateModal} className="bg-primary hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                Buat Template
              </Button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto overflow-x-auto bg-white border-t min-h-0">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="px-5 py-3.5">Nama template</th>
                    <th className="px-5 py-3.5">Kategori</th>
                    <th className="px-5 py-3.5">Bahasa</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-center">Pesan Terkirim</th>
                    <th className="px-5 py-3.5 text-right">Action</th>
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
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-600">
                          <Badge variant="outline" className="capitalize text-xs font-normal">
                            {template.category}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-600">
                          <Badge variant="secondary" className="uppercase text-xs font-medium">
                            {template.language}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-sm">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusColor(template.status)}`}>
                            {getStatusLabel(template.status)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-700 text-center font-medium">
                          {sentCount.toLocaleString("id-ID")}
                        </td>
                        <td className="px-5 py-3 text-sm text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            {template.status === "draft" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handlePushToMeta(template.id)}
                                className="h-8 px-2.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border-emerald-100 hover:border-emerald-200"
                                disabled={pushingId !== null}
                              >
                                <CloudUpload className={`w-3.5 h-3.5 mr-1.5 ${pushingId === template.id ? "animate-spin" : ""}`} />
                                {pushingId === template.id ? "Submitting..." : "Submit"}
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditModal(template)}
                              className="h-8 px-2.5"
                            >
                              <Edit className="w-3.5 h-3.5 mr-1.5" />
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDelete(template.id)}
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

        <div className="p-6 bg-white rounded-lg shadow-sm flex flex-col h-full min-h-0 overflow-hidden">
          <div className="flex items-center gap-2 mb-4 flex-shrink-0">
            <Eye className="w-4 h-4" />
            <h3>Preview Template</h3>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 pr-1">
            {!selectedTemplate ? (
              <p className="text-sm text-muted-foreground">Pilih template untuk melihat preview</p>
            ) : (
              <div className="space-y-5">
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
                      onClick={() => handlePushToMeta(selectedTemplate.id)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl"
                      disabled={pushingId !== null}
                    >
                      <CloudUpload className={`w-4 h-4 mr-2 ${pushingId === selectedTemplate.id ? "animate-spin" : ""}`} />
                      {pushingId === selectedTemplate.id ? "Menyerahkan..." : "Submit ke Meta"}
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
          <div className="w-full max-w-5xl bg-white rounded-lg shadow-lg flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <h3>{editingTemplate ? "Edit Template" : "Buat Template Baru"}</h3>
              <Button variant="ghost" size="sm" onClick={closeModal} disabled={saving}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-6 grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-6 flex-1 overflow-y-auto min-h-0">
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Nama Template *</Label>
                    <span className={`text-xs ${formData.name.length > 500 ? "text-red-600" : "text-muted-foreground"}`}>
                      {formData.name.length}/512
                    </span>
                  </div>
                  <Input
                    placeholder="contoh: reminder_pembayaran"
                    value={formData.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                  />
                  {nameError && <p className="text-xs text-red-600 mt-1">{nameError}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Kategori *</Label>
                    <select
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
                      <option value="authentication">Authentication</option>
                    </select>
                  </div>

                  <div>
                    <Label>Bahasa *</Label>
                    <select
                      className="w-full p-3 border rounded-lg mt-2 bg-white"
                      value={formData.language}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          language: e.target.value as LanguageCode,
                        }))
                      }
                    >
                      <option value="id">Bahasa Indonesia</option>
                      <option value="en_US">English (US)</option>
                      <option value="en">English</option>
                    </select>
                  </div>

                  <div>
                    <Label>Media Sample / Header Type</Label>
                    <select
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
                      <option value="location">Location</option>
                    </select>
                  </div>
                </div>

                {formData.headerType === "text" && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Header Text</Label>
                      <span className={`text-xs ${formData.headerText.length > 55 ? "text-red-600" : "text-muted-foreground"}`}>
                        {formData.headerText.length}/60
                      </span>
                    </div>
                    <Input
                      placeholder="Header singkat"
                      value={formData.headerText}
                      onChange={(e) => {
                        setFormData((prev) => ({ ...prev, headerText: e.target.value }));
                        setHeaderError(validateHeaderText(e.target.value));
                      }}
                    />
                    {headerError && <p className="text-xs text-red-600 mt-1">{headerError}</p>}
                  </div>
                )}

                {["image", "video", "document"].includes(formData.headerType) && (
                  <div>
                    <Label>Media Sample</Label>
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
                            const result = await api.uploadTemplateSample(file);
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
                      <Label>Konten Pesan *</Label>
                      <Button type="button" variant="outline" size="sm" onClick={handleAddVariable}>
                        + Variabel
                      </Button>
                    </div>
                    <span className={`text-xs ${formData.body.length > 1000 ? "text-red-600" : "text-muted-foreground"}`}>
                      {formData.body.length}/1024
                    </span>
                  </div>

                  <Textarea
                    rows={7}
                    placeholder="Contoh: Halo {{1}}, terima kasih telah bergabung dengan {{2}}."
                    value={formData.body}
                    onChange={(e) => handleBodyChange(e.target.value)}
                  />
                  {bodyError ? (
                    <p className="text-xs text-red-600 mt-1">{bodyError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
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
                    <Label>Footer</Label>
                    <span className={`text-xs ${formData.footerText.length > 55 ? "text-red-600" : "text-muted-foreground"}`}>
                      {formData.footerText.length}/60
                    </span>
                  </div>
                  <Input
                    placeholder="Footer opsional"
                    value={formData.footerText}
                    onChange={(e) => {
                      setFormData((prev) => ({ ...prev, footerText: e.target.value }));
                      setFooterError(validateFooterText(e.target.value));
                    }}
                  />
                  {footerError && <p className="text-xs text-red-600 mt-1">{footerError}</p>}
                </div>

                <div>
                  <Label>Buttons</Label>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
                    <select
                      className="w-full p-3 border rounded-lg bg-white"
                      value={formData.buttonType}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          buttonType: e.target.value as ButtonType,
                        }))
                      }
                    >
                      <option value="none">Tanpa Button</option>
                      <option value="quick_reply">Quick Reply</option>
                    </select>

                    {formData.buttonType === "quick_reply" && (
                      <div className="space-y-2">
                        {[0, 1, 2].map((idx) => (
                          <Input
                            key={idx}
                            placeholder={`Quick Reply ${idx + 1}`}
                            value={formData.buttons[idx]}
                            onChange={(e) => handleButtonChange(idx, e.target.value)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  {buttonError && <p className="text-xs text-red-600 mt-1">{buttonError}</p>}
                </div>

                <div className="flex gap-3">
                  <Button onClick={handleSave} className="flex-1 bg-primary hover:bg-primary/90" disabled={saving}>
                    <Save className="w-4 h-4 mr-2" />
                    {saving ? "Menyimpan..." : editingTemplate ? "Update Template" : "Simpan Template"}
                  </Button>

                  <Button variant="outline" onClick={closeModal} className="flex-1" disabled={saving}>
                    Batal
                  </Button>
                </div>
              </div>

              <div className="space-y-4 xl:sticky xl:top-0 h-fit">
                <div className="rounded-xl border bg-slate-50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Eye className="w-4 h-4" />
                    <strong className="text-sm">Preview Template</strong>
                  </div>

                  <WhatsAppBubblePreview
                    headerType={formData.headerType}
                    headerText={formData.headerText}
                    mediaSampleName={formData.mediaSampleFileName || defaultSampleName(formData.headerType)}
                    body={previewBody}
                    footer={formData.footerText}
                    buttons={
                      formData.buttonType === "quick_reply"
                        ? formData.buttons
                          .filter((b) => b.trim())
                          .map((text) => ({ type: "QUICK_REPLY" as const, text }))
                        : []
                    }
                  />
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
          </div>
        </div>
      )}
      {/* Delete Template Confirmation Modal */}
      <AppModal
        open={deleteModalOpen}
        title="Konfirmasi Hapus Template"
        onClose={() => {
          setDeleteModalOpen(false);
          setTemplateIdToDelete(null);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
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
            >
              Hapus
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Apakah Anda yakin ingin menghapus template ini? Tindakan ini tidak dapat dibatalkan.
        </p>
      </AppModal>
    </div>
  );
}
