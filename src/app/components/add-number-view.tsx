import { useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ArrowLeft, CheckCircle2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";

interface AddNumberViewProps {
  onBack: () => void;
  onAddNumber?: () => void;
}

export function AddNumberView({ onBack, onAddNumber }: AddNumberViewProps) {
  const [formData, setFormData] = useState({
    name: "",
    number: "",
    businessId: "",
    wabaId: "",
    phoneNumberId: "",
    accessToken: "",
  });

  const [loading, setLoading] = useState(false);
  const [syncInfo, setSyncInfo] = useState("");

  const updateField = (key: keyof typeof formData, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSyncInfo("");

    try {
      const result = await api.addNumber(formData);

      if ("error" in result) {
        toast.error("Gagal menambahkan nomor: " + result.error);
        return;
      }

      const syncedTemplates = Number(result.data?.syncedTemplates ?? 0);
      setSyncInfo(`Nomor berhasil ditambahkan. Template tersinkron: ${syncedTemplates}`);

      toast.success(
        syncedTemplates > 0
          ? `Nomor berhasil ditambahkan dan ${syncedTemplates} template tersinkron dari Meta.`
          : "Nomor berhasil ditambahkan."
      );

      if (onAddNumber) {
        onAddNumber();
      } else {
        onBack();
      }
    } catch (error) {
      console.error("Error adding number:", error);
      toast.error("Terjadi kesalahan saat menambahkan nomor");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">Tambah Nomor WhatsApp</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Hubungkan nomor WABA Meta baru ke sistem Sipesa
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content - Scrollable form */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
          <Card className="p-6 border-0 shadow-sm" style={{ backgroundColor: "#F0EAC6" }}>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <Label htmlFor="name" className="text-slate-800 font-medium">Nama / Label Nomor</Label>
                <Input
                  id="name"
                  placeholder="Contoh: CS Sekolah"
                  value={formData.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  required
                  className="mt-2 bg-white border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                />
              </div>

              <div>
                <Label htmlFor="number" className="text-slate-800 font-medium">Nomor WhatsApp</Label>
                <Input
                  id="number"
                  placeholder="+628123456789"
                  value={formData.number}
                  onChange={(e) => updateField("number", e.target.value)}
                  required
                  className="mt-2 bg-white border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                />
              </div>

              <div>
                <Label htmlFor="businessId" className="text-slate-800 font-medium">Business ID</Label>
                <Input
                  id="businessId"
                  placeholder="Masukkan Business ID"
                  value={formData.businessId}
                  onChange={(e) => updateField("businessId", e.target.value)}
                  className="mt-2 bg-white border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                />
              </div>

              <div>
                <Label htmlFor="wabaId" className="text-slate-800 font-medium">WABA ID</Label>
                <Input
                  id="wabaId"
                  placeholder="Masukkan WhatsApp Business Account ID"
                  value={formData.wabaId}
                  onChange={(e) => updateField("wabaId", e.target.value)}
                  className="mt-2 bg-white border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                />
              </div>

              <div>
                <Label htmlFor="phoneNumberId" className="text-slate-800 font-medium">Phone Number ID</Label>
                <Input
                  id="phoneNumberId"
                  placeholder="Masukkan Phone Number ID dari Meta"
                  value={formData.phoneNumberId}
                  onChange={(e) => updateField("phoneNumberId", e.target.value)}
                  required
                  className="mt-2 bg-white border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                />
              </div>

              <div>
                <Label htmlFor="accessToken" className="text-slate-800 font-medium">Access Token</Label>
                <Input
                  id="accessToken"
                  type="password"
                  placeholder="Masukkan permanent/system user access token"
                  value={formData.accessToken}
                  onChange={(e) => updateField("accessToken", e.target.value)}
                  required
                  className="mt-2 bg-white border-slate-200 focus-visible:ring-primary focus-visible:border-primary"
                />
              </div>

              <div className="bg-blue-50/80 border border-blue-100 rounded-xl p-4">
                <p className="text-xs text-blue-900 leading-relaxed">
                  Setelah nomor berhasil ditambahkan, sistem akan otomatis mencoba
                  sync template dari Meta berdasarkan WABA ID dan Access Token.
                </p>
              </div>

              {syncInfo && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-2 animate-in slide-in-from-top-1">
                  <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-green-800 font-medium">{syncInfo}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button type="submit" className="flex-1 bg-primary hover:bg-primary/90 text-white font-medium" disabled={loading}>
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Menambahkan...
                    </>
                  ) : (
                    "Tambahkan Nomor"
                  )}
                </Button>
                <Button type="button" variant="outline" onClick={onBack} disabled={loading} className="border-slate-200 hover:bg-slate-50 text-slate-600">
                  Batal
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}