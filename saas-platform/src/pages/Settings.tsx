import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  User, Shield, Bell, Building, Mail, 
  Plus, Loader2, Camera, TextQuote,
  LayoutDashboard, Folder, Settings as SettingsIcon,
  FileText, LogOut
} from 'lucide-react';
import { toast } from 'sonner';
import QRCode from 'react-qr-code';

interface UserProfile {
  full_name: string;
  email: string;
  avatar_url: string;
  job_title: string;
  bio: string;
  notification_settings: string;
  security_settings: string;
}

interface CustomizationSettings {
  primary_color: string;
  secondary_color: string;
  sidebar_color: string;
  sidebar_text_color: string;
  sidebar_icon_color: string;
  sidebar_font_weight: string;
  logo_url: string;
  custom_settings: string;
}

interface AccountSettings {
  name: string;
  corporate_email: string;
  phone: string;
  address: string;
  account_settings: string;
  confidential_required: boolean;
  confidential_password: string;
  confidential_password_configured: boolean;
  watermark_text: string;
  watermark_size: number;
  watermark_offset_y: number;
  watermark_rotation: number;
  watermark_opacity: number;
}

interface TeamMember {
  id: number;
  full_name: string;
  email: string;
  role: string;
  avatar_url: string;
  job_title: string;
}

