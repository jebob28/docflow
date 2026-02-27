import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/auth';
import { Loader2, UserPlus, MoreVertical, Shield, Key, Mail, Trash2, Edit2, User } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface UserData {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  tenant_name: string;
  created_at: string;
}

interface Tenant {
  id: string;
  name: string;
}

export default function Users() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Estado para novo usuário
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newUser, setNewUser] = useState({
    full_name: '',
    email: '',
    password: '',
    tenant_id: '',
    role: 'ADMIN'
  });

  // Estado para redefinição de senha
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchUsers();
    fetchTenants();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await api.get('/admin/users');
      setUsers(Array.isArray(response.data) ? response.data : []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao carregar usuários.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const fetchTenants = async () => {
    try {
      const response = await api.get('/admin/tenants');
      setTenants(Array.isArray(response.data) ? response.data : []);
    } catch (err: unknown) {
      console.error("Erro ao carregar tenants:", err);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      if (editingUser) {
        await api.put(`/admin/users/${editingUser.id}`, {
          full_name: newUser.full_name,
          email: newUser.email,
          role: newUser.role
        });
        toast.success("Usuário atualizado com sucesso!");
      } else {
        if (!newUser.tenant_id) {
          toast.error("Selecione uma empresa para o usuário.");
          return;
        }
        await api.post('/admin/users', newUser);
        toast.success("Usuário criado com sucesso!");
      }
      setIsModalOpen(false);
      setEditingUser(null);
      setNewUser({ full_name: '', email: '', password: '', tenant_id: '', role: 'ADMIN' });
      fetchUsers();
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { message?: string } } };
      const message = apiError.response?.data?.message || `Erro ao ${editingUser ? 'atualizar' : 'criar'} usuário.`;
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditClick = (user: UserData) => {
    setEditingUser(user);
    setNewUser({
      full_name: user.name,
      email: user.email,
      password: '', // Não editamos senha aqui
      tenant_id: '', // Admin não muda tenant por enquanto para evitar confusão
      role: 'ADMIN'
    });
    setIsModalOpen(true);
  };

  const toggleUserStatus = async (id: string, currentStatus: boolean) => {
    try {
      await api.patch(`/admin/users/${id}/status`, { is_active: !currentStatus });
      toast.success(`Status do usuário atualizado!`);
      fetchUsers();
    } catch {
      toast.error("Erro ao atualizar status do usuário.");
    }
  };

  const handleDeleteClick = (user: UserData) => {
    setUserToDelete(user);
    setIsDeleteModalOpen(true);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;

    try {
      setIsDeleting(true);
      await api.delete(`/admin/users/${userToDelete.id}`);
      toast.success(`Usuário ${userToDelete.name} excluído com sucesso!`);
      setIsDeleteModalOpen(false);
      setUserToDelete(null);
      fetchUsers();
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { message?: string } } };
      const message = apiError.response?.data?.message || "Erro ao excluir usuário.";
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !newPassword) return;

    try {
      setIsResetting(true);
      await api.patch(`/admin/users/${selectedUser.id}/password`, { password: newPassword });
      toast.success(`Senha de ${selectedUser.name} redefinida com sucesso!`);
      setIsResetModalOpen(false);
      setNewPassword('');
      setSelectedUser(null);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { message?: string } } };
      const message = apiError.response?.data?.message || "Erro ao redefinir senha.";
      toast.error(message);
    } finally {
      setIsResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden">
        <CardHeader className="py-4 px-4 lg:py-5 lg:px-6 border-b border-slate-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
              <User size={16} className="text-blue-600" />
            </div>
            Gestão de Usuários
          </CardTitle>
          <Dialog open={isModalOpen} onOpenChange={(open) => {
            setIsModalOpen(open);
            if (!open) {
              setEditingUser(null);
              setNewUser({ full_name: '', email: '', password: '', tenant_id: '', role: 'ADMIN' });
            }
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="w-full sm:w-auto bg-[#1b254b] hover:bg-[#1b254b]/90 text-white text-[11px] h-9 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-blue-900/10">
                <UserPlus size={14} />
                Novo Usuário
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[420px] p-0 border-none shadow-2xl bg-white overflow-hidden rounded-[32px]">
              <form onSubmit={handleCreateUser}>
                <div className="p-8 border-b border-slate-100/80">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="p-2 rounded-xl bg-orange-50">
                      <UserPlus className="h-6 w-6 text-[#e66a31] fill-[#e66a31]/10" />
                    </div>
                    <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">
                      {editingUser ? 'Editar Usuário' : 'Novo Usuário'}
                    </DialogTitle>
                  </div>
                  <DialogDescription className="text-slate-500 text-sm font-medium">
                    {editingUser ? 'Atualize os dados do usuário no sistema DocFlow' : 'Cadastre um novo usuário no sistema DocFlow'}
                  </DialogDescription>
                </div>

                <div className="p-8 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-slate-700 text-sm font-bold ml-1 uppercase tracking-wider text-[10px]">Nome Completo</Label>
                    <Input
                      placeholder="Ex: João Silva"
                      value={newUser.full_name}
                      onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                      className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus-visible:ring-[#e66a31]/20 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-700 text-sm font-bold ml-1 uppercase tracking-wider text-[10px]">E-mail</Label>
                    <Input
                      type="email"
                      placeholder="joao@empresa.com"
                      value={newUser.email}
                      onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                      className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus-visible:ring-[#e66a31]/20 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                      required
                    />
                  </div>
                  {!editingUser && (
                    <div className="space-y-2">
                      <Label className="text-slate-700 text-sm font-bold ml-1 uppercase tracking-wider text-[10px]">Senha Inicial</Label>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={newUser.password}
                        onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                        className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus-visible:ring-[#e66a31]/20 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                        required
                      />
                    </div>
                  )}
                  {!editingUser && (
                    <div className="space-y-2">
                      <Label className="text-slate-700 text-sm font-bold ml-1 uppercase tracking-wider text-[10px]">Empresa (Tenant)</Label>
                      <Select 
                        value={newUser.tenant_id}
                        onValueChange={(value) => setNewUser({ ...newUser, tenant_id: value })}
                      >
                        <SelectTrigger className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus:ring-[#e66a31]/20 transition-all font-medium text-slate-900">
                          <SelectValue placeholder="Selecione a empresa" />
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl border-slate-100 bg-white shadow-xl">
                          {tenants.map((tenant) => (
                            <SelectItem key={tenant.id} value={tenant.id} className="text-sm font-medium focus:bg-slate-50 rounded-xl text-slate-700">
                              {tenant.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label className="text-slate-700 text-sm font-bold ml-1 uppercase tracking-wider text-[10px]">Nível de Acesso</Label>
                    <Select 
                      value={newUser.role} 
                      onValueChange={(value) => setNewUser({ ...newUser, role: value })}
                    >
                      <SelectTrigger className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus:ring-[#e66a31]/20 transition-all font-medium text-slate-900">
                        <SelectValue placeholder="Selecione o nível" />
                      </SelectTrigger>
                      <SelectContent className="rounded-2xl border-slate-100 bg-white shadow-xl">
                        <SelectItem value="ADMIN" className="text-sm font-medium focus:bg-slate-50 rounded-xl text-slate-700">Administrador SaaS</SelectItem>
                        <SelectItem value="GESTOR" className="text-sm font-medium focus:bg-slate-50 rounded-xl text-slate-700">Gestor da Empresa</SelectItem>
                        <SelectItem value="USER" className="text-sm font-medium focus:bg-slate-50 rounded-xl text-slate-700">Usuário Comum</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="p-8 pt-0 flex justify-end gap-3">
                  <Button 
                    type="button"
                    variant="ghost"
                    onClick={() => setIsModalOpen(false)}
                    className="h-12 px-6 rounded-2xl font-bold text-slate-500 hover:bg-slate-50 transition-all"
                  >
                    Cancelar
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={isSaving}
                    className={cn(
                      "px-8 font-bold h-12 rounded-2xl shadow-lg transition-all active:scale-[0.97] flex items-center justify-center gap-2 text-sm",
                      newUser.full_name.trim() && newUser.email.trim() && (editingUser || (newUser.password.trim() && newUser.tenant_id))
                        ? "bg-[#e66a31] hover:bg-[#d45a20] text-white shadow-orange-900/10" 
                        : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                    )}
                  >
                    {isSaving ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{editingUser ? 'Salvando...' : 'Criando...'}</span>
                      </div>
                    ) : (
                      <span>{editingUser ? 'Salvar Alterações' : 'Criar Usuário'}</span>
                    )}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <div className="bg-rose-50 text-rose-600 p-3 m-4 lg:m-6 rounded-xl text-[10px] lg:text-[11px] font-bold border border-rose-100 flex items-center gap-2">
              <Shield size={14} className="shrink-0" />
              {error}
            </div>
          )}
          <div className="overflow-x-auto scrollbar-hide">
            <div className="inline-block min-w-full align-middle">
              <Table>
                <TableHeader className="bg-slate-50/50">
                  <TableRow className="hover:bg-transparent border-none">
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap">Usuário</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap hidden sm:table-cell">Tenant / Empresa</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap">Status</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id} className="hover:bg-slate-50/30 transition-colors border-b border-slate-50 last:border-0">
                      <TableCell className="px-4 lg:px-6 py-3 lg:py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 lg:gap-3">
                          <div className="w-8 h-8 lg:w-9 lg:h-9 rounded-xl bg-slate-100 flex items-center justify-center text-[10px] lg:text-[12px] text-slate-600 font-bold border border-slate-200 shadow-sm shrink-0">
                            {user.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-[11px] lg:text-xs text-slate-700 leading-none mb-1 truncate max-w-[100px] lg:max-w-none">{user.name}</p>
                            <div className="flex items-center gap-1 text-[9px] lg:text-[10px] text-slate-400 font-medium truncate max-w-[120px] lg:max-w-none">
                              <Mail size={10} className="shrink-0" />
                              <span className="truncate">{user.email}</span>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 lg:px-6 py-3 lg:py-4 whitespace-nowrap hidden sm:table-cell">
                        <div className="flex flex-col">
                          <span className="text-[11px] lg:text-xs font-bold text-slate-600 truncate max-w-[100px] lg:max-w-none">{user.tenant_name || 'Sistema'}</span>
                          <span className="text-[9px] lg:text-[10px] text-slate-400">Criado em {new Date(user.created_at).toLocaleDateString('pt-BR')}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 lg:px-6 py-3 lg:py-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 lg:px-2.5 lg:py-1 rounded-lg text-[9px] lg:text-[10px] font-bold uppercase tracking-wider border ${
                          user.is_active 
                            ? "bg-emerald-50 text-emerald-600 border-emerald-100" 
                            : "bg-slate-50 text-slate-400 border-slate-100"
                        }`}>
                          {user.is_active ? "Ativo" : "Inativo"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right px-4 lg:px-6 py-3 lg:py-4 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1 lg:gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => toggleUserStatus(user.id, user.is_active)}
                            className={`text-[9px] lg:text-[10px] h-7 lg:h-8 px-2 lg:px-3 rounded-lg font-bold ${
                              user.is_active 
                                ? "text-rose-500 hover:text-rose-600 hover:bg-rose-50" 
                                : "text-blue-500 hover:text-blue-600 hover:bg-blue-50"
                            }`}
                          >
                            {user.is_active ? (
                              <span className="hidden sm:inline">Desativar</span>
                            ) : (
                              <span className="hidden sm:inline">Ativar</span>
                            )}
                            <span className="sm:hidden">{user.is_active ? "OFF" : "ON"}</span>
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 lg:h-8 lg:w-8 text-slate-400 hover:text-slate-600">
                                <MoreVertical size={16} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-xl border-none bg-white shadow-xl p-1">
                              <DropdownMenuItem 
                                onClick={() => handleEditClick(user)}
                                className="text-[11px] lg:text-xs font-bold text-slate-600 focus:bg-slate-50 rounded-lg flex items-center gap-2 cursor-pointer py-2"
                              >
                                <Edit2 size={14} className="text-blue-500" />
                                Editar Usuário
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => {
                                  setSelectedUser(user);
                                  setIsResetModalOpen(true);
                                }}
                                className="text-[11px] lg:text-xs font-bold text-slate-600 focus:bg-slate-50 rounded-lg flex items-center gap-2 cursor-pointer py-2"
                              >
                                <Key size={14} className="text-amber-500" />
                                Redefinir Senha
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleDeleteClick(user)}
                                className="text-[11px] lg:text-xs font-bold text-rose-600 focus:bg-rose-50 rounded-lg flex items-center gap-2 cursor-pointer py-2"
                              >
                                <Trash2 size={14} />
                                Excluir Usuário
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {users.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 lg:py-12 text-xs lg:text-sm text-slate-400 font-medium italic">
                        Nenhum usuário encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isResetModalOpen} onOpenChange={setIsResetModalOpen}>
        <DialogContent className="sm:max-w-[420px] p-0 border-none shadow-2xl bg-white overflow-hidden rounded-[32px]">
          <form onSubmit={handleResetPassword}>
            <div className="p-8 border-b border-slate-100/80">
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2 rounded-xl bg-orange-50">
                  <Key className="h-6 w-6 text-[#e66a31] fill-[#e66a31]/10" />
                </div>
                <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">Redefinir Senha</DialogTitle>
              </div>
              <DialogDescription className="text-slate-500 text-sm font-medium">
                Defina uma nova senha para o usuário <strong className="text-slate-700">{selectedUser?.name}</strong>
              </DialogDescription>
            </div>

            <div className="p-8 space-y-4">
              <div className="space-y-2">
                <Label className="text-slate-700 text-sm font-bold ml-1 uppercase tracking-wider text-[10px]">Nova Senha Temporária</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus-visible:ring-[#e66a31]/20 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                  required
                />
              </div>
            </div>

            <div className="p-8 pt-0 flex justify-end gap-3">
              <Button 
                type="button"
                variant="ghost"
                onClick={() => setIsResetModalOpen(false)}
                className="h-12 px-6 rounded-2xl font-bold text-slate-500 hover:bg-slate-50 transition-all"
              >
                Cancelar
              </Button>
              <Button 
                type="submit" 
                disabled={isResetting}
                className={cn(
                  "px-8 font-bold h-12 rounded-2xl shadow-lg transition-all active:scale-[0.97] flex items-center justify-center gap-2 text-sm",
                  newPassword.trim() 
                    ? "bg-[#e66a31] hover:bg-[#d45a20] text-white shadow-orange-900/10" 
                    : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                )}
              >
                {isResetting ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Redefinindo...</span>
                  </div>
                ) : (
                  <span>Redefinir Senha</span>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="sm:max-w-[400px] rounded-[32px] p-0 overflow-hidden border-none shadow-2xl bg-white animate-in fade-in zoom-in-95 duration-200">
          <div className="p-8 text-center">
            <div className="w-20 h-20 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-6 transition-transform duration-500 hover:rotate-12 group">
              <Trash2 className="h-10 w-10 text-rose-500 transition-colors group-hover:text-rose-600" />
            </div>
            <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight mb-2">
              Confirmar Exclusão
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm font-medium px-4">
              Você está prestes a excluir o usuário <span className="font-bold text-slate-900">"{userToDelete?.name}"</span>. 
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </div>
          <div className="p-8 bg-slate-50/50 flex flex-col gap-3">
            <Button 
              onClick={confirmDeleteUser}
              disabled={isDeleting}
              className="w-full h-12 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold shadow-lg shadow-rose-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Excluindo...</span>
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  <span>Sim, excluir usuário</span>
                </>
              )}
            </Button>
            <Button 
              variant="ghost" 
              onClick={() => setIsDeleteModalOpen(false)}
              className="w-full h-12 rounded-2xl font-bold text-slate-500 hover:bg-white hover:text-slate-700 transition-all text-sm"
            >
              Não, manter usuário
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}