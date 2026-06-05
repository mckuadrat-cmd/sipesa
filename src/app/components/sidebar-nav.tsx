import { LayoutDashboard, MessageSquare, Send, CreditCard, Settings, FileText, History, Plus, LogOut } from 'lucide-react';
import { Button } from './ui/button';
import logoFull from '/sipesa-white.png';

interface SidebarNavProps {
  activeView: string;
  onViewChange: (view: string) => void;
  onLogout?: () => void;
}

export function SidebarNav({ activeView, onViewChange, onLogout }: SidebarNavProps) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'templates', label: 'Template Pesan', icon: FileText },
    { id: 'broadcast', label: 'Broadcast', icon: Send },
    { id: 'inbox', label: 'Kotak Masuk', icon: MessageSquare },
    { id: 'history', label: 'Riwayat Broadcast', icon: History },
    { id: 'billing', label: 'Billing & Token', icon: CreditCard },
    { id: 'settings', label: 'Pengaturan', icon: Settings },
  ];

  return (
    <div className="w-64 bg-accent h-screen flex flex-col border-r border-sidebar-border">
      <div className="p-6 border-b border-sidebar-border">
        <img src={logoFull} alt="Sipesa" className="h-12 w-auto" />
      </div>
      
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                activeView === item.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <Button
          onClick={() => onViewChange('add-number')}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="w-4 h-4 mr-2" />
          Tambah Nomor WA
        </Button>
        {onLogout && (
          <Button
            onClick={onLogout}
            className="w-full bg-red-500 hover:bg-red-600 text-white mt-2"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        )}
      </div>
    </div>
  );
}