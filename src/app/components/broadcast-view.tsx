import { useState, useEffect, useMemo, useRef } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Send,
  Upload,
  Calendar,
  FileText,
  AlertCircle,
  CheckCircle,
  Image,
  Video,
  MapPin,
  MessageSquare,
  X,
  Plus,
  Trash2,
} from "lucide-react";
import { api, TemplateItem } from "../lib/api";
import { BroadcastProgressModal } from "./BroadcastProgressModal";
import { AppModal } from "./AppModal";
import { toast } from "sonner";

interface Contact {
  name: string;
  phone: string;
  variables?: string[];
  mediaUrl?: string;
  fileName?: string;
  rowNumber?: number;
}

interface UploadIssue {
  rowNumber: number;
  reason: string;
}

interface BroadcastViewProps {
  onViewHistory: () => void;
  onBroadcastSent?: () => void;
  user?: any;
}

type HeaderType = "none" | "text" | "image" | "video" | "document" | "location";
type UploadMethod = "csv" | "sheet" | "manual" | "contacts";

interface LocalTemplate extends TemplateItem {
  headerType?: HeaderType;
  headerText?: string;
  footerText?: string;
  buttons?: Array<{ type: "QUICK_REPLY"; text: string }>;
  previewExamples?: Record<number, string>;
}

interface ManualRecipient {
  phone: string;
  variables: string[];
  mediaUrl: string;
  fileName: string;
  contactName: string;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  out.push(current.trim());
  return out.map((v) => v.replace(/^"(.*)"$/, "$1").trim());
}

function normalizePhoneForImport(value: string): string {
  let raw = String(value || "").trim();
  raw = raw.replace(/[^\d+]/g, "");
  if (!raw) return "";
  if (raw.startsWith("08")) return `62${raw.slice(1)}`;
  if (raw.startsWith("8")) return `62${raw}`;
  if (raw.startsWith("+62")) return raw.slice(1);
  if (raw.startsWith("62")) return raw;
  if (raw.startsWith("+")) return raw.slice(1);
  return raw;
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
    if (Number.isFinite(idx) && typeof value === "string") acc[idx] = value;
    return acc;
  }, {});
}

function extractVariables(content: string): number[] {
  const regex = /\{\{(\d+)\}\}/g;
  const matches = [...(content || "").matchAll(regex)];
  const nums = matches.map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
  return [...new Set(nums)].sort((a, b) => a - b);
}

function guessVariableExample(text: string, idx: number) {
  const normalized = (text || "").toLowerCase();
  const token = `{{${idx}}}`;
  const tokenIndex = normalized.indexOf(token.toLowerCase());
  const area =
    tokenIndex >= 0
      ? normalized.slice(Math.max(0, tokenIndex - 60), Math.min(normalized.length, tokenIndex + 60))
      : normalized;

  if (/(ayah|bunda|orang tua|wali|yth|kepada|nama|siswa|peserta)/i.test(area)) return "Bapak/Ibu Fulan";
  if (/(link|tautan|lampiran|dokumen|file|pdf|unduh|download)/i.test(area)) return "https://app.mckuadrat.com/file/contoh";
  if (/(kelas|rombel)/i.test(area)) return "X-A";
  if (/(tanggal|tgl|hari|jadwal)/i.test(area)) return "7 Maret 2026";
  if (/(sekolah|yayasan|instansi)/i.test(area)) return "Sekolah Pesat Bogor";
  if (/(nomor|telepon|kontak|wa|whatsapp)/i.test(area)) return "087870001999";
  if (/(uang|biaya|tagihan|pembayaran|nominal|rp)/i.test(area)) return "Rp450.000";
  return `Contoh ${idx}`;
}

function buildInitialExamples(text: string): Record<number, string> {
  return extractVariables(text).reduce<Record<number, string>>((acc, idx) => {
    acc[idx] = guessVariableExample(text, idx);
    return acc;
  }, {});
}

function applyExamplesToText(text: string, examples: Record<number, string>) {
  let next = text || "";
  extractVariables(next).forEach((idx) => {
    const replacement = examples[idx]?.trim() || guessVariableExample(text, idx);
    next = next.split(`{{${idx}}}`).join(replacement);
  });
  return next;
}

function parseContactsFromStructuredCsv(text: string, selectedTemplate: LocalTemplate | null) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());

  if (lines.length < 2) {
    return {
      contacts: [] as Contact[],
      issues: [{ rowNumber: 1, reason: "File CSV kosong atau hanya berisi header" }],
      duplicateCount: 0,
    };
  }

  const header = parseCsvLine(lines[0]).map((x) => x.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());

  const numberIndex = idx("nomor");
  const contactNameIndex = idx("contactname");
  const mediaIndex = idx("follow_media");
  const fileNameIndex = idx("filename");
  const varIndexes = header
    .map((col, i) => ({ col, i }))
    .filter((x) => /^var[\s_]*\d+$/.test(x.col))
    .sort((a, b) => {
      const numA = Number(a.col.replace(/[\s_]/g, "").slice(3));
      const numB = Number(b.col.replace(/[\s_]/g, "").slice(3));
      return numA - numB;
    });

  if (numberIndex < 0) {
    return {
      contacts: [] as Contact[],
      issues: [{ rowNumber: 1, reason: "Kolom Nomor wajib ada" }],
      duplicateCount: 0,
    };
  }

  const requiresMedia = ["image", "video", "document"].includes(selectedTemplate?.headerType || "none");
  const contacts: Contact[] = [];
  const issues: UploadIssue[] = [];
  const seenPhones = new Set<string>();
  let duplicateCount = 0;

  lines.slice(1).forEach((line, rowIdx) => {
    const rowNumber = rowIdx + 2;
    const cols = parseCsvLine(line);
    const phone = normalizePhoneForImport(cols[numberIndex] || "");
    const variables = varIndexes.map((v) => cols[v.i] || "");
    const mediaUrl = mediaIndex >= 0 ? (cols[mediaIndex] || "").trim() : "";
    const fileName = fileNameIndex >= 0 ? (cols[fileNameIndex] || "").trim() : "";
    const contactName =
      (contactNameIndex >= 0 ? cols[contactNameIndex] : "")?.trim() ||
      phone;

    if (!phone) {
      issues.push({ rowNumber, reason: "Nomor kosong" });
      return;
    }

    if (!/^62\d{8,15}$/.test(phone)) {
      issues.push({ rowNumber, reason: "Format nomor tidak valid" });
      return;
    }

    if (requiresMedia && !mediaUrl) {
      issues.push({
        rowNumber,
        reason: "follow_media wajib diisi karena template memakai header media",
      });
      return;
    }

    if (seenPhones.has(phone)) {
      duplicateCount += 1;
    } else {
      seenPhones.add(phone);
    }

    contacts.push({
      name: contactName,
      phone,
      variables,
      mediaUrl,
      fileName,
      rowNumber,
    });
  });

  return { contacts, issues, duplicateCount };
}

