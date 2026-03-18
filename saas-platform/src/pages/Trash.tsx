import { useEffect, useState, useCallback } from 'react';
import { 
  FileText, 
  Folder,
  FileSpreadsheet,
  FileImage,
  Trash2,
  RefreshCcw,
  Loader2,
  Info,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface TrashItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  extension?: string;
  size?: number;
  color?: string;
  sector_name?: string;
  created_at: string;
  deleted_at: string;
  can_edit: boolean;
  document_type?: string;
}

export default function Trash() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isEmptyTrashModalOpen, setIsEmptyTrashModalOpen] = useState(false);
  const [selectedItemForDelete, setSelectedItemForDelete] = useState<TrashItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const fetchTrash = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/documents/trash', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setItems(data || []);
      } else {
        toast.error('Erro ao carregar lixeira');
      }
    } catch {
      console.error('Erro ao buscar lixeira');
      toast.error('Erro de conexão ao buscar lixeira');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrash();
  }, [fetchTrash]);

  const handleRestore = async (item: TrashItem) => {
    try {
      setActionLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/trash/${item.id}/restore?is_folder=${item.type === 'folder'}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        toast.success(`${item.type === 'folder' ? 'Pasta' : 'Documento'} restaurado com sucesso!`);
        setItems(prev => prev.filter(i => i.id !== item.id));
        setSelectedIds(prev => prev.filter(id => id !== item.id));
      } else {
        toast.error('Erro ao restaurar item');
      }
    } catch {
      toast.error('Erro de conexão ao restaurar');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!selectedItemForDelete) return;

    try {
      setActionLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/trash/${selectedItemForDelete.id}?is_folder=${selectedItemForDelete.type === 'folder'}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        toast.success('Item excluído permanentemente!');
        setItems(prev => prev.filter(i => i.id !== selectedItemForDelete.id));
        setSelectedIds(prev => prev.filter(id => id !== selectedItemForDelete.id));
        setIsDeleteModalOpen(false);
        setSelectedItemForDelete(null);
      } else {
        toast.error('Erro ao excluir item definitivamente');
      }
    } catch {
      toast.error('Erro de conexão ao excluir');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEmptyTrash = async () => {
    try {
      setActionLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/documents/trash/empty', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        toast.success('Lixeira esvaziada com sucesso!');
        setItems([]);
        setSelectedIds([]);
        setIsEmptyTrashModalOpen(false);
      } else {
        toast.error('Erro ao esvaziar lixeira');
      }
    } catch {
      toast.error('Erro de conexão ao esvaziar lixeira');
    } finally {
      setActionLoading(false);
    }
  };

  const getFileIcon = (type: string, extension?: string) => {
    if (type === 'folder') return <Folder className="w-5 h-5 text-amber-500 fill-amber-500" />;
    
    const ext = extension?.toLowerCase();
    if (ext === 'pdf') return <FileText className="w-5 h-5 text-red-500" />;
    if (['doc', 'docx'].includes(ext || '')) return <FileText className="w-5 h-5 text-blue-600" />;
    if (['xls', 'xlsx', 'csv'].includes(ext || '')) return <FileSpreadsheet className="w-5 h-5 text-emerald-600" />;
    if (['jpg', 'jpeg', 'png', 'gif', 'svg'].includes(ext || '')) return <FileImage className="w-5 h-5 text-purple-500" />;
    
    return <FileText className="w-5 h-5 text-slate-400" />;
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '--';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const filteredItems = items;

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredItems.map(i => i.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const TrashCard = ({ item }: { item: TrashItem }) => (
    <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden hover:shadow-md transition-all duration-300">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-3">
            <Checkbox 
              checked={selectedIds.includes(item.id)}
              onCheckedChange={() => toggleSelect(item.id)}
              className="border-border data-[state=checked]:bg-[#1e293b] data-[state=checked]:border-[#1e293b] h-5 w-5 rounded-md"
            />
            <div className="p-2 rounded-xl bg-slate-50">
              {getFileIcon(item.type, item.extension)}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-2xl shadow-xl p-1.5 bg-white border border-border">
              {item.can_edit ? (
                <>
                  <DropdownMenuItem 
                    onClick={() => handleRestore(item)}
                    className="flex items-center gap-2.5 py-3 px-4 rounded-xl text-emerald-600 focus:text-emerald-700 focus:bg-emerald-50 font-bold text-xs"
                  >
                    <RefreshCcw className="w-4 h-4" />
                    Restaurar
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => {
                      setSelectedItemForDelete(item);
                      setIsDeleteModalOpen(true);
                    }}
                    className="flex items-center gap-2.5 py-3 px-4 rounded-xl text-red-600 focus:text-red-700 focus:bg-red-50 font-bold text-xs"
                  >
                    <Trash2 className="w-4 h-4" />
                    Excluir Permanentemente
                  </DropdownMenuItem>
                </>
              ) : (
                <div className="px-4 py-3 text-[10px] text-slate-500 font-bold italic text-center uppercase tracking-widest">
                  Sem permissão
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <h3 className="font-bold text-slate-800 text-sm truncate mb-1" title={item.name}>{item.name}</h3>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="px-2 py-0.5 rounded-md text-[9px] font-black bg-slate-100 text-slate-500 uppercase tracking-tighter">
            {item.sector_name || 'Geral'}
          </span>
          {item.document_type && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[8px] font-black uppercase tracking-widest border border-border/50">
              {item.document_type}
            </span>
          )}
          <span className="text-[10px] font-bold text-slate-400">
            • {formatSize(item.size)}
          </span>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="flex flex-col">
            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Excluído em</span>
            <span className="text-[10px] font-bold text-slate-600">
              {format(new Date(item.deleted_at), "dd/MM/yyyy", { locale: ptBR })}
            </span>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 rounded-xl text-blue-600 font-black text-[10px] uppercase tracking-wider hover:bg-blue-50 px-3"
            onClick={() => handleRestore(item)}
            disabled={!item.can_edit || actionLoading}
          >
            Restaurar
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-4 sm:p-8 space-y-4 sm:space-y-8 max-w-[1600px] mx-auto bg-[#f8fafc] min-h-screen pb-24 lg:pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Lixeira</h1>
          <p className="text-slate-500 text-sm sm:text-base font-medium mt-1">Gerencie seus arquivos excluídos recentemente</p>
        </div>
        <Button 
          variant="outline" 
          className="w-full sm:w-auto h-12 sm:h-10 text-red-600 border-red-100 hover:bg-red-50 hover:text-red-700 font-bold rounded-2xl sm:rounded-xl shadow-sm"
          disabled={items.length === 0 || actionLoading}
          onClick={() => setIsEmptyTrashModalOpen(true)}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Esvaziar Lixeira
        </Button>
      </div>

      {/* Info Card */}
      <Card className="bg-slate-900 border-none shadow-xl rounded-3xl overflow-hidden">
        <CardContent className="p-5 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-center sm:text-left">
            <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
              <Info className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="font-black text-white text-base tracking-tight">Aviso de Exclusão Automática</p>
              <p className="text-slate-400 text-xs sm:text-sm font-medium mt-0.5">Os itens na lixeira serão excluídos permanentemente após 30 dias.</p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            className="text-white font-bold text-xs hover:bg-white/10 rounded-xl"
            onClick={() => toast.info("Consulte os termos de uso para mais detalhes.")}
          >
            Saiba mais
          </Button>
        </CardContent>
      </Card>

      {/* Content */}
      <div className="space-y-4">
        {/* Mobile Selection Info */}
        {selectedIds.length > 0 && (
          <div className="sm:hidden flex items-center justify-between bg-blue-600 p-4 rounded-2xl shadow-lg animate-in slide-in-from-top-4 duration-300">
            <span className="text-white font-black text-xs uppercase tracking-widest">{selectedIds.length} selecionados</span>
            <div className="flex gap-2">
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-white hover:bg-white/20 font-bold text-[10px] uppercase"
                onClick={() => setSelectedIds([])}
              >
                Limpar
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-border">
            <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
            <p className="text-slate-500 font-bold">Carregando itens...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-border text-center px-6">
            <div className="w-20 h-20 rounded-full bg-slate-50 flex items-center justify-center mb-6">
              <Trash2 className="w-10 h-10 text-slate-300" />
            </div>
            <h3 className="text-xl font-black text-slate-800 tracking-tight">Sua lixeira está vazia</h3>
            <p className="text-slate-400 text-sm font-medium mt-2 max-w-xs">Os arquivos que você excluir aparecerão aqui por até 30 dias.</p>
          </div>
        ) : (
          <>
            {/* Table View (Desktop) */}
            <Card className="hidden sm:block border-none shadow-sm overflow-hidden bg-white rounded-3xl">
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-slate-50/50">
                    <TableRow className="hover:bg-transparent border-border">
                      <TableHead className="w-14 pl-8">
                        <Checkbox 
                          checked={selectedIds.length > 0 && selectedIds.length === filteredItems.length}
                          onCheckedChange={toggleSelectAll}
                          className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                        />
                      </TableHead>
                      <TableHead className="text-slate-400 font-black uppercase text-[10px] tracking-widest">Nome do Arquivo</TableHead>
                      <TableHead className="text-slate-400 font-black uppercase text-[10px] tracking-widest">Excluído em</TableHead>
                      <TableHead className="text-slate-400 font-black uppercase text-[10px] tracking-widest">Tamanho</TableHead>
                      <TableHead className="text-slate-400 font-black uppercase text-[10px] tracking-widest">Original</TableHead>
                      <TableHead className="text-right pr-8 text-slate-400 font-black uppercase text-[10px] tracking-widest">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => (
                      <TableRow key={item.id} className="group hover:bg-slate-50/50 transition-colors border-border h-16">
                        <TableCell className="pl-8">
                          <Checkbox 
                            checked={selectedIds.includes(item.id)}
                            onCheckedChange={() => toggleSelect(item.id)}
                            className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-4">
                            <div className="p-2 rounded-xl bg-slate-50">
                              {getFileIcon(item.type, item.extension)}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-bold text-slate-700 text-sm group-hover:text-slate-900 transition-colors truncate max-w-[300px]">
                                {item.name}
                              </span>
                              {item.document_type && (
                                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-0.5">
                                  {item.document_type}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-500 text-xs font-bold">
                          {format(new Date(item.deleted_at), "dd MMM yyyy", { locale: ptBR })}
                        </TableCell>
                        <TableCell className="text-slate-500 text-xs font-bold uppercase">
                          {formatSize(item.size)}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[9px] font-black bg-slate-100 text-slate-500 uppercase tracking-widest">
                            {item.sector_name || 'Geral'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right pr-8">
                          <div className="flex items-center justify-end gap-2">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-9 w-9 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                              onClick={() => handleRestore(item)}
                              disabled={!item.can_edit || actionLoading}
                              title="Restaurar"
                            >
                              <RefreshCcw className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-9 w-9 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                              onClick={() => {
                                setSelectedItemForDelete(item);
                                setIsDeleteModalOpen(true);
                              }}
                              disabled={!item.can_edit || actionLoading}
                              title="Excluir Permanentemente"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Grid View (Mobile) */}
            <div className="grid grid-cols-1 gap-4 sm:hidden">
              {filteredItems.map((item) => (
                <TrashCard key={item.id} item={item} />
              ))}
            </div>

            {/* Pagination */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 px-2">
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">
                <span className="text-slate-900">{filteredItems.length}</span> de <span className="text-slate-900">{items.length}</span> arquivos
              </p>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl border border-border" disabled><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="default" className="h-9 w-9 bg-primary text-white font-black text-xs rounded-xl">1</Button>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl border border-border" onClick={() => toast.info("Em desenvolvimento")}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modals Responsivos */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="max-w-[95%] sm:max-w-md rounded-[2.5rem] border-none shadow-2xl p-0 overflow-hidden">
          <div className="p-8 text-center">
            <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center mb-6 mx-auto">
              <Trash2 className="w-10 h-10 text-red-600" />
            </div>
            <DialogTitle className="text-2xl font-black text-slate-900 tracking-tight">Excluir para sempre?</DialogTitle>
            <DialogDescription className="text-slate-500 font-medium mt-3 text-sm leading-relaxed">
              O arquivo <span className="font-bold text-slate-900">"{selectedItemForDelete?.name}"</span> será removido definitivamente. Esta ação não pode ser desfeita.
            </DialogDescription>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 p-6 bg-slate-50/50">
            <Button 
              variant="ghost" 
              onClick={() => setIsDeleteModalOpen(false)} 
              className="flex-1 h-14 rounded-2xl font-bold text-slate-500"
            >
              Cancelar
            </Button>
            <Button 
              onClick={handlePermanentDelete}
              className="flex-1 h-14 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black shadow-lg shadow-red-200"
              disabled={actionLoading}
            >
              {actionLoading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : "Sim, Excluir"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isEmptyTrashModalOpen} onOpenChange={setIsEmptyTrashModalOpen}>
        <DialogContent className="max-w-[95%] sm:max-w-md rounded-[2.5rem] border-none shadow-2xl p-0 overflow-hidden">
          <div className="p-8 text-center">
            <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center mb-6 mx-auto">
              <Trash2 className="w-10 h-10 text-red-600" />
            </div>
            <DialogTitle className="text-2xl font-black text-slate-900 tracking-tight">Esvaziar lixeira?</DialogTitle>
            <DialogDescription className="text-slate-500 font-medium mt-3 text-sm leading-relaxed">
              Isso apagará <span className="font-bold text-slate-900">TODOS</span> os arquivos da lixeira permanentemente. Não há como desfazer isso.
            </DialogDescription>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 p-6 bg-slate-50/50">
            <Button 
              variant="ghost" 
              onClick={() => setIsEmptyTrashModalOpen(false)} 
              className="flex-1 h-14 rounded-2xl font-bold text-slate-500"
            >
              Voltar
            </Button>
            <Button 
              onClick={handleEmptyTrash}
              className="flex-1 h-14 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black shadow-lg shadow-red-200"
              disabled={actionLoading}
            >
              {actionLoading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : "Esvaziar Agora"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
