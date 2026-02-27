import { useState, useEffect, type ElementType, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Shield, 
  Bell, 
  Users, 
  Palette, 
  LogOut, 
  ChevronRight, 
  Settings, 
  Building2, 
  Smartphone,
  Info,
  HelpCircle,
  Moon,
  Globe
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

interface UserData {
  name: string;
  role: string;
  avatar: string;
  email: string;
}

export default function Config() {
  const navigate = useNavigate();
  const [userData, setUserData] = useState<UserData>({
    name: 'Carregando...',
    role: '',
    avatar: '',
    email: ''
  });

  useEffect(() => {
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
        if (response.ok) {
          const data = await response.json();
          setUserData({
            name: data.full_name,
            role: data.job_title || 'Membro',
            avatar: data.avatar_url,
            email: data.email
          });
        }
      } catch (error) {
        console.error('Erro ao carregar dados:', error);
      }
    };

    fetchUserData();
  }, [navigate]);

  const handleLogout = () => {
    localStorage.clear();
    sessionStorage.clear();
    navigate('/login');
    toast.success('Sessão encerrada com sucesso');
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const ConfigItem = ({ 
    icon: Icon, 
    label, 
    description, 
    onClick, 
    color = "text-slate-600",
    bgColor = "bg-slate-100",
    rightElement = <ChevronRight className="h-5 w-5 text-slate-400" />
  }: { 
    icon: ElementType, 
    label: string, 
    description?: string, 
    onClick?: () => void,
    color?: string,
    bgColor?: string,
    rightElement?: ReactNode
  }) => (
    <button 
      onClick={onClick}
      className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
    >
      <div className="flex items-center gap-4">
        <div className={`p-2.5 rounded-2xl ${bgColor} ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="text-left">
          <p className="text-sm font-bold text-slate-900">{label}</p>
          {description && <p className="text-[11px] text-slate-500 font-medium">{description}</p>}
        </div>
      </div>
      {rightElement}
    </button>
  );

  return (
    <div className="max-w-2xl mx-auto pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header com Perfil */}
      <div className="p-6 pt-2 flex flex-col items-center text-center">
        <div className="relative mb-4">
          <Avatar className="h-24 w-24 border-4 border-white shadow-2xl ring-1 ring-slate-100">
            {userData.avatar && <AvatarImage src={userData.avatar} />}
            <AvatarFallback className="bg-gradient-to-br from-orange-50 to-orange-100 text-orange-600 text-2xl font-black">
              {getInitials(userData.name)}
            </AvatarFallback>
          </Avatar>
        </div>
        <h1 className="text-xl font-black text-slate-900 tracking-tight">{userData.name}</h1>
        <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest">{userData.role}</p>
        <p className="text-xs font-medium text-slate-400 mt-0.5">{userData.email}</p>
        
        <Button 
          variant="outline" 
          className="mt-6 rounded-2xl border-slate-200 font-bold text-xs h-10 px-6 hover:bg-slate-50"
          onClick={() => navigate('/profile')}
        >
          Editar Perfil
        </Button>
      </div>

      <div className="px-4 space-y-6">
        {/* Grupo: Conta e Segurança */}
        <div className="space-y-2">
          <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Conta & Segurança</h2>
          <Card className="overflow-hidden border-none shadow-sm rounded-[24px]">
            <ConfigItem 
              icon={Building2} 
              label="Dados da Conta" 
              description="Informações corporativas e endereço"
              bgColor="bg-blue-50"
              color="text-blue-600"
              onClick={() => navigate('/settings?tab=conta')}
            />
            <ConfigItem 
              icon={Shield} 
              label="Segurança" 
              description="Alterar senha e autenticação"
              bgColor="bg-orange-50"
              color="text-orange-600"
              onClick={() => navigate('/settings?tab=seguranca')}
            />
            <ConfigItem 
              icon={Bell} 
              label="Notificações" 
              description="Configurar alertas e avisos"
              bgColor="bg-rose-50"
              color="text-rose-600"
              onClick={() => navigate('/settings?tab=notificacoes')}
            />
          </Card>
        </div>

        {/* Grupo: Preferências */}
        <div className="space-y-2">
          <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Preferências</h2>
          <Card className="overflow-hidden border-none shadow-sm rounded-[24px]">
            <ConfigItem 
              icon={Palette} 
              label="Aparência" 
              description="Personalizar cores e logotipos"
              bgColor="bg-purple-50"
              color="text-purple-600"
              onClick={() => navigate('/settings?tab=personalizacao')}
            />
            <ConfigItem 
              icon={Globe} 
              label="Idioma" 
              description="Português (Brasil)"
              bgColor="bg-emerald-50"
              color="text-emerald-600"
              onClick={() => toast.info('Idiomas adicionais em breve.')}
            />
            <ConfigItem 
              icon={Moon} 
              label="Modo Escuro" 
              description="Ativar tema escuro no app"
              bgColor="bg-indigo-50"
              color="text-indigo-600"
              rightElement={<Switch disabled className="scale-75" />}
            />
          </Card>
        </div>

        {/* Grupo: Administração */}
        <div className="space-y-2">
          <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Administração</h2>
          <Card className="overflow-hidden border-none shadow-sm rounded-[24px]">
            <ConfigItem 
              icon={Users} 
              label="Gerenciar Equipe" 
              description="Convidar e editar membros"
              bgColor="bg-cyan-50"
              color="text-cyan-600"
              onClick={() => navigate('/settings?tab=equipe')}
            />
            <ConfigItem 
              icon={Settings} 
              label="Gestão de Acessos" 
              description="Níveis de permissão e setores"
              bgColor="bg-slate-100"
              color="text-slate-600"
              onClick={() => navigate('/access-management')}
            />
          </Card>
        </div>

        {/* Grupo: App */}
        <div className="space-y-2">
          <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Sobre o App</h2>
          <Card className="overflow-hidden border-none shadow-sm rounded-[24px]">
            <ConfigItem 
              icon={Smartphone} 
              label="Configurações PWA" 
              description="Versão 1.0.4 - Atualizado"
              bgColor="bg-slate-50"
              color="text-slate-400"
              rightElement={<div className="text-[10px] font-bold text-emerald-500 bg-emerald-50 px-2 py-1 rounded-lg">ONLINE</div>}
            />
            <ConfigItem 
              icon={HelpCircle} 
              label="Central de Ajuda" 
              bgColor="bg-slate-50"
              color="text-slate-400"
              onClick={() => toast.info('Central de Ajuda em breve.')}
            />
            <ConfigItem 
              icon={Info} 
              label="Termos e Privacidade" 
              bgColor="bg-slate-50"
              color="text-slate-400"
            />
          </Card>
        </div>

        {/* Botão de Sair */}
        <Button 
          variant="ghost" 
          className="w-full mt-4 h-14 rounded-[24px] text-rose-500 hover:text-rose-600 hover:bg-rose-50 font-black text-sm flex items-center justify-center gap-3 transition-all"
          onClick={handleLogout}
        >
          <LogOut className="h-5 w-5" />
          Sair do Sistema
        </Button>

        <div className="text-center pb-8">
          <p className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.3em]">DocFlow SaaS Platform</p>
        </div>
      </div>
    </div>
  );
}