function getTemplateDateValue(template: any) {
  const raw =
    template?.updatedAt ||
    template?.updated_at ||
    template?.createdAt ||
    template?.created_at ||
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

function HeaderPreviewBox({ type, text }: { type: HeaderType; text?: string }) {
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
      </div>
    );
  }

  if (type === "video") {
    return (
      <div className="mb-2 overflow-hidden rounded-t-xl rounded-b-md bg-slate-200">
        <div className="h-36 flex items-center justify-center bg-gradient-to-b from-slate-200 to-slate-300">
          <Video className="w-10 h-10 text-slate-500" />
        </div>
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
  body,
  footer,
  buttons,
}: {
  headerType: HeaderType;
  headerText?: string;
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
            <HeaderPreviewBox type={headerType} text={headerText} />

            <div className="text-[13.5px] leading-6 text-slate-800 whitespace-pre-wrap break-words">
              {body ? renderFormattedText(body) : "Pilih template untuk melihat preview"}
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
                  className={`w-full flex items-center justify-center gap-2 px-3 py-3 text-[13px] font-medium text-[#1677f2] ${
                    idx !== 0 ? "border-t" : ""
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

export function BroadcastView({ onViewHistory, onBroadcastSent, user }: BroadcastViewProps) {
  const labelsKey = user?.org_id ? `sipesa_contact_labels_${user.org_id}` : "sipesa_contact_labels";
  const [selectedNumber, setSelectedNumber] = useState("");
  const [whatsappNumbers, setWhatsappNumbers] = useState<any[]>([]);
  const [templates, setTemplates] = useState<LocalTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [uploadMethod, setUploadMethod] = useState<UploadMethod>("csv");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [uploadIssues, setUploadIssues] = useState<UploadIssue[]>([]);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [manualRecipients, setManualRecipients] = useState<ManualRecipient[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);  

  const [allOrgContacts, setAllOrgContacts] = useState<any[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [contactLabels, setContactLabels] = useState<Record<string, string>>({});
  const [contactSearchQuery, setContactSearchQuery] = useState("");

  const [currentTokens, setCurrentTokens] = useState(0);
  const requiredTokens = contacts.length;
  const hasEnoughTokens = currentTokens >= requiredTokens;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [activeBroadcastId, setActiveBroadcastId] = useState<string | null>(null);
  const [resultModal, setResultModal] = useState<{
    open: boolean;
    type: "success" | "error" | "info";
    title: string;
    message: string;
    broadcastId?: string | null;
  }>({
    open: false,
    type: "info",
    title: "",
    message: "",
    broadcastId: null,
  });

  const [duplicateCheckModal, setDuplicateCheckModal] = useState<{
    open: boolean;
    contacts: Contact[];
    issues: UploadIssue[];
    duplicateCount: number;
  }>({
    open: false,
    contacts: [],
    issues: [],
    duplicateCount: 0,
  });

  const handleImportedContacts = (
    importedContacts: Contact[],
    issues: UploadIssue[],
    duplicateCount: number,
  ) => {
    if (duplicateCount > 0) {
      setDuplicateCheckModal({
        open: true,
        contacts: importedContacts,
        issues,
        duplicateCount,
      });
    } else {
      applyContactsResult({ contacts: importedContacts, issues, duplicateCount: 0 });
    }
  };

  const handleKeepUnique = () => {
    const seen = new Set<string>();
    const uniqueContacts = duplicateCheckModal.contacts.filter((c) => {
      const norm = String(c.phone).replace(/\D/g, "");
      if (seen.has(norm)) return false;
      seen.add(norm);
      return true;
    });
    applyContactsResult({
      contacts: uniqueContacts,
      issues: duplicateCheckModal.issues,
      duplicateCount: duplicateCheckModal.duplicateCount,
    });
    setDuplicateCheckModal((prev) => ({ ...prev, open: false }));
  };

  const handleKeepAll = () => {
    applyContactsResult({
      contacts: duplicateCheckModal.contacts,
      issues: duplicateCheckModal.issues,
      duplicateCount: 0,
    });
    setDuplicateCheckModal((prev) => ({ ...prev, open: false }));
  };

  const openResultModal = (
    type: "success" | "error" | "info",
    title: string,
    message: string,
    broadcastId?: string | null,
  ) => {
    setResultModal({ open: true, type, title, message, broadcastId });
  };

  const closeResultModal = () => {
    setResultModal({
      open: false,
      type: "info",
      title: "",
      message: "",
      broadcastId: null,
    });
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId],
  );

  const variableCount = useMemo(() => {
    if (!selectedTemplate) return 0;
    const body = selectedTemplate.content || extractBodyTextFromComponents(selectedTemplate.components) || "";
    return extractVariables(body).length;
  }, [selectedTemplate]);

  const uniqueLabels = useMemo(() => {
    const set = new Set<string>();
    Object.values(contactLabels).forEach((lbl) => {
      if (lbl.trim()) set.add(lbl.trim());
    });
    return Array.from(set).sort();
  }, [contactLabels]);

  const requiresMedia = useMemo(
    () => ["image", "video", "document"].includes(selectedTemplate?.headerType || "none"),
    [selectedTemplate],
  );

  useEffect(() => {
    setManualRecipients((prev) => {
      if (prev.length === 0) {
        return [
          {
            phone: "",
            variables: Array.from({ length: variableCount }, () => ""),
            mediaUrl: "",
            fileName: "",
            contactName: "",
          },
        ];
      }

      return prev.map((row) => ({
        ...row,
        variables: Array.from({ length: variableCount }, (_, i) => row.variables?.[i] || ""),
      }));
    });
  }, [variableCount]);

  const previewBody = useMemo(() => {
    if (!selectedTemplate) return "Pilih template untuk melihat preview";

    const body = selectedTemplate.content || extractBodyTextFromComponents(selectedTemplate.components) || "";

    if (contacts.length > 0) {
      const contact = contacts[0];
      let preview = body;
      extractVariables(body).forEach((idx) => {
        const value =
          contact.variables?.[idx - 1] !== undefined
            ? contact.variables[idx - 1]
            : `{{${idx}}}`;
        preview = preview.split(`{{${idx}}}`).join(value);
      });
      return preview;
    }

    return body;
  }, [selectedTemplate, contacts]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const numbersRes = await api.getNumbers();
      if (numbersRes.success) {
        setWhatsappNumbers(numbersRes.data);
        if (numbersRes.data.length > 0) {
          setSelectedNumber(numbersRes.data[0].id);
        }
      }

      const billingRes = await api.getBilling();
      if (!("error" in billingRes)) {
        setCurrentTokens(Number(billingRes.data?.currentTokens ?? 0));
      }

      const templatesRes = await api.getBroadcastTemplates();
      if (templatesRes.success) {
        const mapped = (templatesRes.data || [])
          .filter((t) => {
            const status = String(t.status || "").toLowerCase();
            return status === "approved" || status === "pending" || status === "rejected";
          })
          .map((tpl) => {
            const header = extractHeaderInfo(tpl.components);
            return {
              ...tpl,
              headerType: header.type,
              headerText: header.text || "",
              footerText: extractFooterText(tpl.components),
              buttons: extractButtons(tpl.components),
              previewExamples: extractPreviewExamples(tpl.components),
            } as LocalTemplate;
          })
          .sort(compareTemplates);

        console.log("BROADCAST_VIEW sorted templates:", mapped.map(t => ({ name: t.name, updatedAt: t.updatedAt, createdAt: t.createdAt, metaTemplateId: t.metaTemplateId })));
        setTemplates(mapped);
        if (mapped.length > 0) {
          setSelectedTemplateId(mapped[0].id);
        }
      }

      const contactsRes = await api.getOrgContacts();
      if (contactsRes.success) {
        setAllOrgContacts(contactsRes.data);
      }
      try {
        let labelsStr = localStorage.getItem(labelsKey);
        if (!labelsStr) {
          const oldLabels = localStorage.getItem("sipesa_contact_labels");
          if (oldLabels) {
            localStorage.setItem(labelsKey, oldLabels);
            labelsStr = oldLabels;
          }
        }
        if (labelsStr) {
          try {
            setContactLabels(JSON.parse(labelsStr));
          } catch {}
        }

        const res = await api.getContactLabels();
        if (res.success) {
          setContactLabels(res.data);
          localStorage.setItem(labelsKey, JSON.stringify(res.data));
        }
      } catch (e) {
        console.error(e);
      }
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const resetImportedContacts = () => {
    setCsvFile(null);
    setContacts([]);
    setUploadIssues([]);
    setDuplicateCount(0);
    setUploadStatus("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const applyContactsResult = (result: { contacts: Contact[]; issues: UploadIssue[]; duplicateCount: number }) => {
    setContacts(result.contacts);
    setUploadIssues(result.issues);
    setDuplicateCount(result.duplicateCount);
    setUploadStatus(result.contacts.length > 0 ? "success" : "error");
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setCsvFile(file);
      const text = await file.text();
      const result = parseContactsFromStructuredCsv(text, selectedTemplate);

      if (result.contacts.length === 0) {
        openResultModal(
          "error",
          "CSV tidak valid",
          "Tidak ada kontak valid yang bisa dipakai. Periksa format CSV kamu.",
        );
        return;
      }

      handleImportedContacts(result.contacts, result.issues, result.duplicateCount);

      if (result.issues.length > 0) {
        openResultModal(
          "info",
          "CSV berhasil dimuat",
          `${result.contacts.length} kontak valid dimuat. ${result.issues.length} baris bermasalah tidak dipakai.`,
        );
      }
    } catch (error) {
      console.error("Error parsing CSV:", error);
      setUploadStatus("error");
      setContacts([]);
      setUploadIssues([]);
      setDuplicateCount(0);
      openResultModal("error", "Gagal membaca CSV", "Pastikan format file CSV sudah benar.");
    }
  };

  const handleSheetImport = async () => {
    if (!sheetUrl) {
      openResultModal("error", "URL belum diisi", "Masukkan URL Google Sheet terlebih dahulu.");
      return;
    }

    try {
      setLoading(true);
      const result = await api.importFromGoogleSheet(sheetUrl, sheetName);

      if ("error" in result) {
        setUploadStatus("error");
        openResultModal("error", "Import Google Sheet gagal", result.error);
        return;
      }

      setCsvFile(null);
      
      const seen = new Set<string>();
      let dupCount = 0;
      result.data.forEach((c) => {
        const norm = String(c.phone).replace(/\D/g, "");
        if (seen.has(norm)) {
          dupCount += 1;
        } else {
          seen.add(norm);
        }
      });

      handleImportedContacts(result.data, [], dupCount);

      if (dupCount === 0) {
        openResultModal(
          "success",
          "Import berhasil",
          `${result.data.length} kontak berhasil diimport dari Google Sheet.`,
        );
      }
    } catch (error) {
      console.error("Error importing from sheet:", error);
      setUploadStatus("error");
      openResultModal("error", "Terjadi kesalahan", "Terjadi kesalahan saat import Google Sheet.");
    } finally {
      setLoading(false);
    }
  };

  const updateManualRow = (index: number, patch: Partial<ManualRecipient>) => {
    setManualRecipients((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const updateManualVariable = (rowIndex: number, varIndex: number, value: string) => {
    setManualRecipients((prev) =>
      prev.map((row, i) => {
        if (i !== rowIndex) return row;
        const variables = [...row.variables];
        variables[varIndex] = value;
        return { ...row, variables };
      }),
    );
  };

  const addManualRecipient = () => {
    setManualRecipients((prev) => [
      ...prev,
      {
        phone: "",
        variables: Array.from({ length: variableCount }, () => ""),
        mediaUrl: "",
        fileName: "",
        contactName: "",
      },
    ]);
  };

  const removeManualRecipient = (index: number) => {
    setManualRecipients((prev) => {
      if (prev.length === 1) {
        return [
          {
            phone: "",
            variables: Array.from({ length: variableCount }, () => ""),
            mediaUrl: "",
            fileName: "",
            contactName: "",
          },
        ];
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleApplyManualRecipients = () => {
    const nextContacts: Contact[] = [];
    const issues: UploadIssue[] = [];
    const seenPhones = new Set<string>();
    let duplicates = 0;

    manualRecipients.forEach((row, index) => {
      const rowNumber = index + 1;
      const phone = normalizePhoneForImport(row.phone);
      const contactName = row.contactName.trim() || phone;

      if (!phone) {
        issues.push({ rowNumber, reason: "Nomor kosong" });
        return;
      }

      if (!/^62\d{8,15}$/.test(phone)) {
        issues.push({ rowNumber, reason: "Format nomor tidak valid" });
        return;
      }

      if (requiresMedia && !row.mediaUrl.trim()) {
        issues.push({
          rowNumber,
          reason: "Link media wajib diisi karena template memakai header media",
        });
        return;
      }

      if (seenPhones.has(phone)) {
        duplicates += 1;
      } else {
        seenPhones.add(phone);
      }

      nextContacts.push({
        name: contactName,
        phone,
        variables: row.variables.map((v) => v || ""),
        mediaUrl: row.mediaUrl.trim() || undefined,
        fileName: row.fileName.trim() || undefined,
        rowNumber,
      });
    });

    setCsvFile(null);
    handleImportedContacts(nextContacts, issues, duplicates);
  };

  const downloadSampleCSV = () => {
    const varsCount = selectedTemplate
      ? extractVariables(selectedTemplate.content || extractBodyTextFromComponents(selectedTemplate.components) || "").length
      : 2;

    const headers = [
      "Nomor",
      ...Array.from({ length: Math.max(varsCount, 2) }, (_, i) => `Var${i + 1}`),
      "follow_media",
      "filename",
      "contactname",
    ];

    const row1 = [
      "6281234567890",
      ...Array.from(
        { length: Math.max(varsCount, 2) },
        (_, i) => selectedTemplate?.previewExamples?.[i + 1] || `Contoh ${i + 1}`,
      ),
      requiresMedia ? "https://drive.google.com/uc?export=download&id=xxxxx" : "",
      requiresMedia && selectedTemplate?.headerType === "document" ? "Dokumen Contoh.pdf" : "",
      "Bapak/Ibu Fulan",
    ];

    const row2 = [
      "6289876543210",
      ...Array.from(
        { length: Math.max(varsCount, 2) },
        (_, i) => selectedTemplate?.previewExamples?.[i + 1] || `Contoh ${i + 1}`,
      ),
      "",
      "",
      "Orang Tua Siswa",
    ];

    const csvContent = [headers.join(","), row1.join(","), row2.join(",")].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sample-broadcast.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const estimatedCost = contacts.length * 1500;
  const scheduleInfoText = scheduleEnabled
  ? `${scheduleDate} ${scheduleTime}`
  : "Kirim sekarang";

  const handleSendBroadcast = async () => {
    if (!selectedNumber || !selectedTemplate || contacts.length === 0) {
      openResultModal("error", "Data belum lengkap", "Pastikan nomor WA, template, dan kontak sudah dipilih.");
      return;
    }

    const invalidMediaRows = requiresMedia
      ? contacts.filter((c) => !String(c.mediaUrl || "").trim()).map((c) => c.rowNumber).filter(Boolean)
      : [];

    if (invalidMediaRows.length > 0) {
      openResultModal(
        "error",
        "Media header belum lengkap",
        `Template ini butuh media header. Baris yang belum punya follow_media: ${invalidMediaRows.slice(0, 10).join(", ")}`,
      );
      return;
    }

    if (scheduleEnabled) {
      if (!scheduleDate || !scheduleTime) {
        openResultModal("error", "Jadwal belum lengkap", "Tanggal dan waktu jadwal wajib diisi.");
        return;
      }

      const scheduledDate = new Date(`${scheduleDate}T${scheduleTime}:00`);
      if (Number.isNaN(scheduledDate.getTime())) {
        openResultModal("error", "Format jadwal tidak valid", "Periksa kembali tanggal dan waktu pengiriman.");
        return;
      }

      if (scheduledDate.getTime() <= Date.now()) {
        openResultModal("error", "Waktu jadwal tidak valid", "Waktu jadwal harus lebih besar dari waktu sekarang.");
        return;
      }
    }

    setConfirmOpen(true);
  };

  const confirmSendBroadcast = async () => {
    if (!selectedTemplate) return;

    setConfirmOpen(false);
    setSending(true);

    try {
      const scheduledAt =
        scheduleEnabled && scheduleDate && scheduleTime
          ? `${scheduleDate}T${scheduleTime}:00`
          : null;

      const result = await api.sendBroadcastWithTemplate({
        numberId: selectedNumber,
        templateId: selectedTemplate.id,
        contacts,
        scheduled: scheduledAt,
      });

      if ("error" in result) {
        openResultModal("error", "Broadcast gagal", result.error);
        return;
      }

      // Automatically save and label contacts asynchronously
      (async () => {
        try {
          const orgContactsRes = await api.getOrgContacts();
          const orgContacts = orgContactsRes.success && Array.isArray(orgContactsRes.data) ? orgContactsRes.data : [];
          const existingContactsMap = new Map<string, { id: string; name: string }>();
          orgContacts.forEach((c: any) => {
            if (c.phone) {
              const norm = String(c.phone).replace(/\D/g, "");
              existingContactsMap.set(norm, { id: c.id, name: c.name });
            }
          });

          let savedLabels: Record<string, string> = {};
          try {
            savedLabels = JSON.parse(localStorage.getItem(labelsKey) || "{}");
          } catch (e) {
            console.error(e);
          }

          for (const c of contacts) {
            const normPhone = String(c.phone).replace(/\D/g, "");
            const existing = existingContactsMap.get(normPhone);
            let savedPhone = c.phone;

            if (existing) {
              if (existing.name !== c.name) {
                const res = await api.updateContact(existing.id, { name: c.name || existing.name, phone: c.phone });
                if (res.success && res.data?.phone) {
                  savedPhone = res.data.phone;
                }
              } else {
                const orig = orgContacts.find((oc: any) => String(oc.phone).replace(/\D/g, "") === normPhone);
                if (orig?.phone) {
                  savedPhone = orig.phone;
                }
              }
            } else {
              const res = await api.createContact({ name: c.name || c.phone, phone: c.phone });
              if (res.success && res.data?.phone) {
                savedPhone = res.data.phone;
              }
            }
            const phoneWithPlus = savedPhone.startsWith("+") ? savedPhone : `+${savedPhone}`;
            savedLabels[phoneWithPlus] = selectedTemplate.name;
          }

          localStorage.setItem(labelsKey, JSON.stringify(savedLabels));
          api.updateContactLabels(savedLabels).catch((e) =>
            console.warn("Gagal sinkronisasi label ke database:", e)
          );
        } catch (err) {
          console.error("Failed to automatically save contacts during broadcast:", err);
        }
      })();

      const newBroadcastId = result.data?.id || null;
      setActiveBroadcastId(newBroadcastId);

      if (scheduledAt) {
        openResultModal(
          "success",
          "Broadcast dijadwalkan",
          `Broadcast berhasil dijadwalkan untuk ${contacts.length} kontak.`,
        );
      } else {
        if (newBroadcastId) {
          setProgressModalOpen(true);
        }
      }

      // Do NOT reset imported contacts immediately to prevent preview from disappearing
      setScheduleEnabled(false);
      setScheduleDate("");
      setScheduleTime("");
      setManualRecipients([
        {
          phone: "",
          variables: Array.from({ length: variableCount }, () => ""),
          mediaUrl: "",
          fileName: "",
          contactName: "",
        },
      ]);

      const billingRes = await api.getBilling();
      if (!("error" in billingRes)) {
        setCurrentTokens(Number(billingRes.data?.currentTokens ?? 0));
      }

      onBroadcastSent?.();
    } catch (error) {
      console.error("Error sending broadcast:", error);
      openResultModal("error", "Terjadi kesalahan", "Terjadi kesalahan saat memproses broadcast.");
    } finally {
      setSending(false);
    }
  };

  if (loading && templates.length === 0 && whatsappNumbers.length === 0) {
    return <div className="p-8">Memuat...</div>;
  }

  return (
    <div className="w-full p-6 md:p-8 bg-white">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="mb-2">Kirim Broadcast</h1>
          <p className="text-muted-foreground">Kirim pesan massal menggunakan template yang sudah disetujui</p>
        </div>
        <Button onClick={onViewHistory} variant="outline">
          <FileText className="w-4 h-4 mr-2" />
          Lihat Riwayat
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-medium">1</div>
              <h3>Pilih Nomor Pengirim</h3>
            </div>
            <select className="w-full p-3 border rounded-lg" value={selectedNumber} onChange={(e) => setSelectedNumber(e.target.value)}>
              <option value="">Pilih nomor WhatsApp</option>
              {whatsappNumbers.map((num) => (
                <option key={num.id} value={num.id}>
                  {num.name} - {num.number}
                </option>
              ))}
            </select>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-medium">2</div>
              <h3>Pilih Template Pesan</h3>
            </div>

            <select
              className="w-full p-3 border rounded-lg bg-white"
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
            >
              <option value="">Pilih template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-medium">3</div>
              <h3>Daftar Penerima</h3>
            </div>

            <div className="flex gap-2 mb-4 flex-wrap">
              <Button variant={uploadMethod === "csv" ? "default" : "outline"} onClick={() => setUploadMethod("csv")} className="flex-1 min-w-[100px]">
                Upload CSV
              </Button>
              <Button variant={uploadMethod === "sheet" ? "default" : "outline"} onClick={() => setUploadMethod("sheet")} className="flex-1 min-w-[100px]">
                Google Sheet
              </Button>
              <Button variant={uploadMethod === "manual" ? "default" : "outline"} onClick={() => setUploadMethod("manual")} className="flex-1 min-w-[100px]">
                Input Manual
              </Button>
              <Button variant={uploadMethod === "contacts" ? "default" : "outline"} onClick={() => setUploadMethod("contacts")} className="flex-1 min-w-[100px]">
                Pilih dari Kontak
              </Button>
            </div>

            {uploadMethod === "csv" && (
              <div className="space-y-4">
                {csvFile ? (
                  <div className="border rounded-lg p-4 bg-slate-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{csvFile.name}</div>
                        <div className="text-xs text-slate-500 mt-1">
                          {contacts.length} kontak valid
                          {duplicateCount > 0 ? ` • ${duplicateCount} duplikat dilewati` : ""}
                          {uploadIssues.length > 0 ? ` • ${uploadIssues.length} baris bermasalah` : ""}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={resetImportedContacts}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-red-500 hover:bg-red-100 shrink-0"
                        title="Hapus CSV"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-gray-300 rounded-lg text-center">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="csv-upload"
                    />

                    <div className="flex items-center justify-center">
                    <label
                      htmlFor="csv-upload"
                      className="flex items-center justify-center w-full py-10 rounded-lg hover:border-indigo-500 hover:bg-gray-50 transition-all cursor-pointer group"
                    >
                      <Upload className="w-5 h-5 text-gray-600 group-hover:scale-110 transition-transform" />
                      <div className="text-center">
                        <span className="text-gray-700">
                          Upload
                        </span>
                      </div>
                    </label>
                    </div>
                  </div>
                )}
                    <p className="text-sm text-muted-foreground text-center mt-2">
                      Format: Nomor, Var1, Var2, Var3, Var4, Var5, follow_media, filename, contactname
                    </p>
                <Button variant="ghost" onClick={downloadSampleCSV} className="w-full">
                  Download Sample CSV
                </Button>
              </div>
            )}

            {uploadMethod === "sheet" && (
              <div className="space-y-4">
                <div>
                  <Label>URL Google Sheet</Label>
                  <Input
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label>Nama Sheet / Tab (Opsional)</Label>
                  <Input
                    placeholder="Contoh: Sheet1 (kosongkan untuk sheet/tab pertama)"
                    value={sheetName}
                    onChange={(e) => setSheetName(e.target.value)}
                    className="mt-2"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Pastikan Google Sheet sudah di-share dengan "Anyone with the link can view"
                  </p>
                </div>
                <Button onClick={handleSheetImport} className="w-full">
                  Import dari Google Sheet
                </Button>
              </div>
            )}

            {uploadMethod === "manual" && (
              <div className="space-y-4">
                {manualRecipients.map((row, rowIndex) => (
                  <div key={rowIndex} className="border rounded-xl p-4 space-y-4 bg-slate-50">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">Penerima {rowIndex + 1}</div>
                      <button
                        type="button"
                        onClick={() => removeManualRecipient(rowIndex)}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-red-500 hover:bg-red-100"
                        title="Hapus penerima"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label>Nomor</Label>
                        <Input
                          placeholder="62812xxxx"
                          value={row.phone}
                          onChange={(e) => updateManualRow(rowIndex, { phone: e.target.value })}
                          className="mt-2"
                        />
                      </div>
                      <div>
                        <Label>Nama Kontak</Label>
                        <Input
                          placeholder="Opsional"
                          value={row.contactName}
                          onChange={(e) => updateManualRow(rowIndex, { contactName: e.target.value })}
                          className="mt-2"
                        />
                      </div>
                    </div>

                    {variableCount > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {Array.from({ length: variableCount }, (_, varIndex) => (
                          <div key={varIndex}>
                            <Label>{`Var${varIndex + 1}`}</Label>
                            <Input
                              placeholder={selectedTemplate?.previewExamples?.[varIndex + 1] || `Contoh ${varIndex + 1}`}
                              value={row.variables[varIndex] || ""}
                              onChange={(e) => updateManualVariable(rowIndex, varIndex, e.target.value)}
                              className="mt-2"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {requiresMedia && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Link Media</Label>
                          <Input
                            placeholder="https://..."
                            value={row.mediaUrl}
                            onChange={(e) => updateManualRow(rowIndex, { mediaUrl: e.target.value })}
                            className="mt-2"
                          />
                        </div>
                        <div>
                          <Label>Filename</Label>
                          <Input
                            placeholder={selectedTemplate?.headerType === "document" ? "Dokumen.pdf" : "Opsional"}
                            value={row.fileName}
                            onChange={(e) => updateManualRow(rowIndex, { fileName: e.target.value })}
                            className="mt-2"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                <div className="flex gap-3">
                  <Button variant="outline" onClick={addManualRecipient} className="flex-1">
                    <Plus className="w-4 h-4 mr-2" />
                    Tambah Penerima
                  </Button>
                  <Button onClick={handleApplyManualRecipients} className="flex-1">
                    Gunakan Data Manual
                  </Button>
                </div>
              </div>
            )}

            {uploadMethod === "contacts" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left Column: Select by Label */}
                  <div className="border border-slate-200 bg-slate-50/50 p-4 rounded-xl space-y-3">
                    <Label className="text-slate-800 font-bold">Pilih Berdasarkan Label</Label>
                    {uniqueLabels.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">Belum ada label kontak</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {uniqueLabels.map((labelName) => {
                          const count = allOrgContacts.filter(c => contactLabels[c.phone] === labelName).length;
                          const isLabelChecked = selectedLabels.includes(labelName);

                          return (
                            <label key={labelName} className="flex items-center gap-2.5 p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors text-xs font-semibold text-slate-700">
                              <input
                                type="checkbox"
                                checked={isLabelChecked}
                                onChange={(e) => {
                                  let nextLabels = [...selectedLabels];
                                  let nextContactIds = [...selectedContactIds];
                                  
                                  const labelContacts = allOrgContacts.filter(c => contactLabels[c.phone] === labelName);

                                  if (e.target.checked) {
                                    nextLabels.push(labelName);
                                    labelContacts.forEach(c => {
                                      if (!nextContactIds.includes(c.id)) nextContactIds.push(c.id);
                                    });
                                  } else {
                                    nextLabels = nextLabels.filter(l => l !== labelName);
                                    labelContacts.forEach(c => {
                                      const hasOtherCheckedLabel = nextLabels.some(l => contactLabels[c.phone] === l);
                                      if (!hasOtherCheckedLabel) {
                                        nextContactIds = nextContactIds.filter(id => id !== c.id);
                                      }
                                    });
                                  }
                                  setSelectedLabels(nextLabels);
                                  setSelectedContactIds(nextContactIds);
                                }}
                                className="rounded border-slate-300 text-primary focus:ring-primary w-4 h-4 cursor-pointer"
                              />
                              <span className="flex-1 truncate">{labelName}</span>
                              <span className="text-xs text-slate-400 font-medium px-2 py-0.5 rounded-full bg-slate-100 border">{count} kontak</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Right Column: Select Individual Contacts */}
                  <div className="border border-slate-200 bg-slate-50/50 p-4 rounded-xl space-y-3 flex flex-col">
                    <Label className="text-slate-800 font-bold">Pilih Kontak Individu</Label>
                    <Input
                      placeholder="Cari nama atau nomor..."
                      value={contactSearchQuery}
                      onChange={(e) => setContactSearchQuery(e.target.value)}
                      className="h-8 text-xs rounded-lg bg-white"
                    />
                    {allOrgContacts.length === 0 ? (
                      <p className="text-xs text-slate-400 italic py-2">Belum ada kontak disimpan</p>
                    ) : (
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1 flex-1">
                        {allOrgContacts
                          .filter(c => {
                            const q = contactSearchQuery.toLowerCase();
                            return c.name.toLowerCase().includes(q) || c.phone.includes(q);
                          })
                          .map((c) => (
                            <label key={c.id} className="flex items-center gap-2.5 p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors text-xs font-semibold text-slate-700">
                              <input
                                type="checkbox"
                                checked={selectedContactIds.includes(c.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedContactIds([...selectedContactIds, c.id]);
                                  } else {
                                    setSelectedContactIds(selectedContactIds.filter(id => id !== c.id));
                                    const cLabel = contactLabels[c.phone];
                                    if (cLabel) {
                                      setSelectedLabels(prev => prev.filter(l => l !== cLabel));
                                    }
                                  }
                                }}
                                className="rounded border-slate-300 text-primary focus:ring-primary w-4 h-4 cursor-pointer"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="truncate">{c.name}</p>
                                 <p className="text-xs text-slate-400 font-medium">{c.phone.startsWith("+") ? c.phone : `+${c.phone}`}</p>
                              </div>
                              {contactLabels[c.phone] && (
                                <span className="text-xs font-bold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-full">{contactLabels[c.phone]}</span>
                              )}
                            </label>
                          ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-100">
                  <span className="text-xs font-bold text-slate-600">
                    {selectedContactIds.length} kontak dipilih
                  </span>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        const selectedContacts = allOrgContacts.filter(c => selectedContactIds.includes(c.id));
                        const mapped = selectedContacts.map((c, idx) => ({
                          name: c.name,
                          phone: c.phone,
                          variables: Array.from({ length: variableCount }, () => ""),
                          mediaUrl: "",
                          fileName: "",
                          rowNumber: idx + 1
                        }));
                        applyContactsResult({ contacts: mapped, issues: [], duplicateCount: 0 });
                        toast.success(`Berhasil menerapkan ${mapped.length} penerima.`);
                      }}
                      disabled={selectedContactIds.length === 0}
                      className="bg-primary hover:bg-primary/95 text-white"
                    >
                      Gunakan Kontak Terpilih
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedContactIds([]);
                        setSelectedLabels([]);
                      }}
                      className="border-slate-200 text-slate-500 hover:bg-slate-50"
                    >
                      Reset Pilihan
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {uploadStatus === "success" && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mt-4">
                <div className="flex items-center justify-between text-green-700">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    <p className="font-medium">{contacts.length} kontak berhasil dimuat</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetImportedContacts}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-green-700 hover:bg-green-100 transition-colors"
                    title="Batalkan / Hapus Penerima"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {duplicateCount > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-4">
                <div className="flex items-center gap-2 text-amber-700">
                  <AlertCircle className="w-5 h-5" />
                  <p className="font-medium">{duplicateCount} nomor duplikat dilewati</p>
                </div>
              </div>
            )}

            {uploadIssues.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-4">
                <div className="flex items-center gap-2 text-red-700 mb-2">
                  <AlertCircle className="w-5 h-5" />
                  <p className="font-medium">{uploadIssues.length} baris bermasalah</p>
                </div>
                <div className="text-sm text-red-700 space-y-1 max-h-40 overflow-auto">
                  {uploadIssues.slice(0, 10).map((issue, idx) => (
                    <div key={idx}>
                      Baris {issue.rowNumber}: {issue.reason}
                    </div>
                  ))}
                  {uploadIssues.length > 10 && <div>Dan {uploadIssues.length - 10} baris lainnya...</div>}
                </div>
              </div>
            )}

            {uploadStatus === "error" && contacts.length === 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-4">
                <div className="flex items-center gap-2 text-red-700">
                  <AlertCircle className="w-5 h-5" />
                  <p className="font-medium">Gagal memuat kontak</p>
                </div>
              </div>
            )}
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-medium">4</div>
              <h3>Jadwalkan Pengiriman (Opsional)</h3>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} className="w-4 h-4" />
              <label>Jadwalkan broadcast untuk waktu tertentu</label>
            </div>

            {scheduleEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Tanggal</Label>
                  <Input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label>Waktu</Label>
                  <Input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className="mt-2" />
                </div>
              </div>
            )}
          </Card>

          <Card className="p-6 bg-primary text-white">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-white mb-2">Siap Kirim Broadcast</h3>
                <p className="text-sm opacity-90">
                  {contacts.length} penerima • butuh {requiredTokens} token • saldo {currentTokens} token
                </p>

                {!hasEnoughTokens && contacts.length > 0 && (
                  <p className="text-xs mt-2 text-red-100">
                    Token tidak cukup. Tambah {requiredTokens - currentTokens} token lagi.
                  </p>
                )}
              </div>

              <Button
                onClick={handleSendBroadcast}
                disabled={
                  sending ||
                  !selectedNumber ||
                  !selectedTemplate ||
                  contacts.length === 0 ||
                  !hasEnoughTokens
                }
                className="bg-white text-primary hover:bg-accent transition-colors"
              >
                {sending ? "Mengirim..." : (
                  <>
                    {scheduleEnabled ? <Calendar className="w-4 h-4 mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                    {scheduleEnabled ? "Jadwalkan" : "Kirim Sekarang"}
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>

        <div>
          <Card className="p-6 sticky top-6">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-4 h-4" />
              <h3>Preview Template</h3>
            </div>

            {selectedTemplate ? (
              <div className="space-y-4">
                <div>
                  <h4 className="mb-1">{selectedTemplate.name}</h4>
                  {contacts.length > 0 && (
                    <div className="text-xs text-slate-500">Preview untuk: {contacts[0].name}</div>
                  )}
                </div>

                <WhatsAppBubblePreview
                  headerType={selectedTemplate.headerType || "none"}
                  headerText={selectedTemplate.headerText}
                  body={previewBody}
                  footer={selectedTemplate.footerText}
                  buttons={selectedTemplate.buttons}
                />
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Pilih template untuk melihat preview</p>
              </div>
            )}
          </Card>
        </div>
      </div>

      <AppModal
        open={confirmOpen && !!selectedTemplate}
        title="Konfirmasi Broadcast"
        description="Pastikan data yang akan dikirim sudah benar."
        onClose={() => setConfirmOpen(false)}
        closeDisabled={sending}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={sending}>
              Batal
            </Button>
            <Button onClick={confirmSendBroadcast} disabled={sending || !hasEnoughTokens}>
              {sending ? "Memproses..." : "Ya, Kirim Broadcast"}
            </Button>
          </div>
        }
      >
        {selectedTemplate && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Template</span>
                <span className="font-medium text-right">{selectedTemplate.name}</span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Penerima</span>
                <span className="font-medium">{contacts.length} kontak</span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Token</span>
                <span className="font-medium">{requiredTokens} token</span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Estimasi biaya</span>
                <span className="font-medium">
                  Rp {estimatedCost.toLocaleString("id-ID")}
                </span>
              </div>

              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Pengiriman</span>
                <span className="font-medium text-right">{scheduleInfoText}</span>
              </div>
            </div>

            {!hasEnoughTokens && contacts.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Token tidak cukup. Tambah {requiredTokens - currentTokens} token lagi.
              </div>
            )}
          </div>
        )}
      </AppModal>

      <AppModal
        open={resultModal.open}
        title={resultModal.title}
        onClose={closeResultModal}
        footer={
          <div className="flex justify-end gap-2">
            {resultModal.broadcastId && (
              <Button
                onClick={() => {
                  const bcId = resultModal.broadcastId;
                  closeResultModal();
                  if (bcId) {
                    window.location.hash = `#/broadcast-detail?broadcastId=${bcId}`;
                  }
                }}
                className="bg-primary text-white"
              >
                Lihat Laporan
              </Button>
            )}
            <Button variant="outline" onClick={closeResultModal}>
              Tutup
            </Button>
          </div>
        }
      >
        <p
          className={`text-sm leading-6 ${
            resultModal.type === "success"
              ? "text-green-700"
              : resultModal.type === "error"
              ? "text-red-700"
              : "text-slate-600"
          }`}
        >
          {resultModal.message}
        </p>
      </AppModal>

      <AppModal
        open={duplicateCheckModal.open}
        title="Nomor Duplikat Ditemukan"
        description="Beberapa nomor telepon penerima yang sama ditemukan dalam daftar."
        onClose={() => setDuplicateCheckModal((prev) => ({ ...prev, open: false }))}
        footer={
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={handleKeepUnique}
              className="border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Hapus Nomor Duplikat
            </Button>
            <Button onClick={handleKeepAll} className="bg-primary hover:bg-primary/95 text-white">
              Lanjutkan dengan Duplikat
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-2">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
            <div>
              <p className="font-semibold">Terdapat {duplicateCheckModal.duplicateCount} nomor duplikat/sama.</p>
              <p className="mt-1 text-xs text-amber-700 leading-normal">
                Pilih <strong>Hapus Nomor Duplikat</strong> jika ingin menyaring daftar sehingga setiap nomor hanya dikirimi pesan satu kali. Atau pilih <strong>Lanjutkan dengan Duplikat</strong> jika ingin tetap mengirim pesan ke semua baris data.
              </p>
            </div>
          </div>
        </div>
      </AppModal>

      <BroadcastProgressModal
        open={progressModalOpen}
        broadcastId={activeBroadcastId}
        onClose={() => setProgressModalOpen(false)}
        onCancelled={() => {
          loadInitialData();
          onBroadcastSent?.();
          resetImportedContacts();
        }}
        onComplete={(bcId) => {
          setProgressModalOpen(false);
          openResultModal(
            "success",
            "Broadcast Selesai",
            "Pesan broadcast Anda telah selesai dikirim. Silakan lihat laporan detail untuk melihat rincian pengiriman.",
            bcId,
          );
          resetImportedContacts();
        }}
      />
    </div>
  );
}