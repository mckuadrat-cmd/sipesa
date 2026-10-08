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
import { api, type ContactImportPreflightRow } from "../lib/api";
import { toast } from "sonner";
import { useVisibilityRefresh } from "../hooks/use-visibility-refresh";
import { useDialogFocus } from "../hooks/use-dialog-focus";

interface Contact {
  id: string;
  name: string;
  phone: string;
  label?: string;
  createdAt?: string;
  updatedAt?: string;
}

const PAGE_SIZE = 10;
const CONTACT_IMPORT_PREFLIGHT_CHUNK_SIZE = 100;
const CONTACT_IMPORT_MUTATION_CONCURRENCY = 4;

type ImportedContact = {
  rowId: number;
  name: string;
  phone: string;
  label?: string;
};

type ContactImportSummary = {
  total: number;
  validNew: number;
  invalid: number;
  duplicateWithinImport: number;
  existingOrganizationDuplicate: number;
  succeeded: number;
  failed: number;
};

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size));
  }
  return chunks;
}

async function mapWithBoundedConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < values.length; offset += concurrency) {
    const wave = values.slice(offset, offset + concurrency);
    results.push(...await Promise.all(wave.map(worker)));
  }
  return results;
}

export function ContactListView({ user }: { user?: any }) {
  const labelsKey = user?.org_id ? `sipesa_contact_labels_${user.org_id}` : "sipesa_contact_labels";
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [contactLoadError, setContactLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [totalContacts, setTotalContacts] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);

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
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [bulkLabelSaving, setBulkLabelSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<{ id: string; name: string } | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  // Import CSV states
  const [importFile, setImportFile] = useState<File | null>(null);
  const [parsedContacts, setParsedContacts] = useState<ImportedContact[]>([]);
  const [importing, setImporting] = useState(false);
  const [importStage, setImportStage] = useState<"idle" | "preflight" | "mutating" | "complete">("idle");
  const [importSummary, setImportSummary] = useState<ContactImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasLoadedRef = useRef(false);
  const requestVersionRef = useRef(0);
  const contactFormDialogRef = useDialogFocus<HTMLDivElement>(showFormModal, () => setShowFormModal(false), formSaving);
  const importDialogRef = useDialogFocus<HTMLDivElement>(showImportModal, () => setShowImportModal(false), importing);
  const bulkLabelDialogRef = useDialogFocus<HTMLDivElement>(showBulkLabelModal, () => setShowBulkLabelModal(false), bulkLabelSaving);

  const loadContactLabels = async () => {
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
        } catch { }
      }

      const res = await api.getContactLabels();
      if (res.success) {
        setContactLabels(res.data);
        localStorage.setItem(labelsKey, JSON.stringify(res.data));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadContacts = async () => {
    const requestVersion = ++requestVersionRef.current;
    if (!hasLoadedRef.current) setLoading(true);
    else setTableLoading(true);
    try {
      const result = await api.getOrgContacts({
        page: currentPage,
        pageSize: PAGE_SIZE,
        search: debouncedSearch || undefined,
        label: selectedFilterLabel === "all" ? undefined : selectedFilterLabel,
      });
      if (requestVersion !== requestVersionRef.current) return;
      if (result.success) {
        setContacts(result.data.items);
        setTotalContacts(result.data.total);
        setServerTotalPages(result.data.totalPages);
        if (currentPage > result.data.totalPages) setCurrentPage(result.data.totalPages);
        setSelectedContactIds([]);
        setContactLoadError("");
        hasLoadedRef.current = true;
      } else if ("error" in result) {
        console.error("Contacts request failed:", result.error);
        setContactLoadError("Kontak belum dapat dimuat. Silakan coba lagi.");
      }
    } catch (err) {
      if (requestVersion !== requestVersionRef.current) return;
      console.error("Error loading contacts:", err);
      setContactLoadError("Kontak belum dapat dimuat. Silakan coba lagi.");
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setLoading(false);
        setTableLoading(false);
      }
    }
  };

  const refreshContacts = useVisibilityRefresh(
    () => loadContacts(),
    { intervalMs: 30_000 },
  );

  useEffect(() => {
    void loadContactLabels();
  }, [labelsKey]);

  useEffect(() => {
    requestVersionRef.current += 1;
    const timeout = window.setTimeout(() => {
      setCurrentPage(1);
      setDebouncedSearch(searchQuery.trim());
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    // Invalidate an older page/search response immediately, even when the
    // non-overlapping refresh helper queues this query behind an in-flight one.
    requestVersionRef.current += 1;
    void refreshContacts();
  }, [currentPage, debouncedSearch, selectedFilterLabel, refreshContacts]);

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
      label: contact.label || contactLabels[contact.phone] || "",
    });
    setShowFormModal(true);
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formSaving) return;
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
        result = await api.updateContact(editingContact.id, { name, phone, label });
      } else {
        result = await api.createContact({ name, phone, label });
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
        api.updateContactLabels(newLabels).catch((e) =>
          console.warn("Gagal sinkronisasi label ke database:", e)
        );

        toast.success(editingContact ? "Kontak berhasil diperbarui" : "Kontak berhasil ditambahkan");
        setShowFormModal(false);
        setFormData({ name: "", phone: "", label: "" });
        setEditingContact(null);
        await refreshContacts();
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
    if (!contactToDelete || deletingContactId) return;
    setDeletingContactId(contactToDelete.id);
    try {
      const result = await api.deleteContact(contactToDelete.id);
      if (result.success) {
        toast.success("Kontak berhasil dihapus");
        setDeleteConfirmOpen(false);
        setContactToDelete(null);
        await refreshContacts();
      } else {
        const errorMsg = "error" in result ? result.error : "Terjadi kesalahan";
        toast.error("Gagal menghapus kontak: " + errorMsg);
      }
    } catch (err) {
      console.error("Error deleting contact:", err);
      toast.error("Terjadi kesalahan saat menghapus kontak");
    } finally {
      setDeletingContactId(null);
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

      const list: ImportedContact[] = [];

      for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        const phoneVal = String(row[phoneIndex] || "").trim();

        const nameVal = nameIndex !== -1 ? String(row[nameIndex] || "").trim() : phoneVal;
        const labelVal = labelIndex !== -1 ? String(row[labelIndex] || "").trim() : "";
        list.push({ rowId: i, name: nameVal || phoneVal || `Baris ${i + 1}`, phone: phoneVal, label: labelVal });
      }

      setParsedContacts(list);
      setImportStage("idle");
      setImportSummary(null);
    };
    reader.readAsText(file);
  };

  const handleBulkImport = async () => {
    if (parsedContacts.length === 0 || importing) return;
    setImporting(true);
    setImportStage("preflight");
    setImportSummary(null);

    try {
      const preflightRows: ContactImportPreflightRow[] = [];
      for (const chunk of chunkValues(parsedContacts, CONTACT_IMPORT_PREFLIGHT_CHUNK_SIZE)) {
        const result = await api.preflightContactImport(chunk.map(({ rowId, phone }) => ({ rowId, phone })));
        if (!result.success) {
          const message = "error" in result ? result.error : "Preflight import gagal";
          throw new Error(message);
        }
        preflightRows.push(...result.data.results);
      }

      const sourceByRowId = new Map(parsedContacts.map((contact) => [String(contact.rowId), contact]));
      const seenNormalizedPhones = new Set<string>();
      const classified = preflightRows.map((row) => {
        const source = sourceByRowId.get(String(row.rowId));
        if (!source) throw new Error("Hasil preflight tidak sesuai dengan file import.");
        const crossChunkDuplicate = row.valid && !!row.normalizedPhone && seenNormalizedPhones.has(row.normalizedPhone);
        if (row.valid && row.normalizedPhone && !crossChunkDuplicate) seenNormalizedPhones.add(row.normalizedPhone);
        return {
          source,
          row,
          duplicateWithinOverallImport: row.duplicateWithinImport || crossChunkDuplicate,
        };
      });

      const invalid = classified.filter(({ row }) => !row.valid).length;
      const duplicateWithinImport = classified.filter(({ duplicateWithinOverallImport }) => duplicateWithinOverallImport).length;
      const existingOrganizationDuplicate = classified.filter(
        ({ row, duplicateWithinOverallImport }) => row.valid && !duplicateWithinOverallImport && row.existingOrganizationDuplicate,
      ).length;
      const mutationPlan = classified.filter(
        ({ row, duplicateWithinOverallImport }) => row.valid && !duplicateWithinOverallImport,
      );
      const validNew = mutationPlan.filter(({ row }) => !row.existingOrganizationDuplicate).length;

      setImportStage("mutating");
      const newLabels = { ...contactLabels };
      const mutationResults = await mapWithBoundedConcurrency(
        mutationPlan,
        CONTACT_IMPORT_MUTATION_CONCURRENCY,
        async ({ source, row }) => {
          const result = row.existingOrganizationDuplicate && row.existingContactId
            ? await api.updateContact(row.existingContactId, { name: source.name, phone: source.phone, label: source.label })
            : await api.createContact({ name: source.name, phone: source.phone, label: source.label });
          if (result.success && source.label) {
            const savedPhone = result.data?.phone || row.normalizedPhone || source.phone;
            newLabels[savedPhone] = source.label;
          }
          return result.success;
        },
      );
      const successCount = mutationResults.filter(Boolean).length;
      const failCount = mutationResults.length - successCount;

      localStorage.setItem(labelsKey, JSON.stringify(newLabels));
      setContactLabels(newLabels);
      api.updateContactLabels(newLabels).catch((e) =>
        console.warn("Gagal sinkronisasi label ke database:", e)
      );

      const summary = {
        total: parsedContacts.length,
        validNew,
        invalid,
        duplicateWithinImport,
        existingOrganizationDuplicate,
        succeeded: successCount,
        failed: failCount,
      };
      setImportSummary(summary);
      setImportStage("complete");
      if (failCount > 0) toast.warning(`Import selesai sebagian: ${successCount} berhasil, ${failCount} gagal.`);
      else toast.success(`Import selesai: ${successCount} kontak berhasil disimpan.`);
      await refreshContacts();
    } catch (err) {
      console.error("Error bulk importing contacts:", err);
      toast.error("Import belum dapat diproses. Periksa file lalu coba lagi.");
      setImportStage("idle");
    } finally {
      setImporting(false);
    }
  };

  const handleBulkDelete = () => {
    setBulkDeleteConfirmOpen(true);
  };

  const handleConfirmBulkDelete = async () => {
    if (deletingBulk) return;
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
      api.updateContactLabels(newLabels).catch((e) =>
        console.warn("Gagal sinkronisasi label ke database:", e)
      );
      setSelectedContactIds([]);
      toast.success(`Berhasil menghapus ${successCount} kontak.${failCount > 0 ? ` Gagal: ${failCount}` : ""}`);
      setBulkDeleteConfirmOpen(false);
      await refreshContacts();
    } catch (err) {
      console.error("Error bulk deleting contacts:", err);
      toast.error("Gagal menghapus kontak terpilih");
    } finally {
      setDeletingBulk(false);
    }
  };

  const handleExportCsv = async () => {
    if (totalContacts === 0) {
      toast.error("Tidak ada kontak untuk diexport");
      return;
    }

    const exported: Contact[] = [];
    let page = 1;
    while (true) {
      const result = await api.getOrgContacts({
        page,
        pageSize: 100,
        search: debouncedSearch || undefined,
        label: selectedFilterLabel === "all" ? undefined : selectedFilterLabel,
      });
      if ("error" in result) {
        toast.error("Gagal mengekspor kontak: " + result.error);
        return;
      }
      exported.push(...result.data.items);
      if (page >= result.data.totalPages) break;
      page += 1;
    }

    const headers = ["Nama", "Nomor", "Label"];
    const rows = exported.map((c) => [
      c.name,
      c.phone,
      c.label || contactLabels[c.phone] || "",
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

  const totalPages = serverTotalPages;
  const paginatedContacts = contacts;

  const handleApplyBulkLabel = async () => {
    if (bulkLabelSaving) return;
    setBulkLabelSaving(true);
    const label = bulkLabelText.trim();
    const selectedContacts = contacts.filter((contact) => selectedContactIds.includes(contact.id));
    try {
      const results = await mapWithBoundedConcurrency(selectedContacts, CONTACT_IMPORT_MUTATION_CONCURRENCY, (contact) => api.updateContact(contact.id, {
        name: contact.name,
        phone: contact.phone,
        label,
      }));
      if (results.some((result) => "error" in result)) {
        toast.error("Sebagian label kontak gagal diperbarui");
        return;
      }

      const savedLabels = JSON.parse(localStorage.getItem(labelsKey) || "{}");
      selectedContacts.forEach((contact) => {
        savedLabels[contact.phone] = label;
      });
      localStorage.setItem(labelsKey, JSON.stringify(savedLabels));
      setContactLabels(savedLabels);
      void api.updateContactLabels(savedLabels);
      toast.success(`Berhasil memperbarui label untuk ${selectedContacts.length} kontak pada halaman ini`);
      setShowBulkLabelModal(false);
      setBulkLabelText("");
      setSelectedContactIds([]);
      await refreshContacts();
    } finally {
      setBulkLabelSaving(false);
    }
  };

  return (
    <div className="w-full p-6 md:p-8 bg-white min-h-screen">

      <div className="mb-8 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight leading-tight">Daftar Kontak</h1>
          <p className="text-sm text-slate-500 mt-1.5 leading-relaxed break-words whitespace-normal max-w-2xl">
            Kelola daftar kontak sekolah Anda.
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
              setImportStage("idle");
              setImportSummary(null);
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
              <h3 className="text-base font-bold text-slate-800">Semua Kontak ({totalContacts})</h3>
              <p className="text-xs text-slate-400 mt-0.5">Urutan abjad nama kontak</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              {/* Filter Label Dropdown */}
              <select
                aria-label="Filter kontak berdasarkan label"
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
                  aria-label="Cari kontak"
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

          {contactLoadError && hasLoadedRef.current && (
            <div className="flex flex-col gap-2 border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between" role="status">
              <span>Data terakhir ditampilkan. Gagal memperbarui kontak.</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadContacts()} disabled={tableLoading} className="self-start sm:self-auto">
                Coba Lagi
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
                      aria-label="Pilih semua kontak pada halaman ini"
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
                {loading && !hasLoadedRef.current ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        <span>Memuat daftar kontak...</span>
                      </div>
                    </td>
                  </tr>
                ) : contactLoadError && !hasLoadedRef.current ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-red-700" role="alert">
                        <h4 className="text-sm font-semibold">Kontak belum dapat dimuat</h4>
                        <p className="mt-1 text-xs text-red-600">Silakan periksa koneksi lalu coba lagi.</p>
                        <Button type="button" variant="outline" size="sm" onClick={() => void loadContacts()} className="mt-3">Coba Lagi</Button>
                      </div>
                    </td>
                  </tr>
                ) : paginatedContacts.length === 0 && !tableLoading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                        <Users className="w-10 h-10 text-slate-200 mb-2" />
                        <h4 className="text-sm font-semibold text-slate-700">
                          {debouncedSearch || selectedFilterLabel !== "all" ? "Tidak ada kontak yang cocok" : "Belum ada kontak"}
                        </h4>
                        <p className="text-xs text-slate-400 mt-1">
                          {debouncedSearch || selectedFilterLabel !== "all"
                            ? "Ubah kata kunci atau filter untuk melihat hasil lain."
                            : "Tambahkan kontak untuk mulai menyiapkan penerima broadcast."}
                        </p>
                        {(debouncedSearch || selectedFilterLabel !== "all") && (
                          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => { setSearchQuery(""); setDebouncedSearch(""); setSelectedFilterLabel("all"); setCurrentPage(1); }}>
                            Reset Pencarian dan Filter
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedContacts.map((contact) => (
                    <tr key={contact.id} className={`hover:bg-slate-50/50 transition-colors ${selectedContactIds.includes(contact.id) ? 'bg-primary/5 hover:bg-primary/5' : ''}`}>
                      <td className="px-4 py-4 whitespace-nowrap w-10">
                        <input
                          type="checkbox"
                          aria-label={`Pilih kontak ${contact.name}`}
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
                        {(contact.label || contactLabels[contact.phone]) ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20 max-w-[160px] truncate animate-in fade-in duration-200" title={contact.label || contactLabels[contact.phone]}>
                            {contact.label || contactLabels[contact.phone]}
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
                            aria-label={`Edit kontak ${contact.name}`}
                            className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 rounded-lg"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteContact(contact.id, contact.name)}
                            aria-label={`Hapus kontak ${contact.name}`}
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

          {tableLoading && (
            <div className="px-6 py-2.5 border-t border-slate-100 text-xs text-slate-500 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              Memperbarui kontak...
            </div>
          )}

          {/* Pagination bar */}
          {totalContacts > PAGE_SIZE && (
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">
                Menampilkan {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, totalContacts)} dari{" "}
                {totalContacts} kontak
              </span>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1 || tableLoading}
                  aria-label="Halaman kontak sebelumnya"
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
                  disabled={currentPage === totalPages || tableLoading}
                  aria-label="Halaman kontak berikutnya"
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
          <div ref={contactFormDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="contact-form-title" className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-50">
              <h3 id="contact-form-title" className="text-base font-bold text-slate-800">
                {editingContact ? "Edit Kontak" : "Tambah Kontak Baru"}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Tutup formulir kontak"
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
          <div ref={importDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="contact-import-title" className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-2xl shadow-xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-50">
              <h3 id="contact-import-title" className="text-base font-bold text-slate-800">Import Kontak dari CSV</h3>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Tutup import kontak"
                disabled={importing}
                onClick={() => {
                  setShowImportModal(false);
                  setImportFile(null);
                  setParsedContacts([]);
                  setImportStage("idle");
                  setImportSummary(null);
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
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="w-full border-2 border-dashed border-slate-200 hover:border-primary/50 transition-colors rounded-xl p-8 bg-slate-50/50 flex flex-col items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".csv"
                  disabled={importing}
                  className="hidden"
                />
                <FileSpreadsheet className="w-10 h-10 text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">
                  {importFile ? importFile.name : "Pilih File CSV"}
                </span>
                <span className="text-xs text-slate-400">
                  Klik untuk menelusuri file dari komputer Anda
                </span>
              </button>

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

              {importing && (
                <div role="status" className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {importStage === "preflight"
                    ? "Memeriksa nomor dan duplikasi di seluruh organisasi..."
                    : "Menyimpan kontak secara bertahap..."}
                </div>
              )}

              {importSummary && importStage === "complete" && (
                <div role="status" className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs sm:grid-cols-3">
                  <span>Total: <strong>{importSummary.total}</strong></span>
                  <span>Baru: <strong>{importSummary.validNew}</strong></span>
                  <span>Duplikat file: <strong>{importSummary.duplicateWithinImport}</strong></span>
                  <span>Kontak existing: <strong>{importSummary.existingOrganizationDuplicate}</strong></span>
                  <span>Invalid: <strong>{importSummary.invalid}</strong></span>
                  <span>Berhasil/Gagal: <strong>{importSummary.succeeded}/{importSummary.failed}</strong></span>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <Button
                  onClick={handleBulkImport}
                  disabled={importing || parsedContacts.length === 0 || importStage === "complete"}
                  className="flex-1 bg-primary hover:bg-primary/95 text-primary-foreground font-medium rounded-xl h-11"
                >
                  {importing ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{importStage === "preflight" ? "Memeriksa..." : "Mengimport..."}</span>
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
                    setImportStage("idle");
                    setImportSummary(null);
                  }}
                  disabled={importing}
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
          <div ref={bulkLabelDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="bulk-label-title" className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-50">
              <h3 id="bulk-label-title" className="text-base font-bold text-slate-800">Ganti Label Massal</h3>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Tutup pengaturan label massal"
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
                  onClick={handleApplyBulkLabel}
                  disabled={bulkLabelSaving}
                  className="flex-1 bg-primary hover:bg-primary/95 text-primary-foreground font-medium rounded-xl h-11"
                >
                  {bulkLabelSaving ? "Menyimpan..." : "Simpan Label"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowBulkLabelModal(false)}
                  disabled={bulkLabelSaving}
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
        closeDisabled={deletingContactId !== null}
        onClose={() => {
          if (deletingContactId) return;
          setDeleteConfirmOpen(false);
          setContactToDelete(null);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={deletingContactId !== null}
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
              disabled={deletingContactId !== null}
            >
              {deletingContactId ? "Menghapus..." : "Hapus"}
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
        closeDisabled={deletingBulk}
        onClose={() => {
          if (!deletingBulk) setBulkDeleteConfirmOpen(false);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={deletingBulk}
              onClick={() => setBulkDeleteConfirmOpen(false)}
            >
              Batal
            </Button>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={handleConfirmBulkDelete}
              disabled={deletingBulk}
            >
              {deletingBulk ? "Menghapus..." : "Hapus"}
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
