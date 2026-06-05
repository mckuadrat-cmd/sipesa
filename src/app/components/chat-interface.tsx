import { useState, useEffect, useRef } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { ArrowLeft, Send, Search, Phone, Smile } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";

interface Message {
  id: string;
  content: string;
  sender: "user" | "contact";
  timestamp: string;
  contactName?: string;
  messageType?: string;
  payload?: any;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  lastMessage: string;
  timestamp: string;
  unread: boolean;
}

interface ChatInterfaceProps {
  numberId: string;
  numberName: string;
  onBack: () => void;
}

const EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🤔", "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "🤐", "🥴",
  "👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "✋", "🤚", "🖐", "🖖", "👋", "✍️", "👏", "🙌", "👐", "🙏", "🤝",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝"
];

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

    const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
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

export function ChatInterface({ numberId, numberName, onBack }: ChatInterfaceProps) {
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadContacts();
    loadTokenBalance();

    const interval = setInterval(() => {
      loadContacts();
      loadTokenBalance();
    }, 5000);

    return () => clearInterval(interval);
  }, [numberId]);

  useEffect(() => {
    if (selectedContact) {
      loadMessages();
    } else {
      setMessages([]);
    }

    const interval = setInterval(() => {
      if (selectedContact) {
        pollMessages();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [selectedContact, numberId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
    try {
      const result = await api.getContacts(numberId);
      if (!result.success) return;
      setContacts(result.data);
    } catch (error) {
      console.error("Error loading contacts:", error);
    }
  };

  const loadMessages = async () => {
    if (!selectedContact) return;

    setLoading(true);
    try {
      const result = await api.getMessages(numberId, selectedContact);
      if (!result.success) return;
      setMessages(result.data);
    } catch (error) {
      console.error("Error loading messages:", error);
    } finally {
      setLoading(false);
    }
  };

  const pollMessages = async () => {
    if (!selectedContact) return;
    try {
      const result = await api.getMessages(numberId, selectedContact);
      if (!result.success) return;
      setMessages(result.data);
    } catch (error) {
      console.error("Error polling messages:", error);
    }
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedContact) return;

    if (tokenBalance <= 0) {
      toast.warning("Token Anda habis! Silakan top-up terlebih dahulu untuk mengirim pesan.");
      return;
    }

    setSending(true);
    try {
      const result = await api.sendMessage(numberId, selectedContact, messageInput);

      if ("error" in result) {
        if (result.error.toLowerCase().includes("token")) {
          toast.warning("Token Anda habis! Silakan top-up terlebih dahulu.");
        } else {
          toast.error("Gagal mengirim pesan: " + result.error);
        }
        return;
      }

      setMessages((prev) => [...prev, result.data]);
      setMessageInput("");
      setTokenBalance(Number(result.tokensRemaining ?? tokenBalance));
      setShowEmojiPicker(false);

      if (result.tokensRemaining < 100) {
        toast.success("Pesan terkirim!", {
          description: `⚠️ Token tersisa: ${result.tokensRemaining}. Segera top-up!`,
        });
      } else {
        toast.success(`Pesan terkirim! Token tersisa: ${result.tokensRemaining}`);
      }

      loadMessages();
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
    <div style={{ display: "flex", height: "calc(100vh - 64px)", overflow: "hidden" }} className="bg-white text-gray-800">
      {/* Sidebar */}
      <div style={{ width: "360px", flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }} className="border-r border-gray-200 bg-white">
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

          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-500">
              {filteredContacts.length} percakapan
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                loadContacts();
                loadTokenBalance();
                if (selectedContact) {
                  loadMessages();
                }
                toast.success("Pesan diperbarui");
              }}
              className="text-xs bg-[#1e3a2f] text-white hover:bg-[#152920] hover:text-white px-3 py-1 h-7 border-none rounded-lg shadow-sm font-semibold transition-all"
            >
              Refresh
            </Button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
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
            {filteredContacts.length === 0 ? (
              <p className="text-center text-xs text-gray-400 py-8">Tidak ada percakapan ditemukan</p>
            ) : (
              filteredContacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => {
                    setSelectedContact(contact.id);
                    setContacts((prev) =>
                      prev.map((c) => (c.id === contact.id ? { ...c, unread: false } : c))
                    );
                  }}
                  className={`w-full px-3 py-3 rounded-xl text-left transition-all duration-200 flex items-center gap-3 ${
                    selectedContact === contact.id
                      ? "bg-emerald-50 border border-emerald-100 shadow-sm"
                      : "hover:bg-gray-50 border border-transparent"
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 text-sm shadow-sm ${getAvatarColor(
                      contact.name
                    )}`}
                  >
                    {getInitials(contact.name)}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-start justify-between gap-1 mb-0.5">
                      <h4
                        className={`text-sm font-semibold truncate ${
                          selectedContact === contact.id ? "text-emerald-900" : "text-gray-900"
                        }`}
                      >
                        {contact.name}
                      </h4>
                      {contact.timestamp && (
                        <span className="text-[10px] text-gray-400 shrink-0 leading-tight text-right whitespace-nowrap">
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
      <div className="flex-1 min-h-0 flex flex-col bg-[#efeae2] relative overflow-hidden">
        {/* Background Overlay to mimic whatsapp doodle */}
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none bg-[radial-gradient(#1e3a2f_1px,transparent_1px)] [background-size:16px_16px]"></div>

        {selectedContact ? (
          <>
            {/* Header */}
            <div className="bg-white px-6 py-4 border-b border-gray-200 flex items-center justify-between shadow-sm z-10">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm ${getAvatarColor(
                    currentContact?.name || ""
                  )}`}
                >
                  {getInitials(currentContact?.name || "")}
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 leading-snug">
                    {currentContact?.name}
                  </h4>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatPhoneNumber(currentContact?.phone || "")}
                  </p>
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
            <ScrollArea className="flex-1 min-h-0 p-6 z-10">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
                </div>
              ) : (
                <div className="space-y-6">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex flex-col ${
                        message.sender === "user" ? "items-end" : "items-start"
                      }`}
                    >
                      <div
                        className={`max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm ${
                          message.sender === "user"
                            ? "bg-[#d9fdd3] text-[#111b21] rounded-tr-none"
                            : "bg-white text-[#111b21] rounded-tl-none border border-[#e9e5db]"
                        }`}
                      >
                        {(() => {
                          const payloadObj = (() => {
                            let p = message.payload;
                            if (typeof p === "string") {
                              try { p = JSON.parse(p); } catch {}
                            }
                            return p;
                          })();
                          const imageId = payloadObj?.image?.id || payloadObj?.id;
                          const imageCaption = payloadObj?.image?.caption || payloadObj?.caption || "";

                          return message.messageType === "image" && imageId ? (
                            <div className="flex flex-col gap-1.5">
                              <img
                                src={api.getMediaUrl(imageId, numberId)}
                                alt="Media"
                                className="rounded-lg max-w-full max-h-64 object-contain cursor-pointer hover:opacity-95 transition-opacity"
                                onClick={() => window.open(api.getMediaUrl(imageId, numberId), '_blank')}
                              />
                              {imageCaption && (
                                <p className="text-[14px] leading-relaxed mt-1">{imageCaption}</p>
                              )}
                            </div>
                          ) : (
                            <p className="text-[14px] whitespace-pre-wrap leading-relaxed">
                              {message.content}
                            </p>
                          );
                        })()}
                      </div>
                      <span className="text-[10px] text-gray-500 mt-1.5 px-1 font-medium">
                        {formatMessageTime(message.timestamp)}
                      </span>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* Input Bar */}
            <div className="bg-white p-4 border-t border-gray-200 relative flex flex-col gap-2 shadow-[0_-2px_10px_rgba(0,0,0,0.02)] z-10">
              {showEmojiPicker && (
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
                  <ScrollArea className="flex-1">
                    <div className="grid grid-cols-6 gap-2 text-xl max-h-40 p-1">
                      {EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => handleAddEmoji(emoji)}
                          className="hover:bg-gray-100 p-1 rounded-lg transition-all text-center active:scale-90"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className={`text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-full shrink-0 ${
                    showEmojiPicker ? "text-emerald-600 bg-emerald-50" : ""
                  }`}
                >
                  <Smile className="w-5 h-5" />
                </Button>

                <Input
                  placeholder="Type a message..."
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
              </div>

              <div className="flex justify-between items-center px-2">
                <span className="text-[11px] text-gray-400 font-medium">
                  💰 Setiap pesan memotong 1 token (Rp 1.500)
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