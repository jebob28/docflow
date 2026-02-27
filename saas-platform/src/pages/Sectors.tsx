import { useState, useEffect } from 'react';
import { 
  Users, 
  Plus, 
  Search, 
  Trash2, 
  Edit2,
  Building2,
  Calendar,
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
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Sector {
  id: string;
  name: string;
  description: string;
  created_at: string;
  can_edit: boolean;
  can_delete: boolean;
}

export default function Sectors() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingSector, setEditingSector] = useState<Sector | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.matchMedia('(min-width: 1024px)').matches);
    };
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);
  
  // Estados para exclusão elegante
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [sectorToDelete, setSectorToDelete] = useState<Sector | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const [newSector, setNewSector] = useState({
    name: '',
    description: ''
  });

  const fetchSectors = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/sectors', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setSectors(data.sectors || []);
        setCanCreate(data.can_create || false);
      } else {
        toast.error('Erro ao carregar setores');
      }
    } catch (error) {
      console.error('Error fetching sectors:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSectors();
  }, []);

  const handleCreateSector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSector.name.trim()) {
      toast.error('O nome do setor é obrigatório');
      return;
    }

    setIsCreating(true);
    try {
      const token = localStorage.getItem('token');
      const url = editingSector ? `/api/v1/sectors/${editingSector.id}` : '/api/v1/sectors';
      const method = editingSector ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method: method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newSector)
      });

      if (response.ok) {
        toast.success(editingSector ? 'Setor atualizado com sucesso' : 'Setor criado com sucesso');
        setIsModalOpen(false);
        setNewSector({ name: '', description: '' });
        setEditingSector(null);
        fetchSectors();
      } else {
        const error = await response.json();
        toast.error(error.message || `Erro ao ${editingSector ? 'atualizar' : 'criar'} setor`);
      }
    } catch {
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setIsCreating(false);
    }
  };

  const handleEditClick = (sector: Sector) => {
    setEditingSector(sector);
    setNewSector({
      name: sector.name,
      description: sector.description
    });
    setIsModalOpen(true);
  };

  const handleDeleteClick = (sector: Sector) => {
    setSectorToDelete(sector);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!sectorToDelete) return;

    setIsDeleting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/sectors/${sectorToDelete.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        toast.success('Setor excluído com sucesso');
        setIsDeleteModalOpen(false);
        setSectorToDelete(null);
        fetchSectors();
      } else {
        toast.error('Erro ao excluir setor');
      }
    } catch {
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredSectors = sectors.filter(sector => 
    sector.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    sector.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  };

  const SectorCard = ({ sector }: { sector: Sector }) => (
    <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden hover:shadow-md transition-all duration-300">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 shadow-sm">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">{sector.name}</h3>
              <p className="text-[10px] text-slate-500 font-medium line-clamp-1">
                {sector.description || 'Sem descrição'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            {sector.can_edit && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                onClick={() => handleEditClick(sector)}
              >
                <Edit2 className="h-4 w-4" />
              </Button>
            )}
            {sector.can_delete && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                onClick={() => handleDeleteClick(sector)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-50 mt-2">
          <div className="flex flex-col">
            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Criado em</span>
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600">
              <Calendar className="h-3 w-3 text-slate-400" />
              {formatDate(sector.created_at)}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {!sector.can_edit && !sector.can_delete && (
              <span className="text-[9px] text-slate-400 font-bold italic uppercase tracking-tighter bg-slate-50 px-2 py-1 rounded-md">
                Somente Leitura
              </span>
            )}
            {sector.can_edit && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-8 rounded-xl text-blue-600 font-black text-[10px] uppercase tracking-wider hover:bg-blue-50 px-3"
                onClick={() => handleEditClick(sector)}
              >
                Editar
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20 md:pb-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-1 md:px-0">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Setores</h1>
          <p className="text-slate-500 text-xs md:text-sm font-medium mt-1">Gerencie os departamentos da sua organização</p>
        </div>
        {canCreate && (
          <Button 
            onClick={() => setIsModalOpen(true)}
            className="bg-[#1a355b] hover:bg-[#10213d] text-white font-bold px-6 h-12 md:h-11 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-blue-900/10 transition-all active:scale-[0.97] w-full md:w-auto"
          >
            <Plus className="h-4 w-4" />
            Novo Setor
          </Button>
        )}
      </div>

      {/* Stats Summary - Horizontal scroll on mobile */}
      <div className="flex md:grid md:grid-cols-3 gap-4 overflow-x-auto pb-2 md:pb-0 scrollbar-hide -mx-1 px-1">
        <Card className="min-w-[200px] flex-1 border-none shadow-sm bg-white rounded-2xl overflow-hidden group hover:shadow-md transition-all duration-300">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total</p>
              <p className="text-2xl font-black text-slate-900 mt-0.5">{sectors.length}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="min-w-[200px] flex-1 border-none shadow-sm bg-white rounded-2xl overflow-hidden group hover:shadow-md transition-all duration-300">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Atividade</p>
              <p className="text-2xl font-black text-slate-900 mt-0.5">Hoje</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Card className="border-none shadow-sm bg-white rounded-[24px] md:rounded-[32px] overflow-hidden">
        <div className="p-4 md:p-6 border-b border-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative w-full sm:w-80 group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
            <Input 
              placeholder="Pesquisar setores..." 
              className="pl-10 h-11 md:h-10 bg-slate-50 border-none rounded-xl text-sm focus-visible:ring-blue-500/10 transition-all font-medium"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div>
          {loading ? (
            <div className="p-20 text-center">
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl animate-pulse" />
                <Loader2 className="h-10 w-10 text-blue-500 animate-spin relative z-10" />
              </div>
              <p className="text-slate-500 text-sm font-medium mt-4">Sincronizando setores...</p>
            </div>
          ) : filteredSectors.length === 0 ? (
            <div className="p-20 text-center">
              <div className="bg-slate-50 w-20 h-20 rounded-[24px] flex items-center justify-center mx-auto mb-6">
                <Building2 className="h-8 w-8 text-slate-300" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Nenhum setor por aqui</h3>
              <p className="text-slate-500 text-sm mt-1.5 max-w-[240px] mx-auto">Organize sua estrutura criando o primeiro setor da organização.</p>
              <Button 
                variant="outline"
                onClick={() => setIsModalOpen(true)}
                className="mt-6 rounded-xl border-slate-200 font-bold px-6 h-11 text-sm"
              >
                Começar Agora
              </Button>
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50/50">
                    <TableRow className="border-none">
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 pl-6 h-12">Setor</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 h-12">Descrição</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 h-12">Data de Criação</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 pr-6 text-right h-12">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSectors.map((sector) => (
                      <TableRow key={sector.id} className="border-slate-50 hover:bg-slate-50/50 group transition-all duration-200">
                        <TableCell className="py-4 pl-6">
                          <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 group-hover:bg-white group-hover:shadow-sm transition-all duration-300">
                              <Users className="h-4.5 w-4.5" />
                            </div>
                            <span className="font-bold text-slate-900 text-sm">{sector.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-500 font-medium line-clamp-1 max-w-xs">{sector.description || 'Sem descrição'}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold">
                            <Calendar className="h-3.5 w-3.5 text-slate-400" />
                            {formatDate(sector.created_at)}
                          </div>
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-300">
                            {sector.can_edit && (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8.5 w-8.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                                onClick={() => handleEditClick(sector)}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                            )}
                            {sector.can_delete && (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8.5 w-8.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                onClick={() => handleDeleteClick(sector)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden p-4 space-y-4">
                {filteredSectors.map((sector) => (
                  <SectorCard key={sector.id} sector={sector} />
                ))}
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Create Sector Sheet */}
      <Sheet open={isModalOpen} onOpenChange={(open) => {
        setIsModalOpen(open);
        if (!open) {
          setEditingSector(null);
          setNewSector({ name: '', description: '' });
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
            "px-8 pt-10 pb-6 border-b border-slate-50 shrink-0 relative",
            isDesktop && "pt-12 pb-8"
          )}>
            <div className="flex items-center gap-4 relative z-10">
              <div className="p-3.5 rounded-2xl bg-blue-50 text-[#1a355b] shadow-sm border border-blue-100/50">
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
                  {editingSector ? 'Atualize as informações do departamento' : 'Cadastre um novo setor na organização'}
                </SheetDescription>
              </div>
            </div>
            {isDesktop && (
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/30 rounded-full -mr-16 -mt-16 blur-3xl" />
            )}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-8 py-8 custom-scrollbar">
            <form onSubmit={handleCreateSector} id="sector-form" className="space-y-8">
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Nome do Setor
                  </label>
                  <div className="relative group">
                    <Input 
                      placeholder="Ex: Recursos Humanos" 
                      className="h-14 bg-slate-50/50 border-slate-200 rounded-2xl focus-visible:ring-4 focus-visible:ring-blue-500/5 focus-visible:border-[#1a355b] transition-all font-bold text-slate-900 placeholder:text-slate-400 text-base md:text-sm pl-4 shadow-sm group-hover:bg-white"
                      value={newSector.name}
                      onChange={(e) => setNewSector(prev => ({ ...prev, name: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Descrição (Opcional)
                  </label>
                  <div className="relative group">
                    <textarea 
                      placeholder="Descreva as responsabilidades deste setor..." 
                      className="w-full min-h-[160px] p-4 bg-slate-50/50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-[#1a355b] transition-all font-bold text-base md:text-sm resize-none text-slate-900 placeholder:text-slate-400 shadow-sm group-hover:bg-white"
                      value={newSector.description}
                      onChange={(e) => setNewSector(prev => ({ ...prev, description: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </form>
          </div>

          <SheetFooter className={cn(
            "px-8 py-6 border-t border-slate-50 bg-white shrink-0",
            isDesktop ? "pb-10" : "pb-8 mb-6"
          )}>
            <div className="flex flex-col w-full gap-4">
              <Button 
                type="submit" 
                form="sector-form"
                disabled={isCreating}
                className={cn(
                  "w-full h-14 rounded-2xl font-black text-lg shadow-xl transition-all active:scale-[0.97] flex items-center justify-center gap-3",
                  newSector.name.trim() 
                    ? "bg-[#1a355b] hover:bg-[#10213d] text-white shadow-blue-900/10" 
                    : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                )}
              >
                {isCreating ? (
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
                    className="w-full py-2 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors hidden"
                  >
                    Cancelar
                  </button>
                ) : (
                  <Button 
                    variant="ghost" 
                    className="h-12 rounded-2xl font-bold text-slate-500 hover:bg-slate-50 hidden"
                  >
                    Cancelar
                  </Button>
                )}
              </SheetClose>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Modal Revert */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="w-[95vw] sm:max-w-[400px] rounded-2xl p-0 overflow-hidden border-none shadow-2xl bg-white animate-in fade-in zoom-in-95 duration-200">
          <div className="p-8 border-b border-slate-100/80 relative">
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 rounded-xl bg-rose-50 text-rose-600">
                <Trash2 className="h-6 w-6" />
              </div>
              <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">Excluir Setor</DialogTitle>
            </div>
            <DialogDescription className="text-slate-500 text-sm font-medium">
              Esta ação não pode ser desfeita
            </DialogDescription>
          </div>

          <div className="p-8 space-y-4 bg-slate-50/30">
            <p className="text-slate-600 text-sm leading-relaxed">
              Você tem certeza que deseja excluir o setor <span className="font-bold text-slate-900">"{sectorToDelete?.name}"</span>? 
              Isso pode afetar a organização de documentos vinculados.
            </p>
            
            <div className="flex flex-col gap-3 pt-2">
              <Button 
                onClick={confirmDelete}
                disabled={isDeleting}
                className="w-full h-12 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-lg shadow-rose-900/10 flex items-center justify-center gap-2"
              >
                {isDeleting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Confirmar Exclusão"}
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => setIsDeleteModalOpen(false)}
                className="w-full h-12 text-slate-400 font-bold hover:text-slate-600 hover:bg-white rounded-xl transition-all hidden"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