export default function Settings() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('perfil');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab) setActiveTab(tab);
  }, [location.search]);

  const [profile, setProfile] = useState<UserProfile>({
    full_name: '', email: '', avatar_url: '', job_title: '', bio: '',
    notification_settings: '{"email": true, "browser": true, "system": true}',
    security_settings: '{"two_factor": false, "session_timeout": 30}'
  });
  const [customization, setCustomization] = useState<CustomizationSettings>({
    primary_color: 'var(--color-primary)', 
    secondary_color: 'var(--secondary)', 
    sidebar_color: '#ffffff',
    sidebar_text_color: 'var(--muted-foreground)',
    sidebar_icon_color: 'var(--muted-foreground)',
    sidebar_font_weight: 'normal',
    logo_url: '', 
    custom_settings: '{}'
  });
  const [account, setAccount] = useState<AccountSettings>({
    name: '', corporate_email: '', phone: '', address: '', account_settings: '{}', confidential_required: false, confidential_password: '', confidential_password_configured: false, watermark_text: '', watermark_size: 80, watermark_offset_y: 0, watermark_rotation: 45, watermark_opacity: 20
  });
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaOtpAuthUrl, setMfaOtpAuthUrl] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [newMember, setNewMember] = useState({
    full_name: '',
    email: '',
    password: '',
    role_name: 'USER',
    sector_id: ''
  });

  const getValidToken = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined' || token === 'null') {
      localStorage.clear();
      navigate('/login');
      return null;
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload?.exp && Date.now() / 1000 >= payload.exp) {
        localStorage.clear();
        navigate('/login');
        return null;
      }
    } catch {
      localStorage.clear();
      navigate('/login');
      return null;
    }
    return token;
  }, [navigate]);

  const fetchTeam = useCallback(async () => {
    try {
      const token = getValidToken();
      if (!token) return;
      const res = await fetch('/api/v1/team', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.status === 401) {
        localStorage.clear();
        navigate('/login');
        return;
      }
      if (res.ok) setTeamMembers(await res.json());
    } catch (error) {
      console.error('Erro ao buscar equipe:', error);
    }
  }, [getValidToken, navigate]);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      const token = getValidToken();
      if (!token) {
        setLoading(false);
        return;
      }
      const headers = { 'Authorization': `Bearer ${token}` };
      const [pRes, cRes, aRes] = await Promise.all([
        fetch('/api/v1/profile', { headers }),
        fetch('/api/v1/customization', { headers }),
        fetch('/api/v1/account', { headers })
      ]);

      if (pRes.status === 401 || cRes.status === 401 || aRes.status === 401) {
        localStorage.clear();
        navigate('/login');
        return;
      }

      if (pRes.ok) {
        const data = await pRes.json();
        setUserRole(data.role || '');
        setProfile({
          full_name: data.full_name || '',
          email: data.email || '',
          avatar_url: data.avatar_url || '',
          job_title: data.job_title || '',
          bio: data.bio || '',
          notification_settings: data.notification_settings || '{"email": true, "browser": true, "system": true}',
          security_settings: data.security_settings || '{"two_factor": false, "session_timeout": 30}'
        });
      }
      if (cRes.ok) {
        const data = await cRes.json();
        setCustomization({
          primary_color: data.primary_color || 'var(--color-primary)',
          secondary_color: data.secondary_color || 'var(--secondary)',
          sidebar_color: data.sidebar_color || '#ffffff',
          sidebar_text_color: data.sidebar_text_color || 'var(--muted-foreground)',
          sidebar_icon_color: data.sidebar_icon_color || 'var(--muted-foreground)',
          sidebar_font_weight: data.sidebar_font_weight || 'normal',
          logo_url: data.logo_url || '',
          custom_settings: data.custom_settings || '{}'
        });
      }

      if (aRes.ok) {
        const data = await aRes.json();
        setAccount({
          name: data.name || '',
          corporate_email: data.corporate_email || '',
          phone: data.phone || '',
          address: data.address || '',
          account_settings: data.account_settings || '{}',
          confidential_required: !!data.confidential_required,
          confidential_password: '',
          confidential_password_configured: !!data.confidential_password_configured,
          watermark_text: data.watermark_text || '',
          watermark_size: data.watermark_size || 80,
          watermark_offset_y: data.watermark_offset_y ?? 0,
          watermark_rotation: data.watermark_rotation ?? 0,
          watermark_opacity: data.watermark_opacity ?? 0.2
        });
      }
      
      await Promise.all([fetchTeam()]);
    } catch {
      toast.error('Erro ao carregar configurações');
    } finally {
      setLoading(false);
    }
  }, [getValidToken, navigate, fetchTeam]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const token = getValidToken();
      if (!token) return;
      const res = await fetch('/api/v1/profile', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(profile)
      });
      if (res.ok) toast.success('Perfil atualizado!');
      else toast.error('Erro ao atualizar perfil');
    } catch (error) {
      console.error(error);
      toast.error('Erro de conexão');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCustomization = async () => {
    setSaving(true);
    try {
      const token = getValidToken();
      if (!token) return;
      const res = await fetch('/api/v1/customization', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(customization)
      });
      if (res.ok) {
        toast.success('Personalização atualizada!');
        window.dispatchEvent(new CustomEvent('customizationUpdated', { detail: customization }));
      } else {
        toast.error('Erro ao atualizar personalização');
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro de conexão');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardCustomization = () => {
    fetchAllData();
    toast.info('Alterações descartadas');
  };

  const handleSaveAccount = async () => {
    setSaving(true);
    try {
      const token = getValidToken();
      if (!token) return;
      const payload = {
        name: account.name,
        corporate_email: account.corporate_email,
        phone: account.phone,
        address: account.address,
        account_settings: account.account_settings,
        confidential_required: account.confidential_required,
        confidential_password: account.confidential_password,
        watermark_text: account.watermark_text,
        watermark_size: account.watermark_size
      };
      const res = await fetch('/api/v1/account', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        toast.success('Dados da conta atualizados!');
        setAccount(prev => ({ ...prev, confidential_password: '' }));
        fetchAllData();
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro de conexão');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!passwords.new || !passwords.confirm) {
      toast.error('Preencha as novas senhas');
      return;
    }
    if (passwords.new !== passwords.confirm) {
      toast.error('As senhas não coincidem');
      return;
    }

    setSaving(true);
    try {
      const token = getValidToken();
      if (!token) return;
      const res = await fetch('/api/v1/reset-password', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ new_password: passwords.new })
      });
      if (res.ok) {
        toast.success('Senha atualizada com sucesso!');
        setPasswords({ current: '', new: '', confirm: '' });
      } else {
        toast.error('Erro ao atualizar senha');
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro de conexão');
    } finally {
      setSaving(false);
    }
  };

  const handleSetupMFA = async () => {
    setMfaBusy(true);
    try {
      const token = getValidToken();
      if (!token) return;
      const res = await fetch('/api/v1/mfa/setup', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMfaSecret(data.secret || '');
        setMfaOtpAuthUrl(data.otpauth_url || '');
        toast.success('Segredo MFA gerado');
      } else {
        const text = await res.text();
        toast.error(text || 'Erro ao configurar MFA');
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro de conexão');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleVerifyMFA = async () => {
    if (!mfaCode) {
      toast.error('Informe o código MFA');
      return;
    }
    setMfaBusy(true);
    try {
      const token = getValidToken();
      if (!token) return;
      const res = await fetch('/api/v1/mfa/verify', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ code: mfaCode })
      });
      if (res.ok) {
        const next = { ...safeParseJson(profile.security_settings), two_factor: true };
        setProfile({ ...profile, security_settings: JSON.stringify(next) });
        setMfaSecret('');
        setMfaOtpAuthUrl('');
        setMfaCode('');
        toast.success('MFA ativado com sucesso');
      } else {
        const text = await res.text();
        toast.error(text || 'Erro ao ativar MFA');
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro de conexão');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleDisableMFA = async () => {
    if (!mfaCode) {
      toast.error('Informe o código MFA');
      return;
    }
    setMfaBusy(true);
    try {
      const token = getValidToken();
      if (!token) return;
      const res = await fetch('/api/v1/mfa/disable', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ code: mfaCode })
      });
      if (res.ok) {
        const next = { ...safeParseJson(profile.security_settings), two_factor: false };
        setProfile({ ...profile, security_settings: JSON.stringify(next) });
        setMfaSecret('');
        setMfaOtpAuthUrl('');
        setMfaCode('');
        toast.success('MFA desativado com sucesso');
      } else {
        const text = await res.text();
        toast.error(text || 'Erro ao desativar MFA');
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro de conexão');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleCopyValue = async (value: string) => {
    if (!value) return;
    try {
      if (!navigator.clipboard) {
        toast.error('Clipboard indisponível');
        return;
      }
      await navigator.clipboard.writeText(value);
      toast.success('Copiado');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao copiar');
    }
  };

  const handleInviteMember = async () => {
    if (!newMember.full_name || !newMember.email || !newMember.password) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }

    setSaving(true);
    try {
      const token = getValidToken();
      if (!token) return;
      const res = await fetch('/api/v1/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...newMember,
          sector_id: newMember.sector_id === '' ? null : newMember.sector_id
        })
      });

      if (res.ok) {
        toast.success('Membro convidado com sucesso');
        setInviteDialogOpen(false);
        setNewMember({
          full_name: '',
          email: '',
          password: '',
          role_name: 'USER',
          sector_id: ''
        });
        fetchTeam();
      } else {
        const data = await res.json();
        toast.error(data.message || 'Erro ao convidar membro');
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro de conexão');
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);

  const safeParseJson = (value: string) => {
    try {
      return JSON.parse(value || '{}') || {};
    } catch {
      return {};
    }
  };

  const sidebarAdvanced = useMemo(() => {
    const custom = safeParseJson(customization.custom_settings);
    return {
      brand_bg_color: custom.sidebar_brand_bg || customization.primary_color,
      item_hover_bg: custom.sidebar_item_hover_bg || '#f1f5f9',
      item_active_bg: custom.sidebar_item_active_bg || 'var(--primary)',
      item_active_text: custom.sidebar_item_active_text || '#ffffff',
      item_active_icon: custom.sidebar_item_active_icon || '#ffffff',
      show_brand_section: custom.sidebar_show_brand !== false,
      border_radius: custom.sidebar_border_radius || 'xl',
      system_name: custom.system_name || 'DocFlow',
      system_subtitle: custom.system_subtitle || 'Gestão de Documentos',
    };
  }, [customization.custom_settings, customization.primary_color]);

  const SidebarPreview = () => {
    const borderRadiusMap: Record<string, string> = {
      none: '0px',
      md: '6px',
      lg: '8px',
      xl: '12px',
      full: '9999px',
    };

    const previewItems = [
      { icon: LayoutDashboard, label: 'Dashboard', active: true },
      { icon: Folder, label: 'Arquivos' },
      { icon: SettingsIcon, label: 'Configurações' },
    ];

    return (
      <div className="rounded-2xl border border-border overflow-hidden shadow-sm bg-white h-full flex flex-col min-h-[400px]">
        <div className="p-3 border-b border-border flex items-center gap-2 bg-slate-50/50">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/20 border border-red-400/30" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400/20 border border-amber-400/30" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400/20 border border-green-400/30" />
          </div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-2">Preview do Menu</span>
        </div>
        
        <div className="flex-1 flex flex-col" style={{ backgroundColor: customization.sidebar_color }}>
          {sidebarAdvanced.show_brand_section && (
            <div className="p-4 flex items-center gap-2.5">
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm" 
                style={{ backgroundColor: sidebarAdvanced.brand_bg_color }}
              >
                {customization.logo_url ? (
                  <img src={customization.logo_url} alt="Logo" className="h-4 w-4 object-contain" />
                ) : (
                  <FileText className="h-4 w-4 text-white" />
                )}
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-black tracking-tight leading-none text-slate-900">
                  {sidebarAdvanced.system_name}
                </span>
                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                  {sidebarAdvanced.system_subtitle}
                </span>
              </div>
            </div>
          )}

          <div className="flex-1 px-2 py-4 space-y-1">
            {previewItems.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-2.5 px-3 py-2 transition-all duration-200"
                style={{
                  borderRadius: borderRadiusMap[sidebarAdvanced.border_radius as keyof typeof borderRadiusMap] || '12px',
                  backgroundColor: item.active ? sidebarAdvanced.item_active_bg : 'transparent',
                  color: item.active ? sidebarAdvanced.item_active_text : customization.sidebar_text_color,
                  fontWeight: customization.sidebar_font_weight === 'bold' ? 700 : 400,
                }}
              >
                <item.icon 
                  className="h-4 w-4" 
                  style={{ 
                    color: item.active ? sidebarAdvanced.item_active_icon : customization.sidebar_icon_color 
                  }} 
                />
                <span className="text-[11px] font-bold">{item.label}</span>
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-border mt-auto">
            <div 
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-red-500 bg-red-50/50"
            >
              <LogOut className="h-4 w-4" />
              <span className="text-[11px] font-bold">Sair</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const updateSidebarAdvanced = (key: string, value: string | number | boolean) => {
    const current = safeParseJson(customization.custom_settings);
    setCustomization({
      ...customization,
      custom_settings: JSON.stringify({ ...current, [key]: value })
    });
  };

  const ColorField = ({ label, value, onChange, inputId }: { label: string; value: string; onChange: (value: string) => void; inputId: string; }) => (
    <div className="space-y-3">
      <Label className="text-sm font-bold text-slate-700 ml-1">{label}</Label>
      <div className="flex gap-2">
        <div className="relative group cursor-pointer">
          <div 
            className="h-12 w-14 rounded-xl border border-border shadow-sm transition-transform group-hover:scale-105" 
            style={{ backgroundColor: value }}
            onClick={() => document.getElementById(inputId)?.click()}
          />
          <input 
            id={inputId}
            type="color" 
            className="absolute inset-0 opacity-0 cursor-pointer" 
            value={value}
            onChange={e => onChange(e.target.value)}
          />
        </div>
        <Input 
          value={value} 
          onChange={e => onChange(e.target.value)} 
          className="font-mono text-sm bg-slate-100 border-none h-12 rounded-xl focus:ring-2 focus:ring-primary/10" 
        />
      </div>
    </div>
  );

  const tabs = useMemo(() => {
    const role = userRole.toUpperCase();
    if (role === 'ADMIN' || role === 'MASTER') {
      return ['Perfil', 'Conta', 'Notificações', 'Segurança', 'Equipe', 'Personalização'];
    }
    if (role === 'GESTOR') {
      return ['Perfil', 'Conta', 'Notificações', 'Segurança'];
    }
    return ['Perfil', 'Notificações', 'Segurança'];
  }, [userRole]);

  const canManageSystem = useMemo(() => {
    const role = userRole.toUpperCase();
    return role === 'ADMIN' || role === 'MASTER';
  }, [userRole]);

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-24 lg:pb-10 px-0 sm:px-0">
      <div className="flex flex-col gap-1 px-4 sm:px-0">
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Configurações</h1>
        <p className="text-sm sm:text-base text-slate-500 font-medium">Gerencie suas preferências de perfil, segurança e conta corporativa.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="sticky top-0 z-20 bg-[#f8fafc]/95 backdrop-blur-xl border-b border-border mb-6 sm:mb-8">
          <div className="max-w-6xl mx-auto">
            <TabsList className="bg-transparent w-full justify-start h-auto p-0 gap-6 sm:gap-8 rounded-none overflow-x-auto no-scrollbar flex-nowrap whitespace-nowrap px-4 sm:px-0">
              {tabs.map((tab) => (
                <TabsTrigger 
                  key={tab}
                  value={tab.toLowerCase()} 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-1 py-4 text-xs sm:text-sm font-bold text-slate-400 data-[state=active]:text-primary transition-all shrink-0 relative"
                >
                  {tab}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>

        <div className="px-4 sm:px-0">
          {/* ABA PERFIL */}
          <TabsContent value="perfil" className="space-y-6 sm:space-y-8 mt-0 animate-in fade-in slide-in-from-bottom-2 duration-300 outline-none">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8 bg-white p-6 sm:p-8 rounded-2xl border border-border shadow-sm">
              <div className="relative group shrink-0">
                <Avatar className="h-24 w-24 sm:h-32 sm:w-32 border-4 border-white shadow-2xl ring-1 ring-slate-100">
                  <AvatarImage src={profile.avatar_url} />
                  <AvatarFallback className="bg-gradient-to-br from-blue-50 to-blue-100 text-primary text-2xl sm:text-3xl font-black">
                    {getInitials(profile.full_name || 'User')}
                  </AvatarFallback>
                </Avatar>
                <Button 
                  size="icon" 
                  variant="secondary" 
                  className="absolute -bottom-1 -right-1 rounded-xl h-10 w-10 shadow-xl border border-white bg-white hover:bg-slate-50 text-slate-600"
                  onClick={() => {
                    const url = prompt('URL do Avatar:', profile.avatar_url);
                    if (url !== null) setProfile({...profile, avatar_url: url});
                  }}
                >
                  <Camera className="h-5 w-5" />
                </Button>
              </div>
              <div className="flex-1 text-center sm:text-left">
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">{profile.full_name || 'Nome do Usuário'}</h2>
                <p className="text-slate-500 font-bold text-sm sm:text-base mt-1">{profile.job_title || 'Cargo / Título'}</p>
                <div className="mt-6 flex flex-wrap justify-center sm:justify-start gap-3 w-full sm:w-auto">
                  <Button 
                    size="sm" 
                    variant="default" 
                    className="bg-primary text-white hover:bg-primary/90 h-11 sm:h-10 px-6 flex-1 sm:flex-none rounded-xl font-bold text-xs" 
                    onClick={() => {
                      const url = prompt('URL do Avatar:', profile.avatar_url);
                      if (url !== null) setProfile({...profile, avatar_url: url});
                    }}
                  >
                    Alterar Foto
                  </Button>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="h-11 sm:h-10 px-6 flex-1 sm:flex-none rounded-xl font-bold text-xs text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                    onClick={() => setProfile({...profile, avatar_url: ''})}
                  >
                    Remover
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
              <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden border border-border">
                <CardHeader className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-blue-50 text-primary">
                      <User className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg font-black text-slate-900 tracking-tight">Informações Pessoais</CardTitle>
                      <CardDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Dados básicos do seu perfil</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-5 sm:space-y-6">
                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700 ml-1">Nome Completo</Label>
                    <Input 
                      value={profile.full_name} 
                      onChange={e => setProfile({...profile, full_name: e.target.value})}
                      className="h-12 bg-slate-50 border-none rounded-xl font-bold text-slate-700 focus:ring-2 focus:ring-primary/10 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700 ml-1">Cargo / Função</Label>
                    <Input 
                      value={profile.job_title} 
                      onChange={e => setProfile({...profile, job_title: e.target.value})}
                      className="h-12 bg-slate-50 border-none rounded-xl font-bold text-slate-700 focus:ring-2 focus:ring-primary/10 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700 ml-1">Biografia</Label>
                    <textarea 
                      value={profile.bio} 
                      onChange={e => setProfile({...profile, bio: e.target.value})}
                      rows={4}
                      className="w-full bg-slate-50 border-none focus:ring-2 focus:ring-primary/10 rounded-xl font-bold text-slate-700 text-sm transition-all p-4 outline-none resize-none"
                      placeholder="Conte um pouco sobre você..."
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden border border-border">
                <CardHeader className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg font-black text-slate-900 tracking-tight">Contato & Acesso</CardTitle>
                      <CardDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Como o sistema se comunica com você</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-5 sm:space-y-6">
                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700 ml-1">E-mail de Acesso</Label>
                    <Input 
                      value={profile.email} 
                      disabled
                      className="h-12 bg-slate-50 border-none rounded-xl font-bold text-slate-400 cursor-not-allowed"
                    />
                    <p className="text-[10px] text-slate-400 font-medium ml-1">O e-mail não pode ser alterado por motivos de segurança.</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-end pt-4 pb-10">
              <Button 
                onClick={handleSaveProfile} 
                disabled={saving}
                className="h-12 px-10 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold shadow-lg shadow-blue-900/10 transition-all active:scale-[0.97]"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Salvar Alterações'}
              </Button>
            </div>
          </TabsContent>

        {/* ABA CONTA */}
        <TabsContent value="conta" className="space-y-6 sm:space-y-8 mt-0 animate-in fade-in slide-in-from-bottom-2 duration-300 outline-none">
          <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden border border-border">
            <CardHeader className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-50 text-primary">
                  <Building className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg font-black text-slate-900 tracking-tight">Dados da Empresa</CardTitle>
                  <CardDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Informações corporativas da conta</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-5 sm:space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700 ml-1">Nome da Empresa</Label>
                  <Input 
                    value={account.name} 
                    disabled={!canManageSystem}
                    onChange={e => setAccount({...account, name: e.target.value})}
                    className="h-12 bg-slate-50 border-none rounded-xl font-bold text-slate-700 focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-70"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700 ml-1">E-mail Corporativo</Label>
                  <Input 
                    value={account.corporate_email} 
                    disabled={!canManageSystem}
                    onChange={e => setAccount({...account, corporate_email: e.target.value})}
                    className="h-12 bg-slate-50 border-none rounded-xl font-bold text-slate-700 focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-70"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700 ml-1">Telefone</Label>
                  <Input 
                    value={account.phone} 
                    disabled={!canManageSystem}
                    onChange={e => setAccount({...account, phone: e.target.value})}
                    className="h-12 bg-slate-50 border-none rounded-xl font-bold text-slate-700 focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-70"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700 ml-1">Endereço</Label>
                  <Input 
                    value={account.address} 
                    disabled={!canManageSystem}
                    onChange={e => setAccount({...account, address: e.target.value})}
                    className="h-12 bg-slate-50 border-none rounded-xl font-bold text-slate-700 focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-70"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden border border-border">
            <CardHeader className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-rose-50 text-rose-600">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg font-black text-slate-900 tracking-tight">Etiquetas Confidenciais</CardTitle>
                  <CardDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Exija senha para arquivos marcados</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-5">
              <div className="flex items-center justify-between gap-4 p-5 sm:p-6 rounded-2xl bg-slate-50 border border-border/50">
                <div className="space-y-1">
                  <Label className="text-sm sm:text-base font-black text-slate-800 tracking-tight cursor-pointer" htmlFor="confidential-required">Solicitar senha ao abrir</Label>
                  <p className="text-[10px] sm:text-xs font-bold text-slate-400 leading-relaxed">Arquivos com a etiqueta Confidencial exigem autenticação adicional.</p>
                </div>
                <Switch 
                  id="confidential-required"
                  checked={account.confidential_required}
                  onCheckedChange={(checked) => setAccount({ ...account, confidential_required: checked })}
                  className="data-[state=checked]:bg-primary"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold text-slate-700 ml-1">Nova senha de acesso</Label>
                <Input 
                  type="password"
                  value={account.confidential_password}
                  onChange={e => setAccount({...account, confidential_password: e.target.value})}
                  className="h-12 bg-slate-50 border-none rounded-xl font-bold text-slate-700 focus:ring-2 focus:ring-primary/10 transition-all"
                  placeholder={account.confidential_password_configured ? 'Senha já configurada' : 'Defina uma senha'}
                />
                <p className="text-[10px] text-slate-400 font-medium ml-1">
                  {account.confidential_password_configured ? 'Senha já configurada para este tenant.' : 'Nenhuma senha configurada.'}
                </p>
              </div>
              
              <div className="space-y-2 pt-2">
                <Label className="text-sm font-bold text-slate-700 ml-1">Texto da Marca d'água</Label>
                <div className="relative group">
                  <TextQuote className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                  <Input 
                    value={account.watermark_text}
                    onChange={e => setAccount({...account, watermark_text: e.target.value})}
                    className="h-12 bg-slate-50 border-none rounded-xl font-bold text-slate-700 pl-11 focus:ring-2 focus:ring-primary/10 transition-all"
                    placeholder="Ex: CONFIDENCIAL - [NOME EMPRESA]"
                  />
                </div>
                <p className="text-[10px] text-slate-400 font-medium ml-1 leading-relaxed">
                  Este texto aparecerá em diagonal nos arquivos PDF marcados como confidenciais.
                </p>
              </div>

              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between ml-1">
                  <Label className="text-sm font-bold text-slate-700">Tamanho da Marca d'água</Label>
                  <span className="text-xs font-black text-primary bg-blue-50 px-2 py-1 rounded-lg">{account.watermark_size}%</span>
                </div>
                <div className="px-1">
                  <input 
                    type="range" 
                    min="10" 
                    max="1000" 
                    step="5"
                    value={account.watermark_size}
                    onChange={e => setAccount({...account, watermark_size: parseInt(e.target.value)})}
                    className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <div className="flex justify-between mt-2 text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                    <span>Pequeno</span>
                    <span>Padrão (80%)</span>
                    <span>Massivo (1000%)</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between ml-1">
                  <Label className="text-sm font-bold text-slate-700">Posição Vertical (Altura)</Label>
                  <span className="text-xs font-black text-primary bg-blue-50 px-2 py-1 rounded-lg">{account.watermark_offset_y || 0}px</span>
                </div>
                <div className="px-1">
                  <input 
                    type="range" 
                    min="-1500" 
                    max="1500" 
                    step="10"
                    value={account.watermark_offset_y || 0}
                    onChange={e => setAccount({...account, watermark_offset_y: parseInt(e.target.value)})}
                    className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <div className="flex justify-between mt-2 text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                    <span>Inferior</span>
                    <span>Centro (0)</span>
                    <span>Superior</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between ml-1">
                  <Label className="text-sm font-bold text-slate-700">Rotação do Texto</Label>
                  <span className="text-xs font-black text-primary bg-blue-50 px-2 py-1 rounded-lg">{account.watermark_rotation || 45}°</span>
                </div>
                <div className="px-1">
                  <input 
                    type="range" 
                    min="0" 
                    max="360" 
                    step="1"
                    value={account.watermark_rotation || 45}
                    onChange={e => setAccount({...account, watermark_rotation: parseInt(e.target.value)})}
                    className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <div className="flex justify-between mt-2 text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                     <span>Horizontal (0°)</span>
                     <span>Padrão (45°)</span>
                     <span>Vertical (90°)</span>
                   </div>
                 </div>
               </div>

               <div className="space-y-4 pt-2">
                 <div className="flex items-center justify-between ml-1">
                   <Label className="text-sm font-bold text-slate-700">Opacidade (Claro/Escuro)</Label>
                   <span className="text-xs font-black text-primary bg-blue-50 px-2 py-1 rounded-lg">{account.watermark_opacity || 20}%</span>
                 </div>
                 <div className="px-1">
                   <input 
                     type="range" 
                     min="5" 
                     max="100" 
                     step="1"
                     value={account.watermark_opacity || 20}
                     onChange={e => setAccount({...account, watermark_opacity: parseInt(e.target.value)})}
                     className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-primary"
                   />
                   <div className="flex justify-between mt-2 text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                     <span>Muito Claro</span>
                     <span>Sutil (20%)</span>
                     <span>Escuro (100%)</span>
                   </div>
                 </div>
               </div>

              {/* Preview da Marca d'água A4 */}
              <div className="space-y-3 pt-4 border-t border-border">
                <div className="flex items-center justify-between ml-1">
                  <Label className="text-sm font-bold text-slate-700">Prévia Visual (Formato A4)</Label>
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-md border border-border">Proporção Real</span>
                </div>
                
                <div className="flex justify-center bg-slate-50 py-8 rounded-2xl border border-border">
                  <div 
                    className="relative bg-white shadow-2xl border border-border overflow-hidden flex items-center justify-center transition-all duration-300"
                    style={{ 
                      width: '210px', 
                      height: '297px',
                      borderRadius: '4px'
                    }}
                  >
                    {/* Fundo simulando um documento A4 */}
                    <div className="absolute inset-6 space-y-3 opacity-5">
                      {[...Array(15)].map((_, i) => (
                        <div key={i} className="space-y-1">
                          <div className="h-1 w-3/4 bg-slate-900 rounded"></div>
                          <div className="h-1 w-full bg-slate-900 rounded"></div>
                        </div>
                      ))}
                    </div>
                    
                    {/* A Marca d'água Real */}
                    <div 
                      className="relative z-10 font-black text-slate-900 pointer-events-none select-none text-center whitespace-nowrap transition-all duration-500"
                      style={{ 
                        transform: `rotate(-${account.watermark_rotation || 45}deg) translateY(${(account.watermark_offset_y || 0) * -0.25}px)`,
                        opacity: (account.watermark_opacity || 20) / 100,
                        fontSize: `${(account.watermark_size || 80) * 0.25}px`,
                        filter: 'grayscale(1)',
                        letterSpacing: '-0.02em'
                      }}
                    >
                      {account.watermark_text || 'CONFIDENCIAL'}
                    </div>
                    
                    <div className="absolute top-4 left-4 w-8 h-1 bg-slate-100 rounded"></div>
                    <div className="absolute bottom-4 right-4 text-[6px] font-bold text-slate-200 uppercase tracking-tighter">
                      Página 1 de 1
                    </div>
                  </div>
                </div>
                
                <p className="text-[10px] text-slate-400 font-medium text-center italic leading-relaxed">
                  A visualização acima simula uma folha A4. O tamanho da marca d'água é proporcional ao que será gerado no PDF final.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end pt-4 pb-10">
            <Button 
              className="h-12 px-10 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold shadow-lg shadow-blue-900/10 transition-all active:scale-[0.97]" 
              onClick={handleSaveAccount}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Salvar Alterações'}
            </Button>
          </div>
        </TabsContent>

        {/* ABA NOTIFICAÇÕES */}
        <TabsContent value="notificações" className="space-y-6 sm:space-y-8 mt-0 animate-in fade-in slide-in-from-bottom-2 duration-300 outline-none">
          <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden border border-border">
            <CardHeader className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-50 text-primary">
                  <Bell className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg font-black text-slate-900 tracking-tight">Preferências de Notificação</CardTitle>
                  <CardDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Escolha como deseja ser avisado</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-4 sm:space-y-6">
              {[
                { key: 'email', label: 'Notificações por E-mail', desc: 'Receba atualizações importantes diretamente na sua caixa de entrada.' },
                { key: 'browser', label: 'Notificações no Navegador', desc: 'Alertas em tempo real enquanto você navega pela plataforma.' },
                { key: 'system', label: 'Alertas do Sistema', desc: 'Notificações sobre manutenções e novidades da ferramenta.' }
              ].map((item) => {
                const settings = safeParseJson(profile.notification_settings);
                return (
                  <div key={item.key} className="flex items-center justify-between gap-4 p-5 sm:p-6 rounded-2xl bg-slate-50 border border-border/50 hover:bg-slate-100 transition-colors">
                    <div className="space-y-1">
                      <Label className="text-sm sm:text-base font-black text-slate-800 tracking-tight cursor-pointer" htmlFor={`notif-${item.key}`}>{item.label}</Label>
                      <p className="text-[10px] sm:text-xs font-bold text-slate-400 leading-relaxed">{item.desc}</p>
                    </div>
                    <Switch 
                      id={`notif-${item.key}`}
                      checked={settings[item.key] !== false}
                      onCheckedChange={(checked) => {
                        const next = { ...settings, [item.key]: checked };
                        setProfile({ ...profile, notification_settings: JSON.stringify(next) });
                      }}
                      className="data-[state=checked]:bg-primary"
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
          
          <div className="flex justify-end pt-4 pb-10">
            <Button 
              className="h-12 px-10 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold shadow-lg shadow-blue-900/10 transition-all active:scale-[0.97]" 
              onClick={handleSaveProfile}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Salvar Alterações'}
            </Button>
          </div>
        </TabsContent>

        {/* ABA SEGURANÇA */}
        <TabsContent value="segurança" className="space-y-6 sm:space-y-8 mt-0 animate-in fade-in slide-in-from-bottom-2 duration-300 outline-none">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
            <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden border border-border">
              <CardHeader className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-blue-50 text-primary">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-black text-slate-900 tracking-tight">Alterar Senha</CardTitle>
                    <CardDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Mantenha sua conta protegida</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-5 sm:space-y-6">
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700 ml-1">Nova Senha</Label>
                  <Input 
                    type="password"
                    value={passwords.new} 
                    onChange={e => setPasswords({...passwords, new: e.target.value})}
                    className="h-12 bg-slate-50 border-none rounded-xl font-bold text-slate-700 focus:ring-2 focus:ring-primary/10 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700 ml-1">Confirmar Nova Senha</Label>
                  <Input 
                    type="password"
                    value={passwords.confirm} 
                    onChange={e => setPasswords({...passwords, confirm: e.target.value})}
                    className="h-12 bg-slate-50 border-none rounded-xl font-bold text-slate-700 focus:ring-2 focus:ring-primary/10 transition-all"
                  />
                </div>
                <Button 
                  className="w-full h-12 rounded-xl bg-primary text-white hover:bg-primary/90 font-bold text-xs sm:text-sm mt-2 transition-all shadow-lg" 
                  onClick={handleUpdatePassword}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Atualizar Senha
                </Button>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden border border-border">
              <CardHeader className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-blue-50 text-primary">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-black text-slate-900 tracking-tight">Sessão</CardTitle>
                    <CardDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Controle de acesso</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-6">
                <div className="space-y-4 p-5 sm:p-6 rounded-2xl bg-slate-50 border border-border">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <Label className="text-sm sm:text-base font-black text-slate-800 tracking-tight">Autenticação em 2 fatores</Label>
                      <p className="text-[10px] sm:text-xs font-bold text-slate-400 leading-relaxed">
                        {safeParseJson(profile.security_settings).two_factor ? 'Ativo' : 'Inativo'}
                      </p>
                    </div>
                    {!safeParseJson(profile.security_settings).two_factor && (
                      <Button
                        variant="outline"
                        className="h-10 rounded-xl text-xs font-bold"
                        onClick={handleSetupMFA}
                        disabled={mfaBusy}
                      >
                        {mfaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Configurar'}
                      </Button>
                    )}
                  </div>
                  {!safeParseJson(profile.security_settings).two_factor && mfaSecret && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-xs font-bold text-slate-500">Segredo MFA</Label>
                        <div className="flex gap-2">
                          <Input value={mfaSecret} readOnly className="h-10 bg-white font-mono text-xs" />
                          <Button
                            variant="outline"
                            className="h-10 text-xs font-bold"
                            onClick={() => handleCopyValue(mfaSecret)}
                          >
                            Copiar
                          </Button>
                        </div>
                      </div>
                      {mfaOtpAuthUrl && (
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label className="text-xs font-bold text-slate-500">QR code</Label>
                            <div className="flex justify-center rounded-xl bg-white p-4 border border-border">
                              <QRCode value={mfaOtpAuthUrl} size={160} />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs font-bold text-slate-500">URL otpauth</Label>
                            <div className="flex gap-2">
                              <Input value={mfaOtpAuthUrl} readOnly className="h-10 bg-white text-xs" />
                              <Button
                                variant="outline"
                                className="h-10 text-xs font-bold"
                                onClick={() => handleCopyValue(mfaOtpAuthUrl)}
                              >
                                Copiar
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label className="text-xs font-bold text-slate-500">Código MFA</Label>
                        <Input
                          value={mfaCode}
                          onChange={(e) => setMfaCode(e.target.value)}
                          placeholder="000000"
                          className="h-10 bg-white text-xs"
                        />
                      </div>
                      <Button
                        className="w-full h-10 rounded-xl bg-primary text-white hover:bg-primary/90 font-bold text-xs"
                        onClick={handleVerifyMFA}
                        disabled={mfaBusy}
                      >
                        {mfaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ativar MFA'}
                      </Button>
                    </div>
                  )}
                  {safeParseJson(profile.security_settings).two_factor && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-xs font-bold text-slate-500">Código MFA</Label>
                        <Input
                          value={mfaCode}
                          onChange={(e) => setMfaCode(e.target.value)}
                          placeholder="000000"
                          className="h-10 bg-white text-xs"
                        />
                      </div>
                      <Button
                        variant="outline"
                        className="w-full h-10 rounded-xl text-xs font-bold"
                        onClick={handleDisableMFA}
                        disabled={mfaBusy}
                      >
                        {mfaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Desativar MFA'}
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ABA EQUIPE */}
        <TabsContent value="equipe" className="space-y-8 mt-0 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-6 sm:p-8 rounded-2xl border border-border shadow-sm">
            <div className="text-center sm:text-left">
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Equipe</h2>
              <p className="text-sm sm:text-base text-slate-500 font-bold mt-1">Gerencie os usuários da conta.</p>
            </div>
            <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
              <DialogTrigger asChild>
                <Button className="w-full sm:w-auto h-12 px-8 rounded-xl bg-primary text-white hover:bg-primary/90 font-bold text-sm shadow-xl shadow-blue-900/10 transition-all">
                  <Plus className="h-5 w-5 mr-2" /> Novo Membro
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl border-none shadow-2xl p-0 overflow-hidden max-w-md w-[95%]">
                <DialogHeader className="px-8 pt-8 pb-4 bg-slate-50/50">
                  <DialogTitle className="text-2xl font-black text-slate-900 tracking-tight">Novo Membro</DialogTitle>
                </DialogHeader>
                <div className="p-8 space-y-5">
                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700 ml-1">Nome</Label>
                    <Input 
                      placeholder="Ex: João Silva" 
                      value={newMember.full_name}
                      onChange={e => setNewMember({...newMember, full_name: e.target.value})}
                      className="h-12 bg-slate-100 border-none rounded-xl font-bold focus:ring-primary/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700 ml-1">E-mail</Label>
                    <Input 
                      placeholder="email@empresa.com" 
                      value={newMember.email}
                      onChange={e => setNewMember({...newMember, email: e.target.value})}
                      className="h-12 bg-slate-100 border-none rounded-xl font-bold focus:ring-primary/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700 ml-1">Senha</Label>
                    <Input 
                      type="password"
                      placeholder="••••••••" 
                      value={newMember.password}
                      onChange={e => setNewMember({...newMember, password: e.target.value})}
                      className="h-12 bg-slate-100 border-none rounded-xl font-bold focus:ring-primary/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700 ml-1">Cargo</Label>
                    <Select 
                      value={newMember.role_name}
                      onValueChange={val => setNewMember({...newMember, role_name: val})}
                    >
                      <SelectTrigger className="h-12 bg-white border-none rounded-xl font-bold focus:ring-primary/10">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl shadow-2xl border-border">
                        <SelectItem value="ADMIN" className="font-bold text-xs py-3">Administrador</SelectItem>
                        <SelectItem value="USER" className="font-bold text-xs py-3">Usuário Padrão</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter className="px-8 pb-8 pt-2">
                  <Button variant="ghost" onClick={() => setInviteDialogOpen(false)} className="h-12 rounded-xl font-bold">Cancelar</Button>
                  <Button onClick={handleInviteMember} disabled={saving} className="h-12 rounded-xl bg-primary text-white font-bold px-8">Convidar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {teamMembers.map((member) => (
              <Card key={member.id} className="border-none shadow-sm bg-white rounded-2xl hover:shadow-md transition-all border border-border overflow-hidden group">
                <CardContent className="p-6 sm:p-8 flex flex-col items-center text-center">
                  <Avatar className="h-20 w-20 mb-4 border-4 border-border shadow-xl group-hover:scale-105 transition-transform">
                    <AvatarImage src={member.avatar_url} />
                    <AvatarFallback className="bg-slate-100 text-slate-400 font-black text-xl">
                      {getInitials(member.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <h3 className="font-black text-slate-900 tracking-tight text-lg truncate w-full">{member.full_name}</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1 mb-6">{member.job_title || 'Membro'}</p>
                  
                  <div className="flex flex-col gap-2 w-full">
                    <div className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-50 text-slate-600 text-[10px] font-black uppercase">
                      <Mail className="h-3 w-3" /> {member.email}
                    </div>
                    <div className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-50 text-primary text-[10px] font-black uppercase">
                      <Shield className="h-3 w-3" /> {member.role === 'ADMIN' ? 'Admin' : 'Usuário'}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ABA PERSONALIZAÇÃO */}
        <TabsContent value="personalização" className="space-y-8 mt-0 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
            <div className="lg:col-span-2 space-y-6 sm:space-y-8">
              <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden border border-border">
                <CardHeader className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600">
                      <Camera className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg font-black text-slate-900 tracking-tight">Identidade Visual</CardTitle>
                      <CardDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Cores e Logo</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-6 sm:space-y-8">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <Label className="text-sm font-bold text-slate-700 ml-1">Nome do Sistema</Label>
                      <Input 
                        value={sidebarAdvanced.system_name} 
                        onChange={e => updateSidebarAdvanced('system_name', e.target.value)}
                        className="h-12 bg-slate-100 border-none rounded-xl font-bold focus:ring-primary/10"
                        placeholder="Ex: DocFlow"
                      />
                    </div>
                    <div className="space-y-3">
                      <Label className="text-sm font-bold text-slate-700 ml-1">Subtítulo do Sistema</Label>
                      <Input 
                        value={sidebarAdvanced.system_subtitle} 
                        onChange={e => updateSidebarAdvanced('system_subtitle', e.target.value)}
                        className="h-12 bg-slate-100 border-none rounded-xl font-bold focus:ring-primary/10"
                        placeholder="Ex: Gestão de Documentos"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-bold text-slate-700 ml-1">Logo (URL)</Label>
                    <div className="flex flex-col sm:flex-row gap-4">
                      <Input 
                        value={customization.logo_url} 
                        onChange={e => setCustomization({...customization, logo_url: e.target.value})}
                        className="h-12 bg-slate-100 border-none rounded-xl font-bold focus:ring-primary/10"
                        placeholder="https://..."
                      />
                      {customization.logo_url && (
                        <div className="h-12 w-full sm:w-24 shrink-0 rounded-xl border border-border bg-white p-2 flex items-center justify-center shadow-sm">
                          <img src={customization.logo_url} alt="Logo" className="max-h-full max-w-full object-contain" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <ColorField 
                      label="Cor Principal" 
                      value={customization.primary_color} 
                      onChange={v => setCustomization({...customization, primary_color: v})} 
                      inputId="color-primary"
                    />
                    <ColorField 
                      label="Cor de Fundo" 
                      value={customization.secondary_color} 
                      onChange={v => setCustomization({...customization, secondary_color: v})} 
                      inputId="color-secondary"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden border border-border">
                <CardHeader className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-blue-50 text-primary">
                      <TextQuote className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg font-black text-slate-900 tracking-tight">Menu Lateral</CardTitle>
                      <CardDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Estilo da navegação</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-6 sm:space-y-8">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <ColorField 
                      label="Fundo Sidebar" 
                      value={customization.sidebar_color} 
                      onChange={v => setCustomization({...customization, sidebar_color: v})} 
                      inputId="color-sidebar-bg"
                    />
                    <ColorField 
                      label="Texto Sidebar" 
                      value={customization.sidebar_text_color} 
                      onChange={v => setCustomization({...customization, sidebar_text_color: v})} 
                      inputId="color-sidebar-text"
                    />
                    <ColorField 
                      label="Ícones Sidebar" 
                      value={customization.sidebar_icon_color} 
                      onChange={v => setCustomization({...customization, sidebar_icon_color: v})} 
                      inputId="color-sidebar-icon"
                    />
                    <div className="space-y-3">
                      <Label className="text-sm font-bold text-slate-700 ml-1">Peso da Fonte</Label>
                      <Select 
                        value={customization.sidebar_font_weight}
                        onValueChange={v => setCustomization({...customization, sidebar_font_weight: v})}
                      >
                        <SelectTrigger className="h-12 bg-white border-none rounded-xl font-bold focus:ring-primary/10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl shadow-2xl border-border">
                          <SelectItem value="light" className="font-bold text-xs py-3">Leve</SelectItem>
                          <SelectItem value="normal" className="font-bold text-xs py-3">Normal</SelectItem>
                          <SelectItem value="medium" className="font-bold text-xs py-3">Médio</SelectItem>
                          <SelectItem value="semibold" className="font-bold text-xs py-3">Semibold</SelectItem>
                          <SelectItem value="bold" className="font-bold text-xs py-3">Negrito</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-1">
              <div className="sticky top-28">
                <SidebarPreview />
              </div>
            </div>
          </div>

          <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden border border-border mt-6 sm:mt-8">
            <CardHeader className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg font-black text-slate-900 tracking-tight">Personalização Avançada do Menu</CardTitle>
                  <CardDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Ajustes finos de cores e comportamento</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-6 sm:px-8 pb-6 sm:pb-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <ColorField 
                  label="Fundo da Marca (Topo)" 
                  value={sidebarAdvanced.brand_bg_color} 
                  onChange={v => updateSidebarAdvanced('sidebar_brand_bg', v)} 
                  inputId="color-sidebar-brand"
                />
                <ColorField 
                  label="Item Hover (Fundo)" 
                  value={sidebarAdvanced.item_hover_bg} 
                  onChange={v => updateSidebarAdvanced('sidebar_item_hover_bg', v)} 
                  inputId="color-sidebar-hover"
                />
                <ColorField 
                  label="Item Ativo (Fundo)" 
                  value={sidebarAdvanced.item_active_bg} 
                  onChange={v => updateSidebarAdvanced('sidebar_item_active_bg', v)} 
                  inputId="color-sidebar-active-bg"
                />
                <ColorField 
                  label="Item Ativo (Texto)" 
                  value={sidebarAdvanced.item_active_text} 
                  onChange={v => updateSidebarAdvanced('sidebar_item_active_text', v)} 
                  inputId="color-sidebar-active-text"
                />
                <ColorField 
                  label="Item Ativo (Ícone)" 
                  value={sidebarAdvanced.item_active_icon} 
                  onChange={v => updateSidebarAdvanced('sidebar_item_active_icon', v)} 
                  inputId="color-sidebar-active-icon"
                />
                <div className="space-y-3">
                  <Label className="text-sm font-bold text-slate-700 ml-1">Arredondamento Itens</Label>
                  <Select 
                    value={sidebarAdvanced.border_radius}
                    onValueChange={v => updateSidebarAdvanced('sidebar_border_radius', v)}
                  >
                    <SelectTrigger className="h-12 bg-white border-none rounded-xl font-bold focus:ring-primary/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl shadow-2xl border-border">
                      <SelectItem value="none" className="font-bold text-xs py-3">Nenhum</SelectItem>
                      <SelectItem value="md" className="font-bold text-xs py-3">Médio</SelectItem>
                      <SelectItem value="lg" className="font-bold text-xs py-3">Grande</SelectItem>
                      <SelectItem value="xl" className="font-bold text-xs py-3">Extra Grande</SelectItem>
                      <SelectItem value="full" className="font-bold text-xs py-3">Total</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-border">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-bold text-slate-700">Exibir Logo/Marca</Label>
                    <p className="text-[10px] text-slate-500 font-medium">Mostrar seção superior do menu</p>
                  </div>
                  <Switch 
                    checked={sidebarAdvanced.show_brand_section}
                    onCheckedChange={v => updateSidebarAdvanced('sidebar_show_brand', v)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 pb-10">
            <Button 
              variant="outline"
              className="h-12 px-8 rounded-xl border-border text-slate-500 font-bold hover:bg-slate-50" 
              onClick={handleDiscardCustomization}
              disabled={saving}
            >
              Descartar
            </Button>
            <Button 
              className="h-12 px-10 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold shadow-lg shadow-blue-900/10 transition-all active:scale-[0.97]" 
              onClick={handleSaveCustomization}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Salvar Alterações'}
            </Button>
          </div>
        </TabsContent>
      </div>
    </Tabs>
  </div>
);
}
