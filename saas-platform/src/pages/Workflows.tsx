import { useState, useEffect } from 'react';
import { 
  GitPullRequest, 
  Search, 
  CheckCircle2, 
  XCircle,
  Clock,
  FileText,
  Loader2
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
import { toast } from 'sonner';

interface Approval {
  id: string;
  contract_id: string;
  contract_title: string;
  contract_status: string;
  step_order: number;
  created_at: string;
}

export default function Workflows() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchPendingApprovals = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/contracts/approvals/pending', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data: Approval[] = await response.json();
        setApprovals(data || []);
      } else {
        toast.error('Erro ao carregar aprovações pendentes');
      }
    } catch (error) {
      console.error('Error fetching approvals:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingApprovals();
  }, []);

  const handleDecision = async (approval: Approval, newStatus: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/contracts/${approval.contract_id}/approvals/${approval.id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (response.ok) {
        toast.success(`Contrato ${newStatus === 'APPROVED' ? 'aprovado' : 'rejeitado'} com sucesso`);
        fetchPendingApprovals();
      } else {
        toast.error('Erro ao atualizar aprovação');
      }
    } catch {
      toast.error('Erro ao conectar com o servidor');
    }
  };

  const filteredApprovals = approvals.filter(approval => 
    approval.contract_title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('pt-BR').format(date);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20 md:pb-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-1 md:px-0">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Workflow de Aprovação</h1>
          <p className="text-slate-500 text-xs md:text-sm font-medium mt-1">Gerencie aprovações pendentes de contratos</p>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Buscar por contrato..." 
            className="pl-11 h-12 bg-white border-none shadow-sm rounded-2xl focus-visible:ring-1 focus-visible:ring-blue-100 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Content */}
      <Card className="border-none shadow-sm bg-white rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14">Contrato</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14">Etapa</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14">Status do Contrato</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14">Criado em</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14 text-right">Ações de Decisão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-40 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
                        <p className="text-sm font-bold text-slate-400">Carregando workflow...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredApprovals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-40 text-center">
                      <div className="flex flex-col items-center gap-3 opacity-40">
                        <GitPullRequest className="h-12 w-12 text-slate-300" />
                        <p className="text-sm font-bold text-slate-400">Nenhuma aprovação pendente</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredApprovals.map((approval) => (
                    <TableRow key={approval.id} className="group hover:bg-slate-50/50 transition-colors border-border">
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-600 transition-all duration-300">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-900 line-clamp-1">{approval.contract_title}</span>
                            <span className="text-[10px] text-slate-400 font-medium">Contrato</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="text-xs font-semibold text-slate-700">Etapa {approval.step_order}</div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <span className="px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 w-fit">
                          <Clock className="h-3 w-3" />
                          {approval.contract_status}
                        </span>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <span className="text-xs text-slate-600">{formatDate(approval.created_at)}</span>
                      </TableCell>
                      <TableCell className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-9 rounded-xl text-rose-600 font-black text-[10px] uppercase tracking-wider hover:bg-rose-50 px-4 flex items-center gap-2"
                            onClick={() => handleDecision(approval, 'REJECTED')}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Rejeitar
                          </Button>
                          <Button 
                            variant="default" 
                            size="sm" 
                            className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-wider px-4 flex items-center gap-2 shadow-sm"
                            onClick={() => handleDecision(approval, 'APPROVED')}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Aprovar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
