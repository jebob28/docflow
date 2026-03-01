import { useState, useEffect } from 'react';
import { 
  GitPullRequest, 
  Search, 
  CheckCircle2, 
  XCircle,
  Clock,
  FileText,
  User,
  Filter,
  Loader2,
  ArrowRight
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

interface Document {
  id: string;
  name: string;
  status: string;
  owner_name: string;
  sector_name: string;
  created_at: string;
}

export default function Workflows() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('PENDING_APPROVAL');

  const fetchPendingDocuments = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      // Reutilizamos o endpoint de listagem com filtro de status
      const response = await fetch(`/api/v1/documents?status=${filterStatus}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setDocuments(data.documents || []);
      } else {
        toast.error('Erro ao carregar documentos para aprovação');
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingDocuments();
  }, [filterStatus]);

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (response.ok) {
        toast.success(`Documento ${newStatus === 'ACTIVE' ? 'aprovado' : 'rejeitado'} com sucesso`);
        fetchPendingDocuments();
      } else {
        toast.error('Erro ao atualizar status do documento');
      }
    } catch {
      toast.error('Erro ao conectar com o servidor');
    }
  };

  const filteredDocuments = documents.filter(doc => 
    doc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    doc.owner_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING_APPROVAL':
        return (
          <span className="px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 w-fit">
            <Clock className="h-3 w-3" />
            Aguardando Aprovação
          </span>
        );
      case 'REJECTED':
        return (
          <span className="px-3 py-1 rounded-full bg-rose-50 text-rose-700 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 w-fit">
            <XCircle className="h-3 w-3" />
            Rejeitado
          </span>
        );
      case 'ACTIVE':
        return (
          <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 w-fit">
            <CheckCircle2 className="h-3 w-3" />
            Ativo / Aprovado
          </span>
        );
      default:
        return status;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20 md:pb-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-1 md:px-0">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Workflow de Aprovação</h1>
          <p className="text-slate-500 text-xs md:text-sm font-medium mt-1">Gerencie a revisão e aprovação de documentos pendentes</p>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Buscar por nome ou autor..." 
            className="pl-11 h-12 bg-white border-none shadow-sm rounded-2xl focus-visible:ring-1 focus-visible:ring-blue-100 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex bg-white p-1 rounded-2xl shadow-sm gap-1">
          <Button 
            variant={filterStatus === 'PENDING_APPROVAL' ? 'default' : 'ghost'}
            onClick={() => setFilterStatus('PENDING_APPROVAL')}
            className={`h-10 rounded-xl px-4 font-bold text-xs ${filterStatus === 'PENDING_APPROVAL' ? 'bg-[#1a355b] text-white' : 'text-slate-500'}`}
          >
            Pendentes
          </Button>
          <Button 
            variant={filterStatus === 'REJECTED' ? 'default' : 'ghost'}
            onClick={() => setFilterStatus('REJECTED')}
            className={`h-10 rounded-xl px-4 font-bold text-xs ${filterStatus === 'REJECTED' ? 'bg-[#1a355b] text-white' : 'text-slate-500'}`}
          >
            Rejeitados
          </Button>
          <Button 
            variant={filterStatus === 'ACTIVE' ? 'default' : 'ghost'}
            onClick={() => setFilterStatus('ACTIVE')}
            className={`h-10 rounded-xl px-4 font-bold text-xs ${filterStatus === 'ACTIVE' ? 'bg-[#1a355b] text-white' : 'text-slate-500'}`}
          >
            Aprovados
          </Button>
        </div>
      </div>

      {/* Content */}
      <Card className="border-none shadow-sm bg-white rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-slate-50">
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14">Documento</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14">Autor / Setor</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14">Status Atual</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14 text-right">Ações de Decisão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-40 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
                        <p className="text-sm font-bold text-slate-400">Carregando workflow...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredDocuments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-40 text-center">
                      <div className="flex flex-col items-center gap-3 opacity-40">
                        <GitPullRequest className="h-12 w-12 text-slate-300" />
                        <p className="text-sm font-bold text-slate-400">Nenhum documento aguardando ação</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredDocuments.map((doc) => (
                    <TableRow key={doc.id} className="group hover:bg-slate-50/50 transition-colors border-slate-50">
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-600 transition-all duration-300">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-900 line-clamp-1">{doc.name}</span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              Enviado em {new Date(doc.created_at).toLocaleDateString('pt-BR')}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                            <User className="h-3 w-3 text-slate-400" />
                            {doc.owner_name}
                          </div>
                          <span className="text-[10px] font-black text-blue-600/60 uppercase tracking-tighter">
                            {doc.sector_name || 'Sem Setor'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        {getStatusBadge(doc.status)}
                      </TableCell>
                      <TableCell className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {doc.status === 'PENDING_APPROVAL' && (
                            <>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-9 rounded-xl text-rose-600 font-black text-[10px] uppercase tracking-wider hover:bg-rose-50 px-4 flex items-center gap-2"
                                onClick={() => handleUpdateStatus(doc.id, 'REJECTED')}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                Rejeitar
                              </Button>
                              <Button 
                                variant="default" 
                                size="sm" 
                                className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-wider px-4 flex items-center gap-2 shadow-sm"
                                onClick={() => handleUpdateStatus(doc.id, 'ACTIVE')}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Aprovar
                              </Button>
                            </>
                          )}
                          {doc.status === 'REJECTED' && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-9 rounded-xl text-blue-600 font-black text-[10px] uppercase tracking-wider hover:bg-blue-50 px-4 flex items-center gap-2"
                              onClick={() => handleUpdateStatus(doc.id, 'PENDING_APPROVAL')}
                            >
                              <ArrowRight className="h-3.5 w-3.5" />
                              Revisar
                            </Button>
                          )}
                          {doc.status === 'ACTIVE' && (
                            <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest italic pr-4">
                              Concluído
                            </span>
                          )}
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
