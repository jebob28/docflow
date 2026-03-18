import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Building2, BarChart3, ShieldCheck, LogOut, Search, Bell, MessageSquare, Menu, Settings } from 'lucide-react';
import { authService, api } from '@/lib/auth';
import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { toast } from 'sonner';

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  path: string;
  active: boolean;
  onClick: () => void;
}

const NavItem = ({ icon, label, active, onClick }: NavItemProps) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all text-[13px] ${
      active ? 'bg-white/15 font-bold text-white shadow-sm' : 'text-white/60 hover:bg-white/10 hover:text-white'
    }`}
  >
    {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<{ size?: number }>, { size: 16 }) : icon}
    <span>{label}</span>
  </button>
);

interface SidebarContentProps {
  onNavItemClick?: () => void;
  navigate: (path: string) => void;
  locationPathname: string;
  stats: { total_storage: string } | null;
  handleLogout: () => void;
}

const navItems = [
  { icon: <LayoutDashboard />, label: "Dashboard", path: "/dashboard" },
  { icon: <Building2 />, label: "Tenants", path: "/tenants" },
  { icon: <Users />, label: "Usuários", path: "/users" },
  { icon: <BarChart3 />, label: "CRM & Leads", path: "/crm" },
  { 
    icon: <ShieldCheck />, 
    label: "Auditoria", 
    path: "/audit",
    notImplemented: true 
  },
];

const SidebarContent = ({ onNavItemClick, navigate, locationPathname, stats, handleLogout }: SidebarContentProps) => (
  <>
    <div className="p-5 flex items-center gap-3 mb-2">
      <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-lg">
        <ShieldCheck className="text-[#1b254b] w-5 h-5" />
      </div>
      <div>
        <h1 className="text-base font-bold leading-none tracking-tight">GED Admin</h1>
        <p className="text-[9px] text-white/40 mt-1 uppercase font-bold tracking-widest">SaaS Control</p>
      </div>
    </div>
    
    <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto custom-scrollbar">
      <p className="px-3 text-[9px] font-bold text-white/20 uppercase tracking-[0.2em] mb-2 mt-4">Menu Principal</p>
      {navItems.map((item) => (
        <NavItem 
          key={item.path}
          icon={item.icon}
          label={item.label}
          path={item.path}
          active={locationPathname === item.path}
          onClick={() => {
            if ('notImplemented' in item && item.notImplemented) {
              toast.info(`A página de ${item.label} será implementada em breve.`);
              return;
            }
            navigate(item.path);
            onNavItemClick?.();
          }}
        />
      ))}

      <p className="px-3 text-[9px] font-bold text-white/20 uppercase tracking-[0.2em] mb-2 mt-6">Sistema</p>
      <NavItem 
        icon={<Settings />} 
        label="Configurações" 
        path="/settings" 
        active={locationPathname === "/settings"} 
        onClick={() => {
          toast.info('A página de Configurações do SaaS será implementada em breve.');
          // navigate("/settings");
          // onNavItemClick?.();
        }} 
      />
    </nav>

    <div className="p-4 mt-auto">
      <div className="bg-white/5 rounded-2xl p-4 mb-4 border border-white/5 backdrop-blur-sm">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="p-1.5 bg-blue-500/20 rounded-lg">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <p className="text-[10px] font-bold text-white/70">Uso de Nuvem</p>
        </div>
        <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden mb-2">
          <div 
            className="bg-blue-500 h-full transition-all duration-1000 ease-out shadow-[0_0_8px_rgba(59,130,246,0.5)]" 
            style={{ width: stats?.total_storage && parseFloat(stats.total_storage) > 0 ? `${Math.min(100, (parseFloat(stats.total_storage) / 10) * 100)}%` : '2%' }}
          />
        </div>
        <p className="text-[9px] text-white/30 font-bold text-center tracking-wider">{stats?.total_storage || '0 GB'} / 10 GB</p>
      </div>

      <button 
        onClick={handleLogout}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-white/40 hover:bg-rose-500/10 hover:text-rose-400 transition-all text-[13px] font-bold"
      >
        <LogOut size={16} />
        <span>Sair do Painel</span>
      </button>
    </div>
  </>
);

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = authService.getUser();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [stats, setStats] = useState<{ total_storage: string } | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const statsRes = await api.get('/admin/dashboard/stats').catch(() => ({ data: { total_storage: '0 GB' } }));
        setStats(statsRes.data);
      } catch (error) {
        console.error("Erro ao buscar stats no layout", error);
      }
    };
    fetchStats();
  }, []);

  const handleLogout = () => {
    authService.logout();
  };

  return (
    <div className="flex h-screen bg-[#f4f7fe] text-slate-700 antialiased overflow-hidden font-sans">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex w-60 bg-[#1b254b] text-white flex-col shadow-2xl z-20 transition-all">
        <SidebarContent 
          navigate={navigate} 
          locationPathname={location.pathname} 
          stats={stats} 
          handleLogout={handleLogout} 
        />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative h-full bg-[#f4f7fe]">
        <header className="h-16 flex items-center justify-between px-4 lg:px-8 bg-transparent sticky top-0 z-10 shrink-0 backdrop-blur-md">
          <div className="flex items-center gap-4 flex-1">
            {/* Mobile Menu Trigger */}
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden text-slate-600 hover:bg-white rounded-xl shadow-sm border border-border/50">
                  <Menu size={20} />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 bg-[#1b254b] border-none w-64 text-white">
                <div className="flex flex-col h-full">
                  <SidebarContent 
                    onNavItemClick={() => setIsMobileMenuOpen(false)} 
                    navigate={navigate} 
                    locationPathname={location.pathname} 
                    stats={stats} 
                    handleLogout={handleLogout} 
                  />
                </div>
              </SheetContent>
            </Sheet>

            <div className="flex-1 max-w-md hidden sm:block">
              <div className="relative group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                <Input 
                  placeholder="Pesquisar..." 
                  className="pl-10 h-9 bg-white border-none shadow-sm rounded-xl w-full text-xs focus-visible:ring-blue-500/10 placeholder:text-slate-400"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      toast.info('A busca global será implementada em breve.');
                    }
                  }}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-4 ml-4">
            <div className="flex items-center gap-1 lg:gap-2 pr-2 lg:pr-4 border-r border-border">
              <button 
                className="p-2 text-slate-400 hover:text-blue-500 hover:bg-white rounded-xl shadow-none hover:shadow-sm transition-all relative"
                onClick={() => toast.info('Você não possui novas notificações no momento.')}
              >
                <Bell size={18} />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-rose-500 rounded-full border-2 border-[#f4f7fe]" />
              </button>
              <button 
                className="p-2 text-slate-400 hover:text-blue-500 hover:bg-white rounded-xl shadow-none hover:shadow-sm transition-all hidden xs:flex items-center justify-center"
                onClick={() => toast.info('Central de mensagens será habilitada em breve.')}
              >
                <MessageSquare size={18} />
              </button>
            </div>

            <div className="flex items-center gap-2 lg:gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-[11px] font-bold text-slate-800 leading-none truncate max-w-[100px]">{user?.name || 'Administrador'}</p>
                <p className="text-[9px] text-slate-400 mt-1 font-bold uppercase tracking-wider">Master Admin</p>
              </div>
              <div className="w-8 h-8 lg:w-9 lg:h-9 rounded-xl overflow-hidden shadow-md ring-2 ring-white shrink-0">
                <img 
                  src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || 'Admin')}&background=1b254b&color=fff&bold=true`} 
                  alt="Avatar" 
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-3 sm:px-4 lg:px-8 pb-8 custom-scrollbar">
          <div className="max-w-[1600px] mx-auto pt-2">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
