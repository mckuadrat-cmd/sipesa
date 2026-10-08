import { useState, useEffect, useRef } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { AppModal } from "./AppModal";

import { ArrowLeft, Send, Search, Phone, Smile, RotateCw, CheckCheck, Trash2, Square, CheckSquare, Edit, X, Lock, FileText, Sparkles, Clock, AlertTriangle, ChevronDown, Download } from "lucide-react";
import { toast } from "sonner";
import { api, type MessageCursor } from "../lib/api";
import { getAuthToken } from "../lib/apiClient";
import { supabase } from "../lib/supabaseClient";
import { useVisibilityRefresh } from "../hooks/use-visibility-refresh";
import { useDialogFocus } from "../hooks/use-dialog-focus";

function SafeImage({
  src,
  alt,
  className,
  fallbackText,
  onClick,
}: {
  src: string;
  alt: string;
  className?: string;
  fallbackText: string;
  onClick?: () => void;
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return <span className="text-slate-500 italic text-xs">{fallbackText}</span>;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      onError={() => setHasError(true)}
    />
  );
}

function useSecureMediaUrl(mediaId: string, numberId: string, retryNonce = 0) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setUrl("");
    setError(false);

    api.getMediaObjectUrl(mediaId, numberId).then((result) => {
      if (!active) {
        if (result.success) URL.revokeObjectURL(result.data);
        return;
      }
      if (!result.success) {
        setError(true);
        return;
      }
      objectUrl = result.data;
      setUrl(objectUrl);
    });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaId, numberId, retryNonce]);

  return { url, error };
}

function SecureMediaImage({
  mediaId,
  numberId,
  alt,
  className,
  fallbackText,
}: {
  mediaId: string;
  numberId: string;
  alt: string;
  className?: string;
  fallbackText: string;
}) {
  const [retryNonce, setRetryNonce] = useState(0);
  const { url, error } = useSecureMediaUrl(mediaId, numberId, retryNonce);
  if (error) return (
    <span className="inline-flex flex-col items-start gap-1 text-xs text-slate-500" role="status">
      <span>{fallbackText}</span>
      <button type="button" className="font-semibold underline" onClick={() => setRetryNonce((value) => value + 1)}>Coba lagi</button>
    </span>
  );
  if (!url) return <span className="text-slate-500 italic text-xs" role="status">Memuat media…</span>;

  return (
    <button type="button" className="block max-w-full text-left" aria-label={`Buka ${alt}`} onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
      <SafeImage src={url} alt={alt} className={className} fallbackText={fallbackText} />
    </button>
  );
}

function SecureDocumentLink({
  mediaId,
  numberId,
  fileName,
}: {
  mediaId: string;
  numberId: string;
  fileName: string;
}) {
  const [retryNonce, setRetryNonce] = useState(0);
  const { url, error } = useSecureMediaUrl(mediaId, numberId, retryNonce);
  if (error) return (
    <button type="button" className="text-xs font-semibold text-red-600 underline" onClick={() => setRetryNonce((value) => value + 1)}>
      Coba muat dokumen lagi
    </button>
  );
  if (!url) return <span className="text-xs text-slate-500" role="status">Memuat dokumen…</span>;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={fileName}
      aria-label={`Buka atau unduh dokumen ${fileName}`}
      className="w-9 h-9 rounded-full bg-white hover:bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-600 transition-colors shrink-0"
      title="Buka atau unduh dokumen"
    >
      <Download className="w-4 h-4" />
    </a>
  );
}

interface Message {
  id: string;
  content: string;
  sender: "user" | "contact";
  timestamp: string;
  contactName?: string;
  messageType?: string;
  payload?: any;
  status?: string;
}

const MESSAGE_STATUS_RANK: Record<string, number> = {
  pending: 0,
  queued: 0,
  processing: 10,
  accepted: 20,
  sent: 20,
  delivered: 30,
  read: 40,
  failed: -1,
};

function resolveMessageStatus(existingStatus?: string, incomingStatus?: string) {
  const existing = String(existingStatus || "").toLowerCase();
  const incoming = String(incomingStatus || "").toLowerCase();
  if (!incoming) return existingStatus;
  if (!existing) return incomingStatus;
  if (existing === "failed") return existingStatus;
  if (incoming === "failed") {
    const existingRank = MESSAGE_STATUS_RANK[existing] ?? 0;
    return existingRank < MESSAGE_STATUS_RANK.delivered ? incomingStatus : existingStatus;
  }
  const existingRank = MESSAGE_STATUS_RANK[existing] ?? 0;
  const incomingRank = MESSAGE_STATUS_RANK[incoming] ?? 0;
  return incomingRank >= existingRank ? incomingStatus : existingStatus;
}

function compareMessages(a: Message, b: Message) {
  const byTime = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  return byTime || a.id.localeCompare(b.id);
}

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const existing = byId.get(message.id);
    if (!existing) {
      byId.set(message.id, message);
      continue;
    }
    byId.set(message.id, {
      ...existing,
      ...message,
      status: resolveMessageStatus(existing.status, message.status),
    });
  }
  return [...byId.values()].sort(compareMessages);
}

function MessageStatus({ status }: { status?: string }) {
  const normalized = String(status || "pending").toLowerCase();
  const presentation = normalized === "read"
    ? { label: "Dibaca", icon: CheckCheck, className: "text-blue-600" }
    : normalized === "delivered"
      ? { label: "Diterima", icon: CheckCheck, className: "text-emerald-600" }
      : normalized === "sent" || normalized === "accepted"
        ? { label: "Terkirim", icon: CheckCheck, className: "text-slate-600" }
        : normalized === "failed"
          ? { label: "Gagal", icon: AlertTriangle, className: "text-red-600" }
          : { label: "Mengirim", icon: Clock, className: "text-slate-500" };
  const StatusIcon = presentation.icon;
  return (
    <span className={`inline-flex items-center gap-1 ${presentation.className}`} aria-label={`Status pesan: ${presentation.label}`}>
      <StatusIcon className="h-3 w-3" aria-hidden="true" />
      {presentation.label}
    </span>
  );
}

function cursorFromMessage(message?: Message): MessageCursor | null {
  return message ? { createdAt: message.timestamp, id: message.id } : null;
}

function isCursorAfter(candidate: MessageCursor, current: MessageCursor | null) {
  if (!current) return true;
  const timeDifference = new Date(candidate.createdAt).getTime() - new Date(current.createdAt).getTime();
  return timeDifference > 0 || (timeDifference === 0 && candidate.id > current.id);
}

function mapRealtimeMessage(row: any): Message {
  return {
    id: String(row.id),
    content: String(row.text_body ?? ""),
    sender: row.direction === "out" ? "user" : "contact",
    timestamp: String(row.created_at),
    status: row.status ? String(row.status) : undefined,
    messageType: row.message_type || "text",
    payload: row.payload ?? null,
  };
}

function logRealtimeDiagnostic(event: string, context: Record<string, unknown> = {}) {
  if (!import.meta.env.DEV) return;
  console.debug("[CHAT_REALTIME]", event, context);
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  lastMessage: string;
  timestamp: string;
  unread: boolean;
  avatarUrl?: string;
  avatar_url?: string;
  avatar?: string;
}

interface ChatInterfaceProps {
  numberId: string;
  numberName: string;
  onBack: () => void;
  onViewTemplates?: () => void;
}

