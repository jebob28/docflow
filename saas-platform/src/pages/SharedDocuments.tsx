import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Share2, 
  Search, 
  Filter, 
  MoreVertical, 
  FileText,
  Folder,
  Clock,
  User,
  ExternalLink,
  ChevronRight,
  Loader2,
  Tag as TagIcon,
  Download,
  Trash2,
  Eye
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import ShareModal from '@/components/ShareModal';

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface SharedFile {
  id: string;
  name: string;
  extension: string;
  size: number;
  content_type: string;
  created_at: string;
  shared_by?: string;
  permission?: string;
  tags?: Tag[];
  can_edit?: boolean;
  is_public?: boolean;
  link_id?: string;
  type?: 'document' | 'folder';
  document_type?: string;
}

export default function SharedDocuments() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'with-me' | 'by-me'>('with-me');
  const [documents, setDocuments] = useState<SharedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<SharedFile | null>(null);
  const [revoking, setRevoking] = useState(false);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const endpoint = activeTab === 'with-me' ? '/api/v1/documents/shared/with-me' : '/api/v1/documents/shared/by-me';
      const response = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setDocuments(data || []);
      } else {
        toast.error("Erro ao carregar documentos compartilhados.");
      }
    } catch (error) {
      console.error("Erro:", error);
      toast.error("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const filteredDocs = documents.filter(doc => 
    doc.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleDownload = (doc: SharedFile) => {
    const token = localStorage.getItem('token');
    const url = `/api/v1/documents/${doc.id}/download`;
    
    toast.promise(
      fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      }).then(async (res) => {
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `${doc.name}${doc.extension || ''}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }),
      {
        loading: `Preparando download de: ${doc.name}${doc.extension || ''}...`,
        success: `Download de ${doc.name}${doc.extension || ''} iniciado!`,
        error: 'Erro ao processar download.',
      }
    );
  };

  const handleRevoke = (doc: SharedFile) => {
    setSelectedDoc(doc);
    if (doc.is_public && doc.link_id) {
      setIsRevokeDialogOpen(true);
    } else {
      setIsShareModalOpen(true);
      toast.info("Para revogar o acesso de usuários ou setores, utilize o modal de gerenciamento.");
    }
  };

  const confirmRevoke = async () => {
    if (!selectedDoc || !selectedDoc.link_id) return;
    
    setRevoking(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/shares/${selectedDoc.link_id}?type=link`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success("Link público revogado com sucesso.");
        setIsRevokeDialogOpen(false);
        fetchDocuments();
      } else {
        toast.error("Erro ao revogar link público.");
      }
    } catch (error) {
      console.error("Erro ao revogar:", error);
      toast.error("Erro de conexão ao revogar acesso.");
    } finally {
      setRevoking(false);
    }
  };

  const handleView = (doc: SharedFile) => {
    if (doc.type === 'folder') {
      toast.info("Para visualizar o conteúdo desta pasta, acesse a página de Documentos.");
      navigate('/documents');
      return;
    }
    navigate(`/documents/view/${doc.id}`);
  };

  const copyPublicLink = (doc: SharedFile) => {
    if (doc.is_public && doc.link_id) {
      const fullUrl = `${window.location.origin}/public/share/${doc.link_id}`;
      navigator.clipboard.writeText(fullUrl);
      toast.success("Link público copiado para a área de transferência!");
    } else {
      toast.info("Este item não possui um link público ativo. Use 'Gerenciar Acesso' para criar um.");
    }
  };

  const DocumentCard = ({ doc }: { doc: SharedFile }) => (
    <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden hover:shadow-md transition-all duration-300">
      <div className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-2.5 rounded-xl shadow-sm shadow-indigo-100",
              doc.type === 'folder' ? "bg-amber-50 text-amber-600" :
              doc.extension === 'pdf' ? "bg-red-50 text-red-600" :
              doc.extension === 'docx' ? "bg-blue-50 text-blue-600" :
              doc.extension === 'xlsx' ? "bg-emerald-50 text-emerald-600" :
              "bg-indigo-50 text-indigo-600"
            )}>
              {doc.type === 'folder' ? <Folder className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-slate-900 text-sm truncate pr-2">
                {doc.name}{doc.extension ? `.${doc.extension}` : ''}
              </h3>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{formatSize(doc.size)}</p>
                <div className="w-1 h-1 rounded-full bg-slate-300" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                  {format(new Date(doc.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                </p>
                {doc.document_type && (
                  <>
                    <div className="w-1 h-1 rounded-full bg-slate-300" />
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[8px] font-black uppercase tracking-widest border border-border/50">
                      {doc.document_type}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg hover:bg-slate-50 text-slate-400">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-2xl border-none shadow-2xl p-2 bg-white">
              {activeTab === 'with-me' ? (
                <>
                  <DropdownMenuItem 
                    onClick={() => handleView(doc)}
                    className="flex items-center gap-3 p-3 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-blue-600 font-semibold cursor-pointer"
                  >
                    <Eye className="h-4 w-4" />
                    Visualizar
                  </DropdownMenuItem>
                  
                  {doc.type !== 'folder' && (
                    <DropdownMenuItem 
                      onClick={() => handleDownload(doc)}
                      className="flex items-center gap-3 p-3 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-blue-600 font-semibold cursor-pointer"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </DropdownMenuItem>
                  )}
                </>
              ) : (
                <>
                  <DropdownMenuItem 
                    onClick={() => handleRevoke(doc)}
                    className="flex items-center gap-3 p-3 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                    Revogar Acesso
                  </DropdownMenuItem>

                  {doc.is_public && (
                    <DropdownMenuItem 
                      onClick={() => copyPublicLink(doc)}
                      className="flex items-center gap-3 p-3 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-blue-600 font-semibold cursor-pointer"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Copiar Link Público
                    </DropdownMenuItem>
                  )}
                </>
              )}

              <DropdownMenuSeparator className="bg-slate-50 my-1" />

              {doc.can_edit && (
                <DropdownMenuItem 
                  onClick={() => {
                    setSelectedDoc(doc);
                    setIsShareModalOpen(true);
                  }}
                  className="flex items-center gap-3 p-3 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-blue-600 font-semibold cursor-pointer"
                >
                  <Share2 className="h-4 w-4" />
                  Gerenciar Acesso
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <User className="h-3 w-3 text-slate-500" />
              </div>
              <span className="text-[11px] font-bold text-slate-600 truncate max-w-[120px]">
                {doc.shared_by || 'Sistema'}
              </span>
            </div>

            <div className={cn(
              "flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold gap-1 shadow-sm",
              doc.permission === 'WRITE' 
                ? "bg-blue-50 text-blue-600" 
                : "bg-slate-100 text-slate-500"
            )}>
              {doc.permission === 'WRITE' ? 'Pode Editar' : 'Apenas Ver'}
            </div>
          </div>

          {doc.tags && doc.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {doc.tags.map((tag: Tag) => (
                <div 
                  key={tag.id}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider border"
                  style={{ 
                    backgroundColor: `${tag.color}10`, 
                    color: tag.color,
                    borderColor: `${tag.color}25`
                  }}
                >
                  <TagIcon className="h-2 w-2" />
                  {tag.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );

  return (
    <div className="p-4 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-slate-400 text-sm font-medium">
            <span>Início</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-blue-600">Arquivos Compartilhados</span>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Arquivos Compartilhados</h1>
          <p className="text-slate-500 font-medium">Gerencie documentos compartilhados com você ou por você em tempo real.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            onClick={() => {
              const searchInput = document.querySelector('input[placeholder*="Pesquisar"]') as HTMLInputElement;
              if (searchInput) searchInput.focus();
              toast.info("Use o campo de busca para filtrar por nome.");
            }}
            className="bg-white border-border text-slate-600 hover:bg-slate-50 rounded-xl h-11 px-5 font-semibold transition-all duration-300 shadow-sm"
          >
            <Filter className="h-4 w-4 mr-2" />
            Filtrar
          </Button>
          <Button 
            onClick={() => {
              toast.info("Selecione um arquivo na página de Documentos para compartilhar.");
              navigate('/documents');
            }}
            className="bg-primary hover:bg-primary/90 text-white rounded-xl h-11 px-5 font-semibold transition-all duration-300 shadow-lg shadow-blue-900/10"
          >
            <Share2 className="h-4 w-4 mr-2" />
            Compartilhar novo
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-1 bg-slate-100/50 p-1 rounded-2xl w-full sm:w-fit overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('with-me')}
            className={cn(
              "flex items-center gap-2 px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all duration-300 whitespace-nowrap flex-1 sm:flex-none justify-center",
              activeTab === 'with-me' 
                ? "bg-white text-blue-600 shadow-sm" 
                : "text-slate-500 hover:text-slate-700 hover:bg-white/50"
            )}
          >
            <Clock className="h-4 w-4" />
            Comigo
            <span className={cn(
              "ml-1 px-2 py-0.5 rounded-full text-[10px]",
              activeTab === 'with-me' ? "bg-blue-50 text-blue-600" : "bg-slate-200 text-slate-500"
            )}>
              {activeTab === 'with-me' ? documents.length : documents.filter(d => d.permission === 'OWNER').length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('by-me')}
            className={cn(
              "flex items-center gap-2 px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all duration-300 whitespace-nowrap flex-1 sm:flex-none justify-center",
              activeTab === 'by-me' 
                ? "bg-white text-blue-600 shadow-sm" 
                : "text-slate-500 hover:text-slate-700 hover:bg-white/50"
            )}
          >
            <ExternalLink className="h-4 w-4" />
            Por mim
            <span className={cn(
              "ml-1 px-2 py-0.5 rounded-full text-[10px]",
              activeTab === 'by-me' ? "bg-blue-50 text-blue-600" : "bg-slate-200 text-slate-500"
            )}>
              {activeTab === 'by-me' ? documents.length : documents.filter(d => d.is_public || d.permission === 'OWNER').length}
            </span>
          </button>
        </div>
      </div>

      {/* Content */}
      <Card className="border-none shadow-sm bg-white rounded-[24px] overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative w-full sm:w-80 group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
            <Input 
              placeholder="Pesquisar..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 h-11 bg-slate-50/50 border-none rounded-xl focus-visible:ring-2 focus-visible:ring-blue-500/20 transition-all duration-300"
            />
          </div>
        </div>

        {/* Desktop View */}
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow className="hover:bg-transparent border-none">
                <TableHead className="h-12 text-[11px] font-bold uppercase text-slate-400 px-6 tracking-wider">Nome do Arquivo</TableHead>
                <TableHead className="h-12 text-[11px] font-bold uppercase text-slate-400 px-6 tracking-wider">
                  {activeTab === 'with-me' ? 'Compartilhado por' : 'Público/Setor'}
                </TableHead>
                <TableHead className="h-12 text-[11px] font-bold uppercase text-slate-400 px-6 tracking-wider">Data</TableHead>
                <TableHead className="h-12 text-[11px] font-bold uppercase text-slate-400 px-6 tracking-wider">Permissões</TableHead>
                <TableHead className="h-12 text-[11px] font-bold uppercase text-slate-400 px-6 tracking-wider text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                      <p className="text-slate-500 font-medium">Carregando documentos...</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredDocs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="p-4 rounded-full bg-slate-50">
                        <Share2 className="h-8 w-8 text-slate-300" />
                      </div>
                      <p className="text-slate-500 font-medium">Nenhum documento encontrado.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredDocs.map((doc) => (
                  <TableRow key={doc.id} className="hover:bg-slate-50/50 transition-colors border-b border-border last:border-0 group">
                    <TableCell className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "p-2.5 rounded-xl shadow-sm transition-transform group-hover:scale-110 duration-300",
                          doc.type === 'folder' ? "bg-amber-50 text-amber-600" :
                          doc.extension === 'pdf' ? "bg-red-50 text-red-600" :
                          doc.extension === 'docx' ? "bg-blue-50 text-blue-600" :
                          doc.extension === 'xlsx' ? "bg-emerald-50 text-emerald-600" :
                          "bg-indigo-50 text-indigo-600"
                        )}>
                          {doc.type === 'folder' ? <Folder className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                            {doc.name}{doc.extension ? `.${doc.extension}` : ''}
                          </p>
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] font-bold text-slate-400">{formatSize(doc.size)}</p>
                            {doc.document_type && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[8px] font-black uppercase tracking-widest border border-border/50">
                                {doc.document_type}
                              </span>
                            )}
                            {doc.tags && doc.tags.length > 0 && (
                              <div className="flex gap-1">
                                {doc.tags.map((tag: Tag) => (
                                  <div 
                                    key={tag.id}
                                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider border"
                                    style={{ 
                                      backgroundColor: `${tag.color}15`, 
                                      color: tag.color,
                                      borderColor: `${tag.color}30`
                                    }}
                                  >
                                    <TagIcon className="h-2 w-2" />
                                    {tag.name}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center">
                          <User className="h-4 w-4 text-slate-500" />
                        </div>
                        <span className="font-semibold text-slate-700">{doc.shared_by || 'Sistema'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      <p className="text-sm font-medium text-slate-600">
                        {format(new Date(doc.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                      </p>
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      <div className={cn(
                        "inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold gap-1.5 shadow-sm",
                        doc.permission === 'WRITE' 
                          ? "bg-blue-50 text-blue-600" 
                          : "bg-slate-100 text-slate-500"
                      )}>
                        <div className={cn("h-1 w-1 rounded-full", doc.permission === 'WRITE' ? "bg-blue-600" : "bg-slate-500")} />
                        {doc.permission === 'WRITE' ? 'Pode Editar' : 'Apenas Visualizar'}
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all duration-300 border border-transparent hover:border-border shadow-sm hover:shadow-md">
                            <MoreVertical className="h-5 w-5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56 p-2 rounded-2xl shadow-xl border-border bg-white animate-in fade-in zoom-in-95 duration-200">
                            <div className="px-2 py-1.5 mb-1 border-b border-border">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-tight">Opções</p>
                            </div>

                            {activeTab === 'with-me' ? (
                              <>
                                <DropdownMenuItem 
                                  onClick={() => handleView(doc)}
                                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-all cursor-pointer group"
                                >
                                  <div className="w-8 h-8 rounded-lg bg-blue-50/50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                                    <Eye className="h-4 w-4 text-blue-500" />
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-sm font-bold">Visualizar</span>
                                    <span className="text-[10px] text-slate-400">Abrir documento</span>
                                  </div>
                                </DropdownMenuItem>
                                
                                {doc.type !== 'folder' && (
                                  <DropdownMenuItem 
                                    onClick={() => handleDownload(doc)}
                                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all cursor-pointer group"
                                  >
                                    <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center group-hover:bg-slate-200 transition-colors">
                                      <Download className="h-4 w-4 text-slate-600" />
                                    </div>
                                    <div className="flex flex-col">
                                      <span className="text-sm font-bold">Download</span>
                                      <span className="text-[10px] text-slate-400">Baixar arquivo</span>
                                    </div>
                                  </DropdownMenuItem>
                                )}
                              </>
                            ) : (
                              <>
                                <DropdownMenuItem 
                                  onClick={() => handleRevoke(doc)}
                                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-rose-600 hover:bg-rose-50 transition-all cursor-pointer group"
                                >
                                  <div className="w-8 h-8 rounded-lg bg-rose-50/50 flex items-center justify-center group-hover:bg-rose-100 transition-colors">
                                    <Trash2 className="h-4 w-4 text-rose-500" />
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-sm font-bold">Revogar Acesso</span>
                                    <span className="text-[10px] text-rose-400/70">Remover compartilhamento</span>
                                  </div>
                                </DropdownMenuItem>

                                {doc.is_public && (
                                  <DropdownMenuItem 
                                    onClick={() => copyPublicLink(doc)}
                                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-all cursor-pointer group"
                                  >
                                    <div className="w-8 h-8 rounded-lg bg-blue-50/50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                                      <ExternalLink className="h-4 w-4 text-blue-500" />
                                    </div>
                                    <div className="flex flex-col">
                                      <span className="text-sm font-bold">Copiar Link</span>
                                      <span className="text-[10px] text-slate-400">Link de acesso público</span>
                                    </div>
                                  </DropdownMenuItem>
                                )}
                              </>
                            )}

                            {doc.can_edit && (
                              <>
                                <DropdownMenuSeparator className="bg-slate-50 my-1" />
                                <DropdownMenuItem 
                                  onClick={() => {
                                    setSelectedDoc(doc);
                                    setIsShareModalOpen(true);
                                  }}
                                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-600 hover:text-primary hover:bg-blue-50 transition-all cursor-pointer group"
                                >
                                  <div className="w-8 h-8 rounded-lg bg-blue-50/50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                                    <Share2 className="h-4 w-4 text-blue-500" />
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-sm font-bold">Gerenciar Acesso</span>
                                    <span className="text-[10px] text-slate-400">Editar permissões</span>
                                  </div>
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile View */}
        <div className="md:hidden grid grid-cols-1 gap-4 p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
              <p className="text-slate-500 font-medium text-sm">Carregando...</p>
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 bg-slate-50 rounded-2xl border-2 border-dashed border-border">
              <Share2 className="h-10 w-10 text-slate-300" />
              <p className="text-slate-500 font-medium text-sm text-center px-6">Nenhum documento compartilhado encontrado.</p>
            </div>
          ) : (
            filteredDocs.map((doc) => (
              <DocumentCard key={doc.id} doc={doc} />
            ))
          )}
        </div>
        
        <div className="p-6 border-t border-border flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
            Mostrando {filteredDocs.length} de {documents.length} resultados
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-9 w-9 p-0 rounded-lg border-border text-slate-600 bg-white" onClick={() => toast.info("Você já está na primeira página.")}>1</Button>
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100" onClick={() => toast.info("A funcionalidade de paginação será habilitada conforme o volume de documentos crescer.")}>2</Button>
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100" onClick={() => toast.info("A funcionalidade de paginação será habilitada conforme o volume de documentos crescer.")}>3</Button>
          </div>
        </div>
      </Card>

      {selectedDoc && (
        <ShareModal 
          isOpen={isShareModalOpen}
          onClose={() => {
            setIsShareModalOpen(false);
            setSelectedDoc(null);
            fetchDocuments(); // Recarregar após gerenciar
          }}
          itemName={selectedDoc.type === 'folder' ? selectedDoc.name : `${selectedDoc.name}${selectedDoc.extension ? `.${selectedDoc.extension}` : ''}`}
          itemId={selectedDoc.id}
          isFolder={selectedDoc.type === 'folder'}
          tags={selectedDoc.tags}
        />
      )}

      <Dialog open={isRevokeDialogOpen} onOpenChange={setIsRevokeDialogOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-3xl border-none shadow-2xl p-0 overflow-hidden bg-white">
          <div className="bg-rose-50/50 p-6 flex flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-rose-100 flex items-center justify-center shadow-inner">
              <Trash2 className="h-8 w-8 text-rose-600" />
            </div>
            <DialogHeader className="text-center">
              <DialogTitle className="text-xl font-bold text-slate-900">Revogar Link Público</DialogTitle>
              <DialogDescription className="text-slate-500 font-medium">
                Tem certeza que deseja revogar o link público para <span className="text-slate-900 font-bold">"{selectedDoc?.name}"</span>?
              </DialogDescription>
            </DialogHeader>
          </div>
          
          <div className="p-6 pt-0 space-y-4">
            <div className="bg-slate-50 p-4 rounded-2xl border border-border space-y-2">
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <Clock className="h-3 w-3" />
                Consequências
              </div>
              <ul className="text-xs text-slate-600 font-medium space-y-1.5 list-disc list-inside">
                <li>O link deixará de funcionar imediatamente</li>
                <li>Qualquer pessoa com o link perderá o acesso</li>
                <li>A senha associada será invalidada</li>
              </ul>
            </div>

            <DialogFooter className="flex flex-row gap-3 sm:justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => setIsRevokeDialogOpen(false)}
                className="flex-1 h-11 rounded-2xl border-border text-slate-600 font-bold hover:bg-slate-50 hover:text-slate-900 transition-all"
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmRevoke}
                disabled={revoking}
                className="flex-1 h-11 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-lg shadow-rose-200 transition-all disabled:opacity-50"
              >
                {revoking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Sim, Revogar"
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
