import { useEffect, useState, useRef } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { 
  Settings as SettingsIcon, 
  Save, 
  UserRound, 
  RefreshCw, 
  Camera, 
  Trash2, 
  X, 
  Lock 
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";

interface SettingsViewProps {
  onUpdateUser?: () => Promise<void>;
}

export function SettingsView({ onUpdateUser }: SettingsViewProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState({
    id: "",
    fullName: "",
    username: "",
    email: "",
    role: "",
  });

  const [org, setOrg] = useState({
    id: "",
    name: "",
    supportEmail: "",
    autoReplyEnabled: false,
    autoReplyMessage: "",
    fallbackTemplateName: "",
    sendDelayMs: 2000,
    throttlePerMin: 30,
  });

  const [registeredWaNumber, setRegisteredWaNumber] = useState("Belum ada");

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const [result, numbersRes] = await Promise.all([
        api.getSettings(),
        api.getNumbers()
      ]);

      if ("error" in result) {
        toast.error("Gagal memuat settings: " + result.error);
        return;
      }

      const userId = result.data.profile?.id ?? "";
      setProfile({
        id: userId,
        fullName: result.data.profile?.fullName ?? "",
        username: result.data.profile?.username ?? "",
        email: result.data.profile?.email ?? "",
        role: result.data.profile?.role ?? "",
      });

      const orgId = result.data.org?.id ?? "";
      setOrg({
        id: orgId,
        name: result.data.org?.name ?? "",
        supportEmail: result.data.org?.supportEmail ?? "",
        autoReplyEnabled: !!result.data.org?.autoReplyEnabled,
        autoReplyMessage: result.data.org?.autoReplyMessage ?? "",
        fallbackTemplateName: result.data.org?.fallbackTemplateName ?? "",
        sendDelayMs: Number(result.data.org?.sendDelayMs ?? 2000),
        throttlePerMin: Number(result.data.org?.throttlePerMin ?? 30),
      });

      if (numbersRes && !("error" in numbersRes) && numbersRes.data.length > 0) {
        const formattedNumbers = numbersRes.data.map(n => n.number).join(", ");
        setRegisteredWaNumber(formattedNumbers);
      }

      if (userId) {
        let avatarVal = localStorage.getItem(`sipesa_avatar_${userId}`);
        if (!avatarVal) {
          avatarVal = result.data.profile?.avatar || null;
          if (!avatarVal) {
            const oldAvatar = localStorage.getItem("sipesa_avatar");
            if (oldAvatar) {
              localStorage.setItem(`sipesa_avatar_${userId}`, oldAvatar);
              avatarVal = oldAvatar;
            }
          } else {
            localStorage.setItem(`sipesa_avatar_${userId}`, avatarVal);
          }
        }
        setAvatar(avatarVal);
      } else {
        setAvatar(null);
      }
      const addressKey = orgId ? `sipesa_address_${orgId}` : "sipesa_address";
      let addressVal = localStorage.getItem(addressKey);
      if (!addressVal && orgId) {
        addressVal = result.data.org?.address || "";
        if (!addressVal) {
          const oldAddress = localStorage.getItem("sipesa_address");
          if (oldAddress) {
            localStorage.setItem(addressKey, oldAddress);
            addressVal = oldAddress;
          }
        } else {
          localStorage.setItem(addressKey, addressVal);
        }
      }
      setAddress(addressVal || "");
    } catch (error) {
      console.error(error);
      toast.error("Gagal memuat settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!profile.fullName.trim()) {
      toast.warning("Nama lengkap wajib diisi");
      return;
    }
    if (!org.name.trim()) {
      toast.warning("Nama instansi wajib diisi");
      return;
    }
    if (!profile.email.trim()) {
      toast.warning("Email wajib diisi");
      return;
    }
    if (!profile.username.trim()) {
      toast.warning("Username wajib diisi");
      return;
    }

    setSaving(true);
    try {
      const [profileRes, orgRes] = await Promise.all([
        api.updateProfile({
          fullName: profile.fullName,
          username: profile.username,
          email: profile.email,
        }),
        api.updateOrgSettings({
          name: org.name,
          supportEmail: org.supportEmail,
          address: address,
        })
      ]);

      if ("error" in profileRes) {
        toast.error("Gagal menyimpan profil: " + profileRes.error);
        return;
      }

      if ("error" in orgRes) {
        toast.error("Gagal menyimpan data instansi: " + orgRes.error);
        return;
      }

      const addressKey = org.id ? `sipesa_address_${org.id}` : "sipesa_address";
      localStorage.setItem(addressKey, address);
      toast.success("Profil dan data instansi berhasil disimpan");
      
      if (onUpdateUser) {
        await onUpdateUser();
      }
    } catch (error) {
      console.error(error);
      toast.error("Terjadi kesalahan saat menyimpan data");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMessaging = async () => {
    setSaving(true);
    try {
      const result = await api.updateMessagingSettings({
        autoReplyEnabled: org.autoReplyEnabled,
        autoReplyMessage: org.autoReplyMessage,
        fallbackTemplateName: org.fallbackTemplateName,
        sendDelayMs: Number(org.sendDelayMs),
        throttlePerMin: Number(org.throttlePerMin),
      });

      if ("error" in result) {
        toast.error("Gagal menyimpan pengaturan pesan: " + result.error);
        return;
      }

      toast.success("Pengaturan pesan berhasil disimpan");
    } catch (error) {
      console.error(error);
      toast.error("Terjadi kesalahan saat menyimpan pengaturan pesan");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      toast.warning("Password lama dan password baru wajib diisi");
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      toast.warning("Password baru minimal 8 karakter");
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.warning("Konfirmasi password tidak sama");
      return;
    }

    setSaving(true);
    try {
      const result = await api.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });

      if ("error" in result) {
        toast.error("Gagal ganti password: " + result.error);
        return;
      }

      toast.success("Password berhasil diubah");
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setShowPasswordModal(false);
    } catch (error) {
      console.error(error);
      toast.error("Terjadi kesalahan saat mengganti password");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Ukuran foto maksimal 2MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      if (!profile.id) {
        toast.error("Gagal memperbarui foto profil: ID pengguna tidak tersedia.");
        return;
      }
      const avatarKey = `sipesa_avatar_${profile.id}`;
      localStorage.setItem(avatarKey, base64);
      setAvatar(base64);
      window.dispatchEvent(new Event("sipesa-avatar-updated"));
      
      try {
        await api.updateProfile({
          fullName: profile.fullName,
          username: profile.username,
          email: profile.email,
          avatar: base64,
        });
      } catch (err) {
        console.warn("Gagal sinkronisasi foto profil ke database:", err);
      }

      toast.success("Foto profil berhasil diperbarui");
    };
    reader.onerror = () => {
      toast.error("Gagal membaca file foto");
    };
    reader.readAsDataURL(file);
  };

  const handleAvatarDelete = async () => {
    if (!profile.id) return;
    const avatarKey = `sipesa_avatar_${profile.id}`;
    localStorage.removeItem(avatarKey);
    setAvatar(null);
    window.dispatchEvent(new Event("sipesa-avatar-updated"));

    try {
      await api.updateProfile({
        fullName: profile.fullName,
        username: profile.username,
        email: profile.email,
        avatar: null,
      });
    } catch (err) {
      console.warn("Gagal menghapus foto profil di database:", err);
    }

    toast.success("Foto profil berhasil dihapus");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
          <p className="text-muted-foreground">Memuat pengaturan...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full p-6 md:p-8 bg-white space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 leading-tight">Pengaturan</h1>
        <p className="text-sm text-slate-500 mt-1">
          Kelola profil user, data instansi, dan pengaturan pengiriman pesan
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* SECTION 1: Profil User */}
        <Card className="p-6 border border-slate-100 rounded-2xl shadow-sm bg-white">
        <div className="flex items-center gap-3 mb-6">
          <UserRound className="w-5 h-5 text-primary" />
          <h3 className="font-bold text-slate-800">Profil User</h3>
        </div>

        <div className="space-y-6">
          {/* Avatar Upload Container */}
          <div className="flex flex-col sm:flex-row items-center gap-6 pb-6 border-b border-slate-100">
            <div className="w-20 h-20 rounded-full border bg-slate-50 flex items-center justify-center text-xl font-bold text-slate-700 overflow-hidden relative shadow-inner">
              {avatar ? (
                <img src={avatar} alt="Profile" className="w-full h-full object-cover" />
              ) : profile.fullName ? (
                profile.fullName.slice(0, 2).toUpperCase()
              ) : (
                <UserRound className="w-8 h-8 text-slate-400" />
              )}
            </div>

            <div className="flex flex-col items-center sm:items-start gap-2">
              <span className="text-sm font-semibold text-slate-700">Foto Profil</span>
              <div className="flex items-center gap-2">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleAvatarChange} 
                  accept="image/*" 
                  className="hidden" 
                />
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5"
                >
                  <Camera className="w-4 h-4" />
                  Ubah Foto
                </Button>
                {avatar && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleAvatarDelete}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
              <span className="text-xs text-slate-400">Rekomendasi rasio 1:1, maks 2MB.</span>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <Label className="text-slate-700 font-medium">Nama Lengkap</Label>
              <Input
                className="mt-2"
                placeholder="Masukkan nama lengkap"
                value={profile.fullName}
                onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
              />
            </div>

            <div>
              <Label className="text-slate-700 font-medium">Nama Instansi</Label>
              <Input
                className="mt-2"
                placeholder="Masukkan nama instansi/sekolah"
                value={org.name}
                onChange={(e) => setOrg((o) => ({ ...o, name: e.target.value }))}
              />
            </div>

            <div>
              <Label className="text-slate-700 font-medium">Email</Label>
              <Input
                className="mt-2"
                type="email"
                placeholder="Masukkan email aktif"
                value={profile.email}
                onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
              />
            </div>

            <div>
              <Label className="text-slate-700 font-medium">Nomor Whatsapp Terdaftar</Label>
              <Input 
                className="mt-2 bg-slate-50/80" 
                value={registeredWaNumber} 
                disabled 
              />
            </div>

            <div>
              <Label className="text-slate-700 font-medium">Username</Label>
              <Input
                className="mt-2"
                placeholder="Username"
                value={profile.username}
                onChange={(e) => setProfile((p) => ({ ...p, username: e.target.value.toLowerCase() }))}
              />
            </div>

            <div>
              <Label className="text-slate-700 font-medium">Password</Label>
              <div className="flex gap-2 mt-2">
                <Input 
                  type="password" 
                  value="xxxxxxxx" 
                  disabled 
                  className="bg-slate-50/80 flex-1" 
                />
                <Button 
                  variant="outline" 
                  onClick={() => setShowPasswordModal(true)}
                  className="flex items-center gap-1.5 shrink-0"
                >
                  <Lock className="w-4 h-4" />
                  Ganti Password
                </Button>
              </div>
            </div>

            <div className="md:col-span-2">
              <Label className="text-slate-700 font-medium">Alamat</Label>
              <textarea
                className="w-full mt-2 p-3 border rounded-lg min-h-[80px] text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary border-slate-200"
                placeholder="Masukkan alamat lengkap instansi/sekolah"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <Button onClick={handleSaveProfile} disabled={saving} className="bg-primary hover:bg-primary/95 text-white">
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Menyimpan..." : "Simpan Profil"}
            </Button>
          </div>
        </div>
      </Card>

      {/* SECTION 2: Pengaturan Pengiriman */}
      <Card className="p-6 border border-slate-100 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <SettingsIcon className="w-5 h-5 text-primary" />
          <h3 className="font-bold text-slate-800">Pengaturan Pengiriman</h3>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-slate-700 font-medium">Auto Reply Dalam 24 Jam</Label>
              <p className="text-xs text-slate-400 mt-1">
                Balasan otomatis hanya aman dipakai dalam customer service window 24 jam
              </p>
            </div>
            <Switch
              checked={org.autoReplyEnabled}
              onCheckedChange={(val) => setOrg((o) => ({ ...o, autoReplyEnabled: val }))}
            />
          </div>

          <div>
            <Label className="text-slate-700 font-medium">Pesan Auto Reply</Label>
            <textarea
              className="w-full mt-2 p-3 border rounded-lg min-h-[110px] text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              value={org.autoReplyMessage}
              onChange={(e) => setOrg((o) => ({ ...o, autoReplyMessage: e.target.value }))}
            />
          </div>

          <div>
            <Label className="text-slate-700 font-medium">Template Fallback di Luar 24 Jam</Label>
            <Input
              className="mt-2"
              placeholder="Nama template approved di Meta"
              value={org.fallbackTemplateName}
              onChange={(e) => setOrg((o) => ({ ...o, fallbackTemplateName: e.target.value }))}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label className="text-slate-700 font-medium">Jeda Antar Pesan (ms)</Label>
              <Input
                type="number"
                className="mt-2"
                value={org.sendDelayMs}
                onChange={(e) => setOrg((o) => ({ ...o, sendDelayMs: Number(e.target.value || 0) }))}
              />
            </div>

            <div>
              <Label className="text-slate-700 font-medium">Max Pesan per Menit</Label>
              <Input
                type="number"
                className="mt-2"
                value={org.throttlePerMin}
                onChange={(e) => setOrg((o) => ({ ...o, throttlePerMin: Number(e.target.value || 1) }))}
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <Button onClick={handleSaveMessaging} disabled={saving} className="bg-primary hover:bg-primary/95 text-white">
              <Save className="w-4 h-4 mr-2" />
              Simpan Pengaturan Pengiriman
            </Button>
          </div>
        </div>
      </Card>
      </div>

      {/* Password Change Popup Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-bold text-slate-800">Ganti Password</h3>
              <button 
                onClick={() => setShowPasswordModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <Label className="text-slate-700 font-medium">Password Lama</Label>
                <Input
                  type="password"
                  className="mt-2"
                  placeholder="Masukkan password lama"
                  value={passwordForm.currentPassword}
                  onChange={(e) =>
                    setPasswordForm((p) => ({ ...p, currentPassword: e.target.value }))
                  }
                />
              </div>

              <div>
                <Label className="text-slate-700 font-medium">Password Baru</Label>
                <Input
                  type="password"
                  className="mt-2"
                  placeholder="Minimal 8 karakter"
                  value={passwordForm.newPassword}
                  onChange={(e) =>
                    setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))
                  }
                />
              </div>

              <div>
                <Label className="text-slate-700 font-medium">Konfirmasi Password Baru</Label>
                <Input
                  type="password"
                  className="mt-2"
                  placeholder="Ketik ulang password baru"
                  value={passwordForm.confirmPassword}
                  onChange={(e) =>
                    setPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))
                  }
                />
              </div>
            </div>
            
            <div className="flex items-center gap-3 px-6 py-4 bg-slate-50 border-t justify-end">
              <Button 
                variant="outline" 
                onClick={() => setShowPasswordModal(false)}
                disabled={saving}
              >
                Batal
              </Button>
              <Button 
                onClick={handleChangePassword} 
                disabled={saving}
                className="bg-primary hover:bg-primary/95 text-white"
              >
                Ganti Password
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}