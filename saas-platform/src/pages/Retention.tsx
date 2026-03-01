import { useState, useEffect } from 'react';
import { 
  Clock, 
  Plus,
  Search,
  Pencil,
  Trash2, 
  ShieldAlert,
  Calendar,
  Loader2,
  Database,
  Play
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
  DialogDescription,
  DialogFooter,
  DialogHeader
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from 'sonner';

interface DocumentType {
  id: string;
  name: string;
  retention_years: number;
  final_destination: string;
  created_at: string;
}

export default function Retention() {
  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingType, setEditingType] = useState<DocumentType | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isWorkerRunning, setIsWorkerRunning] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    retention_years: 5,
    final_destination: 'EXPURGO'
  });

  const fetchDocTypes = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/document-types', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setDocTypes(data || []);
      } else {
        toast.error('Erro ao carregar tipos de documento');
      }
    } catch (error) {
      console.error('Error fetching document types:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocTypes();
  }, []);

  const openCreateModal = () => {
    setEditingType(null);
    setFormData({ name: '', retention_years: 5, final_destination: 'EXPURGO' });
    setIsModalOpen(true);
  };

  const openEditModal = (type: DocumentType) => {
    setEditingType(type);
    setFormData({
      name: type.name,
      retention_years: type.retention_years,
      final_destination: type.final_destination
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('O nome do tipo é obrigatório');
      return;
    }

    setIsProcessing(true);
    try {
      const token = localStorage.getItem('token');
      const url = editingType 
        ? `/api/v1/document-types/${editingType.id}` 
        : '/api/v1/document-types';
      
      const method = editingType ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        toast.success(editingType ? 'Tipo atualizado com sucesso' : 'Tipo criado com sucesso');
        setIsModalOpen(false);
        fetchDocTypes();
      } else {
        const error = await response.json();
        toast.error(error.message || 'Erro ao processar requisição');
      }
    } catch {
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteDocType = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este tipo de documento? Ele não pode estar em uso.')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/document-types/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        toast.success('Tipo de documento excluído com sucesso');
        fetchDocTypes();
      } else if (response.status === 409) {
        toast.error('Não é possível excluir um tipo em uso por documentos');
      } else {
        toast.error('Erro ao excluir tipo de documento');
      }
    } catch {
      toast.error('Erro ao conectar com o servidor');
    }
  };

  const runRetentionWorker = async () => {
    setIsWorkerRunning(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/document-types/retention-worker', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const result = await response.json();
        toast.success(`${result.message}. Arquivos removidos: ${result.deleted_count}`);
      } else {
        toast.error('Erro ao executar worker de retenção');
      }
    } catch {
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setIsWorkerRunning(false);
    }
  };

  const filteredDocTypes = docTypes.filter(type => 
    type.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20 md:pb-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-1 md:px-0">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Tabela de Temporalidade</h1>
          <p className="text-slate-500 text-xs md:text-sm font-medium mt-1">Defina prazos de guarda e destino final dos documentos</p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline"
            onClick={runRetentionWorker}
            disabled={isWorkerRunning}
            className="border-slate-200 text-slate-600 font-bold px-4 h-11 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.97]"
          >
            {isWorkerRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Executar Retenção
          </Button>
          <Button 
            onClick={openCreateModal}
            className="bg-[#1a355b] hover:bg-[#10213d] text-white font-bold px-6 h-11 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-blue-900/10 transition-all active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" />
            Novo Tipo
          </Button>
        </div>
      </div>

      {/* Search and Content */}
      <Card className="border-none shadow-sm bg-white rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <div className="p-6 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input 
                placeholder="Buscar tipo de documento..." 
                className="pl-11 h-12 bg-slate-50/50 border-none rounded-2xl focus-visible:ring-1 focus-visible:ring-blue-100 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-4 py-2 bg-blue-50/50 rounded-2xl text-blue-700">
                <Database className="h-4 w-4" />
                <span className="text-xs font-black uppercase tracking-wider">{docTypes.length} Tipos</span>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-slate-50">
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14">Tipo de Documento</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14">Prazo de Guarda</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14">Destino Final</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14">Criado em</TableHead>
                  <TableHead className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-6 h-14 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-40 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
                        <p className="text-sm font-bold text-slate-400">Carregando temporalidade...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredDocTypes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-40 text-center">
                      <div className="flex flex-col items-center gap-3 opacity-40">
                        <Clock className="h-12 w-12 text-slate-300" />
                        <p className="text-sm font-bold text-slate-400">Nenhum tipo de documento encontrado</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredDocTypes.map((type) => (
                    <TableRow key={type.id} className="group hover:bg-slate-50/50 transition-colors border-slate-50">
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-600 transition-all duration-300">
                            <Clock className="h-4 w-4" />
                          </div>
                          <span className="font-bold text-slate-900">{type.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-black uppercase tracking-wider">
                            {type.retention_years} Anos
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {type.final_destination === 'EXPURGO' ? (
                            <span className="px-3 py-1 rounded-full bg-rose-50 text-rose-700 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5">
                              <ShieldAlert className="h-3 w-3" />
                              Descarte Definitivo
                            </span>
                          ) : (
                            <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase tracking-wider">
                              Guarda Permanente
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDate(type.created_at)}
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-9 w-9 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                            onClick={() => openEditModal(type)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-9 w-9 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all"
                            onClick={() => handleDeleteDocType(type.id)}
                          >
                            <Trash2 className="h-4 w-4" />
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

      {/* New Doc Type Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[450px] rounded-3xl p-0 overflow-hidden border-none shadow-2xl">
          <form onSubmit={handleSubmit}>
            <DialogHeader className="p-8 bg-[#1a355b] text-white">
              <DialogTitle className="text-2xl font-black tracking-tight">
                {editingType ? 'Editar Tipo de Documento' : 'Novo Tipo de Documento'}
              </DialogTitle>
              <DialogDescription className="text-blue-100 font-medium opacity-80">
                Defina as regras de temporalidade para este tipo
              </DialogDescription>
            </DialogHeader>
            
            <div className="p-8 space-y-6 bg-white">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Nome do Tipo</label>
                <Input 
                  placeholder="Ex: Contratos, Notas Fiscais, RH..." 
                  className="h-12 bg-slate-50 border-none rounded-2xl px-4 focus-visible:ring-1 focus-visible:ring-blue-100 transition-all font-bold text-slate-900"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Prazo de Guarda</label>
                  <Select 
                    value={String(formData.retention_years)} 
                    onValueChange={(v) => setFormData({...formData, retention_years: Number(v)})}
                  >
                    <SelectTrigger className="h-12 bg-slate-50 border-none rounded-2xl px-4 focus:ring-1 focus:ring-blue-100 font-bold text-slate-900">
                      <SelectValue placeholder="Anos" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100">
                      <SelectItem value="1">1 Ano</SelectItem>
                      <SelectItem value="2">2 Anos</SelectItem>
                      <SelectItem value="5">5 Anos</SelectItem>
                      <SelectItem value="10">10 Anos</SelectItem>
                      <SelectItem value="20">20 Anos</SelectItem>
                      <SelectItem value="50">50 Anos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Destino Final</label>
                  <Select 
                    value={formData.final_destination} 
                    onValueChange={(v) => setFormData({...formData, final_destination: v})}
                  >
                    <SelectTrigger className="h-12 bg-slate-50 border-none rounded-2xl px-4 focus:ring-1 focus:ring-blue-100 font-bold text-slate-900">
                      <SelectValue placeholder="Destino" />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-slate-100">
                      <SelectItem value="EXPURGO">Descarte</SelectItem>
                      <SelectItem value="PERMANENTE">Permanente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <DialogFooter className="p-8 bg-slate-50 flex flex-col sm:flex-row gap-3">
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => setIsModalOpen(false)}
                className="rounded-2xl h-12 font-bold text-slate-500 hover:bg-white flex-1"
              >
                Cancelar
              </Button>
              <Button 
                type="submit" 
                disabled={isProcessing}
                className="bg-[#1a355b] hover:bg-[#10213d] text-white font-bold h-12 rounded-2xl flex-1 shadow-lg shadow-blue-900/10 transition-all active:scale-[0.97]"
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : (editingType ? 'Salvar Alterações' : 'Criar Tipo')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
