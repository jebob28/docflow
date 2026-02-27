import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatCard } from './Dashboard';
import { api } from '@/lib/auth';
import { Loader2, BarChart3, Plus, MoreVertical, TrendingUp, DollarSign, Users, Clock, Trash2, Edit2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Lead {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  status: string;
  estimated_value: number;
  source: string;
  created_at: string;
}

interface CRMStats {
  new_leads: number;
  in_proposal: number;
  conversion_rate: number;
  monthly_sales: number;
}

export default function CRM() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<CRMStats | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<{id: string, name: string} | null>(null);
  const [isDeletingLead, setIsDeletingLead] = useState(false);
  const [newLead, setNewLead] = useState({ 
    company_name: '', 
    contact_name: '', 
    email: '', 
    phone: '', 
    status: 'NEW',
    estimated_value: 0,
    source: 'Direct' 
  });
  const [isSaving, setIsSaving] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [leadsRes, statsRes] = await Promise.all([
        api.get('/admin/crm/leads').catch(() => ({ data: [] })),
        api.get('/admin/crm/stats').catch(() => ({ data: { new_leads: 0, in_proposal: 0, conversion_rate: 0, monthly_sales: 0 } }))
      ]);
      setLeads(Array.isArray(leadsRes.data) ? leadsRes.data : []);
      setStats(statsRes.data);
    } catch {
      toast.error("Erro ao carregar dados do CRM");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      if (editingLead) {
        await api.put(`/admin/crm/leads/${editingLead.id}`, newLead);
        toast.success("Lead atualizado com sucesso!");
      } else {
        await api.post('/admin/crm/leads', newLead);
        toast.success("Lead criado com sucesso!");
      }
      setIsModalOpen(false);
      setEditingLead(null);
      setNewLead({ company_name: '', contact_name: '', email: '', phone: '', status: 'NEW', estimated_value: 0, source: 'Direct' });
      fetchData();
    } catch (err) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || `Erro ao ${editingLead ? 'atualizar' : 'criar'} lead.`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditClick = (lead: Lead) => {
    setEditingLead(lead);
    setNewLead({
      company_name: lead.company_name,
      contact_name: lead.contact_name,
      email: lead.email,
      phone: lead.phone || '',
      status: lead.status,
      estimated_value: lead.estimated_value,
      source: lead.source || 'Direct'
    });
    setIsModalOpen(true);
  };

  const handleDeleteClick = (id: string, name: string) => {
    setLeadToDelete({ id, name });
    setIsDeleteModalOpen(true);
  };

  const confirmDeleteLead = async () => {
    if (!leadToDelete) return;

    try {
      setIsDeletingLead(true);
      await api.delete(`/admin/crm/leads/${leadToDelete.id}`);
      toast.success(`Lead da empresa ${leadToDelete.name} excluído com sucesso!`);
      setIsDeleteModalOpen(false);
      setLeadToDelete(null);
      fetchData();
    } catch (err) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || "Erro ao excluir lead.");
    } finally {
      setIsDeletingLead(false);
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status.toUpperCase()) {
      case 'WON':
        return 'bg-emerald-50 text-emerald-600 border-emerald-100';
      case 'PROPOSAL':
        return 'bg-blue-50 text-blue-600 border-blue-100';
      case 'LOST':
        return 'bg-rose-50 text-rose-600 border-rose-100';
      case 'NEW':
        return 'bg-purple-50 text-purple-600 border-purple-100';
      default:
        return 'bg-slate-50 text-slate-500 border-slate-100';
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <StatCard 
          title="Novos Leads" 
          value={stats?.new_leads.toString() || "0"} 
          sub="Esta semana" 
          icon={Users}
          trend="up"
          trendValue="15%"
        />
        <StatCard 
          title="Em Proposta" 
          value={stats?.in_proposal.toString() || "0"} 
          sub="Aguardando fechamento" 
          icon={Clock}
        />
        <StatCard 
          title="Taxa Conversão" 
          value={`${stats?.conversion_rate || 0}%`} 
          sub="Média global" 
          icon={TrendingUp}
          trend="up"
          trendValue="2.4%"
        />
        <StatCard 
          title="Vendas Mês" 
          value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(stats?.monthly_sales || 0)} 
          sub="Meta: R$ 60k" 
          icon={DollarSign}
          trend="down"
          trendValue="5%"
        />
      </div>
      
      <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden">
        <CardHeader className="py-4 px-4 lg:py-5 lg:px-6 border-b border-slate-50 flex flex-col sm:flex-row items-center justify-between gap-4">
          <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
              <BarChart3 size={16} className="text-blue-600" />
            </div>
            <span className="truncate">Leads Recentes</span>
          </CardTitle>
          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="w-full sm:w-auto bg-[#1b254b] hover:bg-[#1b254b]/90 text-white text-[11px] h-9 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]">
                <Plus size={14} />
                Novo Lead
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[480px] p-0 border-none shadow-2xl bg-white overflow-hidden rounded-[32px]">
              <form onSubmit={handleCreateLead}>
                <div className="p-8 border-b border-slate-100/80">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="p-2 rounded-xl bg-orange-50">
                      <TrendingUp className="h-6 w-6 text-[#e66a31] fill-[#e66a31]/10" />
                    </div>
                    <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">
                      {editingLead ? 'Editar Lead' : 'Novo Lead'}
                    </DialogTitle>
                  </div>
                  <DialogDescription className="text-slate-500 text-sm font-medium">
                    {editingLead ? 'Atualize os dados do lead no DocFlow' : 'Cadastre um novo lead no sistema DocFlow'}
                  </DialogDescription>
                </div>

                <div className="p-8 space-y-5">
                  {editingLead && (
                    <div className="space-y-2">
                      <Label htmlFor="status" className="text-slate-700 text-sm font-bold ml-1">Status</Label>
                      <Select 
                        value={newLead.status} 
                        onValueChange={(value) => setNewLead({ ...newLead, status: value })}
                      >
                        <SelectTrigger className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus:ring-[#e66a31]/20 font-medium">
                          <SelectValue placeholder="Selecione o status" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-none shadow-xl">
                          <SelectItem value="NEW">Novo</SelectItem>
                          <SelectItem value="CONTACTED">Contatado</SelectItem>
                          <SelectItem value="PROPOSAL">Proposta</SelectItem>
                          <SelectItem value="WON">Ganhado</SelectItem>
                          <SelectItem value="LOST">Perdido</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="company" className="text-slate-700 text-sm font-bold ml-1">Nome da Empresa</Label>
                    <Input
                      id="company"
                      placeholder="Ex: Empresa Ltda"
                      value={newLead.company_name}
                      onChange={(e) => setNewLead({ ...newLead, company_name: e.target.value })}
                      className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus-visible:ring-[#e66a31]/20 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="contact" className="text-slate-700 text-sm font-bold ml-1">Nome do Contato</Label>
                    <Input
                      id="contact"
                      placeholder="Ex: João Silva"
                      value={newLead.contact_name}
                      onChange={(e) => setNewLead({ ...newLead, contact_name: e.target.value })}
                      className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus-visible:ring-[#e66a31]/20 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-slate-700 text-sm font-bold ml-1">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="contato@empresa.com"
                        value={newLead.email}
                        onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
                        className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus-visible:ring-[#e66a31]/20 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="value" className="text-slate-700 text-sm font-bold ml-1">Valor Est.</Label>
                      <Input
                        id="value"
                        type="number"
                        placeholder="5000"
                        value={newLead.estimated_value}
                        onChange={(e) => setNewLead({ ...newLead, estimated_value: Number(e.target.value) })}
                        className="h-12 bg-slate-50 border-slate-100 rounded-2xl px-4 text-sm focus-visible:ring-[#e66a31]/20 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                        required
                      />
                    </div>
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
                      newLead.company_name.trim() 
                        ? "bg-[#e66a31] hover:bg-[#d45a20] text-white shadow-orange-900/10" 
                        : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                    )}
                  >
                    {isSaving ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{editingLead ? 'Salvando...' : 'Criando...'}</span>
                      </div>
                    ) : (
                      <span>{editingLead ? 'Salvar Alterações' : 'Criar Lead'}</span>
                    )}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto scrollbar-hide">
            <div className="inline-block min-w-full align-middle">
              <Table>
                <TableHeader className="bg-slate-50/50">
                  <TableRow className="hover:bg-transparent border-none">
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap">Empresa</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap hidden sm:table-cell">Contato</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap">Status</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap text-right">Valor Est.</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => (
                    <TableRow key={lead.id} className="hover:bg-slate-50/30 transition-colors border-b border-slate-50 last:border-0">
                      <TableCell className="px-4 lg:px-6 py-3 lg:py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 lg:gap-3">
                          <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-lg bg-slate-50 flex items-center justify-center text-[10px] lg:text-[11px] text-slate-600 font-bold border border-slate-100 shadow-sm shrink-0">
                            {lead.company_name.substring(0, 2).toUpperCase()}
                          </div>
                          <span className="font-bold text-[11px] lg:text-xs text-slate-700 truncate max-w-[100px] lg:max-w-none">{lead.company_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px] lg:text-xs text-slate-500 px-4 lg:px-6 py-3 lg:py-4 font-medium hidden sm:table-cell">{lead.contact_name}</TableCell>
                      <TableCell className="px-4 lg:px-6 py-3 lg:py-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 lg:px-2.5 lg:py-1 rounded-lg text-[9px] lg:text-[10px] font-bold uppercase tracking-wider border ${getStatusStyle(lead.status)}`}>
                          {lead.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-[11px] lg:text-xs font-bold text-slate-700 px-4 lg:px-6 py-3 lg:py-4">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lead.estimated_value)}
                      </TableCell>
                      <TableCell className="text-right px-4 lg:px-6 py-3 lg:py-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-600">
                              <MoreVertical size={16} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="rounded-xl border-none bg-white shadow-xl p-1">
                            <DropdownMenuItem 
                              onClick={() => handleEditClick(lead)}
                              className="text-[11px] lg:text-xs font-bold text-slate-600 focus:bg-slate-50 rounded-lg flex items-center gap-2 cursor-pointer py-2"
                            >
                              <Edit2 size={14} className="text-blue-500" />
                              Editar Lead
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleDeleteClick(lead.id, lead.company_name)}
                              className="text-[11px] lg:text-xs font-bold text-rose-600 focus:bg-rose-50 rounded-lg flex items-center gap-2 cursor-pointer py-2"
                            >
                              <Trash2 size={14} />
                              Excluir Lead
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {leads.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 lg:py-12 text-xs lg:text-sm text-slate-400 font-medium italic">
                        Nenhum lead encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

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
              Você está prestes a excluir o lead da empresa <span className="font-bold text-slate-900">"{leadToDelete?.name}"</span>. 
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </div>
          <div className="p-8 bg-slate-50/50 flex flex-col gap-3">
            <Button 
              onClick={confirmDeleteLead}
              disabled={isDeletingLead}
              className="w-full h-12 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold shadow-lg shadow-rose-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {isDeletingLead ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Excluindo...</span>
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  <span>Sim, excluir lead</span>
                </>
              )}
            </Button>
            <Button 
              variant="ghost" 
              onClick={() => setIsDeleteModalOpen(false)}
              className="w-full h-12 rounded-2xl font-bold text-slate-500 hover:bg-white hover:text-slate-700 transition-all text-sm"
            >
              Não, manter lead
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