const EMOJI_CATEGORIES = [
  {
    name: "Wajah & Orang",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🤔", "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "🤐", "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈", "👿", "👹", "👺", "🤡", "💩", "👻", "💀", "☠️", "👽", "👾", "🤖", "🎃", "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾"
    ]
  },
  {
    name: "Gestur & Tangan",
    emojis: [
      "👋", "🤚", "🖐", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪", "🦾", "🦵", "🦿", "👣", "👂", "🦻", "👃", "🧠", "🫀", "🫁", "🦷", "🦴", "👀", "👁", "👅", "👄", "💋"
    ]
  },
  {
    name: "Hewan & Alam",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐽", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦", "🐤", "🐣", "🐥", "🦆", "🦢", "🦉", "🦜", "🐊", "🐢", "🦎", "🐍", "🐲", "🐉", "🦕", "🦖", "🐳", "🐋", "🐬", "🦭", "🐟", "🐠", "🐡", "🦈", "🐙", "🐚", "🐌", "🦋", "🐛", "🐜", "🐝", "🪲", "🐞", "🦗", "🕷", "🕸", "🦂", "🦟", "💐", "🌸", "💮", "🏵", "🌹", "🥀", "🌺", "🌻", "🌼", "🌷", "🌱", "🪴", "🌲", "🌳", "🌴", "🌵", "🌾", "🌿", "🍀", "🍁", "🍂", "🍃"
    ]
  },
  {
    name: "Makanan & Minuman",
    emojis: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒", "🌶", "🫑", "🌽", "🥕", "🫒", "🧄", "🧅", "🍄", "🍞", "🥐", "🥖", "🥨", "🥯", "🥞", "🧇", "🧀", "🍖", "🍗", "🥩", "🥓", "🍔", "🍟", "🍕", "🌭", "🥪", "🌮", "🌯", "🥚", "🍳", "🥘", "🍲", "🥣", "🥗", "🍿", "🧈", "🧂", "🍱", "🍘", "🍙", "🍚", "🍛", "🍜", "🍝", "🍣", "🍤", "🍥", "🍡", "🥟", "🥠", "🍦", "🍧", "🍨", "🍩", "🍪", "🎂", "🍰", "🧁", "🥧", "🍫", "🍬", "🍭", "🍮", "🍯", "🥛", "☕", "🍵", "🍶", "🍾", "🍷", "🍸", "🍹", "🍺", "🍻", "🥂", "🥃", "🥤", "🧋", "🧃", "🧊"
    ]
  },
  {
    name: "Hati & Simbol",
    emojis: [
      "💘", "💝", "💖", "💗", "💓", "💞", "💕", "💟", "❣️", "💔", "❤️‍🔥", "❤️‍🩹", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💯", "💢", "💥", "💫", "💦", "💨", "🕳", "💣", "💬", "🗨", "🗯", "💭", "💤", "🌐", "🔆", "⚠️", "🚫", "✅", "❌", "❓", "❗", "⭕"
    ]
  }
];

const EMOJIS = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

