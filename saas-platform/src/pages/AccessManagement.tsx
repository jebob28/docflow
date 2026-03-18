import { useState, useEffect } from 'react';
import { 
  Users, 
  Plus, 
  Search, 
  Trash2, 
  Edit2,
  Building2,
  Loader2,
  Shield,
  UserPlus,
  Mail,
  Lock,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Dialog, 
  DialogContent, 
  DialogTitle, 
  DialogDescription
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Sector {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

interface UserSector {
  sector_id: string;
  sector_name: string;
  permission_type: 'GESTOR' | 'VIEWER';
}

interface User {
  id: number;
  full_name: string;
  email: string;
  role_name: string;
  sectors: UserSector[];
  is_active: boolean;
  created_at: string;
}

export default function AccessManagement() {
  const [activeTab, setActiveTab] = useState<'users' | 'sectors'>('users');
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [userRole, setUserRole] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modais
  const [isSectorModalOpen, setIsSectorModalOpen] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  
  // Edição
  const [editingSector, setEditingSector] = useState<Sector | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [itemToDelete, setItemToDelete] = useState<{ id: string | number, type: 'user' | 'sector', name: string } | null>(null);
  
  // Loading states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form states
  const [sectorForm, setSectorForm] = useState({ name: '', description: '' });
  const [userForm, setUserForm] = useState({ 
    full_name: '', 
    email: '', 
    password: '', 
    role_name: 'USER', 
    sectors: [] as { sector_id: string; permission_type: 'GESTOR' | 'VIEWER' }[]
  });
  const [newPassword, setNewPassword] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers = { 'Authorization': `Bearer ${token}` };
      
      const [sectorsRes, usersRes] = await Promise.all([
        fetch('/api/v1/sectors', { headers }),
        fetch('/api/v1/users', { headers })
      ]);
      
      if (sectorsRes.ok) {
        const sectorsData = await sectorsRes.json();
        // Handle both object { sectors: [] } and array [] formats
        const sectorsList = Array.isArray(sectorsData) ? sectorsData : (sectorsData.sectors || []);
        setSectors(sectorsList);
      }
      
      if (usersRes.ok) {
        const usersData: unknown = await usersRes.json();
        const usersList = Array.isArray(usersData)
          ? usersData
          : usersData && typeof usersData === 'object' && 'users' in usersData
            ? (usersData as { users: User[] }).users
            : [];
        const processedUsers: User[] = (usersList as User[]).map((user) => ({
          ...user,
          sectors: Array.isArray(user.sectors) ? user.sectors : []
        }));
        setUsers(processedUsers);
      }

      // Buscar perfil para obter a role do usuário logado
      const profileRes = await fetch('/api/v1/profile', { headers });
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        setUserRole(profileData.role || '');
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Handlers Setores
  const handleSaveSector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sectorForm.name.trim()) return;

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const url = editingSector ? `/api/v1/sectors/${editingSector.id}` : '/api/v1/sectors';
      const method = editingSector ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(sectorForm)
      });

      if (response.ok) {
        toast.success(editingSector ? 'Setor atualizado' : 'Setor criado');
        setIsSectorModalOpen(false);
        setSectorForm({ name: '', description: '' });
        setEditingSector(null);
        fetchData();
      } else {
        try {
          const err = await response.json();
          toast.error(err.message || 'Erro ao salvar setor');
        } catch {
          const text = await response.text();
          toast.error(text || 'Erro ao salvar setor');
        }
      }
    } catch (error) {
      console.error('Erro detalhado no fetch:', error);
      toast.error('Erro de conexão ou erro inesperado');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handlers Usuários
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const url = editingUser ? `/api/v1/users/${editingUser.id}` : '/api/v1/users';
      const method = editingUser ? 'PUT' : 'POST';

      console.log(`Tentando ${method} em ${url}...`);

      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userForm)
      });

      if (response.ok) {
        toast.success(editingUser ? 'Usuário atualizado' : 'Usuário criado');
        setIsUserModalOpen(false);
        setEditingUser(null);
        setUserForm({ full_name: '', email: '', password: '', role_name: 'USER', sectors: [] });
        fetchData();
      } else {
        try {
          const err = await response.json();
          toast.error(err.message || 'Erro ao salvar usuário');
        } catch {
          // Se não for JSON, tenta ler como texto
          const text = await response.text();
          toast.error(text || 'Erro ao salvar usuário');
        }
      }
    } catch (error) {
      console.error('Erro detalhado no fetch (usuário):', error);
      toast.error('Erro de conexão ou erro inesperado');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleUserStatus = async (user: User) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/users/${user.id}/status`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ is_active: !user.is_active })
      });

      if (response.ok) {
        toast.success(`Usuário ${user.is_active ? 'desativado' : 'ativado'}`);
        fetchData();
      }
    } catch {
      toast.error('Erro ao alterar status');
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !newPassword) return;

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/users/${editingUser.id}/password`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password: newPassword })
      });

      if (response.ok) {
        toast.success('Senha alterada com sucesso');
        setIsPasswordModalOpen(false);
        setNewPassword('');
      } else {
        toast.error('Erro ao alterar senha');
      }
    } catch {
      toast.error('Erro de conexão');
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;

    setIsDeleting(true);
    try {
      const token = localStorage.getItem('token');
      const url = itemToDelete.type === 'user' 
        ? `/api/v1/users/${itemToDelete.id}`
        : `/api/v1/sectors/${itemToDelete.id}`;

      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success(`${itemToDelete.type === 'user' ? 'Usuário' : 'Setor'} excluído`);
        setIsDeleteModalOpen(false);
        setItemToDelete(null);
        fetchData();
      } else {
        toast.error('Erro ao excluir item');
      }
    } catch {
      toast.error('Erro de conexão');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredSectors = sectors.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredUsers = users.filter(u => 
    u.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (date: string) => new Date(date).toLocaleDateString('pt-BR');

  const UserCard = ({ user }: { user: User }) => (
    <Card className="border-none shadow-sm bg-white rounded-xl overflow-hidden hover:shadow-md transition-all duration-300">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 text-primary shadow-sm">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">{user.full_name}</h3>
              <p className="text-[10px] text-slate-500 font-medium line-clamp-1">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100"
              onClick={() => {
                setEditingUser(user);
                setUserForm({
                  full_name: user.full_name,
                  email: user.email,
                  password: '',
                  role_name: user.role_name,
                  sectors: (user.sectors || []).map(s => ({ 
                    sector_id: s.sector_id, 
                    permission_type: s.permission_type 
                  }))
                });
                setIsUserModalOpen(true);
              }}
            >
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
              onClick={() => {
                setItemToDelete({ id: user.id, type: 'user', name: user.full_name });
                setIsDeleteModalOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <span className={cn(
              "text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider",
              user.role_name === 'MASTER' ? "bg-purple-100 text-purple-700" :
              user.role_name === 'GESTOR' ? "bg-blue-100 text-blue-700" :
              "bg-slate-100 text-slate-600"
            )}>
              {user.role_name}
            </span>
            <button 
              onClick={() => handleToggleUserStatus(user)}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold transition-all",
                user.is_active ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"
              )}
            >
              {user.is_active ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {user.is_active ? 'ATIVO' : 'INATIVO'}
            </button>
          </div>

          <div className="flex flex-wrap gap-1 border-t border-border pt-3">
            {user.sectors && user.sectors.length > 0 ? (
              user.sectors.map((us) => (
                <span 
                  key={us.sector_id}
                  className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                    us.permission_type === 'GESTOR' 
                      ? "bg-blue-100 text-primary" 
                      : "bg-slate-100 text-slate-600"
                  )}
                >
                  {us.sector_name}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-slate-400 italic">Sem setores vinculados</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const canManageSectors = userRole.toUpperCase() === 'ADMIN' || userRole.toUpperCase() === 'MASTER';

  const SectorCard = ({ sector }: { sector: Sector }) => (
    <Card className="border-none shadow-sm bg-white rounded-xl overflow-hidden hover:shadow-md transition-all duration-300">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 text-primary shadow-sm">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">{sector.name}</h3>
              <p className="text-[10px] text-slate-500 font-medium line-clamp-1">
                Criado em {formatDate(sector.created_at)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button 
              variant="ghost" 
              size="icon" 
              disabled={!canManageSectors}
              className="h-8 w-8 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100"
              onClick={() => {
                setEditingSector(sector);
                setSectorForm({ name: sector.name, description: sector.description });
                setIsSectorModalOpen(true);
              }}
            >
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              disabled={!canManageSectors}
              className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
              onClick={() => {
                setItemToDelete({ id: sector.id, type: 'sector', name: sector.name });
                setIsDeleteModalOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-slate-500 line-clamp-2 mt-2 bg-slate-50 p-2.5 rounded-xl">
          {sector.description || 'Sem descrição cadastrada'}
        </p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Gestão de Acessos</h1>
          <p className="text-slate-500 text-sm mt-1">Gerencie usuários, permissões e setores da sua organização</p>
        </div>
        
        <div className="flex bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('users')}
            className={cn(
              "px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2",
              activeTab === 'users' ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Users className="h-4 w-4" />
            Usuários
          </button>
          <button
            onClick={() => setActiveTab('sectors')}
            className={cn(
              "px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2",
              activeTab === 'sectors' ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Building2 className="h-4 w-4" />
            Setores
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-none shadow-sm bg-white rounded-xl overflow-hidden group hover:shadow-md transition-all">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-blue-50 text-primary group-hover:bg-primary group-hover:text-white transition-all">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Usuários Ativos</p>
              <p className="text-2xl font-bold text-slate-900 mt-0.5">{users.filter(u => u.is_active).length}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-none shadow-sm bg-white rounded-xl overflow-hidden group hover:shadow-md transition-all">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-blue-50 text-primary group-hover:bg-primary group-hover:text-white transition-all">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total de Setores</p>
              <p className="text-2xl font-bold text-slate-900 mt-0.5">{sectors.length}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-white rounded-xl overflow-hidden group hover:shadow-md transition-all">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-blue-50 text-primary group-hover:bg-primary group-hover:text-white transition-all">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Níveis de Acesso</p>
              <p className="text-2xl font-bold text-slate-900 mt-0.5">4</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Action */}
      <Card className="border-none shadow-sm bg-white rounded-xl overflow-hidden">
        <div className="p-6 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative w-full sm:w-80 group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-primary transition-colors" />
            <Input 
              placeholder={activeTab === 'users' ? "Pesquisar usuários..." : "Pesquisar setores..."} 
              className="pl-10 h-10 bg-slate-50 border-none rounded-xl text-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <Button 
            disabled={activeTab === 'sectors' && !canManageSectors}
            onClick={() => {
              if (activeTab === 'users') {
                setEditingUser(null);
                setUserForm({ full_name: '', email: '', password: '', role_name: 'USER', sectors: [] });
                setIsUserModalOpen(true);
              } else {
                setEditingSector(null);
                setSectorForm({ name: '', description: '' });
                setIsSectorModalOpen(true);
              }
            }}
            className="bg-primary hover:bg-primary/90 text-white font-bold px-6 h-10 rounded-xl flex items-center gap-2 shadow-lg shadow-blue-900/10"
          >
            {activeTab === 'users' ? <UserPlus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {activeTab === 'users' ? 'Novo Usuário' : 'Novo Setor'}
          </Button>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-20 text-center">
              <Loader2 className="h-10 w-10 text-blue-500 animate-spin mx-auto" />
              <p className="text-slate-500 text-sm font-medium mt-4">Carregando informações...</p>
            </div>
          ) : activeTab === 'users' ? (
            <>
              {/* Desktop View */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader className="bg-slate-50/50">
                    <TableRow className="border-none">
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest text-slate-400 pl-6 h-12">Usuário</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest text-slate-400 h-12">Setor</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest text-slate-400 h-12">Acesso</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest text-slate-400 h-12">Status</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest text-slate-400 pr-6 text-right h-12">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <TableRow key={user.id} className="border-border hover:bg-slate-50/50 group transition-all">
                        <TableCell className="py-4 pl-6">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-900 text-sm">{user.full_name}</span>
                            <span className="text-xs text-slate-400">{user.email}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {user.sectors && user.sectors.length > 0 ? (
                              user.sectors.map((us) => (
                                <span 
                                  key={us.sector_id}
                                  className={cn(
                                    "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                                    us.permission_type === 'GESTOR' 
                                      ? "bg-blue-100 text-primary" 
                                      : "bg-slate-100 text-slate-600"
                                  )}
                                  title={us.permission_type}
                                >
                                  {us.sector_name}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-400">Nenhum</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider",
                            user.role_name === 'MASTER' ? "bg-purple-100 text-purple-700" :
                            user.role_name === 'GESTOR' ? "bg-blue-100 text-blue-700" :
                            "bg-slate-100 text-slate-600"
                          )}>
                            {user.role_name}
                          </span>
                        </TableCell>
                        <TableCell>
                          <button 
                            onClick={() => handleToggleUserStatus(user)}
                            className={cn(
                              "flex items-center gap-1.5 text-[10px] font-bold transition-all",
                              user.is_active ? "text-emerald-600" : "text-rose-500"
                            )}
                          >
                            {user.is_active ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                            {user.is_active ? 'ATIVO' : 'INATIVO'}
                          </button>
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100"
                              onClick={() => {
                                setEditingUser(user);
                                setUserForm({
                                  full_name: user.full_name,
                                  email: user.email,
                                  password: '',
                                  role_name: user.role_name,
                                  sectors: (user.sectors || []).map(s => ({ 
                                    sector_id: s.sector_id, 
                                    permission_type: s.permission_type 
                                  }))
                                });
                                setIsUserModalOpen(true);
                              }}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100"
                              onClick={() => {
                                setEditingUser(user);
                                setIsPasswordModalOpen(true);
                              }}
                            >
                              <Lock className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                              onClick={() => {
                                setItemToDelete({ id: user.id, type: 'user', name: user.full_name });
                                setIsDeleteModalOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile View */}
              <div className="md:hidden grid grid-cols-1 gap-4 p-4">
                {filteredUsers.length > 0 ? (
                  filteredUsers.map((user) => (
                    <UserCard key={user.id} user={user} />
                  ))
                ) : (
                  <div className="p-12 text-center bg-slate-50 rounded-xl border-2 border-dashed border-border">
                    <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500 font-medium">Nenhum usuário encontrado</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Desktop View */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader className="bg-slate-50/50">
                    <TableRow className="border-none">
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest text-slate-400 pl-6 h-12">Setor</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest text-slate-400 h-12">Descrição</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest text-slate-400 h-12">Criação</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-widest text-slate-400 pr-6 text-right h-12">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSectors.map((sector) => (
                      <TableRow key={sector.id} className="border-border hover:bg-slate-50/50 group transition-all">
                        <TableCell className="py-4 pl-6">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-blue-50 text-primary">
                              <Building2 className="h-4 w-4" />
                            </div>
                            <span className="font-bold text-slate-900 text-sm">{sector.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-500 line-clamp-1">{sector.description || 'Sem descrição'}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-400 font-medium">{formatDate(sector.created_at)}</span>
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-100"
                              onClick={() => {
                                setEditingSector(sector);
                                setSectorForm({ name: sector.name, description: sector.description });
                                setIsSectorModalOpen(true);
                              }}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                              onClick={() => {
                                setItemToDelete({ id: sector.id, type: 'sector', name: sector.name });
                                setIsDeleteModalOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile View */}
              <div className="md:hidden grid grid-cols-1 gap-4 p-4">
                {filteredSectors.length > 0 ? (
                  filteredSectors.map((sector) => (
                    <SectorCard key={sector.id} sector={sector} />
                  ))
                ) : (
                  <div className="p-12 text-center bg-slate-50 rounded-xl border-2 border-dashed border-border">
                    <Building2 className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500 font-medium">Nenhum setor encontrado</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Sheet de Usuário */}
      <Sheet open={isUserModalOpen} onOpenChange={(open) => {
        setIsUserModalOpen(open);
        if (!open) {
          setEditingUser(null);
          setUserForm({ 
            full_name: '', 
            email: '', 
            password: '', 
            role_name: 'USER', 
            sectors: [] 
          });
        }
      }}>
        <SheetContent 
          side={isDesktop ? "right" : "bottom"} 
          className={cn(
            "p-0 border-none shadow-2xl bg-white focus:outline-none flex flex-col transition-all duration-500",
            isDesktop ? "h-full w-full sm:max-w-[550px] rounded-l-[32px]" : "h-[92vh] rounded-t-[32px]"
          )}
        >
          <SheetHeader className={cn(
            "px-8 pt-10 pb-6 border-b border-border shrink-0 relative",
            isDesktop && "pt-12 pb-8"
          )}>
            <div className="flex items-center gap-5 relative z-10">
              <div className="p-4 rounded-2xl bg-blue-50 text-primary shadow-sm border border-blue-100/50">
                <UserPlus className="h-7 w-7" />
              </div>
              <div>
                <SheetTitle className={cn(
                  "font-black text-slate-900 leading-tight tracking-tight",
                  isDesktop ? "text-3xl" : "text-2xl"
                )}>
                  {editingUser ? 'Editar Usuário' : 'Novo Usuário'}
                </SheetTitle>
                <SheetDescription className="text-slate-500 text-sm font-medium mt-1">
                  {editingUser ? 'Atualize as informações do membro' : 'Cadastre um novo membro na plataforma'}
                </SheetDescription>
              </div>
            </div>
            {isDesktop && (
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/30 rounded-full -mr-16 -mt-16 blur-3xl" />
            )}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-8 py-8 custom-scrollbar">
            <form onSubmit={handleSaveUser} id="user-form" className="space-y-8">
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Nome Completo</label>
                  <div className="relative group">
                    <Users className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors" />
                    <Input 
                      placeholder="Ex: João Silva" 
                      className="h-14 pl-12 bg-slate-50/50 border-border rounded-2xl font-bold text-slate-900 placeholder:text-slate-400 focus-visible:ring-4 focus-visible:ring-blue-500/5 focus-visible:border-primary transition-all group-hover:bg-white shadow-sm"
                      value={userForm.full_name}
                      onChange={e => setUserForm(prev => ({ ...prev, full_name: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">E-mail Corporativo</label>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors" />
                    <Input 
                      type="email"
                      placeholder="email@empresa.com" 
                      className="h-14 pl-12 bg-slate-50/50 border-border rounded-2xl font-bold text-slate-900 placeholder:text-slate-400 focus-visible:ring-4 focus-visible:ring-blue-500/5 focus-visible:border-primary transition-all group-hover:bg-white shadow-sm"
                      value={userForm.email}
                      onChange={e => setUserForm(prev => ({ ...prev, email: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                {!editingUser && (
                  <div className="space-y-3">
                    <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Senha Inicial</label>
                    <div className="relative group">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors" />
                      <Input 
                        type="password"
                        placeholder="••••••••" 
                        className="h-14 pl-12 bg-slate-50/50 border-border rounded-2xl font-bold text-slate-900 placeholder:text-slate-400 focus-visible:ring-4 focus-visible:ring-blue-500/5 focus-visible:border-primary transition-all group-hover:bg-white shadow-sm"
                        value={userForm.password}
                        onChange={e => setUserForm(prev => ({ ...prev, password: e.target.value }))}
                        required={!editingUser}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Nível de Acesso Global</label>
                    <Select 
                      value={userForm.role_name} 
                      onValueChange={val => setUserForm(prev => ({ ...prev, role_name: val }))}
                    >
                      <SelectTrigger className="h-14 bg-white border-none rounded-2xl font-bold text-slate-900 focus:ring-4 focus:ring-blue-500/5 focus:border-primary transition-all hover:bg-white shadow-sm">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent className="rounded-2xl border-none shadow-2xl p-1 bg-white" position="popper" sideOffset={8}>
                        <SelectItem value="MASTER" className="font-bold rounded-xl focus:bg-slate-50 focus:text-primary py-3">Master</SelectItem>
                        <SelectItem value="GESTOR" className="font-bold rounded-xl focus:bg-slate-50 focus:text-primary py-3">Gestor</SelectItem>
                        <SelectItem value="USER" className="font-bold rounded-xl focus:bg-slate-50 focus:text-primary py-3">Usuário</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3">
                    <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Setores e Permissões</label>
                    <div className="grid grid-cols-1 gap-3 max-h-[300px] overflow-y-auto p-3 rounded-2xl bg-slate-50/50 border border-border shadow-inner">
                      {sectors.length === 0 && (
                        <p className="p-6 text-center text-xs text-slate-400 font-bold italic">Nenhum setor cadastrado</p>
                      )}
                      {sectors.map((sector) => {
                        const isSelected = userForm.sectors?.some(s => s.sector_id === sector.id) || false;
                        const currentSector = userForm.sectors?.find(s => s.sector_id === sector.id);
                        
                        return (
                          <div key={sector.id} className={cn(
                            "flex items-center justify-between p-3 rounded-xl transition-all border border-transparent",
                            isSelected ? "bg-white shadow-sm border-blue-100" : "hover:bg-white/50"
                          )}>
                            <div className="flex items-center gap-3">
                              <Checkbox 
                                id={`sector-${sector.id}`}
                                checked={isSelected}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setUserForm(prev => ({
                                      ...prev,
                                      sectors: [...(prev.sectors || []), { sector_id: sector.id, permission_type: 'VIEWER' }]
                                    }));
                                  } else {
                                    setUserForm(prev => ({
                                      ...prev,
                                      sectors: (prev.sectors || []).filter(s => s.sector_id !== sector.id)
                                    }));
                                  }
                                }}
                                className="h-5 w-5 border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary rounded-md"
                              />
                              <label 
                                htmlFor={`sector-${sector.id}`}
                                className="text-sm font-bold text-slate-700 cursor-pointer"
                              >
                                {sector.name}
                              </label>
                            </div>

                            {isSelected && (
                              <Select 
                                value={currentSector?.permission_type || 'VIEWER'} 
                                onValueChange={(val: 'GESTOR' | 'VIEWER') => {
                                  setUserForm(prev => ({
                                    ...prev,
                                    sectors: (prev.sectors || []).map(s => 
                                      s.sector_id === sector.id ? { ...s, permission_type: val } : s
                                    )
                                  }));
                                }}
                              >
                                <SelectTrigger className="h-9 w-32 bg-white border-none rounded-lg text-[10px] font-black uppercase tracking-widest focus:ring-2 focus:ring-blue-500/10">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-none shadow-2xl p-1 bg-white" position="popper" sideOffset={4}>
                                  <SelectItem value="VIEWER" className="text-[10px] font-black uppercase rounded-lg py-2 focus:bg-slate-50">Visualizador</SelectItem>
                                  <SelectItem value="GESTOR" className="text-[10px] font-black uppercase rounded-lg py-2 focus:bg-slate-50">Gestor</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <SheetFooter className={cn(
            "px-8 py-6 border-t border-border bg-white shrink-0",
            isDesktop ? "pb-10" : "pb-8 mb-6"
          )}>
            <div className="flex flex-col w-full gap-4">
              <Button 
                type="submit" 
                form="user-form"
                disabled={isSubmitting}
                className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black text-lg shadow-xl shadow-blue-900/10 transition-all active:scale-[0.97] flex items-center justify-center gap-3"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Processando...</span>
                  </>
                ) : (
                  <>
                    <Plus className="h-5 w-5" />
                    <span>{editingUser ? 'Salvar Alterações' : 'Criar Conta de Usuário'}</span>
                  </>
                )}
              </Button>
              <SheetClose asChild>
                {isDesktop ? (
                  <button 
                    type="button"
                    className="w-full py-2 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Cancelar
                  </button>
                ) : (
                  <Button 
                    type="button" 
                    variant="ghost" 
                    className="w-full h-12 font-bold text-slate-500 hover:bg-slate-50 rounded-2xl transition-all"
                  >
                    Cancelar
                  </Button>
                )}
              </SheetClose>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Modal Alterar Senha */}
      <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
        <DialogContent className="sm:max-w-[400px] rounded-2xl p-0 overflow-hidden border-none shadow-2xl bg-white">
          <div className="p-8 border-b border-border/80 text-center">
            <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            <DialogTitle className="text-xl font-bold text-slate-900">Alterar Senha</DialogTitle>
            <DialogDescription className="text-slate-500 text-sm font-medium mt-1">
              Defina uma nova senha para {editingUser?.full_name}
            </DialogDescription>
          </div>
          
          <form onSubmit={handleUpdatePassword} className="p-8 space-y-4">
            <Input 
              type="password"
              placeholder="Nova senha (mínimo 6 caracteres)"
              className="h-12 bg-slate-50 border-none rounded-xl font-semibold"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
            />
            <Button 
              type="submit"
              disabled={isSubmitting || newPassword.length < 6}
              className="w-full h-12 rounded-xl bg-primary text-white font-bold"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar Alteração'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Sheet de Setor */}
      <Sheet open={isSectorModalOpen} onOpenChange={(open) => {
        setIsSectorModalOpen(open);
        if (!open) {
          setEditingSector(null);
          setSectorForm({ name: '', description: '' });
        }
      }}>
        <SheetContent 
          side={isDesktop ? "right" : "bottom"} 
          className={cn(
            "p-0 border-none shadow-2xl bg-white focus:outline-none flex flex-col transition-all duration-500",
            isDesktop ? "h-full w-full sm:max-w-[480px] rounded-l-[32px]" : "h-[92vh] rounded-t-[32px]"
          )}
        >
          <SheetHeader className={cn(
            "px-8 pt-10 pb-6 border-b border-border shrink-0 relative",
            isDesktop && "pt-12 pb-8"
          )}>
            <div className="flex items-center gap-5 relative z-10">
              <div className="p-4 rounded-2xl bg-blue-50 text-primary shadow-sm border border-blue-100/50">
                <Building2 className="h-7 w-7" />
              </div>
              <div>
                <SheetTitle className={cn(
                  "font-black text-slate-900 leading-tight tracking-tight",
                  isDesktop ? "text-3xl" : "text-2xl"
                )}>
                  {editingSector ? 'Editar Setor' : 'Novo Setor'}
                </SheetTitle>
                <SheetDescription className="text-slate-500 text-sm font-medium mt-1">
                  {editingSector ? 'Atualize as informações do setor' : 'Cadastre um novo setor na organização'}
                </SheetDescription>
              </div>
            </div>
            {isDesktop && (
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/30 rounded-full -mr-16 -mt-16 blur-3xl" />
            )}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-8 py-8 custom-scrollbar">
            <form onSubmit={handleSaveSector} id="sector-form" className="space-y-8">
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Nome do Setor</label>
                  <div className="relative group">
                    <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors" />
                    <Input 
                      placeholder="Ex: Departamento Jurídico" 
                      className="h-14 pl-12 bg-slate-50/50 border-border rounded-2xl font-bold text-slate-900 placeholder:text-slate-400 focus-visible:ring-4 focus-visible:ring-blue-500/5 focus-visible:border-primary transition-all group-hover:bg-white shadow-sm"
                      value={sectorForm.name}
                      onChange={e => setSectorForm(prev => ({ ...prev, name: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Descrição</label>
                  <textarea 
                    placeholder="Descreva as responsabilidades deste setor (opcional)"
                    className="w-full min-h-[160px] p-4 bg-slate-50/50 border border-border rounded-2xl font-bold text-base md:text-sm resize-none text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-primary transition-all group-hover:bg-white shadow-sm"
                    value={sectorForm.description}
                    onChange={e => setSectorForm(prev => ({ ...prev, description: e.target.value }))}
                  />
                </div>
              </div>
            </form>
          </div>

          <SheetFooter className={cn(
            "px-8 py-6 border-t border-border bg-white shrink-0",
            isDesktop ? "pb-10" : "pb-8 mb-6"
          )}>
            <div className="flex flex-col w-full gap-4">
              <Button 
                type="submit" 
                form="sector-form"
                disabled={isSubmitting}
                className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black text-lg shadow-xl shadow-blue-900/10 transition-all active:scale-[0.97] flex items-center justify-center gap-3"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Processando...</span>
                  </>
                ) : (
                  <>
                    <Plus className="h-5 w-5" />
                    <span>{editingSector ? 'Salvar Alterações' : 'Criar Setor'}</span>
                  </>
                )}
              </Button>
              <SheetClose asChild>
                {isDesktop ? (
                  <button 
                    type="button"
                    className="w-full py-2 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Cancelar
                  </button>
                ) : (
                  <Button 
                    type="button" 
                    variant="ghost" 
                    className="w-full h-12 font-bold text-slate-500 hover:bg-slate-50 rounded-2xl transition-all"
                  >
                    Cancelar
                  </Button>
                )}
              </SheetClose>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Modal Deletar */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="w-[95%] max-w-[400px] rounded-2xl p-0 overflow-hidden border-none shadow-2xl bg-white animate-in zoom-in-95 duration-200">
          <div className="p-8 border-b border-border/80 text-center">
            <div className="w-20 h-20 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-4">
              <Trash2 className="h-10 w-10 text-rose-500" />
            </div>
            <DialogTitle className="text-2xl font-bold text-slate-900">Confirmar Exclusão</DialogTitle>
            <DialogDescription className="text-slate-500 text-sm font-medium mt-2">
              Tem certeza que deseja excluir <strong>{itemToDelete?.name}</strong>? Esta ação não pode ser desfeita.
            </DialogDescription>
          </div>
          
          <div className="p-6 bg-slate-50/50 flex flex-col gap-3">
            <Button 
              onClick={confirmDelete}
              disabled={isDeleting}
              className="w-full h-14 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-lg shadow-lg shadow-rose-200 transition-all flex items-center justify-center gap-2"
            >
              {isDeleting ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Sim, excluir permanentemente'}
            </Button>
            <Button 
              variant="ghost" 
              onClick={() => setIsDeleteModalOpen(false)}
              className="w-full h-12 font-bold text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
            >
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
