import { useState, useEffect, useMemo, useRef } from "react";
import { Card } from "./ui/card";
import { AppModal } from "./AppModal";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Download,
  Upload,
  User,
  Users,
  X,
  Loader2,
  FileSpreadsheet,
} from "lucide-react";
import { api } from "../lib/api";
import { toast } from "sonner";

interface Contact {
  id: string;
  name: string;
  phone: string;
  createdAt?: string;
  updatedAt?: string;
}

const PAGE_SIZE = 10;

export function ContactListView({ user }: { user?: any }) {
  const labelsKey = user?.org_id ? `sipesa_contact_labels_${user.org_id}` : "sipesa_contact_labels";
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // Labels and selection states
  const [contactLabels, setContactLabels] = useState<Record<string, string>>({});
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [showBulkLabelModal, setShowBulkLabelModal] = useState(false);
  const [bulkLabelText, setBulkLabelText] = useState("");
  const [selectedFilterLabel, setSelectedFilterLabel] = useState("all");

  const uniqueLabels = useMemo(() => {
    const labelsSet = new Set<string>();
    Object.values(contactLabels).forEach((lbl) => {
      if (lbl && lbl.trim()) labelsSet.add(lbl.trim());
    });
    return Array.from(labelsSet).sort();
  }, [contactLabels]);

  // Modals state
  const [showFormModal, setShowFormModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  // Form states
  const [formData, setFormData] = useState({ name: "", phone: "", label: "" });
  const [formSaving, setFormSaving] = useState(false);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<{ id: string; name: string } | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  // Import CSV states
  const [importFile, setImportFile] = useState<File | null>(null);
  const [parsedContacts, setParsedContacts] = useState<Array<{ name: string; phone: string; label?: string }>>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadContactLabels = () => {
    try {
      let labelsStr = localStorage.getItem(labelsKey);
      if (!labelsStr) {
        const oldLabels = localStorage.getItem("sipesa_contact_labels");
        if (oldLabels) {
          localStorage.setItem(labelsKey, oldLabels);
          labelsStr = oldLabels;
        }
      }
      const labels = JSON.parse(labelsStr || "{}");
      setContactLabels(labels);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadContacts();
    loadContactLabels();
  }, []);

  const loadContacts = async () => {
    setLoading(true);
    try {
      const result = await api.getOrgContacts();
      if (result.success && Array.isArray(result.data)) {
        setContacts(result.data);
      } else if ("error" in result) {
        toast.error("Gagal memuat kontak: " + result.error);
      }
    } catch (err) {
      console.error("Error loading contacts:", err);
      toast.error("Gagal memuat kontak");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddModal = () => {
    setEditingContact(null);
    setFormData({ name: "", phone: "", label: "" });
    setShowFormModal(true);
  };

  const handleOpenEditModal = (contact: Contact) => {
    setEditingContact(contact);
    setFormData({
      name: contact.name,
      phone: contact.phone,
      label: contactLabels[contact.phone] || "",
    });
    setShowFormModal(true);
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = formData.name.trim();
    const phone = formData.phone.trim().replace(/\D/g, "");
    const label = formData.label.trim();

    if (!name) {
      toast.error("Nama kontak harus diisi");
      return;
    }
    if (!phone) {
      toast.error("Nomor telepon harus diisi");
      return;
    }

    setFormSaving(true);
    try {
      let result;
      if (editingContact) {
        result = await api.updateContact(editingContact.id, { name, phone });
      } else {
        result = await api.createContact({ name, phone });
      }

      if (result.success) {
        const savedPhone = result.data?.phone || phone;
        const newLabels = { ...contactLabels };
        if (editingContact && editingContact.phone !== savedPhone) {
          delete newLabels[editingContact.phone];
        }
        newLabels[savedPhone] = label;
        localStorage.setItem(labelsKey, JSON.stringify(newLabels));
        setContactLabels(newLabels);

        toast.success(editingContact ? "Kontak berhasil diperbarui" : "Kontak berhasil ditambahkan");
        setShowFormModal(false);
        setFormData({ name: "", phone: "", label: "" });
        setEditingContact(null);
        await loadContacts();
      } else {
        const errorMsg = "error" in result ? result.error : "Terjadi kesalahan";
        toast.error("Gagal menyimpan kontak: " + errorMsg);
      }
    } catch (error) {
      console.error("Error saving contact:", error);
      toast.error("Terjadi kesalahan saat menyimpan kontak");
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeleteContact = (contactId: string, name: string) => {
    setContactToDelete({ id: contactId, name });
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDeleteSingle = async () => {
    if (!contactToDelete) return;
    try {
      const result = await api.deleteContact(contactToDelete.id);
      if (result.success) {
        toast.success("Kontak berhasil dihapus");
        setDeleteConfirmOpen(false);
        setContactToDelete(null);
        await loadContacts();
      } else {
        const errorMsg = "error" in result ? result.error : "Terjadi kesalahan";
        toast.error("Gagal menghapus kontak: " + errorMsg);
      }
    } catch (err) {
      console.error("Error deleting contact:", err);
      toast.error("Terjadi kesalahan saat menghapus kontak");
    }
  };

  // CSV parsing logic (Client side)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
      if (lines.length < 2) {
        toast.error("File CSV kosong atau tidak valid");
        return;
      }

      const parseCsvLine = (line: string): string[] => {
        const out: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          const next = line[i + 1];
          if (ch === '"') {
            if (inQuotes && next === '"') {
              current += '"';
              i++;
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
      };

      const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
      const nameIndex = headers.findIndex((h) => ["nama", "name", "display_name", "display name", "contact"].includes(h));
      const phoneIndex = headers.findIndex((h) => ["nomor", "phone", "telepon", "no hp", "phone_number"].includes(h));
      const labelIndex = headers.findIndex((h) => ["label", "tag", "labels", "tags"].includes(h));

      if (phoneIndex === -1) {
        toast.error("Kolom nomor telepon tidak ditemukan. Gunakan header 'Nomor' atau 'Phone'");
        return;
      }

      const list: Array<{ name: string; phone: string; label?: string }> = [];
      const seen = new Set<string>();

      for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        let phoneVal = String(row[phoneIndex] || "").trim().replace(/[^\d+]/g, "");
        if (!phoneVal) continue;

        if (phoneVal.startsWith("+")) phoneVal = phoneVal.slice(1);
        if (phoneVal.startsWith("0")) phoneVal = `62${phoneVal.slice(1)}`;
        if (phoneVal.startsWith("8")) phoneVal = `62${phoneVal}`;

        if (seen.has(phoneVal)) continue;
        seen.add(phoneVal);

        const nameVal = nameIndex !== -1 ? String(row[nameIndex] || "").trim() : phoneVal;
        const labelVal = labelIndex !== -1 ? String(row[labelIndex] || "").trim() : "";
        list.push({ name: nameVal || phoneVal, phone: phoneVal, label: labelVal });
      }

      setParsedContacts(list);
    };
    reader.readAsText(file);
  };

  const handleBulkImport = async () => {
    if (parsedContacts.length === 0) return;
    setImporting(true);

    let successCount = 0;
    let failCount = 0;

    try {
      const newLabels = { ...contactLabels };
      
      const existingContactsMap = new Map<string, string>(); // normPhone -> id
      contacts.forEach(c => {
        const norm = String(c.phone).replace(/\D/g, "");
        existingContactsMap.set(norm, c.id);
      });

      for (const item of parsedContacts) {
        const normPhone = String(item.phone).replace(/\D/g, "");
        const existingId = existingContactsMap.get(normPhone);

        let result;
        if (existingId) {
          result = await api.updateContact(existingId, { name: item.name, phone: item.phone });
        } else {
          result = await api.createContact({ name: item.name, phone: item.phone });
        }

        if (result.success) {
          successCount++;
          if (item.label) {
            const savedPhone = result.data?.phone || item.phone;
            newLabels[savedPhone] = item.label;
          }
        } else {
          failCount++;
        }
      }

      localStorage.setItem(labelsKey, JSON.stringify(newLabels));
      setContactLabels(newLabels);

      toast.success(`Berhasil mengimport ${successCount} kontak. Gagal: ${failCount}`);
      setShowImportModal(false);
      setImportFile(null);
      setParsedContacts([]);
      await loadContacts();
    } catch (err) {
      console.error("Error bulk importing contacts:", err);
      toast.error("Gagal melakukan import kontak secara massal");
    } finally {
      setImporting(false);
    }
  };

  const handleBulkDelete = () => {
    setBulkDeleteConfirmOpen(true);
  };

  const handleConfirmBulkDelete = async () => {
    setBulkDeleteConfirmOpen(false);
    setDeletingBulk(true);
    let successCount = 0;
    let failCount = 0;

    try {
      const newLabels = { ...contactLabels };
      for (const contactId of selectedContactIds) {
        const contact = contacts.find((c) => c.id === contactId);
        const res = await api.deleteContact(contactId);
        if (res.success) {
          successCount++;
          if (contact) {
            delete newLabels[contact.phone];
          }
        } else {
          failCount++;
        }
      }

      localStorage.setItem(labelsKey, JSON.stringify(newLabels));
      setContactLabels(newLabels);
      setSelectedContactIds([]);
      toast.success(`Berhasil menghapus ${successCount} kontak.${failCount > 0 ? ` Gagal: ${failCount}` : ""}`);
      await loadContacts();
    } catch (err) {
      console.error("Error bulk deleting contacts:", err);
      toast.error("Gagal menghapus kontak terpilih");
    } finally {
      setDeletingBulk(false);
    }
  };

  const handleExportCsv = () => {
    if (contacts.length === 0) {
      toast.error("Tidak ada kontak untuk diexport");
      return;
    }

    const headers = ["Nama", "Nomor", "Label"];
    const rows = contacts.map((c) => [
      c.name,
      c.phone,
      contactLabels[c.phone] || "",
    ].map(val => {
      let s = String(val ?? "");
      if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
      return s;
    }).join(","));

    const csvContent = [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `daftar-kontak-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Berhasil mendownload CSV daftar kontak");
  };

  // Instant search filter logic
  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      const q = searchQuery.toLowerCase();
      const label = (contactLabels[c.phone] || "").toLowerCase();
      const matchesSearch =
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        label.includes(q);
      const matchesLabelFilter =
        selectedFilterLabel === "all" ||
        label === selectedFilterLabel.toLowerCase();
      return matchesSearch && matchesLabelFilter;
    });
  }, [contacts, searchQuery, contactLabels, selectedFilterLabel]);

  // Pagination logic
  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / PAGE_SIZE));
  const paginatedContacts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredContacts.slice(start, start + PAGE_SIZE);
  }, [filteredContacts, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  return (
    <div className="w-full p-6 md:p-8 bg-white min-h-screen">
      
      {/* Header Section */}
      <div className="mb-8 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 leading-tight">Daftar Kontak</h1>
          <p className="text-sm text-slate-500 mt-1">
            Kelola daftar kontak penerima broadcast untuk sekolah Anda
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={handleExportCsv}
            className="border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </Button>

          <Button
            variant="outline"
            onClick={() => {
              setParsedContacts([]);
              setImportFile(null);
              setShowImportModal(true);
            }}
            className="border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </Button>

          <Button onClick={handleOpenAddModal} className="bg-primary hover:bg-primary/95 text-primary-foreground flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Tambah Kontak
          </Button>
        </div>
      </div>

      {/* Grid container with list/table */}
      <div className="grid grid-cols-1 gap-6">
        
        {/* Contacts card list */}
        <Card className="border border-slate-100 shadow-sm rounded-2xl overflow-hidden bg-white flex flex-col">
          <div className="px-6 py-4 border-b border-slate-50 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-base font-bold text-slate-800">Semua Kontak ({filteredContacts.length})</h3>
              <p className="text-xs text-slate-400 mt-0.5">Urutan abjad nama kontak</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              {/* Filter Label Dropdown */}
              <select
                value={selectedFilterLabel}
                onChange={(e) => {
                  setSelectedFilterLabel(e.target.value);
                  setCurrentPage(1);
                }}
                className="h-10 border border-slate-200 bg-white px-3 rounded-xl text-sm text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-transparent min-w-[140px] cursor-pointer"
              >
                <option value="all">Semua Label</option>
                {uniqueLabels.map((lbl) => (
                  <option key={lbl} value={lbl}>
                    {lbl}
                  </option>
                ))}
              </select>

              {/* Search Input */}
              <div className="relative w-full sm:max-w-xs flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <Input
                  placeholder="Cari nama, nomor, atau label..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-10 border-slate-200 rounded-xl focus-visible:ring-primary w-full text-sm"
                />
              </div>
            </div>
          </div>

          {/* Bulk Action Bar */}
          {selectedContactIds.length > 0 && (
            <div className="flex items-center gap-3 bg-primary/5 border-b border-slate-100 px-6 py-3 animate-in slide-in-from-top-2">
              <span className="text-xs font-semibold text-primary">
                {selectedContactIds.length} kontak terpilih
              </span>
              <Button
                size="sm"
                onClick={() => setShowBulkLabelModal(true)}
                className="bg-primary hover:bg-primary/95 text-white text-xs h-8 px-3 rounded-lg"
              >
                Ganti Label Massal
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={deletingBulk}
                className="bg-red-600 hover:bg-red-700 text-white text-xs h-8 px-3 rounded-lg flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deletingBulk ? "Menghapus..." : "Hapus Terpilih"}</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedContactIds([])}
                className="border-slate-200 text-slate-500 hover:bg-slate-50 text-xs h-8 px-3 rounded-lg"
              >
                Batal
              </Button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50/50">
                <tr className="border-b border-slate-100">
                  <th className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-400 w-10">
                    <input
                      type="checkbox"
                      checked={paginatedContacts.length > 0 && paginatedContacts.every(c => selectedContactIds.includes(c.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const newSelected = [...selectedContactIds];
                          paginatedContacts.forEach(c => {
                            if (!newSelected.includes(c.id)) newSelected.push(c.id);
                          });
                          setSelectedContactIds(newSelected);
                        } else {
                          setSelectedContactIds(
                            selectedContactIds.filter(id => !paginatedContacts.some(c => c.id === id))
                          );
                        }
                      }}
                      className="rounded border-slate-300 text-primary focus:ring-primary w-4 h-4 cursor-pointer"
                    />
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Nama Kontak</th>
                  <th className="px-6 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Nomor Telepon</th>
                  <th className="px-6 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Label</th>
                  <th className="px-6 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-slate-400">Tanggal Terdaftar</th>
                  <th className="px-6 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-slate-400">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        <span>Memuat daftar kontak...</span>
                      </div>
                    </td>
                  </tr>
                ) : paginatedContacts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                        <Users className="w-10 h-10 text-slate-200 mb-2" />
                        <h4 className="text-sm font-semibold text-slate-700">Kontak Tidak Ditemukan</h4>
                        <p className="text-xs text-slate-400 mt-1">
                          Belum ada kontak yang terdaftar atau tidak ada kontak yang cocok dengan kata kunci pencarian.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedContacts.map((contact) => (
                    <tr key={contact.id} className={`hover:bg-slate-50/50 transition-colors ${selectedContactIds.includes(contact.id) ? 'bg-primary/5 hover:bg-primary/5' : ''}`}>
                      <td className="px-4 py-4 whitespace-nowrap w-10">
                        <input
                          type="checkbox"
                          checked={selectedContactIds.includes(contact.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedContactIds([...selectedContactIds, contact.id]);
                            } else {
                              setSelectedContactIds(selectedContactIds.filter(id => id !== contact.id));
                            }
                          }}
                          className="rounded border-slate-300 text-primary focus:ring-primary w-4 h-4 cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 uppercase flex-shrink-0">
                            {contact.name.slice(0, 2)}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-slate-800">{contact.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 font-medium">
                        {contact.phone.startsWith("+") ? contact.phone : `+${contact.phone}`}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {contactLabels[contact.phone] ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 max-w-[160px] truncate animate-in fade-in duration-200" title={contactLabels[contact.phone]}>
                            {contactLabels[contact.phone]}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs italic">Tanpa Label</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-400">
                        {contact.createdAt
                          ? new Date(contact.createdAt).toLocaleDateString("id-ID", {
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            })
                          : "-"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenEditModal(contact)}
                            className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 rounded-lg"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteContact(contact.id, contact.name)}
                            className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination bar */}
          {filteredContacts.length > PAGE_SIZE && (
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">
                Menampilkan {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, filteredContacts.length)} dari{" "}
                {filteredContacts.length} kontak
              </span>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="rounded-lg h-8 px-3 text-xs"
                >
                  Sebelumnya
                </Button>
                <div className="text-xs font-semibold text-slate-600 min-w-[50px] text-center">
                  {currentPage} / {totalPages}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="rounded-lg h-8 px-3 text-xs"
                >
                  Selanjutnya
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* MODAL 1: ADD/EDIT FORM */}
      {showFormModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-auto">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-50">
              <h3 className="text-base font-bold text-slate-800">
                {editingContact ? "Edit Kontak" : "Tambah Kontak Baru"}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFormModal(false)}
                className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4.5 h-4.5" />
              </Button>
            </div>

            <form onSubmit={handleSaveContact} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="contact-name" className="text-slate-700">Nama Lengkap *</Label>
                <Input
                  id="contact-name"
                  placeholder="Contoh: Budi Santoso"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  className="rounded-xl border-slate-200 focus-visible:ring-primary h-11"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contact-phone" className="text-slate-700">Nomor WhatsApp *</Label>
                <Input
                  id="contact-phone"
                  placeholder="Contoh: 08123456789"
                  value={formData.phone}
                  onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                  className="rounded-xl border-slate-200 focus-visible:ring-primary h-11"
                  required
                />
                <p className="text-[10px] text-slate-400">
                  Nomor akan otomatis diformat ke standar internasional (contoh: 62812...).
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contact-label" className="text-slate-700">Label</Label>
                <Input
                  id="contact-label"
                  placeholder="Contoh: Kelas 10, Guru, Alumni"
                  value={formData.label}
                  onChange={(e) => setFormData((prev) => ({ ...prev, label: e.target.value }))}
                  className="rounded-xl border-slate-200 focus-visible:ring-primary h-11"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="submit"
                  disabled={formSaving}
                  className="flex-1 bg-primary hover:bg-primary/95 text-primary-foreground font-medium rounded-xl h-11"
                >
                  {formSaving ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Menyimpan...</span>
                    </div>
                  ) : (
                    <span>Simpan Kontak</span>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowFormModal(false)}
                  className="flex-1 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium rounded-xl h-11"
                >
                  Batal
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CSV IMPORT */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-auto">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-50">
              <h3 className="text-base font-bold text-slate-800">Import Kontak dari CSV</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowImportModal(false);
                  setImportFile(null);
                  setParsedContacts([]);
                }}
                className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4.5 h-4.5" />
              </Button>
            </div>

            <div className="p-6 space-y-4">
              {/* Instructions */}
              <div className="text-xs text-slate-500 bg-slate-50 p-4 rounded-xl space-y-1.5">
                <p className="font-semibold text-slate-700">Panduan Format File CSV:</p>
                <ul className="list-disc pl-4 space-y-1 text-[11px]">
                  <li>Baris pertama wajib merupakan nama kolom (header).</li>
                  <li>Wajib ada kolom <b>Nama</b> dan <b>Nomor</b> (nomor WhatsApp).</li>
                  <li>Contoh format: <code>Nama, Nomor</code></li>
                  <li>Contoh baris data: <code>Budi Santoso, 081234567890</code></li>
                </ul>
              </div>

              {/* Upload Zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-200 hover:border-primary/50 transition-colors rounded-xl p-8 bg-slate-50/50 flex flex-col items-center justify-center gap-2 cursor-pointer"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".csv"
                  className="hidden"
                />
                <FileSpreadsheet className="w-10 h-10 text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">
                  {importFile ? importFile.name : "Pilih File CSV"}
                </span>
                <span className="text-xs text-slate-400">
                  Klik untuk menelusuri file dari komputer Anda
                </span>
              </div>

              {/* Preview Zone */}
              {parsedContacts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-700">
                      Pratinjau Data ({parsedContacts.length} Kontak ditemukan)
                    </span>
                    <span className="text-slate-400">Menampilkan 5 pertama</span>
                  </div>
                  <div className="border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-100 text-xs">
                    {parsedContacts.slice(0, 5).map((pc, idx) => (
                      <div key={idx} className="flex justify-between px-4 py-2.5 bg-slate-50/20">
                        <span className="font-semibold text-slate-700 truncate pr-2">{pc.name}</span>
                        <span className="font-mono text-slate-500">
                          {pc.phone.startsWith("+") ? pc.phone : `+${pc.phone}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <Button
                  onClick={handleBulkImport}
                  disabled={importing || parsedContacts.length === 0}
                  className="flex-1 bg-primary hover:bg-primary/95 text-primary-foreground font-medium rounded-xl h-11"
                >
                  {importing ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Mengimport ({parsedContacts.length})...</span>
                    </div>
                  ) : (
                    <span>Mulai Import</span>
                  )}
                </Button>
                <Button
                  onClick={() => {
                    setShowImportModal(false);
                    setImportFile(null);
                    setParsedContacts([]);
                  }}
                  className="flex-1 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium rounded-xl h-11"
                >
                  Batal
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: BULK LABEL EDIT */}
      {showBulkLabelModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-auto">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-50">
              <h3 className="text-base font-bold text-slate-800">Ganti Label Massal</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowBulkLabelModal(false)}
                className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4.5 h-4.5" />
              </Button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-500">
                Ubah label untuk {selectedContactIds.length} kontak yang Anda pilih secara sekaligus.
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="bulk-label" className="text-slate-700">Label Baru</Label>
                <Input
                  id="bulk-label"
                  placeholder="Contoh: Kelas 10, Guru, Alumni"
                  value={bulkLabelText}
                  onChange={(e) => setBulkLabelText(e.target.value)}
                  className="rounded-xl border-slate-200 focus-visible:ring-primary h-11"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  onClick={() => {
                    const savedLabels = JSON.parse(localStorage.getItem(labelsKey) || "{}");
                    const selectedContacts = contacts.filter(c => selectedContactIds.includes(c.id));
                    selectedContacts.forEach(c => {
                      savedLabels[c.phone] = bulkLabelText.trim();
                    });
                    localStorage.setItem(labelsKey, JSON.stringify(savedLabels));
                    setContactLabels(savedLabels);
                    toast.success(`Berhasil memperbarui label untuk ${selectedContactIds.length} kontak`);
                    setShowBulkLabelModal(false);
                    setBulkLabelText("");
                    setSelectedContactIds([]);
                  }}
                  className="flex-1 bg-primary hover:bg-primary/95 text-primary-foreground font-medium rounded-xl h-11"
                >
                  Simpan Label
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowBulkLabelModal(false)}
                  className="flex-1 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium rounded-xl h-11"
                >
                  Batal
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Contact Modal */}
      <AppModal
        open={deleteConfirmOpen}
        title="Hapus Kontak"
        onClose={() => {
          setDeleteConfirmOpen(false);
          setContactToDelete(null);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDeleteConfirmOpen(false);
                setContactToDelete(null);
              }}
            >
              Batal
            </Button>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={handleConfirmDeleteSingle}
            >
              Hapus
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Apakah Anda yakin ingin menghapus kontak <strong className="text-slate-800 font-bold">&ldquo;{contactToDelete?.name}&rdquo;</strong>? Tindakan ini tidak dapat dibatalkan.
        </p>
      </AppModal>

      {/* Bulk Delete Contacts Modal */}
      <AppModal
        open={bulkDeleteConfirmOpen}
        title="Hapus Kontak Terpilih"
        onClose={() => setBulkDeleteConfirmOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkDeleteConfirmOpen(false)}
            >
              Batal
            </Button>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={handleConfirmBulkDelete}
            >
              Hapus
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Apakah Anda yakin ingin menghapus <strong className="text-slate-800 font-bold">{selectedContactIds.length} kontak terpilih</strong>? Tindakan ini tidak dapat dibatalkan.
        </p>
      </AppModal>

    </div>
  );
}
