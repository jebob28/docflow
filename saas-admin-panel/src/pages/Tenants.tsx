import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/auth';
import { Loader2, Building2, Plus, MoreVertical, Shield, Trash2, Edit2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Tenant {
  id: string;
  name: string;
  domain: string;
  cnpj: string;
  is_active: boolean;
  created_at: string;
  max_storage_gb: number;
  used_storage: number;
}

export default function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isQuotaModalOpen, setIsQuotaModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [newQuota, setNewQuota] = useState<number>(10);
  const [newTenant, setNewTenant] = useState({ name: '', slug: '', document: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [tenantToDelete, setTenantToDelete] = useState<Tenant | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async () => {
    try {
      setLoading(true);
      const response = await api.get('/admin/tenants');
      setTenants(Array.isArray(response.data) ? response.data : []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao carregar tenants.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateQuota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;

    try {
      setIsSaving(true);
      await api.patch(`/admin/tenants/${selectedTenant.id}/quota`, { max_storage_gb: newQuota });
      toast.success("Capacidade atualizada com sucesso!");
      setIsQuotaModalOpen(false);
      fetchTenants();
    } catch (err: unknown) {
      toast.error("Erro ao atualizar capacidade.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      if (editingTenant) {
        await api.put(`/admin/tenants/${editingTenant.id}`, newTenant);
        toast.success("Empresa atualizada com sucesso!");
      } else {
        await api.post('/admin/tenants', newTenant);
        toast.success("Empresa cadastrada com sucesso!");
      }
      setIsModalOpen(false);
      setEditingTenant(null);
      setNewTenant({ name: '', slug: '', document: '' });
      fetchTenants();
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { message?: string } } };
      const message = apiError.response?.data?.message || `Erro ao ${editingTenant ? 'atualizar' : 'criar'} empresa.`;
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditClick = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setNewTenant({
      name: tenant.name,
      slug: tenant.domain.split('.')[0], // Simplificado
      document: tenant.cnpj
    });
    setIsModalOpen(true);
  };

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      await api.patch(`/admin/tenants/${id}/status`, { is_active: !currentStatus });
      toast.success(`Status ${!currentStatus ? 'ativado' : 'desativado'} com sucesso!`);
      fetchTenants();
    } catch {
      toast.error("Erro ao atualizar status.");
    }
  };

  const handleDeleteClick = (tenant: Tenant) => {
    setTenantToDelete(tenant);
    setIsDeleteModalOpen(true);
  };

  const confirmDeleteTenant = async () => {
    if (!tenantToDelete) return;

    try {
      setIsDeleting(true);
      await api.delete(`/admin/tenants/${tenantToDelete.id}`);
      toast.success(`Empresa ${tenantToDelete.name} excluída com sucesso!`);
      setIsDeleteModalOpen(false);
      setTenantToDelete(null);
      fetchTenants();
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { message?: string } } };
      const message = apiError.response?.data?.message || "Erro ao excluir empresa.";
      toast.error(message);
    } finally {
      setIsDeleting(false);
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
              <Building2 size={16} className="text-blue-600" />
            </div>
            Gestão de Empresas
          </CardTitle>
          
          <Dialog open={isModalOpen} onOpenChange={(open) => {
            setIsModalOpen(open);
            if (!open) {
              setEditingTenant(null);
              setNewTenant({ name: '', slug: '', document: '' });
            }
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="w-full sm:w-auto bg-[#1b254b] hover:bg-[#1b254b]/90 text-white text-[11px] h-9 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-blue-900/10">
                <Plus size={14} />
                Novo Tenant
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[480px] p-0 border-none shadow-2xl bg-white overflow-hidden rounded-[32px]">
              <form onSubmit={handleCreateTenant}>
                <div className="p-8 border-b border-slate-100/80">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="p-2 rounded-xl bg-orange-50">
                      <Building2 className="h-6 w-6 text-[#e66a31] fill-[#e66a31]/10" />
                    </div>
                    <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">
                      {editingTenant ? 'Editar Empresa' : 'Nova Empresa'}
                    </DialogTitle>
                  </div>
                  <DialogDescription className="text-slate-500 text-sm font-medium">
                    {editingTenant ? 'Atualize os dados da empresa no sistema SaaS' : 'Cadastre um novo tenant no sistema SaaS'}
                  </DialogDescription>
                </div>

                <div className="p-8 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-slate-700 text-sm font-bold ml-1">Nome da Empresa</Label>
                    <Input
                      id="name"
                      placeholder="Ex: Minha Empresa LTDA"
                      value={newTenant.name}
                      onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
                      className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus-visible:ring-[#e66a31]/20 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="slug" className="text-slate-700 text-sm font-bold ml-1">Slug (Domínio)</Label>
                    <Input
                      id="slug"
                      placeholder="Ex: minha-empresa"
                      value={newTenant.slug}
                      onChange={(e) => setNewTenant({ ...newTenant, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                      className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus-visible:ring-[#e66a31]/20 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="document" className="text-slate-700 text-sm font-bold ml-1">CNPJ</Label>
                    <Input
                      id="document"
                      placeholder="00.000.000/0000-00"
                      value={newTenant.document}
                      onChange={(e) => setNewTenant({ ...newTenant, document: e.target.value })}
                      className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus-visible:ring-[#e66a31]/20 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                      required
                    />
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
                      newTenant.name.trim() && newTenant.slug.trim()
                        ? "bg-[#e66a31] hover:bg-[#d45a20] text-white shadow-orange-900/10" 
                        : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                    )}
                  >
                    {isSaving ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{editingTenant ? 'Salvando...' : 'Cadastrando...'}</span>
                      </div>
                    ) : (
                      <span>{editingTenant ? 'Salvar Alterações' : 'Cadastrar Empresa'}</span>
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
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap">Empresa</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap hidden md:table-cell">CNPJ</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap hidden sm:table-cell">Domínio</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap">Capacidade</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap">Status</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((tenant) => (
                    <TableRow key={tenant.id} className="hover:bg-slate-50/30 transition-colors border-b border-slate-50 last:border-0">
                      <TableCell className="px-4 lg:px-6 py-3 lg:py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 lg:gap-3">
                          <div className="w-8 h-8 lg:w-9 lg:h-9 rounded-xl bg-blue-50 flex items-center justify-center text-[10px] lg:text-[12px] text-blue-600 font-bold border border-blue-100 shadow-sm shrink-0">
                            {tenant.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-[11px] lg:text-xs text-slate-700 leading-none mb-1 truncate max-w-[100px] lg:max-w-none">{tenant.name}</p>
                            <p className="text-[9px] lg:text-[10px] text-slate-400 font-medium">{new Date(tenant.created_at).toLocaleDateString('pt-BR')}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px] lg:text-xs text-slate-500 px-4 lg:px-6 py-3 lg:py-4 font-medium hidden md:table-cell whitespace-nowrap">{tenant.cnpj}</TableCell>
                      <TableCell className="text-[11px] lg:text-xs text-slate-500 px-4 lg:px-6 py-3 lg:py-4 font-medium hidden sm:table-cell whitespace-nowrap">{tenant.domain}</TableCell>
                      <TableCell className="px-4 lg:px-6 py-3 lg:py-4 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-[11px] lg:text-xs font-bold text-slate-700">{tenant.max_storage_gb} GB</span>
                          <span className="text-[9px] text-slate-400">Total contratado</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 lg:px-6 py-3 lg:py-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 lg:px-2.5 lg:py-1 rounded-lg text-[9px] lg:text-[10px] font-bold uppercase tracking-wider border ${
                          tenant.is_active 
                            ? "bg-emerald-50 text-emerald-600 border-emerald-100" 
                            : "bg-slate-50 text-slate-400 border-slate-100"
                        }`}>
                          {tenant.is_active ? "Ativo" : "Inativo"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right px-4 lg:px-6 py-3 lg:py-4 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1 lg:gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => {
                              setSelectedTenant(tenant);
                              setNewQuota(tenant.max_storage_gb);
                              setIsQuotaModalOpen(true);
                            }}
                            className="text-[9px] lg:text-[10px] h-7 lg:h-8 px-2 lg:px-3 rounded-lg font-bold text-blue-500 hover:text-blue-600 hover:bg-blue-50"
                          >
                            Alterar GB
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => toggleStatus(tenant.id, tenant.is_active)}
                            className={`text-[9px] lg:text-[10px] h-7 lg:h-8 px-2 lg:px-3 rounded-lg font-bold ${
                              tenant.is_active 
                                ? "text-rose-500 hover:text-rose-600 hover:bg-rose-50" 
                                : "text-blue-500 hover:text-blue-600 hover:bg-blue-50"
                            }`}
                          >
                            {tenant.is_active ? (
                              <span className="hidden sm:inline">Desativar</span>
                            ) : (
                              <span className="hidden sm:inline">Ativar</span>
                            )}
                            <span className="sm:hidden">{tenant.is_active ? "OFF" : "ON"}</span>
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 lg:h-8 lg:w-8 text-slate-400 hover:text-slate-600">
                                <MoreVertical size={16} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-xl border-none bg-white shadow-xl p-1">
                              <DropdownMenuItem 
                                onClick={() => handleEditClick(tenant)}
                                className="text-[11px] lg:text-xs font-bold text-slate-600 focus:bg-slate-50 rounded-lg flex items-center gap-2 cursor-pointer py-2"
                              >
                                <Edit2 size={14} className="text-blue-500" />
                                Editar Empresa
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleDeleteClick(tenant)}
                                className="text-[11px] lg:text-xs font-bold text-rose-600 focus:bg-rose-50 rounded-lg flex items-center gap-2 cursor-pointer py-2"
                              >
                                <Trash2 size={14} />
                                Excluir Empresa
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {tenants.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 lg:py-12 text-xs lg:text-sm text-slate-400 font-medium italic">
                        Nenhum tenant cadastrado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isQuotaModalOpen} onOpenChange={setIsQuotaModalOpen}>
        <DialogContent className="sm:max-w-[420px] p-0 border-none shadow-2xl bg-white overflow-hidden rounded-[32px]">
          <form onSubmit={handleUpdateQuota}>
            <div className="p-8 border-b border-slate-100/80">
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2 rounded-xl bg-orange-50">
                  <Building2 className="h-6 w-6 text-[#e66a31] fill-[#e66a31]/10" />
                </div>
                <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">Alterar Capacidade</DialogTitle>
              </div>
              <DialogDescription className="text-slate-500 text-sm font-medium">
                Ajuste a quota de armazenamento para <strong className="text-slate-700">{selectedTenant?.name}</strong>
              </DialogDescription>
            </div>

            <div className="p-8 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="quota" className="text-slate-700 text-sm font-bold ml-1 uppercase tracking-wider text-[10px]">Capacidade em GB</Label>
                <Input
                  id="quota"
                  type="number"
                  min="1"
                  value={newQuota}
                  onChange={(e) => setNewQuota(Number(e.target.value))}
                  className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus-visible:ring-[#e66a31]/20 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                  required
                />
              </div>
            </div>

            <div className="p-8 pt-0 flex justify-end gap-3">
              <Button 
                type="button"
                variant="ghost"
                onClick={() => setIsQuotaModalOpen(false)}
                className="h-12 px-6 rounded-2xl font-bold text-slate-500 hover:bg-slate-50 transition-all"
              >
                Cancelar
              </Button>
              <Button 
                type="submit" 
                disabled={isSaving}
                className={cn(
                  "px-8 font-bold h-12 rounded-2xl shadow-lg transition-all active:scale-[0.97] flex items-center justify-center gap-2 text-sm",
                  "bg-[#e66a31] hover:bg-[#d45a20] text-white shadow-orange-900/10"
                )}
              >
                {isSaving ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Atualizando...</span>
                  </div>
                ) : (
                  <span>Salvar Alteração</span>
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
              Você está prestes a excluir a empresa <span className="font-bold text-slate-900">"{tenantToDelete?.name}"</span>. 
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </div>
          <div className="p-8 bg-slate-50/50 flex flex-col gap-3">
            <Button 
              onClick={confirmDeleteTenant}
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
                  <span>Sim, excluir empresa</span>
                </>
              )}
            </Button>
            <Button 
              variant="ghost" 
              onClick={() => setIsDeleteModalOpen(false)}
              className="w-full h-12 rounded-2xl font-bold text-slate-500 hover:bg-white hover:text-slate-700 transition-all text-sm"
            >
              Não, manter empresa
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
