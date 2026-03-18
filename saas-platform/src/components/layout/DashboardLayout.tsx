import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  Users,
  LayoutDashboard,
  Folder,
  Share2,
  Trash2,
  Settings,
  FileText,
  Search,
  Bell,
  LogOut,
  Plus,
  Upload,
  ScanLine,
  Clock,
  GitPullRequest,
  LayoutTemplate,
  AlertTriangle,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SidebarItemProps {
  icon: React.ElementType;
  label: string;
  href: string;
  active?: boolean;
  theme: 'light' | 'dark';
  primaryColor: string;
  sidebarTextColor: string;
  sidebarIconColor: string;
  sidebarFontWeight: string;
  sidebarActiveBackgroundColor: string;
  sidebarHoverBackgroundColor: string;
  sidebarActiveIndicatorColor: string;
  sidebarActiveTextColor: string;
  sidebarActiveIconColor: string;
  isExpanded?: boolean;
}

interface NotificationItem {
  id: string;
  title: string;
  message?: string | null;
  link?: string | null;
  read_at?: string | null;
  created_at: string;
}

const SidebarItem = ({
  icon: Icon,
  label,
  href,
  active,
  primaryColor,
  sidebarTextColor,
  sidebarIconColor,
  sidebarFontWeight,
  sidebarActiveBackgroundColor,
  sidebarHoverBackgroundColor,
  sidebarActiveIndicatorColor,
  sidebarActiveTextColor,
  sidebarActiveIconColor,
  isExpanded = true
}: SidebarItemProps) => {
  const textColor = active ? sidebarActiveTextColor : sidebarTextColor;
  const iconColor = active ? sidebarActiveIconColor : sidebarIconColor;
  return (
    <Link to={href} title={!isExpanded ? label : undefined}>
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg transition-all duration-200 group relative",
          isExpanded ? "px-4 py-2.5" : "justify-center p-2.5 mx-2",
          active ? "bg-[var(--sidebar-active-bg)]" : "hover:bg-[var(--sidebar-hover-bg)]"
        )}
        style={{
          color: textColor,
          fontWeight: sidebarFontWeight === 'bold' ? 700 : 400,
          '--sidebar-active-bg': sidebarActiveBackgroundColor,
          '--sidebar-hover-bg': sidebarHoverBackgroundColor
        } as React.CSSProperties}
      >
        {active && (
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full"
            style={{ backgroundColor: sidebarActiveIndicatorColor || primaryColor }}
          />
        )}
        <Icon className="h-4.5 w-4.5 flex-shrink-0" style={{ color: iconColor }} />
        {isExpanded && <span className="text-sm truncate">{label}</span>}
      </div>
    </Link>
  );
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarExpanded, setIsSidebarExpanded] = React.useState(true);
  const [userData, setUserData] = React.useState({
    name: 'Carlos Silva',
    role: 'Admin',
    avatar: '',
    storageLimitGB: 10,
    usedStorageGB: 0,
    percentUsed: 0,
  });
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = React.useState(false);
  const [customization, setCustomization] = React.useState({
    primary_color: 'var(--primary)',
    secondary_color: '#f8fafc',
    sidebar_color: '#ffffff',
    sidebar_text_color: '#64748b',
    sidebar_icon_color: '#94a3b8',
    sidebar_font_weight: 'normal',
    logo_url: '',
    custom_settings: '{}',
  });

  const sidebarAdvanced = React.useMemo(() => {
    let parsed = {};
    try {
      parsed = JSON.parse(customization.custom_settings || '{}') || {};
    } catch {
      parsed = {};
    }
    const sidebar = typeof (parsed as { sidebar?: Record<string, string> }).sidebar === 'object' && (parsed as { sidebar?: Record<string, string> }).sidebar
      ? (parsed as { sidebar?: Record<string, string> }).sidebar
      : {};
    const systemName = typeof (parsed as { system_name?: string }).system_name === 'string'
      ? (parsed as { system_name?: string }).system_name
      : '';
    const systemSubtitle = typeof (parsed as { system_subtitle?: string }).system_subtitle === 'string'
      ? (parsed as { system_subtitle?: string }).system_subtitle
      : '';
    return {
      system_name: systemName,
      system_subtitle: systemSubtitle,
      brand_bg_color: customization.primary_color,
      brand_icon_color: '#ffffff',
      brand_title_color: '#1e293b',
      brand_subtitle_color: '#94a3b8',
      item_hover_bg: '#f8fafc',
      item_active_bg: '#f1f5f9',
      item_active_indicator: customization.primary_color,
      item_active_text: customization.sidebar_text_color,
      item_active_icon: customization.sidebar_icon_color,
      border_color: '#f1f5f9',
      settings_hover_bg: '#f8fafc',
      settings_active_bg: '#f1f5f9',
      logout_text_color: '#ef4444',
      logout_icon_color: '#ef4444',
      logout_hover_bg: '#fff1f2',
      ...sidebar
    };
  }, [
    customization.custom_settings,
    customization.primary_color,
    customization.sidebar_text_color,
    customization.sidebar_icon_color
  ]);

  const [isPWA, setIsPWA] = React.useState(false);

  React.useEffect(() => {
    const checkPWA = () => {
      const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                          navigatorWithStandalone.standalone === true || 
                          document.referrer.includes('android-app://');
      setIsPWA(isStandalone);
    };
    
    checkPWA();
    window.matchMedia('(display-mode: standalone)').addEventListener('change', (e) => setIsPWA(e.matches));
  }, []);

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        // Notifica o backend para revogar o token
        await fetch('/api/v1/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      }
    } catch (error) {
      console.error('Erro ao fazer logout no servidor:', error);
    } finally {
      // Limpa tudo no frontend independentemente do sucesso da chamada
      localStorage.clear();
      sessionStorage.clear();
      navigate('/login');
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const unreadNotifications = React.useMemo(() => {
    return notifications.filter(item => !item.read_at).length;
  }, [notifications]);

  const formatNotificationDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  };

  const fetchNotifications = React.useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setNotifications([]);
        return;
      }
      const response = await fetch('/api/v1/contracts/notifications', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data: NotificationItem[] = await response.json();
        setNotifications(data || []);
      }
    } catch (error) {
      console.error('Erro ao carregar notificações:', error);
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  const markNotificationRead = async (notificationId: string) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        return;
      }
      const response = await fetch(`/api/v1/contracts/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        setNotifications(prev => prev.map(item => item.id === notificationId ? { ...item, read_at: new Date().toISOString() } : item));
      }
    } catch (error) {
      console.error('Erro ao atualizar notificação:', error);
    }
  };

  const handleNotificationClick = async (notification: NotificationItem) => {
    if (!notification.read_at) {
      await markNotificationRead(notification.id);
    }
    if (notification.link) {
      if (notification.link.startsWith('http')) {
        window.location.href = notification.link;
        return;
      }
      navigate(notification.link);
    }
  };

  React.useEffect(() => {
    const fetchUserData = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          navigate('/login');
          return;
        }
        const response = await fetch('/api/v1/profile', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.status === 401) {
          localStorage.clear();
          navigate('/login');
          return;
        }
        if (response.ok) {
          const data = await response.json();
          setUserData(prev => ({
            ...prev,
            name: data.full_name,
            role: data.role,
            avatar: data.avatar_url
          }));
        }
      } catch (error) {
        console.error('Erro ao carregar dados do usuário:', error);
      }
    };

    fetchUserData();
  }, [navigate]);

  React.useEffect(() => {
    const fetchCustomization = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          navigate('/login');
          return;
        }
        const response = await fetch('/api/v1/customization', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.status === 401) {
          localStorage.clear();
          navigate('/login');
          return;
        }
        if (response.ok) {
          const data = await response.json();
          setCustomization(prev => ({
            ...prev,
            primary_color: data.primary_color || prev.primary_color,
            secondary_color: data.secondary_color || prev.secondary_color,
            sidebar_color: data.sidebar_color || prev.sidebar_color,
            sidebar_text_color: data.sidebar_text_color || prev.sidebar_text_color,
            sidebar_icon_color: data.sidebar_icon_color || prev.sidebar_icon_color,
            sidebar_font_weight: data.sidebar_font_weight || prev.sidebar_font_weight,
            logo_url: data.logo_url || '',
            custom_settings: data.custom_settings || '{}'
          }));
        }
      } catch (error) {
        console.error('Erro ao carregar personalização:', error);
      }
    };

    fetchCustomization();
  }, [navigate]);

  React.useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications, location.pathname]);

  React.useEffect(() => {
    const handleCustomizationUpdated = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail) {
        setCustomization(prev => ({
          ...prev,
          ...detail
        }));
      }
    };

    window.addEventListener('customizationUpdated', handleCustomizationUpdated);
    return () => window.removeEventListener('customizationUpdated', handleCustomizationUpdated);
  }, []);

  const menuItems = React.useMemo(() => {
    const items = [
      { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard' },
      { icon: Folder, label: 'Meus Arquivos', href: '/documents' },
      { 
        icon: FileText, 
        label: 'Contratos', 
        href: '/contracts' 
      },
      { 
        icon: LayoutTemplate, 
        label: 'Templates', 
        href: '/contracts/templates' 
      },
      { 
        icon: AlertTriangle, 
        label: 'Vencimentos', 
        href: '/contracts/expirations' 
      },
      { icon: Share2, label: 'Compartilhados', href: '/shared' },
      ...(isPWA ? [{ icon: ScanLine, label: 'Digitalização', href: '/scanner' }] : []),
      { icon: Clock, label: 'Temporalidade', href: '/retention' },
      { icon: GitPullRequest, label: 'Workflow', href: '/workflows' },
      { icon: Users, label: 'Gestão de Acessos', href: '/access-management' },
      { icon: Trash2, label: 'Lixeira', href: '/trash' },
    ];

    // Filtragem baseada em Role
    const userRole = userData.role?.toUpperCase();
    
    // Usuário básico não vê gestão de acessos nem compartilhados (se "não compartilha" implica não ver a área)
    if (userRole === 'USER') {
      return items.filter(item => 
        item.href !== '/access-management' && 
        item.href !== '/shared' &&
        item.href !== '/retention'
      );
    }

    // Gestor vê tudo exceto o que for exclusivo de Admin (se houver)
    // No momento, Gestor pode ver Gestão de Acessos pois ele "cria usuário"
    
    return items;
  }, [isPWA, userData.role]);

  const bottomNavItems = React.useMemo(() => {
    const items = [
      { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard' },
      { icon: Folder, label: 'Arquivos', href: '/documents' },
      {
        icon: FileText,
        label: 'Contratos',
        href: '/contracts',
        children: [
          { icon: FileText, label: 'Contratos', href: '/contracts' },
          { icon: AlertTriangle, label: 'Vencimentos', href: '/contracts/expirations' },
          { icon: LayoutTemplate, label: 'Templates', href: '/contracts/templates' },
        ],
      },
      ...(isPWA ? [{ icon: ScanLine, label: 'Scanner', href: '/scanner' }] : []),
      { icon: Share2, label: 'Compart.', href: '/shared' },
      ...(!isPWA ? [{ icon: Users, label: 'Acessos', href: '/access-management' }] : []),
    ];

    // Filtragem baseada em Role para mobile
    const userRole = userData.role?.toUpperCase();
    if (userRole === 'USER') {
      return items.filter(item => 
        item.href !== '/access-management' && 
        item.href !== '/shared' &&
        item.href !== '/settings' &&
        item.href !== '/config'
      );
    }

    return items;
  }, [isPWA, userData.role]);

  const sidebarContent = (
    <div
      className="flex h-full flex-col border-r relative transition-all duration-300"
      style={{ backgroundColor: customization.sidebar_color, borderColor: sidebarAdvanced.border_color }}
    >
      <button
        onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
        className="absolute -right-3 top-8 bg-white border border-slate-200 rounded-full p-1 shadow-sm z-50 text-slate-500 hover:text-slate-700 hidden lg:flex"
      >
        {isSidebarExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      <div className={cn("p-6 flex items-center relative", isSidebarExpanded ? "gap-3" : "justify-center px-2")}>
        <div className="rounded-xl p-2 shadow-lg shadow-blue-900/10 flex-shrink-0" style={{ backgroundColor: sidebarAdvanced.brand_bg_color }}>
          {customization.logo_url ? (
            <img src={customization.logo_url} alt="Logo" className="h-5 w-5 object-contain" />
          ) : (
            <FileText className="h-5 w-5" style={{ color: sidebarAdvanced.brand_icon_color }} />
          )}
        </div>
        {isSidebarExpanded && (
          <div className="overflow-hidden">
            <h1 className="font-bold text-lg tracking-tight leading-none truncate" style={{ color: sidebarAdvanced.brand_title_color }}>
              {sidebarAdvanced.system_name || 'DocFlow'}
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-wider mt-0.5 truncate" style={{ color: sidebarAdvanced.brand_subtitle_color }}>
              {sidebarAdvanced.system_subtitle || 'Gestão de Documentos'}
            </p>
          </div>
        )}
      </div>

      <div className="flex-1 px-3 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
        {menuItems.map((item) => (
          <SidebarItem 
            key={item.href}
            {...item}
            isExpanded={isSidebarExpanded}
            theme="light"
            primaryColor={customization.primary_color}
            sidebarTextColor={customization.sidebar_text_color}
            sidebarIconColor={customization.sidebar_icon_color}
            sidebarFontWeight={customization.sidebar_font_weight}
            sidebarActiveBackgroundColor={sidebarAdvanced.item_active_bg}
            sidebarHoverBackgroundColor={sidebarAdvanced.item_hover_bg}
            sidebarActiveIndicatorColor={sidebarAdvanced.item_active_indicator}
            sidebarActiveTextColor={sidebarAdvanced.item_active_text}
            sidebarActiveIconColor={sidebarAdvanced.item_active_icon}
            active={location.pathname === item.href}
          />
        ))}
      </div>

      <div className="p-4 border-t space-y-1" style={{ borderColor: sidebarAdvanced.border_color }}>
        {userData.role?.toUpperCase() !== 'USER' && (
          <Link to="/settings" title={!isSidebarExpanded ? 'Configurações' : undefined}>
            <div className={cn(
              "flex items-center gap-3 rounded-lg transition-all",
              isSidebarExpanded ? "px-4 py-2.5" : "justify-center p-2.5 mx-1",
              location.pathname === '/settings' ? "bg-[var(--sidebar-active-bg)]" : "hover:bg-[var(--sidebar-hover-bg)]"
            )} style={{
              color: customization.sidebar_text_color,
              fontWeight: customization.sidebar_font_weight === 'bold' ? 700 : 400,
              '--sidebar-active-bg': sidebarAdvanced.settings_active_bg,
              '--sidebar-hover-bg': sidebarAdvanced.settings_hover_bg
            } as React.CSSProperties}>
              <Settings className="h-4.5 w-4.5 flex-shrink-0" style={{ color: customization.sidebar_icon_color }} />
              {isSidebarExpanded && <span className="text-sm truncate">Configurações</span>}
            </div>
          </Link>
        )}
        
        <button 
          onClick={handleLogout}
          title={!isSidebarExpanded ? 'Sair do Sistema' : undefined}
          className={cn(
            "w-full flex items-center gap-3 rounded-lg transition-all hover:bg-[var(--sidebar-hover-bg)]",
            isSidebarExpanded ? "px-4 py-2.5" : "justify-center p-2.5 mx-1"
          )}
          style={{ color: sidebarAdvanced.logout_text_color, '--sidebar-hover-bg': sidebarAdvanced.logout_hover_bg } as React.CSSProperties}
        >
          <LogOut className="h-4.5 w-4.5 flex-shrink-0" style={{ color: sidebarAdvanced.logout_icon_color }} />
          {isSidebarExpanded && <span className="text-sm font-medium truncate">Sair do Sistema</span>}
        </button>
      </div>
    </div>
  );

  const isScannerPage = location.pathname === '/scanner';

  return (
    <div className="flex h-screen bg-[#f8fafc] overflow-hidden font-sans">
      <aside className={cn("hidden lg:flex transition-all duration-300", isSidebarExpanded ? "lg:w-64" : "lg:w-20", isScannerPage && "lg:hidden")}>
        {sidebarContent}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar */}
        {!isScannerPage && (
          <header className="bg-white/70 backdrop-blur-xl border-b border-border/50 sticky top-0 z-30 pt-safe">
            <div className="flex items-center justify-between px-5 h-14 lg:h-20 lg:px-8 w-full max-w-7xl mx-auto">
              {/* Mobile Brand (App Native Style) */}
              <div className="flex items-center gap-2.5 lg:hidden">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm bg-[#0f172a]">
                  {customization.logo_url ? (
                    <img src={customization.logo_url} alt="Logo" className="h-5 w-5 object-contain" />
                  ) : (
                    <FileText className="h-5 w-5 text-white" />
                  )}
                </div>
                <h1 className="font-extrabold text-[16px] tracking-tight text-[#0f172a]">DocFlow</h1>
              </div>

              {/* Desktop Search / Mobile Spacer */}
              <div className="hidden lg:flex flex-1 max-w-2xl px-4">
                <div className="relative w-full group">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                  <Input 
                    placeholder="Pesquisar..." 
                    className="w-full pl-10 h-11 bg-slate-50/50 border-slate-200 focus:bg-white focus:ring-4 focus:ring-primary/5 transition-all rounded-xl"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        toast.info(`Pesquisando por: "${(e.target as HTMLInputElement).value}"`);
                      }
                    }}
                  />
                </div>
              </div>

              {/* Actions (Native Icons) */}
              <div className="flex items-center gap-1.5 lg:gap-6">
                <button 
                  className="lg:hidden p-2 text-[#0f172a] hover:bg-slate-100 rounded-full transition-colors"
                  onClick={() => toast.info('Funcionalidade de busca mobile em breve.')}
                >
                  <Search className="h-5 w-5" />
                </button>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button 
                      className="p-2 text-[#0f172a] hover:bg-slate-100 rounded-full transition-colors relative"
                      onClick={() => {
                        if (notifications.length === 0 && !notificationsLoading) {
                          toast.info('Você não possui novas notificações.');
                        }
                      }}
                    >
                      <Bell className="h-5 w-5" />
                      {unreadNotifications > 0 && (
                        <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 bg-blue-600 rounded-full ring-2 ring-white" />
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-80 bg-white border-border p-2 rounded-2xl shadow-xl animate-in slide-in-from-bottom-2 duration-200">
                    {notificationsLoading && (
                      <div className="px-3 py-4 text-xs text-slate-400 font-medium">Carregando notificações...</div>
                    )}
                    {!notificationsLoading && notifications.length === 0 && (
                      <div className="px-3 py-4 text-xs text-slate-400 font-medium">Sem notificações no momento.</div>
                    )}
                    {!notificationsLoading && notifications.length > 0 && (
                      <div className="max-h-72 overflow-y-auto">
                        {notifications.map((notification) => (
                          <DropdownMenuItem
                            key={notification.id}
                            className={cn(
                              "flex flex-col items-start gap-1 rounded-xl px-3 py-2 focus:bg-slate-50 cursor-pointer",
                              notification.read_at ? "opacity-70" : "opacity-100"
                            )}
                            onClick={() => handleNotificationClick(notification)}
                          >
                            <span className="text-xs font-bold text-slate-800">{notification.title}</span>
                            {notification.message && (
                              <span className="text-[11px] text-slate-400 font-medium line-clamp-2">{notification.message}</span>
                            )}
                            <span className="text-[10px] text-slate-400 font-medium">{formatNotificationDate(notification.created_at)}</span>
                          </DropdownMenuItem>
                        ))}
                      </div>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Link to="/profile" className="flex items-center gap-3 lg:pl-6 lg:border-l lg:border-border hover:opacity-80 transition-opacity">
                  <div className="hidden lg:text-right lg:block">
                    <p className="text-sm font-bold text-slate-900 leading-none">{userData.name}</p>
                    <p className="text-[11px] text-slate-400 font-medium mt-1">{userData.role}</p>
                  </div>
                  <Avatar className="h-8 w-8 lg:h-10 lg:w-10 border border-border shadow-sm">
                    {userData.avatar && <AvatarImage src={userData.avatar} />}
                    <AvatarFallback className="bg-slate-100 text-[#0f172a] font-bold text-[10px]">
                      {getInitials(userData.name)}
                    </AvatarFallback>
                  </Avatar>
                </Link>
              </div>
            </div>
          </header>
        )}

        {/* Page Content */}
        <ScrollArea className={cn("flex-1 bg-[#f8fafc]", !isScannerPage && "pb-24 lg:pb-0")}>
          <div className={cn("p-4 lg:p-8", isScannerPage && "p-0 lg:p-0 h-screen")}>
            {children}
          </div>
        </ScrollArea>
      </main>

      {/* Floating Bottom Navigation for Mobile */}
      {!isScannerPage && (
        <nav className="lg:hidden fixed bottom-6 left-4 right-4 z-50 bg-[#0f172a] border border-slate-800 shadow-[0_8px_32px_-4px_rgba(0,0,0,0.5)] rounded-[24px] overflow-hidden">
          <div 
            className="grid px-2 py-3" 
            style={{ gridTemplateColumns: `repeat(${bottomNavItems.length}, minmax(0, 1fr))` }}
          >
            {bottomNavItems.map((item) => {
              const isActive = item.children
                ? item.children.some(child => location.pathname === child.href) || location.pathname === item.href
                : location.pathname === item.href;
              const color = isActive ? "#3b82f6" : "#94a3b8";

              if (item.children) {
                return (
                  <DropdownMenu key={item.href}>
                    <DropdownMenuTrigger asChild>
                      <button
                        className={cn(
                          "flex flex-col items-center justify-center gap-1.5 transition-all active:scale-90",
                          isActive ? "relative" : "opacity-60"
                        )}
                      >
                        <div className={cn(
                          "p-2 rounded-2xl transition-all",
                          isActive ? "bg-slate-800 shadow-inner" : ""
                        )}>
                          <item.icon className="h-5 w-5" style={{ color }} />
                        </div>
                        <span className={cn(
                          "text-[10px] font-bold tracking-tight",
                          isActive ? "text-white" : "text-slate-500"
                        )}>
                          {item.label}
                        </span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="center"
                      side="top"
                      sideOffset={16}
                      className="w-52 bg-white border-border p-2 rounded-2xl shadow-xl animate-in slide-in-from-bottom-2 duration-200"
                    >
                      {item.children.map(child => (
                        <DropdownMenuItem
                          key={child.href}
                          className="flex items-center gap-3 p-3 rounded-xl focus:bg-slate-50 cursor-pointer"
                          onClick={() => navigate(child.href)}
                        >
                          <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center">
                            <child.icon className="h-4.5 w-4.5 text-slate-600" />
                          </div>
                          <span className="text-sm font-bold text-slate-700">{child.label}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              }

              return (
                <Link 
                  key={item.href} 
                  to={item.href} 
                  className={cn(
                    "flex flex-col items-center justify-center gap-1.5 transition-all active:scale-90",
                    isActive ? "relative" : "opacity-60"
                  )}
                >
                  <div className={cn(
                    "p-2 rounded-2xl transition-all",
                    isActive ? "bg-slate-800 shadow-inner" : ""
                  )}>
                    <item.icon className="h-5 w-5" style={{ color }} />
                  </div>
                  <span className={cn(
                    "text-[10px] font-bold tracking-tight",
                    isActive ? "text-white" : "text-slate-500"
                  )}>
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* Floating Action Button (FAB) for Mobile - Positioned above floating nav */}
      {!isScannerPage && (
        <div className="lg:hidden fixed bottom-28 right-6 z-40">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button 
                className="w-14 h-14 bg-[#0f172a] text-white rounded-full shadow-2xl flex items-center justify-center active:scale-95 transition-transform"
              >
                <Plus className="h-6 w-6" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="mb-2 w-56 bg-white border-border p-2 rounded-2xl shadow-xl animate-in slide-in-from-bottom-2 duration-200">
              <DropdownMenuItem 
                className="flex items-center gap-3 p-3 rounded-xl focus:bg-indigo-50 cursor-pointer group"
                onClick={() => {
                  if (location.pathname === '/documents') {
                    window.dispatchEvent(new CustomEvent('open-upload-modal'));
                  } else {
                    navigate('/documents?upload=true');
                  }
                }}
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center group-focus:bg-indigo-100 transition-colors">
                  <Upload className="h-5 w-5 text-indigo-600" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-slate-700">Upload</span>
                  <span className="text-[10px] text-slate-400 font-medium">Arquivos locais</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