function formatMessageTime(isoString: string) {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const datePart = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    const pad = (n: number) => String(n).padStart(2, "0");
    const timePart = `${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
    return `${datePart}, ${timePart}`;
  } catch {
    return isoString;
  }
}

function formatContactTime(isoString: string) {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const time = `${pad(d.getHours())}.${pad(d.getMinutes())}`;

    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    if (isToday) {
      return time;
    }

    const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const dateStr = `${d.getDate()} ${months[d.getMonth()]}`;
    return `${dateStr}, ${time}`;
  } catch {
    return "";
  }
}

function formatPhoneNumber(phone: string) {
  let cleaned = String(phone || "").trim();
  if (!cleaned) return "";
  if (!cleaned.startsWith("+")) {
    cleaned = "+" + cleaned;
  }
  if (cleaned.startsWith("+62")) {
    const code = "+62";
    const rest = cleaned.slice(3);
    if (rest.length >= 9) {
      return `${code} ${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`;
    }
  }
  return cleaned;
}

function getAvatarColor(name: string) {
  const colors = [
    "bg-emerald-600",
    "bg-teal-600",
    "bg-cyan-600",
    "bg-indigo-600",
    "bg-violet-600",
    "bg-rose-600",
    "bg-amber-600",
    "bg-orange-600",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

function getInitials(name: string) {
  const cleanName = name.trim();
  if (!cleanName) return "?";
  return cleanName[0].toUpperCase();
}

export function ChatInterface({ numberId, numberName, onBack, onViewTemplates }: ChatInterfaceProps) {
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [realtimeState, setRealtimeState] = useState("CONNECTING");
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [conversationState, setConversationState] = useState({ loading: false, hasData: false, error: false });
  const [contactsState, setContactsState] = useState({ loading: true, hasData: false, error: false });
  const [sending, setSending] = useState(false);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // 24-Hour CS Window & Template Selector States
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateLoadState, setTemplateLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [templatesList, setTemplatesList] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<any | null>(null);
  const [templateVarValues, setTemplateVarValues] = useState<string[]>([]);
  const [sendingTemplate, setSendingTemplate] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userIsAtBottomRef = useRef<boolean>(true);
  const autoScrollNextRef = useRef<boolean>(true);
  const textSendAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const templateSendAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const olderCursorRef = useRef<MessageCursor | null>(null);
  const latestCursorRef = useRef<MessageCursor | null>(null);
  const conversationGenerationRef = useRef(0);
  const markReadInFlightRef = useRef<string | null>(null);
  const templateDialogRef = useDialogFocus<HTMLDivElement>(showTemplateModal, () => setShowTemplateModal(false), sendingTemplate);
  const selectedContactRef = useRef<string | null>(selectedContact);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight <= 120;
    userIsAtBottomRef.current = isAtBottom;
    setShowScrollBottomBtn(!isAtBottom);
  };

  const scrollToBottom = (smooth = true) => {
    if (!scrollContainerRef.current) return;
    scrollContainerRef.current.scrollTo({
      top: scrollContainerRef.current.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
    userIsAtBottomRef.current = true;
    setShowScrollBottomBtn(false);
  };

  // Check 24-Hour Customer Service Window from client's last incoming message
  const lastIncomingMessage = [...messages].reverse().find((m) => m.sender === "contact");
  const isWithin24Hours = Boolean(
    lastIncomingMessage &&
    (Date.now() - new Date(lastIncomingMessage.timestamp).getTime() < 24 * 60 * 60 * 1000)
  );

  const loadApprovedTemplates = async () => {
    setLoadingTemplates(true);
    setTemplateLoadState("loading");
    try {
      const res = await api.getBroadcastTemplates();
      if (!res.success || !Array.isArray(res.data)) throw new Error(res.success ? "Invalid template response" : res.error);
      setTemplatesList(res.data.filter((template: any) => String(template.status || "").toLowerCase() === "approved"));
      setTemplateLoadState("loaded");
    } catch (err) {
      console.error("Error fetching templates:", err);
      setTemplatesList([]);
      setTemplateLoadState("error");
    } finally {
      setLoadingTemplates(false);
    }
  };

  const openTemplateModal = () => {
    setShowTemplateModal(true);
    setSelectedTemplate(null);
    setTemplateVarValues([]);
    void loadApprovedTemplates();
  };

  const handleSelectTemplate = (template: any) => {
    setSelectedTemplate(template);
    const text = String(template?.content || "");
    const variableMatches = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    const declaredCount = Array.isArray(template?.variables) ? template.variables.length : 0;
    const count = Math.max(variableMatches.length > 0 ? Math.max(...variableMatches) : 0, declaredCount);
    setTemplateVarValues(Array(count).fill(""));
  };

  const selectedTemplateRequiresMedia = Boolean(
    Array.isArray(selectedTemplate?.components)
    && selectedTemplate.components.some((component: any) =>
      String(component?.type || "").toUpperCase() === "HEADER"
      && ["IMAGE", "VIDEO", "DOCUMENT"].includes(String(component?.format || "").toUpperCase()),
    ),
  );
  const invalidTemplateVariableIndexes = templateVarValues
    .map((value, index) => value.trim() ? -1 : index)
    .filter((index) => index >= 0);
  const templatePrerequisitesValid = invalidTemplateVariableIndexes.length === 0 && !selectedTemplateRequiresMedia;

  const buildTemplatePreview = (content: string, vars: string[]) => {
    if (!content) return "";
    let result = content;
    vars.forEach((v, idx) => {
      const val = v.trim() || `{{${idx + 1}}}`;
      result = result.replace(new RegExp(`\\{\\{${idx + 1}\\}\\}`, "g"), val);
    });
    return result;
  };

  const handleExecuteSendTemplate = async () => {
    if (!selectedTemplate || !selectedContact) return;
    if (!templatePrerequisitesValid) return;

    if (!isWithin24Hours && tokenBalance <= 0) {
      toast.warning("Token Anda habis! Silakan top-up terlebih dahulu.");
      return;
    }

    const requiresPaidSend = !isWithin24Hours;
    setSendingTemplate(true);
    try {
      const previewText = buildTemplatePreview(selectedTemplate.content, templateVarValues);
      const fingerprint = JSON.stringify({
        numberId,
        contactId: selectedContact,
        templateName: selectedTemplate.name,
        variables: templateVarValues,
        content: previewText,
      });
      if (templateSendAttemptRef.current?.fingerprint !== fingerprint) {
        templateSendAttemptRef.current = { fingerprint, key: crypto.randomUUID() };
      }
      const result = await api.sendMessage(numberId, selectedContact, {
        messageType: "template",
        templateName: selectedTemplate.name,
        language: selectedTemplate.language || "id",
        bodyVariables: templateVarValues,
        content: previewText,
      }, templateSendAttemptRef.current.key);

      if ("error" in result) {
        if (!result.retryable) templateSendAttemptRef.current = null;
        console.error("Template send failed:", result.error);
        toast.error("Template belum dapat dikirim. Silakan coba lagi.");
        return;
      }

      if (result.data?.outcome === "processing") {
        toast.info("Pengiriman sebelumnya masih diproses. SIPESA tidak mengirim duplikat.");
        return;
      }

      templateSendAttemptRef.current = null;

      if (result.data) {
        autoScrollNextRef.current = true;
        setMessages((previous) => mergeMessages(previous, [result.data]));
      }
      setTokenBalance(Number(result.tokensRemaining ?? tokenBalance));
      setShowTemplateModal(false);
      setSelectedTemplate(null);
      if (result.data?.outcome === "accepted_reconciliation_required") {
        toast.warning("Pesan diterima Meta, tetapi sinkronisasi status lokal perlu diperiksa.");
      } else {
        toast.success("Pesan template sedang dikirim.");
      }
      void refreshContacts();
      void reconcileVisibleMessages();
      if (requiresPaidSend) void refreshBalance();
    } catch (err) {
      console.error("Error sending template:", err);
      toast.error("Terjadi kesalahan saat mengirim template pesan");
    } finally {
      setSendingTemplate(false);
    }
  };

  useEffect(() => {
    if (autoScrollNextRef.current || userIsAtBottomRef.current) {
      scrollToBottom(autoScrollNextRef.current ? false : true);
      autoScrollNextRef.current = false;
    }
  }, [messages]);

  const loadTokenBalance = async () => {
    try {
      const result = await api.getBilling();
      if (!result.success) return;
      setTokenBalance(Number(result.data.currentTokens ?? 0));
    } catch (error) {
      console.error("Error loading token balance:", error);
    }
  };

  const loadContacts = async () => {
    setContactsState((previous) => ({ ...previous, loading: true, error: false }));
    try {
      const result = await api.getContacts(numberId);
      if (!result.success) throw new Error(result.error);
      setContacts(result.data);
      setContactsState({ loading: false, hasData: true, error: false });
    } catch (error) {
      console.error("Error loading contacts:", error);
      setContactsState((previous) => ({ ...previous, loading: false, error: true }));
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const result = await api.readAllMessages(numberId);
      if (!result.success) {
        toast.error("Gagal menandai semua pesan sebagai dibaca");
        return;
      }
      toast.success("Semua pesan ditandai sebagai dibaca");
      setMessages((previous) => previous.map((message) =>
        message.sender === "contact" && message.status === "delivered"
          ? { ...message, status: "read" }
          : message
      ));
      void refreshContacts();
    } catch (error) {
      console.error("Error marking all as read:", error);
      toast.error("Terjadi kesalahan");
    }
  };

  const toggleEditMode = () => {
    setIsEditMode(!isEditMode);
    setSelectedContactIds(new Set());
  };

  const handleToggleContactSelection = (contactId: string) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedContactIds.size === filteredContacts.length) {
      setSelectedContactIds(new Set());
    } else {
      setSelectedContactIds(new Set(filteredContacts.map((c) => c.id)));
    }
  };

  const handleMarkSelectedAsRead = async () => {
    const ids = Array.from(selectedContactIds);
    if (ids.length === 0) return;
    try {
      const result = await api.readAllMessages(numberId, ids);
      if (!result.success) {
        toast.error("Gagal menandai pesan sebagai dibaca");
        return;
      }
      toast.success("Pesan terpilih berhasil ditandai sebagai dibaca");
      setSelectedContactIds(new Set());
      setIsEditMode(false);
      void refreshContacts();
      if (selectedContact && ids.includes(selectedContact)) {
        setMessages((previous) => previous.map((message) =>
          message.sender === "contact" && message.status === "delivered"
            ? { ...message, status: "read" }
            : message
        ));
      }
    } catch (error) {
      console.error(error);
      toast.error("Terjadi kesalahan");
    }
  };

  const handleDeleteSelected = () => {
    if (selectedContactIds.size === 0) return;
    setDeleteConfirmOpen(true);
  };

  const executeDeleteSelected = async () => {
    const ids = Array.from(selectedContactIds);
    if (ids.length === 0) return;
    try {
      const result = await api.deleteConversations(numberId, { contactIds: ids });
      if (!result.success) {
        toast.error("Gagal menghapus percakapan");
        return;
      }
      toast.success("Percakapan terpilih berhasil dihapus");
      setSelectedContactIds(new Set());
      setIsEditMode(false);
      if (selectedContact && ids.includes(selectedContact)) {
        setSelectedContact(null);
        setMessages([]);
      }
      void refreshContacts();
    } catch (error) {
      console.error(error);
      toast.error("Terjadi kesalahan");
    } finally {
      setDeleteConfirmOpen(false);
    }
  };

  const loadMessages = async (contactId = selectedContact) => {
    if (!contactId) return;
    const generation = ++conversationGenerationRef.current;
    setLoading(true);
    setConversationState((previous) => ({ ...previous, loading: true, error: false }));
    try {
      const result = await api.getMessages(numberId, contactId, { limit: 50 });
      if (!result.success) throw new Error(result.error);
      if (generation !== conversationGenerationRef.current) return;
      setMessages(result.data.messages);
      setHasOlderMessages(result.data.hasMore);
      olderCursorRef.current = result.data.olderCursor;
      latestCursorRef.current = result.data.latestCursor;
      setConversationState({ loading: false, hasData: true, error: false });
    } catch (error) {
      if (generation !== conversationGenerationRef.current) return;
      console.error("Error loading messages:", error);
      setConversationState((previous) => ({ ...previous, loading: false, error: true }));
    } finally {
      if (generation === conversationGenerationRef.current) {
        setLoading(false);
        setConversationState((previous) => ({ ...previous, loading: false }));
      }
    }
  };

  const loadOlderMessages = async () => {
    if (!selectedContact || !olderCursorRef.current || loadingOlderMessages) return;
    const contactId = selectedContact;
    const cursor = olderCursorRef.current;
    const generation = conversationGenerationRef.current;
    const previousScrollHeight = scrollContainerRef.current?.scrollHeight ?? 0;
    setLoadingOlderMessages(true);
    try {
      const result = await api.getMessages(numberId, contactId, { before: cursor, limit: 50 });
      if (!result.success) throw new Error(result.error);
      if (generation !== conversationGenerationRef.current) return;
      setMessages((previous) => mergeMessages(previous, result.data.messages));
      setHasOlderMessages(result.data.hasMore);
      olderCursorRef.current = result.data.olderCursor;
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop += scrollContainerRef.current.scrollHeight - previousScrollHeight;
        }
      });
    } catch (error) {
      console.error("Error loading older messages:", error);
      setConversationState((previous) => ({ ...previous, error: true }));
    } finally {
      if (generation === conversationGenerationRef.current) setLoadingOlderMessages(false);
    }
  };

  const reconcileMessages = async () => {
    if (!selectedContact) return;
    const contactId = selectedContact;
    const generation = conversationGenerationRef.current;
    let cursor = latestCursorRef.current;
    if (!cursor) {
      await loadMessages(contactId);
      return;
    }

    try {
      // Bound each request and drain a short burst page-by-page. If more than
      // five pages arrive at once, the next reconciliation continues exactly
      // after the last stable (created_at, id) cursor without gaps.
      for (let page = 0; page < 5; page += 1) {
        const result = await api.getMessages(numberId, contactId, { after: cursor, limit: 50 });
        if (!result.success) throw new Error(result.error);
        if (generation !== conversationGenerationRef.current) return;
        if (result.data.messages.length > 0) {
          setMessages((previous) => mergeMessages(previous, result.data.messages));
        }
        if (result.data.latestCursor) {
          cursor = result.data.latestCursor;
          latestCursorRef.current = cursor;
        }
        if (!result.data.hasMore || result.data.messages.length === 0) break;
      }

      const recentIds = messages.slice(-50).map((message) => message.id);
      const statuses = await api.getMessageStatuses(numberId, contactId, recentIds);
      if (statuses.success && generation === conversationGenerationRef.current) {
        const statusById = new Map(statuses.data.map((row) => [row.id, row.status]));
        setMessages((previous) => previous.map((message) => {
          const status = statusById.get(message.id);
          if (!status) return message;
          return { ...message, status: resolveMessageStatus(message.status, status) };
        }));
      }
      setConversationState((previous) => ({ ...previous, error: false }));
    } catch (error) {
      console.error("Error reconciling messages:", error);
      setConversationState((previous) => ({ ...previous, error: true }));
    }
  };

  const markActiveConversationRead = async () => {
    if (!selectedContact || document.visibilityState === "hidden") return;
    const hasUnreadInbound = messages.some(
      (message) => message.sender === "contact" && message.status === "delivered",
    );
    if (!hasUnreadInbound) return;

    const key = `${numberId}:${selectedContact}`;
    if (markReadInFlightRef.current === key) return;
    markReadInFlightRef.current = key;
    try {
      const result = await api.markConversationRead(numberId, selectedContact);
      if (!result.success) return;
      setMessages((previous) => previous.map((message) =>
        message.sender === "contact" && message.status === "delivered"
          ? { ...message, status: "read" }
          : message
      ));
      await loadContacts();
    } finally {
      if (markReadInFlightRef.current === key) markReadInFlightRef.current = null;
    }
  };

  const refreshContacts = useVisibilityRefresh(loadContacts, { intervalMs: 30_000 });
  const refreshBalance = useVisibilityRefresh(loadTokenBalance);
  const reconcileVisibleMessages = useVisibilityRefresh(reconcileMessages, {
    enabled: Boolean(selectedContact),
    intervalMs: 30_000,
  });
  const refreshReadState = useVisibilityRefresh(markActiveConversationRead, {
    enabled: Boolean(selectedContact),
  });

  useEffect(() => {
    setSelectedContact(null);
    setMessages([]);
    setHasOlderMessages(false);
    olderCursorRef.current = null;
    latestCursorRef.current = null;
    conversationGenerationRef.current += 1;
    void Promise.all([refreshContacts(), refreshBalance()]);
  }, [numberId, refreshBalance, refreshContacts]);

  useEffect(() => {
    selectedContactRef.current = selectedContact;
  }, [selectedContact]);

  useEffect(() => {
    autoScrollNextRef.current = true;
    userIsAtBottomRef.current = true;
    setShowScrollBottomBtn(false);
    setMessages([]);
    setHasOlderMessages(false);
    olderCursorRef.current = null;
    latestCursorRef.current = null;
    conversationGenerationRef.current += 1;
    setConversationState({ loading: Boolean(selectedContact), hasData: false, error: false });

    if (selectedContact) void loadMessages(selectedContact);
  }, [selectedContact, numberId]);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const token = getAuthToken();
      logRealtimeDiagnostic("number_channel_auth", { numberId, tokenAvailable: Boolean(token) });
      if (token) await supabase.realtime.setAuth(token);
      if (cancelled) return;

      channel = supabase
        .channel(`chat-number-inserts:${numberId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "wa_messages", filter: `number_id=eq.${numberId}` },
          (payload) => {
            const row: any = payload.new;
            const eventNumberId = String(row.number_id || "");
            const eventContactId = String(row.contact_id || "");
            logRealtimeDiagnostic("insert_received", {
              numberId,
              messageId: row.id ? String(row.id) : null,
              eventNumberId: eventNumberId || null,
              eventContactId: eventContactId || null,
              status: row.status ? String(row.status) : null,
            });

            if (eventNumberId !== numberId) {
              logRealtimeDiagnostic("insert_rejected", {
                reason: "number_id_mismatch",
                numberId,
                eventNumberId: eventNumberId || null,
              });
              return;
            }
            if (!eventContactId || !row.id || !row.created_at) {
              logRealtimeDiagnostic("insert_rejected", {
                reason: "missing_message_identity",
                numberId,
              });
              return;
            }

            void refreshContacts();
            const activeContactId = selectedContactRef.current;
            if (!activeContactId || eventContactId !== activeContactId) {
              logRealtimeDiagnostic("insert_summary_only", {
                reason: activeContactId ? "different_active_contact" : "no_active_conversation",
                numberId,
                eventContactId,
              });
              return;
            }

            const message = mapRealtimeMessage(row);
            setMessages((previous) => mergeMessages(previous, [message]));
            const cursor = cursorFromMessage(message);
            if (cursor && isCursorAfter(cursor, latestCursorRef.current)) latestCursorRef.current = cursor;
          },
        )
        .subscribe((status, error) => {
          setRealtimeState(status);
          logRealtimeDiagnostic("number_channel_status", {
            numberId,
            status,
            error: error?.message ?? null,
          });
        });
    })().catch((error) => {
      setRealtimeState("CHANNEL_ERROR");
      logRealtimeDiagnostic("number_channel_setup_error", {
        numberId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return () => {
      cancelled = true;
      logRealtimeDiagnostic("number_channel_cleanup", { numberId, channelCreated: Boolean(channel) });
      if (channel) void supabase.removeChannel(channel);
    };
  }, [numberId, refreshContacts]);

  useEffect(() => {
    if (!selectedContact) return;
    const contactId = selectedContact;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const token = getAuthToken();
      logRealtimeDiagnostic("conversation_channel_auth", {
        numberId,
        contactId,
        tokenAvailable: Boolean(token),
      });
      if (token) await supabase.realtime.setAuth(token);
      if (cancelled) return;

      channel = supabase
        .channel(`chat-contact-updates:${numberId}:${contactId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "wa_messages", filter: `contact_id=eq.${contactId}` },
          (payload) => {
            const row: any = payload.new;
            const eventNumberId = String(row.number_id || "");
            const eventContactId = String(row.contact_id || "");
            logRealtimeDiagnostic("update_received", {
              numberId,
              contactId,
              messageId: row.id ? String(row.id) : null,
              eventNumberId: eventNumberId || null,
              eventContactId: eventContactId || null,
              status: row.status ? String(row.status) : null,
            });
            if (eventNumberId !== numberId || eventContactId !== contactId) {
              logRealtimeDiagnostic("update_rejected", {
                reason: eventNumberId !== numberId ? "number_id_mismatch" : "contact_id_mismatch",
                numberId,
                contactId,
                eventNumberId: eventNumberId || null,
                eventContactId: eventContactId || null,
              });
              return;
            }
            setMessages((previous) => mergeMessages(previous, [mapRealtimeMessage(row)]));
          },
        )
        .subscribe((status, error) => {
          setRealtimeState(status);
          logRealtimeDiagnostic("conversation_channel_status", {
            numberId,
            contactId,
            status,
            error: error?.message ?? null,
          });
        });
    })().catch((error) => {
      setRealtimeState("CHANNEL_ERROR");
      logRealtimeDiagnostic("conversation_channel_setup_error", {
        numberId,
        contactId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return () => {
      cancelled = true;
      logRealtimeDiagnostic("conversation_channel_cleanup", {
        numberId,
        contactId,
        channelCreated: Boolean(channel),
      });
      if (channel) void supabase.removeChannel(channel);
    };
  }, [numberId, selectedContact]);

  useEffect(() => {
    void refreshReadState();
  }, [messages, refreshReadState, selectedContact]);

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedContact) return;

    if (!isWithin24Hours && tokenBalance <= 0) {
      toast.warning("Token Anda habis! Silakan top-up terlebih dahulu untuk mengirim pesan.");
      return;
    }

    const requiresPaidSend = !isWithin24Hours;
    setSending(true);
    try {
      const fingerprint = JSON.stringify({ numberId, contactId: selectedContact, content: messageInput });
      if (textSendAttemptRef.current?.fingerprint !== fingerprint) {
        textSendAttemptRef.current = { fingerprint, key: crypto.randomUUID() };
      }
      const result = await api.sendMessage(
        numberId,
        selectedContact,
        messageInput,
        textSendAttemptRef.current.key,
      );

      if ("error" in result) {
        if (!result.retryable) textSendAttemptRef.current = null;
        console.error("Message send failed:", result.error);
        if (result.error.toLowerCase().includes("token")) {
          toast.warning("Token Anda habis! Silakan top-up terlebih dahulu.");
        } else {
          toast.error("Pesan belum dapat dikirim. Silakan coba lagi.");
        }
        return;
      }

      if (result.data?.outcome === "processing") {
        toast.info("Pengiriman sebelumnya masih diproses. SIPESA tidak mengirim duplikat.");
        return;
      }

      textSendAttemptRef.current = null;

      autoScrollNextRef.current = true;
      setMessages((previous) => mergeMessages(previous, [result.data]));
      setMessageInput("");
      setTokenBalance(Number(result.tokensRemaining ?? tokenBalance));
      setShowEmojiPicker(false);

      if (result.data?.outcome === "accepted_reconciliation_required") {
        toast.warning("Pesan diterima Meta, tetapi sinkronisasi status lokal perlu diperiksa.");
      } else if (result.tokensRemaining < 100) {
        toast.success("Pesan sedang dikirim.", {
          description: `⚠️ Token tersisa: ${result.tokensRemaining}. Segera top-up!`,
        });
      } else {
        toast.success(`Pesan sedang dikirim. Token tersisa: ${result.tokensRemaining}`);
      }

      void refreshContacts();
      void reconcileVisibleMessages();
      if (requiresPaidSend) void refreshBalance();
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Terjadi kesalahan saat mengirim pesan");
    } finally {
      setSending(false);
    }
  };

  const handleAddEmoji = (emoji: string) => {
    setMessageInput((prev) => prev + emoji);
  };

  const filteredContacts = contacts.filter(
    (contact) =>
      contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.phone.includes(searchQuery)
  );

  const currentContact = contacts.find((c) => c.id === selectedContact);

  return (
    <div className="h-full w-full flex overflow-hidden bg-white text-gray-800">
      {/* Sidebar */}
      <div
        className={`border-r border-gray-200 bg-white flex flex-col overflow-hidden w-full md:w-[360px] shrink-0 ${selectedContact ? "hidden md:flex" : "flex"
          }`}
      >
        <div className="p-4 border-b border-gray-100 flex-shrink-0">
          {/* Back Button */}
          <Button
            variant="ghost"
            onClick={onBack}
            className="mb-3 w-full justify-start text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg h-9 px-3 font-medium transition-all"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Kembali
          </Button>

          <h3 className="text-base font-bold text-gray-900 mb-2 truncate" title={numberName}>
            {numberName}
          </h3>

          {isEditMode ? (
            <div className="flex items-center justify-between mb-3 gap-1.5 bg-slate-50 p-2 rounded-lg border border-slate-100">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  aria-label={selectedContactIds.size === filteredContacts.length ? "Batalkan pilihan semua percakapan" : "Pilih semua percakapan"}
                  className="text-slate-500 hover:text-slate-700 transition-colors"
                  title={selectedContactIds.size === filteredContacts.length ? "Deselect All" : "Select All"}
                >
                  {selectedContactIds.size === filteredContacts.length && filteredContacts.length > 0 ? (
                    <CheckSquare className="w-5 h-5 text-emerald-600" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-400" />
                  )}
                </button>
                <span className="text-xs font-bold text-slate-600">
                  {selectedContactIds.size} terpilih
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleMarkSelectedAsRead}
                  aria-label="Tandai percakapan terpilih sebagai dibaca"
                  disabled={selectedContactIds.size === 0}
                  className={`p-1.5 rounded-lg transition-all ${selectedContactIds.size === 0
                    ? "text-slate-300 cursor-not-allowed"
                    : "text-sky-600 hover:bg-sky-50"
                    }`}
                  title="Tandai dibaca"
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  aria-label="Hapus percakapan terpilih"
                  disabled={selectedContactIds.size === 0}
                  className={`p-1.5 rounded-lg transition-all ${selectedContactIds.size === 0
                    ? "text-slate-300 cursor-not-allowed"
                    : "text-red-600 hover:bg-red-50"
                    }`}
                  title="Hapus terpilih"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={toggleEditMode}
                  aria-label="Keluar dari mode pilih percakapan"
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
                  title="Batal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between mb-3 gap-1.5">
              <span className="text-xs font-semibold text-gray-500 truncate">
                {filteredContacts.length} percakapan
              </span>
              <div className="flex items-center gap-1">
                {/* Edit Mode Toggle Button */}
                <button
                  type="button"
                  onClick={toggleEditMode}
                  aria-label="Pilih percakapan untuk dikelola"
                  className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-all"
                  title="Edit Percakapan"
                >
                  <Edit className="w-4 h-4" />
                </button>
                {/* Mark All as Read Button */}
                <button
                  type="button"
                  onClick={handleMarkAllAsRead}
                  aria-label="Tandai semua percakapan sebagai dibaca"
                  className="p-1.5 text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-lg transition-all"
                  title="Tandai semua dibaca"
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
                {/* Refresh Button */}
                <button
                  type="button"
                  onClick={() => {
                    void refreshContacts();
                    void refreshBalance();
                    if (selectedContact) void reconcileVisibleMessages();
                    toast.success("Pesan diperbarui");
                  }}
                  aria-label="Perbarui pesan"
                  className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-all"
                  title="Perbarui pesan"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              aria-label="Cari percakapan"
              placeholder="Cari percakapan..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-gray-50 border-gray-200 focus:bg-white transition-all rounded-lg text-sm"
            />
          </div>
        </div>

        {/* Contact List — plain scrollable div */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }} className="bg-white">
          <div className="p-2 space-y-0.5">
            {contactsState.error && contactsState.hasData && (
              <div className="m-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800" role="status">
                <p>Daftar terakhir ditampilkan. Gagal memperbarui.</p>
                <button type="button" onClick={() => void loadContacts()} className="mt-1 font-bold hover:underline">Coba Lagi</button>
              </div>
            )}
            {!contactsState.hasData && contactsState.loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-gray-500" role="status">
                <RotateCw className="h-4 w-4 animate-spin" /> Memuat percakapan...
              </div>
            ) : !contactsState.hasData && contactsState.error ? (
              <div className="py-8 text-center text-xs" role="alert">
                <p className="font-semibold text-red-600">Percakapan belum dapat dimuat.</p>
                <button type="button" onClick={() => void loadContacts()} className="mt-2 font-bold text-emerald-700 hover:underline">Coba Lagi</button>
              </div>
            ) : filteredContacts.length === 0 ? (
              <p className="text-center text-xs text-gray-400 py-8">
                {contacts.length === 0 ? "Belum ada percakapan." : "Tidak ada hasil pencarian."}
              </p>
            ) : (
              filteredContacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => {
                    if (isEditMode) {
                      handleToggleContactSelection(contact.id);
                    } else {
                      setSelectedContact(contact.id);
                      setContacts((prev) =>
                        prev.map((c) => (c.id === contact.id ? { ...c, unread: false } : c))
                      );
                    }
                  }}
                  className={`w-full px-3 py-3 rounded-xl text-left transition-all duration-200 flex items-center gap-3 relative ${selectedContact === contact.id
                    ? "bg-emerald-50 border border-emerald-100 shadow-sm"
                    : "hover:bg-gray-50 border border-transparent"
                    }`}
                >
                  {isEditMode && (
                    <div
                      className="shrink-0 mr-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleContactSelection(contact.id);
                      }}
                    >
                      {selectedContactIds.has(contact.id) ? (
                        <CheckSquare className="w-5 h-5 text-emerald-600" />
                      ) : (
                        <Square className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                  )}
                  <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 shadow-sm">
                    {contact.avatarUrl || contact.avatar_url || contact.avatar ? (
                      <img src={contact.avatarUrl || contact.avatar_url || contact.avatar} alt={contact.name} className="w-full h-full object-cover" />
                    ) : (
                      <div
                        className={`w-full h-full flex items-center justify-center text-white font-bold text-sm bg-gradient-to-br from-white/10 to-black/25 ${getAvatarColor(
                          contact.name
                        )}`}
                      >
                        {getInitials(contact.name)}
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-start justify-between gap-1 mb-0.5">
                      <h4
                        className={`text-sm font-semibold truncate ${selectedContact === contact.id ? "text-emerald-900" : "text-gray-900"
                          }`}
                      >
                        {contact.name}
                      </h4>
                      {contact.timestamp && (
                        <span className="text-xs text-gray-400 shrink-0 leading-tight text-right whitespace-nowrap">
                          {formatContactTime(contact.timestamp)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs text-gray-500 truncate">
                        {contact.lastMessage || "(tanpa teks)"}
                      </p>
                      {contact.unread && (
                        <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full shrink-0 animate-pulse" />
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Main Chat Pane */}
      <div
        className={`flex-1 min-h-0 flex flex-col bg-[#efeae2] relative overflow-hidden ${selectedContact ? "flex" : "hidden md:flex"
          }`}
      >
        {/* Background Overlay to mimic whatsapp doodle */}
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none bg-[radial-gradient(#1e3a2f_1px,transparent_1px)] [background-size:16px_16px]"></div>

        {selectedContact ? (
          <>
            {/* Header */}
            <div className="bg-white px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 flex items-center justify-between shadow-sm z-10">
              <div className="flex items-center gap-2 md:gap-3 min-w-0">
                {/* Back button to list on mobile */}
                <button
                  type="button"
                  onClick={() => setSelectedContact(null)}
                  aria-label="Kembali ke daftar percakapan"
                  className="p-1.5 hover:bg-gray-100 rounded-lg md:hidden text-gray-500 shrink-0"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 shadow-sm">
                  {currentContact?.avatarUrl || currentContact?.avatar_url || currentContact?.avatar ? (
                    <img src={currentContact.avatarUrl || currentContact.avatar_url || currentContact.avatar} alt={currentContact.name} className="w-full h-full object-cover" />
                  ) : (
                    <div
                      className={`w-full h-full flex items-center justify-center text-white font-bold text-sm bg-gradient-to-br from-white/10 to-black/25 ${getAvatarColor(
                        currentContact?.name || ""
                      )}`}
                    >
                      {getInitials(currentContact?.name || "")}
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 leading-snug">
                    {currentContact?.name}
                  </h4>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatPhoneNumber(currentContact?.phone || "")}
                  </p>
                  <span className="sr-only">Realtime: {realtimeState}</span>
                  {realtimeState !== "SUBSCRIBED" && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700" role="status">
                      <RotateCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                      Memperbarui koneksi…
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-full shadow-sm">
                <Coins className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-xs font-semibold text-emerald-700">
                  {tokenBalance} Token
                </span>
              </div>
            </div>

            {/* Chat Area */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 z-10 relative"
            >
              {!conversationState.hasData && (loading || conversationState.loading) ? (
                <div className="flex items-center justify-center h-full" role="status" aria-label="Memuat pesan">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
                </div>
              ) : !conversationState.hasData && conversationState.error ? (
                <div className="flex h-full items-center justify-center p-4" role="alert">
                  <div className="max-w-sm rounded-xl border border-red-200 bg-white/95 p-5 text-center shadow-sm">
                    <AlertTriangle className="mx-auto h-7 w-7 text-red-500" />
                    <p className="mt-2 text-sm font-semibold text-slate-800">Pesan belum dapat dimuat.</p>
                    <button type="button" onClick={() => void loadMessages(selectedContact)} className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white">Coba Lagi</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {conversationState.error && (
                    <div className="sticky top-0 z-20 mx-auto flex max-w-lg flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/95 p-3 text-xs text-amber-800 shadow-sm" role="status">
                      <span>Pesan terakhir ditampilkan. Gagal memperbarui.</span>
                      <button type="button" onClick={() => void reconcileMessages()} className="font-bold hover:underline">Coba Lagi</button>
                    </div>
                  )}
                  {hasOlderMessages && (
                    <div className="flex justify-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void loadOlderMessages()}
                        disabled={loadingOlderMessages}
                        className="bg-white/90 text-xs"
                      >
                        {loadingOlderMessages ? "Memuat…" : "Muat pesan sebelumnya"}
                      </Button>
                    </div>
                  )}
                  {messages.length === 0 && (
                    <div className="py-16 text-center text-sm text-slate-500">
                      <MessageCircle className="mx-auto mb-3 h-10 w-10 text-slate-400 opacity-50" />
                      <p className="font-semibold">Belum ada pesan.</p>
                      <p className="mt-1 text-xs">Mulai percakapan saat siap.</p>
                    </div>
                  )}
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex flex-col ${message.sender === "user" ? "items-end" : "items-start"
                        }`}
                    >
                      <div
                        className={`max-w-[70%] rounded-2xl shadow-sm ${message.messageType === "sticker"
                          ? "bg-transparent shadow-none"
                          : message.messageType === "reaction"
                            ? "bg-slate-100/90 text-slate-800 border border-slate-200 px-3 py-1 rounded-full"
                            : message.sender === "user"
                              ? "bg-[#d9fdd3] text-[#111b21] rounded-tr-none px-4 py-2.5"
                              : "bg-white text-[#111b21] rounded-tl-none border border-[#e9e5db] px-4 py-2.5"
                          }`}
                      >
                        {(() => {
                          const payloadObj = (() => {
                            let p = message.payload;
                            if (typeof p === "string") {
                              try { p = JSON.parse(p); } catch { }
                            }
                            return p;
                          })();
                          const imageId = payloadObj?.image?.id || payloadObj?.id;
                          const imageCaption = payloadObj?.image?.caption || payloadObj?.caption || "";
                          const documentData = payloadObj?.document || {};
                          const documentId = documentData?.id || (message.messageType === "document" ? payloadObj?.id : null);
                          const documentName = documentData?.filename || documentData?.file_name || "Dokumen";
                          const documentCaption = documentData?.caption || payloadObj?.caption || "";
                          const documentMimeType = documentData?.mime_type || payloadObj?.mime_type || "";
                          if (message.messageType === "image" && imageId) {
                            return (
                              <div className="flex flex-col gap-1.5">
                                <SecureMediaImage
                                  mediaId={imageId}
                                  numberId={numberId}
                                  alt="Media"
                                  className="rounded-lg max-w-full max-h-64 object-contain cursor-pointer hover:opacity-95 transition-opacity"
                                  fallbackText="[Gambar (Gagal dimuat)]"
                                />
                                {imageCaption && (
                                  <p className="text-[14px] leading-relaxed mt-1">{imageCaption}</p>
                                )}
                              </div>
                            );
                          } else if (message.messageType === "document") {
                            return (
                              <div className="flex flex-col gap-2 min-w-[240px] max-w-full">
                                <div className="flex items-center gap-3 rounded-xl border border-black/10 bg-black/[0.035] p-3">
                                  <div className="w-10 h-10 rounded-lg bg-white/80 flex items-center justify-center shrink-0 border border-black/5">
                                    <FileText className="w-5 h-5 text-slate-600" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-slate-800 truncate" title={documentName}>
                                      {documentName}
                                    </p>
                                    <p className="text-[11px] text-slate-500 truncate">
                                      {documentMimeType || "Dokumen WhatsApp"}
                                    </p>
                                  </div>
                                  {documentId && (
                                    <SecureDocumentLink
                                      mediaId={documentId}
                                      numberId={numberId}
                                      fileName={documentName}
                                    />
                                  )}
                                </div>
                                {documentCaption && (
                                  <p className="text-[14px] whitespace-pre-wrap leading-relaxed">{documentCaption}</p>
                                )}
                                {!documentId && (
                                  <p className="text-xs text-slate-500 italic">Dokumen tidak dapat dimuat.</p>
                                )}
                              </div>
                            );
                          } else if (message.messageType === "sticker") {
                            const stickerId = payloadObj?.sticker?.id || payloadObj?.id;
                            return stickerId ? (
                              <SecureMediaImage
                                mediaId={stickerId}
                                numberId={numberId}
                                alt="Sticker"
                                className="w-28 h-28 object-contain rounded-lg hover:scale-105 transition-transform cursor-pointer"
                                fallbackText="[Stiker]"
                              />
                            ) : (
                              <span className="text-slate-500 italic text-xs">[Stiker]</span>
                            );
                          } else if (message.messageType === "reaction") {
                            const emoji = payloadObj?.reaction?.emoji || "❤️";
                            return (
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                                <span>Mereaksi:</span>
                                <span className="text-base leading-none select-none">{emoji}</span>
                              </div>
                            );
                          } else {
                            return (
                              <p className="text-[14px] whitespace-pre-wrap leading-relaxed">
                                {message.content}
                              </p>
                            );
                          }
                        })()}
                      </div>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 mt-1.5 px-1 font-medium">
                        <span>{formatMessageTime(message.timestamp)}</span>
                        {message.sender === "user" && <MessageStatus status={message.status} />}
                      </span>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}

              {showScrollBottomBtn && (
                <button
                  onClick={() => scrollToBottom(true)}
                  className="sticky bottom-4 left-1/2 -translate-x-1/2 bg-white/95 hover:bg-white text-gray-700 shadow-md border border-gray-200 rounded-full px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium backdrop-blur transition-all hover:scale-105 z-20"
                >
                  <ChevronDown className="w-4 h-4 text-emerald-600 animate-bounce" />
                  <span>Pesan terbaru</span>
                </button>
              )}
            </div>

            {/* Input Bar */}
            <div className="bg-white p-4 border-t border-gray-200 relative flex flex-col gap-2 shadow-[0_-2px_10px_rgba(0,0,0,0.02)] z-10">
              {showEmojiPicker && isWithin24Hours && (
                <div className="absolute bottom-20 left-4 z-50 bg-white border border-gray-200 rounded-2xl shadow-xl w-72 p-3 flex flex-col h-56 transition-all duration-300">
                  <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-gray-100">
                    <span className="text-xs font-bold text-gray-500">Pilih Emoji</span>
                    <button
                      onClick={() => setShowEmojiPicker(false)}
                      className="text-gray-400 hover:text-gray-600 text-xs font-bold"
                    >
                      Tutup
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-1">
                    <div className="space-y-4 p-1">
                      {EMOJI_CATEGORIES.map((cat) => (
                        <div key={cat.name} className="space-y-1.5">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                            {cat.name}
                          </span>
                          <div className="grid grid-cols-6 gap-2 text-xl">
                            {cat.emojis.map((emoji) => (
                              <button
                                key={emoji}
                                onClick={() => handleAddEmoji(emoji)}
                                className="hover:bg-gray-100 p-1 rounded-lg transition-all text-center active:scale-90"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                {isWithin24Hours ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      className={`text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-full shrink-0 ${showEmojiPicker ? "text-emerald-600 bg-emerald-50" : ""
                        }`}
                    >
                      <Smile className="w-5 h-5" />
                    </Button>

                    <Input
                      placeholder="Tulis pesan..."
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                      className="flex-1 bg-gray-50 border-gray-200 focus:bg-white rounded-full px-4 text-sm transition-all focus:ring-1 focus:ring-emerald-500"
                    />

                    <Button
                      onClick={handleSendMessage}
                      className="bg-emerald-600 hover:bg-[#152920] text-white rounded-full p-2.5 w-10 h-10 flex items-center justify-center shadow-md shrink-0 transition-transform active:scale-95"
                      disabled={sending || !messageInput.trim()}
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="relative flex-1 flex items-center">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                      <Input
                        placeholder="Chat manual terkunci (> 24 jam). Pilih Template Pesan ->"
                        disabled
                        className="w-full bg-slate-100/80 border-slate-200 rounded-full pl-9 pr-4 text-xs italic text-slate-500 cursor-not-allowed"
                      />
                    </div>

                    <Button
                      onClick={openTemplateModal}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full px-4 py-2 flex items-center gap-2 font-semibold shadow-md shrink-0 transition-all text-xs"
                    >
                      <FileText className="w-4 h-4" />
                      Pilih Template Pesan
                    </Button>
                  </>
                )}
              </div>

              <div className="flex justify-between items-center px-2">
                <span className={`text-[11px] font-medium ${isWithin24Hours ? "text-emerald-600" : "text-gray-400"}`}>
                  {isWithin24Hours ? "✅ Bebas Token (Gratis balasan dalam 24 jam)" : "💰 Menggunakan 1 token per pengiriman"}
                </span>
                {tokenBalance <= 10 && tokenBalance > 0 && (
                  <span className="text-[11px] text-amber-600 font-semibold animate-pulse">
                    ⚠️ Token hampir habis!
                  </span>
                )}
                {tokenBalance === 0 && (
                  <span className="text-[11px] text-rose-600 font-bold">
                    🚫 Token habis. Silakan top-up.
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center z-10">
            <div className="text-center text-gray-400">
              <MessageCircle className="w-16 h-16 mx-auto mb-4 opacity-30 text-emerald-600" />
              <p className="font-semibold text-gray-500">Pilih kontak untuk memulai percakapan</p>
              <p className="text-xs text-gray-400 mt-1">Gunakan panel kiri untuk mencari atau memilih kontak</p>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <AppModal
        open={deleteConfirmOpen}
        title="Hapus Percakapan"
        description={`Apakah Anda yakin ingin menghapus ${selectedContactIds.size} percakapan terpilih? Tindakan ini tidak dapat dibatalkan.`}
        onClose={() => setDeleteConfirmOpen(false)}
      >
        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="outline"
            onClick={() => setDeleteConfirmOpen(false)}
            className="rounded-lg text-sm font-medium border-slate-200"
          >
            Batal
          </Button>
          <Button
            onClick={executeDeleteSelected}
            className="bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium border-none shadow-sm"
          >
            Hapus
          </Button>
        </div>
      </AppModal>

      {/* Template Selection Modal for >24h CS Window */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div ref={templateDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="chat-template-title" className="w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col max-h-[85dvh] overflow-hidden border border-slate-100">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 id="chat-template-title" className="font-bold text-slate-800 text-sm">Pilih Template Pesan Meta</h3>
                  <p className="text-[11px] text-slate-500">Wajib untuk pesan &gt; 24 jam</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Tutup pemilih template"
                onClick={() => {
                  setShowTemplateModal(false);
                  setSelectedTemplate(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {loadingTemplates || templateLoadState === "loading" ? (
                <div className="py-12 text-center text-slate-500 flex flex-col items-center gap-3">
                  <RotateCw className="w-7 h-7 animate-spin text-emerald-600" />
                  <span className="text-xs font-semibold text-slate-600">Memuat template disetujui Meta...</span>
                </div>
              ) : templateLoadState === "error" ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center" role="alert">
                  <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
                  <p className="mt-2 text-sm font-semibold text-slate-800">Template belum dapat dimuat.</p>
                  <p className="mt-1 text-xs text-slate-600">Silakan coba kembali tanpa menutup percakapan.</p>
                  <button type="button" onClick={() => void loadApprovedTemplates()} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white">
                    <RotateCw className="h-3.5 w-3.5" /> Coba Lagi
                  </button>
                </div>
              ) : !selectedTemplate ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">
                    Silakan pilih salah satu template approved di bawah ini untuk dikirim ke kontak:
                  </p>
                  {templatesList.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                      <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-amber-500" />
                      <p className="font-semibold text-slate-700 text-sm">Belum ada template yang siap digunakan.</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Buat atau sinkronkan template terlebih dahulu pada menu Template Pesan.
                      </p>
                      {onViewTemplates && (
                        <button type="button" onClick={() => { setShowTemplateModal(false); onViewTemplates(); }} className="mt-3 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50">
                          Lihat Template
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {templatesList.map((tpl) => (
                        <button
                          key={tpl.id}
                          onClick={() => handleSelectTemplate(tpl)}
                          className="w-full p-3.5 rounded-xl border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40 text-left transition-all space-y-1.5 group bg-white shadow-xs hover:shadow-sm"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-sm text-slate-800 group-hover:text-emerald-900">
                              {tpl.name}
                            </span>
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                              {tpl.language || "id"}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                            {tpl.content || "(Tidak ada sampel isi teks)"}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <button
                    onClick={() => setSelectedTemplate(null)}
                    className="text-xs text-emerald-600 font-bold hover:underline flex items-center gap-1"
                  >
                    ← Kembali pilih template lain
                  </button>

                  <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1.5">
                    <span className="text-xs font-bold text-slate-800 block">
                      Template: {selectedTemplate.name}
                    </span>
                    <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                      {selectedTemplate.content}
                    </p>
                  </div>

                  {/* Template Variable Inputs */}
                  {templateVarValues.length > 0 && (
                    <div className="space-y-3 bg-emerald-50/60 p-4 border border-emerald-200/70 rounded-xl">
                      <span className="text-xs font-bold text-emerald-950 block">
                        Isi Variabel Pesan ({templateVarValues.length}):
                      </span>
                      {templateVarValues.map((_, idx) => (
                        <div key={idx}>
                          <label className="text-[11px] font-semibold text-slate-600 mb-1 block">
                            Variabel `{"{{" + (idx + 1) + "}}"}`
                          </label>
                          <Input
                            placeholder={`Masukkan nilai untuk {{${idx + 1}}}`}
                            value={templateVarValues[idx] || ""}
                            onChange={(e) => {
                              const newVars = [...templateVarValues];
                              newVars[idx] = e.target.value;
                              setTemplateVarValues(newVars);
                            }}
                            aria-invalid={!templateVarValues[idx]?.trim()}
                            aria-describedby={`template-variable-error-${idx}`}
                            className={`bg-white text-xs ${!templateVarValues[idx]?.trim() ? "border-red-300 focus-visible:ring-red-400" : ""}`}
                          />
                          {!templateVarValues[idx]?.trim() && (
                            <p id={`template-variable-error-${idx}`} className="mt-1 text-[11px] font-medium text-red-600" role="alert">
                              Variabel ini wajib diisi.
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedTemplateRequiresMedia && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" role="alert">
                      Template ini memerlukan media header. Pengiriman template media belum tersedia dari Chat.
                    </div>
                  )}

                  {/* Message Preview */}
                  <div className="p-3.5 bg-emerald-100/70 border border-emerald-200/80 rounded-xl text-xs space-y-1">
                    <span className="font-bold text-emerald-950 block">Preview Pesan:</span>
                    <p className="text-emerald-950 font-medium whitespace-pre-wrap leading-relaxed">
                      {buildTemplatePreview(selectedTemplate.content, templateVarValues)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-t border-slate-100">
              <span className={`text-[11px] font-medium ${isWithin24Hours ? "text-emerald-600" : "text-slate-500"}`}>
                {isWithin24Hours ? "✅ Bebas Token (Gratis balasan dalam window 24 jam)" : "💰 Memotong 1 token per pengiriman"}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowTemplateModal(false);
                    setSelectedTemplate(null);
                  }}
                  disabled={sendingTemplate}
                  className="rounded-lg text-xs"
                >
                  Batal
                </Button>
                {selectedTemplate && (
                  <Button
                    onClick={handleExecuteSendTemplate}
                    disabled={sendingTemplate || !templatePrerequisitesValid}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold"
                  >
                    {sendingTemplate ? "Mengirim..." : "Kirim Template"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageCircle({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

function Coins({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
