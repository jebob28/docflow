import { useEffect, useState, useRef, useCallback } from 'react';
import { 
  FileText, 
  Share2, 
  Folder,
  FileSpreadsheet,
  FileImage,
  Search,
  Filter,
  Download,
  Trash2,
  ChevronRight,
  ChevronDown,
  Plus,
  Upload,
  Loader2,
  CloudUpload,
  CheckCircle2,
  FileIcon,
  ArrowLeft,
  Home,
  Eye,
  Tag as TagIcon,
  MoreVertical,
  Pencil,
  Shield,
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
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import DocumentViewer from '@/components/DocumentViewer';
import ShareModal from '@/components/ShareModal';

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Sector {
  id: string;
  name: string;
  can_edit?: boolean;
  permission_type?: string;
}

interface Folder {
  id: string;
  name: string;
  sector_id?: string;
  sector_name?: string;
  color?: string;
  created_at?: string;
  updated_at?: string;
  size?: number;
  files_count?: number;
  total_size?: number;
  tags?: Tag[];
  can_edit?: boolean;
}

interface DocumentFile {
  id: string;
  name: string;
  extension?: string;
  size?: number;
  created_at?: string;
  updated_at?: string;
  sector_id?: string;
  sector_name?: string;
  tags?: Tag[];
  url?: string;
  can_edit?: boolean;
}

interface Stats {
  total_files: number;
  used_storage: number;
  max_storage: number;
}

type Item = (Folder & { itemType: 'folder' }) | (DocumentFile & { itemType: 'file' });

export default function Documents() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilterSectorId, setSelectedFilterSectorId] = useState<string>('all');
  const [selectedFilterTagId, setSelectedFilterTagId] = useState<string>('all');
  const [currentFolder, setCurrentFolder] = useState<Folder | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Folder[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  // Estados para Modais
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#1a355b');
  const [selectedFiles, setSelectedFiles] = useState<Array<{ file: File; status: 'pending' | 'uploading' | 'completed' | 'error'; progress: number; id: string }>>([]);
  const [selectedSectorId, setSelectedSectorId] = useState<string>('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [viewMode] = useState<'list' | 'grid'>('grid');
  const [isMobileActionSheetOpen, setIsMobileActionSheetOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Estados para Visualização e Etiquetas
  const [viewerDoc, setViewerDoc] = useState<{ id: string, name: string, url: string, can_edit?: boolean } | null>(null);
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false);
  const [selectedItemForTags, setSelectedItemForTags] = useState<Item | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [selectedItemForShare, setSelectedItemForShare] = useState<Item | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedItemForDelete, setSelectedItemForDelete] = useState<Item | null>(null);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [selectedItemForRename, setSelectedItemForRename] = useState<Item | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [isConfidentialPromptOpen, setIsConfidentialPromptOpen] = useState(false);
  const [confidentialPassword, setConfidentialPassword] = useState('');
  const [confidentialAction, setConfidentialAction] = useState<'view' | 'download' | null>(null);
  const [confidentialItem, setConfidentialItem] = useState<Item | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3b82f6');

  const [actionLoading, setActionLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Helper para verificar permissão de escrita no contexto atual
  const canWriteInCurrentContext = () => {
    if (currentFolder) {
      return currentFolder.can_edit;
    }
    
    if (selectedFilterSectorId !== 'all') {
      const selectedSector = sectors.find(s => s.id === selectedFilterSectorId);
      return selectedSector?.can_edit;
    }

    // Se estiver na raiz e "Todos os Setores" estiver selecionado, 
    // permitimos abrir o modal se o usuário for GESTOR em pelo menos um setor 
    // ou se o backend permitir (o backend validará ao salvar)
    return sectors.some(s => s.can_edit);
  };
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchTags = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/documents/tags', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data: Tag[] = await response.json();
        setAllTags(data || []);
      } else {
        console.error('Erro ao buscar tags (HTTP):', response.status);
      }
    } catch {
      console.error('Erro ao buscar tags (Network)');
    }
  }, []);

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/documents/tags', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: newTagName, color: newTagColor })
      });
      if (response.ok) {
        toast.success('Etiqueta criada!');
        setNewTagName('');
        fetchTags();
      } else {
        const errorText = await response.text();
        toast.error(`Erro ao criar etiqueta: ${errorText}`);
      }
    } catch {
      toast.error('Erro de conexão ao criar etiqueta');
    }
  };

  const handleAssignTag = async (tagId: string) => {
    if (!selectedItemForTags) return;
    try {
      const token = localStorage.getItem('token');
      // No backend, usamos /api/v1/folders/:id/tags ou /api/v1/documents/:id/tags
      const endpoint = selectedItemForTags.itemType === 'folder' 
        ? `/api/v1/folders/${selectedItemForTags.id}/tags`
        : `/api/v1/documents/${selectedItemForTags.id}/tags`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tag_id: tagId })
      });
      if (response.ok) {
        toast.success('Etiqueta vinculada!');
        
        // Atualizar o item selecionado localmente para refletir a mudança no modal imediatamente
        const tag = allTags.find(t => t.id === tagId);
        if (tag) {
          // Garantir que a lista de tags exista
          const currentTags = selectedItemForTags.tags || [];
          setSelectedItemForTags((prev) => prev ? ({
            ...prev,
            tags: [...currentTags, tag]
          }) : prev);
          
          // Também atualizar na lista principal para refletir no UI pendurado
          if (selectedItemForTags.itemType === 'folder') {
            setFolders(prev => prev.map(f => 
              f.id === selectedItemForTags.id 
                ? { ...f, tags: [...(f.tags || []), tag] } 
                : f
            ));
          } else {
            setDocuments(prev => prev.map(d => 
              d.id === selectedItemForTags.id 
                ? { ...d, tags: [...(d.tags || []), tag] } 
                : d
            ));
          }
        }
      }
    } catch {
      toast.error('Erro ao vincular etiqueta');
    }
  };

  const handleUnassignTag = async (tagId: string) => {
    if (!selectedItemForTags) return;
    try {
      const token = localStorage.getItem('token');
      const endpoint = selectedItemForTags.itemType === 'folder'
        ? `/api/v1/folders/${selectedItemForTags.id}/tags/${tagId}`
        : `/api/v1/documents/${selectedItemForTags.id}/tags/${tagId}`;

      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        toast.success('Etiqueta removida!');
        
        // Atualizar o item selecionado localmente
        setSelectedItemForTags((prev) => prev ? ({
          ...prev,
          tags: (prev.tags || []).filter((t) => t.id !== tagId)
        }) : prev);
        
        // Também atualizar na lista principal
        if (selectedItemForTags.itemType === 'folder') {
          setFolders(prev => prev.map(f => 
            f.id === selectedItemForTags.id 
              ? { ...f, tags: (f.tags || []).filter((t) => t.id !== tagId) } 
              : f
          ));
        } else {
          setDocuments(prev => prev.map(d => 
            d.id === selectedItemForTags.id 
              ? { ...d, tags: (d.tags || []).filter((t) => t.id !== tagId) } 
              : d
          ));
        }
      }
    } catch {
      toast.error('Erro ao remover etiqueta');
    }
  };

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    const handleOpenMobileActions = () => {
      setIsMobileActionSheetOpen(true);
    };
    
    const handleOpenUploadModal = () => {
      setIsUploadOpen(true);
    };

    window.addEventListener('open-mobile-actions', handleOpenMobileActions);
    window.addEventListener('open-upload-modal', handleOpenUploadModal);

    // Verificar se há solicitação de upload via URL (para quando vem do DashboardLayout)
    const params = new URLSearchParams(window.location.search);
    if (params.get('upload') === 'true') {
      setIsUploadOpen(true);
      // Limpar o parâmetro da URL sem recarregar a página
      const newUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({ path: newUrl }, '', newUrl);
    }

    return () => {
      window.removeEventListener('open-mobile-actions', handleOpenMobileActions);
      window.removeEventListener('open-upload-modal', handleOpenUploadModal);
    };
  }, []);

  const handleSelectButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const newFiles = files.map(file => ({
        file,
        status: 'pending' as const,
        progress: 0,
        id: Math.random().toString(36).substring(7)
      }));
      setSelectedFiles(prev => [...prev, ...newFiles]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      const newFiles = files.map(file => ({
        file,
        status: 'pending' as const,
        progress: 0,
        id: Math.random().toString(36).substring(7)
      }));
      setSelectedFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (id: string) => {
    setSelectedFiles(prev => prev.filter(f => f.id !== id));
  };

  const fetchData = useCallback(async (sectorFilter?: string, folderId?: string, tagFilter?: string) => {
    try {
      const token = localStorage.getItem('token');
      const currentSectorFilter = sectorFilter !== undefined ? sectorFilter : selectedFilterSectorId;
      const currentFolderId = folderId !== undefined ? folderId : selectedFolderId;
      const currentTagFilter = tagFilter !== undefined ? tagFilter : selectedFilterTagId;
      
      let docsUrl = '/api/v1/documents';
      const params = new URLSearchParams();
      
      if (currentSectorFilter && currentSectorFilter !== 'all') {
        params.append('sector_id', currentSectorFilter);
      }
      
      if (currentFolderId) {
        params.append('folder_id', currentFolderId);
      }

      if (currentTagFilter && currentTagFilter !== 'all') {
        params.append('tag_id', currentTagFilter);
      }

      const queryString = params.toString();
      if (queryString) {
        docsUrl += `?${queryString}`;
      }

      const [docsResponse, sectorsResponse] = await Promise.all([
        fetch(docsUrl, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/v1/sectors', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);
      
      if (docsResponse.ok) {
        const data = await docsResponse.json();
        setFolders(data.folders || []);
        setDocuments(data.documents || []);
        setStats(data.stats || null);
      }

      if (sectorsResponse.ok) {
        const sectorsData = await sectorsResponse.json();
        setSectors(sectorsData.sectors || []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [selectedFilterSectorId, selectedFolderId, selectedFilterTagId]);

  useEffect(() => {
    fetchData(selectedFilterSectorId, selectedFolderId, selectedFilterTagId);
    fetchTags();
  }, [selectedFilterSectorId, selectedFolderId, selectedFilterTagId, fetchData, fetchTags]);

  const navigateToFolder = (folder: Folder | null) => {
    if (!folder) {
      setSelectedFolderId('');
      setCurrentFolder(null);
      setBreadcrumbs([]);
      return;
    }
    
    setSelectedFolderId(folder.id);
    setCurrentFolder(folder);
    
    // Simples breadcrumb management (ideally would fetch from backend)
    setBreadcrumbs(prev => {
      const exists = prev.find(b => b.id === folder.id);
      if (exists) {
        const index = prev.indexOf(exists);
        return prev.slice(0, index + 1);
      }
      return [...prev, folder];
    });
  };

  const navigateBack = () => {
    if (breadcrumbs.length <= 1) {
      navigateToFolder(null);
    } else {
      const parentFolder = breadcrumbs[breadcrumbs.length - 2];
      navigateToFolder(parentFolder);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    setActionLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          name: newFolderName,
          sector_id: selectedSectorId || (currentFolder ? currentFolder.sector_id : null),
          parent_id: selectedFolderId || null,
          color: newFolderColor
        })
      });

      if (response.ok) {
        toast.success("Pasta criada com sucesso!");
        setIsCreateFolderOpen(false);
        setNewFolderName('');
        setSelectedSectorId('');
        fetchData();
      } else {
        toast.error("Erro ao criar pasta.");
      }
    } catch {
      toast.error("Erro de conexão ao criar pasta.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) return;

    setActionLoading(true);
    const token = localStorage.getItem('token');

    for (const fileItem of selectedFiles) {
      if (fileItem.status === 'completed') continue;

      setSelectedFiles(prev => prev.map(f => 
        f.id === fileItem.id ? { ...f, status: 'uploading', progress: 10 } : f
      ));

      try {
        const formData = new FormData();
        formData.append('file', fileItem.file);

        const targetSectorId = selectedSectorId || (currentFolder ? currentFolder.sector_id : null);
        if (targetSectorId) {
          formData.append('sector_id', targetSectorId);
        }

        if (selectedFolderId) {
          formData.append('folder_id', selectedFolderId);
        }

        // Simulando progresso para o UI (já que fetch não suporta progresso nativo facilmente sem XHR)
        const progressInterval = setInterval(() => {
          setSelectedFiles(prev => prev.map(f => {
            if (f.id === fileItem.id && f.status === 'uploading' && f.progress < 90) {
              return { ...f, progress: f.progress + 10 };
            }
            return f;
          }));
        }, 200);

        const response = await fetch('/api/v1/documents/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });

        clearInterval(progressInterval);

        if (response.ok) {
          setSelectedFiles(prev => prev.map(f => 
            f.id === fileItem.id ? { ...f, status: 'completed', progress: 100 } : f
          ));
        } else {
          setSelectedFiles(prev => prev.map(f => 
            f.id === fileItem.id ? { ...f, status: 'error', progress: 0 } : f
          ));
        }
      } catch {
        setSelectedFiles(prev => prev.map(f => 
          f.id === fileItem.id ? { ...f, status: 'error', progress: 0 } : f
        ));
      }
    }

    const allCompleted = selectedFiles.every(f => f.status === 'completed' || f.status === 'error');
    if (allCompleted) {
      toast.success("Processo de upload finalizado!");
      setIsUploadOpen(false);
      setSelectedFiles([]);
      setSelectedSectorId('');
      fetchData();
    }
    setActionLoading(false);
  };

  const hasConfidentialTag = (item: Item) => {
    if (item.itemType !== 'file') return false;
    return (item.tags || []).some(tag => (tag?.name || '').toLowerCase() === 'confidencial');
  };

  const openConfidentialPrompt = (item: Item, action: 'view' | 'download') => {
    setConfidentialItem(item);
    setConfidentialAction(action);
    setConfidentialPassword('');
    setIsConfidentialPromptOpen(true);
  };

  const handleView = async (item: Item, providedPassword?: string) => {
    if (item.itemType === 'folder') return;
    if (!providedPassword && hasConfidentialTag(item)) {
      openConfidentialPrompt(item, 'view');
      return;
    }
    setProcessingId(item.id);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`
      };
      if (providedPassword) {
        headers['X-Confidential-Password'] = providedPassword;
      }
      const response = await fetch(`/api/v1/documents/${item.id}`, {
        headers
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        // Em vez de abrir nova aba, abrir o visualizador interno
        setViewerDoc({
          id: item.id,
          name: item.name,
          url: url,
          can_edit: item.can_edit
        });
      } else if (response.status === 401) {
        toast.error("Senha necessária ou incorreta.");
      } else if (response.status === 409) {
        toast.error("Senha confidencial não configurada.");
      } else {
        toast.error("Erro ao visualizar arquivo.");
      }
    } catch {
      toast.error("Erro de conexão ao visualizar arquivo.");
    } finally {
      setProcessingId(null);
    }
  };

  const handleDownload = async (item: Item, providedPassword?: string) => {
    if (item.itemType === 'folder') return;
    if (!providedPassword && hasConfidentialTag(item)) {
      openConfidentialPrompt(item, 'download');
      return;
    }
    setProcessingId(item.id);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`
      };
      if (providedPassword) {
        headers['X-Confidential-Password'] = providedPassword;
      }
      const response = await fetch(`/api/v1/documents/${item.id}`, {
        headers
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.name;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        toast.success("Download iniciado!");
      } else if (response.status === 401) {
        toast.error("Senha necessária ou incorreta.");
      } else if (response.status === 409) {
        toast.error("Senha confidencial não configurada.");
      } else {
        toast.error("Erro ao baixar arquivo.");
      }
    } catch {
      toast.error("Erro de conexão ao baixar arquivo.");
    } finally {
      setProcessingId(null);
    }
  };

  const confirmConfidentialAccess = async () => {
    if (!confidentialItem || !confidentialAction) return;
    const password = confidentialPassword;
    const item = confidentialItem;
    const action = confidentialAction;
    setIsConfidentialPromptOpen(false);
    setConfidentialPassword('');
    setConfidentialItem(null);
    setConfidentialAction(null);
    if (action === 'view') {
      await handleView(item, password);
    } else {
      await handleDownload(item, password);
    }
  };

  const handleDelete = async (item: Item) => {
    setSelectedItemForDelete(item);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!selectedItemForDelete) return;
    
    setProcessingId(selectedItemForDelete.id);
    try {
      const token = localStorage.getItem('token');
      const endpoint = selectedItemForDelete.itemType === 'folder' ? `/api/v1/folders/${selectedItemForDelete.id}` : `/api/v1/documents/${selectedItemForDelete.id}`;
      
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        toast.success(`${selectedItemForDelete.itemType === 'folder' ? 'Pasta' : 'Arquivo'} excluído com sucesso!`);
        setIsDeleteModalOpen(false);
        setSelectedItemForDelete(null);
        fetchData();
      } else {
        toast.error("Erro ao excluir item.");
      }
    } catch {
      toast.error("Erro de conexão ao excluir item.");
    } finally {
      setProcessingId(null);
    }
  };

  const handleRename = async () => {
    if (!selectedItemForRename || !newItemName.trim() || newItemName === selectedItemForRename.name) return;

    setActionLoading(true);
    try {
      const token = localStorage.getItem('token');
      const endpoint = selectedItemForRename.itemType === 'folder' 
        ? `/api/v1/folders/${selectedItemForRename.id}/rename` 
        : `/api/v1/documents/${selectedItemForRename.id}/rename`;

      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: newItemName.trim() })
      });

      if (response.ok) {
        toast.success(`${selectedItemForRename.itemType === 'folder' ? 'Pasta' : 'Arquivo'} renomeado com sucesso!`);
        setIsRenameModalOpen(false);
        setSelectedItemForRename(null);
        setNewItemName('');
        fetchData();
      } else {
        const errorText = await response.text();
        toast.error(`Erro ao renomear: ${errorText || 'Erro desconhecido'}`);
      }
    } catch {
      toast.error("Erro de conexão ao renomear item.");
    } finally {
      setActionLoading(false);
    }
  };

  const getFileIcon = (type: string, extension?: string) => {
    if (type === 'folder') return { icon: Folder, color: 'text-slate-700', bg: 'bg-slate-100' };
    
    const ext = extension?.toLowerCase().replace('.', '');
    switch (ext) {
      case 'pdf': return { icon: FileText, color: 'text-rose-700', bg: 'bg-rose-100/50' };
      case 'xlsx': case 'xls': case 'csv': return { icon: FileSpreadsheet, color: 'text-emerald-700', bg: 'bg-emerald-100/50' };
      case 'jpg': case 'jpeg': case 'png': case 'gif': return { icon: FileImage, color: 'text-indigo-700', bg: 'bg-indigo-100/50' };
      case 'doc': case 'docx': return { icon: FileText, color: 'text-blue-700', bg: 'bg-blue-100/50' };
      default: return { icon: FileText, color: 'text-slate-600', bg: 'bg-slate-100/50' };
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const filteredItems: Item[] = [
    ...folders.map(f => ({ ...f, itemType: 'folder' as const })),
    ...documents.map(d => ({ ...d, itemType: 'file' as const }))
  ].filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const DocumentCard = ({ item, idx }: { item: Item, idx: number }) => {
    const iconData = getFileIcon(item.itemType, item.itemType === 'file' ? item.extension : undefined);
    const Icon = iconData.icon;
    
    return (
      <Card 
        key={item.id || idx}
        className={cn(
          "group border-slate-100 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-500/5 transition-all cursor-pointer rounded-xl overflow-hidden",
          item.itemType === 'folder' ? "bg-white" : "bg-white"
        )}
        onClick={() => item.itemType === 'folder' ? navigateToFolder(item) : handleView(item)}
      >
        <CardContent className="p-4">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-full flex justify-between items-start mb-1">
              <div 
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shadow-sm border",
                  item.itemType === 'folder' ? "bg-slate-50 text-slate-600" : iconData.bg + " " + iconData.color,
                  "border-slate-100"
                )}
                style={item.itemType === 'folder' ? {
                  backgroundColor: `${item.color || '#64748b'}15`,
                  color: item.color || '#64748b',
                  borderColor: `${item.color || '#64748b'}30`
                } : {}}
              >
                <Icon className="h-5 w-5" style={item.itemType === 'folder' ? { fill: `${item.color || '#64748b'}30` } : {}} />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 p-2 rounded-xl shadow-xl border-slate-100 bg-white">
                  {item.itemType === 'file' ? (
                    <>
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleView(item); }} className="rounded-xl gap-3 py-2.5 cursor-pointer">
                        <Eye className="h-4 w-4 text-slate-400" />
                        <span className="font-semibold text-sm">Visualizar</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDownload(item); }} className="rounded-xl gap-3 py-2.5 cursor-pointer">
                        <Download className="h-4 w-4 text-slate-400" />
                        <span className="font-semibold text-sm">Download</span>
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigateToFolder(item); }} className="rounded-xl gap-3 py-2.5 cursor-pointer">
                      <Folder className="h-4 w-4 text-slate-400" />
                      <span className="font-semibold text-sm">Abrir Pasta</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem 
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedItemForTags(item);
                      setIsTagsModalOpen(true);
                    }}
                    className="rounded-xl gap-3 py-2.5 cursor-pointer"
                  >
                    <TagIcon className="h-4 w-4 text-slate-400" />
                    <span className="font-semibold text-sm">Etiquetas</span>
                  </DropdownMenuItem>
                  {item.can_edit && (
                    <DropdownMenuItem 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedItemForRename(item);
                        setNewItemName(item.name);
                        setIsRenameModalOpen(true);
                      }}
                      className="rounded-xl gap-3 py-2.5 cursor-pointer"
                    >
                      <Pencil className="h-4 w-4 text-slate-400" />
                      <span className="font-semibold text-sm">Renomear</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator className="my-1 bg-slate-50" />
                  <DropdownMenuItem 
                    onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                    className="rounded-xl gap-3 py-2.5 cursor-pointer text-rose-600 focus:bg-rose-50 focus:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4 text-rose-400" />
                    <span className="font-semibold text-sm">Excluir</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="w-full space-y-1">
              <p className="font-bold text-slate-700 text-[13px] truncate group-hover:text-[#1a355b] transition-colors px-1">
                {item.name}
              </p>
              <div className="flex flex-col gap-1 items-center">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">
                  {item.itemType === 'folder' 
                    ? `${item.files_count || 0} arquivos` 
                    : formatSize(item.size)
                  }
                </span>
                <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">
                  {formatDate(item.updated_at || item.created_at)}
                </span>
              </div>
            </div>

            {item.tags && item.tags.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1 mt-1">
                {item.tags.slice(0, 2).map((tag) => (
                  <span 
                    key={tag.id}
                    className="px-1.5 py-0.5 rounded-md text-[8px] font-bold text-white uppercase tracking-tighter shadow-sm"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
                {item.tags.length > 2 && (
                  <span className="text-[8px] font-bold text-slate-400">
                    +{item.tags.length - 2}
                  </span>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1a355b]"></div>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 pb-12">
      {/* Header com Breadcrumbs e Ações */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            <div 
              onClick={() => navigateToFolder(null)}
              className="flex items-center gap-1.5 hover:text-[#1a355b] cursor-pointer transition-colors group"
            >
              <Home className="h-3 w-3 group-hover:scale-110 transition-transform" />
              <span>Meu Drive</span>
            </div>
            {breadcrumbs.map((crumb, idx) => (
              <div key={crumb.id} className="flex items-center gap-2">
                <ChevronRight className="h-3 w-3 text-slate-300" />
                <span 
                  onClick={() => navigateToFolder(crumb)}
                  className={cn(
                    "hover:text-[#1a355b] cursor-pointer transition-colors",
                    idx === breadcrumbs.length - 1 && "text-[#1a355b] bg-blue-50 px-2 py-0.5 rounded-full"
                  )}
                >
                  {crumb.name}
                </span>
              </div>
            ))}
            {breadcrumbs.length === 0 && (
              <>
                <ChevronRight className="h-3 w-3 text-slate-300" />
                <span className="text-[#1a355b] bg-blue-50 px-2 py-0.5 rounded-full">Raiz</span>
              </>
            )}
          </div>
          <div className="space-y-0.5 flex items-center gap-4">
            {selectedFolderId && (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={navigateBack}
                className="h-10 w-10 rounded-xl text-slate-400 hover:text-[#1a355b] hover:bg-blue-50 transition-all border border-slate-100"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                {currentFolder ? currentFolder.name : 'Meus Arquivos'}
              </h1>
              <p className="text-slate-500 text-sm">
                {currentFolder 
                  ? `Conteúdo da pasta ${currentFolder.name}` 
                  : 'Gerencie e organize seus documentos com segurança.'
                }
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="outline" 
                className="h-10 px-4 border-slate-200 text-slate-600 text-sm font-bold rounded-xl flex items-center gap-2 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
              >
                <Filter className="h-4 w-4" />
                <span className="hidden sm:inline">Filtrar</span>
                {(selectedFilterSectorId !== 'all' || selectedFilterTagId !== 'all') && (
                  <span className="flex h-2 w-2 rounded-full bg-blue-500 ml-1" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 p-4 rounded-2xl border-slate-100 shadow-xl bg-white animate-in fade-in zoom-in-95 duration-200">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Setor</Label>
                  <div className="relative group">
                    <select 
                      value={selectedFilterSectorId}
                      onChange={(e) => setSelectedFilterSectorId(e.target.value)}
                      className="w-full h-10 pl-4 pr-10 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl bg-white hover:bg-slate-50 hover:border-slate-300 transition-all appearance-none cursor-pointer outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/30"
                    >
                      <option value="all">Todos os Setores</option>
                      {sectors.map(sector => (
                        <option key={sector.id} value={sector.id}>{sector.name}</option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                      <ChevronDown className="h-4 w-4" />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Etiqueta</Label>
                  <div className="relative group">
                    <select 
                      value={selectedFilterTagId}
                      onChange={(e) => setSelectedFilterTagId(e.target.value)}
                      className="w-full h-10 pl-4 pr-10 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl bg-white hover:bg-slate-50 hover:border-slate-300 transition-all appearance-none cursor-pointer outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/30"
                    >
                      <option value="all">Todas as Etiquetas</option>
                      {allTags.map(tag => (
                        <option key={tag.id} value={tag.id}>{tag.name}</option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                      <TagIcon className="h-4 w-4" />
                    </div>
                  </div>
                </div>

                {(selectedFilterSectorId !== 'all' || selectedFilterTagId !== 'all') && (
                  <Button 
                    variant="ghost" 
                    onClick={() => {
                      setSelectedFilterSectorId('all');
                      setSelectedFilterTagId('all');
                    }}
                    className="w-full h-9 text-xs font-bold text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Limpar Filtros
                  </Button>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          
          {canWriteInCurrentContext() && (
            <>
              <Button 
                variant="outline"
                onClick={() => setIsUploadOpen(true)}
                className="h-10 px-4 border-slate-200 text-slate-600 text-sm font-bold rounded-xl hidden lg:flex items-center gap-2 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
              >
                <Upload className="h-4 w-4" />
                <span>Fazer Upload</span>
              </Button>

              <Button 
                onClick={() => setIsCreateFolderOpen(true)}
                className="bg-[#1a355b] hover:bg-[#10213d] text-white text-sm font-bold px-5 h-10 rounded-xl hidden lg:flex items-center gap-2 shadow-lg shadow-blue-900/10 transition-all active:scale-[0.97]"
              >
                <Plus className="h-4.5 w-4.5" />
                <span>Nova Pasta</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Barra de Pesquisa Rápida e View Toggle */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-xl group">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-slate-50 text-slate-400 group-focus-within:bg-blue-50 group-focus-within:text-blue-500 transition-all">
            <Search className="h-4 w-4" />
          </div>
          <Input 
            placeholder="Pesquisar arquivos ou pastas..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-14 h-10 bg-white border-slate-100 rounded-xl text-sm font-medium focus-visible:ring-4 focus-visible:ring-blue-500/5 focus:border-blue-500/30 placeholder:text-slate-400 shadow-sm transition-all"
          />
        </div>

        {stats && (
          <div className="flex items-center gap-6 px-6 py-2.5 bg-white rounded-xl shadow-sm border border-slate-100/50">
            <div className="flex flex-col">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Arquivos</span>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold text-slate-900">{stats.total_files}</span>
                <span className="text-[10px] font-bold text-emerald-500 uppercase">itens</span>
              </div>
            </div>
            <div className="w-[1px] h-8 bg-slate-100" />
            <div className="flex flex-col">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Uso</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-slate-900">
                  {formatSize(stats.used_storage)}
                </span>
                <span className="text-[10px] font-bold text-slate-400 uppercase">de { (stats.max_storage / (1024 * 1024 * 1024)).toFixed(0) } GB</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabela de Arquivos e Pastas */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <Folder className="h-3.5 w-3.5 text-blue-500" />
            {searchQuery ? 'Resultados da Pesquisa' : 'Arquivos e Pastas'}
          </h3>
        </div>
        
        <Card className="border-none shadow-sm bg-white rounded-xl overflow-hidden border border-slate-100/50">
          <CardContent className="p-0">
            {filteredItems.length === 0 ? (
              <div className="py-16 text-center">
                <div className="bg-slate-50 w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-inner">
                  <Search className="h-6 w-6 text-slate-300" />
                </div>
                <h3 className="text-slate-900 font-bold text-lg tracking-tight">Nenhum {searchQuery ? 'resultado' : 'item'} encontrado</h3>
                <p className="text-slate-500 text-sm mt-1 max-w-sm mx-auto">
                  {searchQuery 
                    ? 'Não encontramos nenhum arquivo ou pasta que corresponda à sua pesquisa.' 
                    : 'Esta pasta está vazia.'}
                </p>
                {searchQuery && (
                  <Button 
                    variant="outline" 
                    className="mt-6 text-[#1a355b] font-bold border-blue-100 hover:bg-blue-50 rounded-xl h-9 px-6 text-xs"
                    onClick={() => setSearchQuery('')}
                  >
                    Limpar pesquisa
                  </Button>
                )}
              </div>
            ) : (
              <>
                {/* Desktop View (Table) */}
                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-50/50">
                      <TableRow className="hover:bg-transparent border-slate-100 h-11">
                        <TableHead className="w-[45%] pl-6 text-[9px] font-bold text-slate-400 uppercase tracking-[0.1em]">Nome</TableHead>
                        <TableHead className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.1em]">Data de Modificação</TableHead>
                        <TableHead className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.1em]">Tamanho</TableHead>
                        <TableHead className="w-[150px] pr-6 text-[9px] font-bold text-slate-400 uppercase tracking-[0.1em] text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems
                        .sort((a, b) => {
                          if (a.itemType === 'folder' && b.itemType !== 'folder') return -1;
                          if (a.itemType !== 'folder' && b.itemType === 'folder') return 1;
                          return 0;
                        })
                        .map((item, idx) => {
                          const iconData = getFileIcon(item.itemType, item.itemType === 'file' ? item.extension : undefined);
                          const Icon = iconData.icon;
                        
                        return (
                          <TableRow 
                            key={item.id || idx} 
                            className={cn(
                              "group border-slate-50 hover:bg-slate-50/80 transition-all h-16",
                              item.itemType === 'folder' && "cursor-pointer"
                            )}
                            onClick={() => item.itemType === 'folder' && navigateToFolder(item)}
                          >
                            <TableCell className="pl-6 py-4">
                              <div className="flex items-center gap-4">
                                <div className="relative">
                                  <div 
                                    className={cn(
                                      "w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300",
                                      item.itemType === 'folder' ? "bg-slate-100/90 text-slate-700" : iconData.bg + " " + iconData.color,
                                      "shadow-[0_2px_12px_-2px_rgba(0,0,0,0.1)] border border-slate-200/80"
                                    )}
                                    style={item.itemType === 'folder' ? {
                                      backgroundColor: `${item.color || '#64748b'}18`,
                                      color: item.color || '#64748b',
                                      borderColor: `${item.color || '#64748b'}40`
                                    } : {}}
                                  >
                                    <Icon className="h-5.5 w-5.5" style={item.itemType === 'folder' ? { fill: `${item.color || '#64748b'}40` } : {}} />
                                  </div>
                                </div>
                                <div className="min-w-0 flex flex-col gap-0.5">
                                  <div className="font-semibold text-slate-700 text-[14px] group-hover:text-[#1a355b] transition-colors truncate max-w-[200px] sm:max-w-[350px] leading-tight">
                                    {item.name}
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-[10px] font-bold text-slate-400/70 uppercase tracking-wider">
                                      {item.sector_name || 'Geral'}
                                    </span>
                                    {item.tags && item.tags.length > 0 && (
                                      <div className="flex flex-wrap gap-2 mt-1.5 ml-0.5">
                                        {item.tags.map((tag: Tag) => (
                                          <div 
                                            key={tag.id}
                                            className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-tight border transition-all relative group/tag shadow-sm hover:bg-white/10"
                                            style={{ 
                                              backgroundColor: `${tag.color}25`, 
                                              color: tag.color,
                                              borderColor: `${tag.color}50`
                                            }}
                                          >
                                            <TagIcon className="h-2.5 w-2.5 relative z-10" />
                                            <span className="relative z-10">{tag.name}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs font-medium text-slate-500">
                                {formatDate(item.updated_at || item.created_at)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs font-semibold text-slate-600">
                                {item.itemType === 'folder' 
                                  ? formatSize(item.total_size || 0)
                                  : formatSize(item.size)
                                }
                              </span>
                            </TableCell>
                            <TableCell className="pr-6 text-right">
                              <div className="flex items-center justify-end gap-0.5">
                                {item.can_edit && (
                                  <>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedItemForShare(item);
                                        setIsShareModalOpen(true);
                                      }}
                                      title="Compartilhar"
                                      className="h-8 w-8 rounded-lg text-slate-400 hover:text-[#1a355b] hover:bg-blue-50/50 transition-all"
                                    >
                                      <Share2 className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedItemForTags(item);
                                        fetchTags();
                                        setIsTagsModalOpen(true);
                                      }}
                                      title="Gerenciar Etiquetas"
                                      className="h-8 w-8 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all"
                                    >
                                      <TagIcon className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedItemForRename(item);
                                        setNewItemName(item.name);
                                        setIsRenameModalOpen(true);
                                      }}
                                      title="Renomear"
                                      className="h-8 w-8 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50/50 transition-all"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                )}
                                {item.itemType === 'file' && (
                                  <>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleView(item);
                                      }}
                                      disabled={processingId === item.id}
                                      title="Visualizar"
                                      className="h-8 w-8 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50/50 transition-all"
                                    >
                                      {processingId === item.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Eye className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownload(item);
                                      }}
                                      disabled={processingId === item.id}
                                      title="Download"
                                      className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all"
                                    >
                                      {processingId === item.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Download className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  </>
                                )}
                                {item.can_edit && (
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDelete(item);
                                    }}
                                    title="Excluir"
                                    className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50/50 transition-all"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile/Tablet View (Grid Cards) */}
                <div className={cn(
                  "md:hidden p-4",
                  viewMode === 'list' ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 sm:grid-cols-3 gap-4"
                )}>
                  {filteredItems
                    .sort((a, b) => {
                      if (a.itemType === 'folder' && b.itemType !== 'folder') return -1;
                      if (a.itemType !== 'folder' && b.itemType === 'folder') return 1;
                      return 0;
                    })
                    .map((item, idx) => (
                      <DocumentCard key={item.id || idx} item={item} idx={idx} />
                    ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal Criar Pasta */}
      <Dialog open={isCreateFolderOpen} onOpenChange={(open) => {
        setIsCreateFolderOpen(open);
        if (open) {
          // Se estivermos dentro de uma pasta, herdar o setor
          if (currentFolder) {
            setSelectedSectorId(currentFolder.sector_id || "");
          }
        } else {
          setNewFolderName("");
          setSelectedSectorId("");
          setNewFolderColor("#1a355b");
        }
      }}>
        <DialogContent className="w-[95vw] sm:max-w-[400px] rounded-2xl p-0 overflow-hidden border-none shadow-2xl bg-white animate-in fade-in zoom-in-95 duration-200">
        <div className="p-8 border-b border-slate-100/80 relative">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-xl bg-blue-50">
              <Folder className="h-6 w-6 text-[#1a355b] fill-[#1a355b]/10" />
            </div>
            <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">Nova Pasta</DialogTitle>
          </div>
            <DialogDescription className="text-slate-500 text-sm font-medium">
              Organize seus documentos no DocFlow
            </DialogDescription>
          </div>

          <form onSubmit={handleCreateFolder} className="p-8 space-y-6">
            <div className="space-y-3">
              <Label htmlFor="folderName" className="text-sm font-bold text-slate-700 ml-1">
                Nome da Pasta
              </Label>
              <div className="relative group">
                <Input
                  id="folderName"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Digite o nome da pasta..."
                  className="h-12 pl-4 rounded-xl border-slate-200 bg-slate-50/30 focus:bg-white focus:ring-4 focus:ring-blue-500/5 focus:border-[#1a355b] transition-all font-semibold text-slate-900 text-sm placeholder:text-slate-400"
                  required
                />
              </div>
              <div className="flex items-center gap-2 text-slate-500 text-[11px] font-medium ml-1">
                <div className="w-4 h-4 rounded-full border border-slate-300 flex items-center justify-center text-[10px] font-bold">i</div>
                O nome da pasta deve ser único neste diretório.
              </div>
            </div>

            {!currentFolder && (
              <div className="space-y-3">
                <Label htmlFor="folderSector" className="text-sm font-bold text-slate-700 ml-1">
                  Vincular ao Setor
                </Label>
                <div className="relative group">
                  <select 
                    id="folderSector"
                    value={selectedSectorId}
                    onChange={(e) => setSelectedSectorId(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl border-slate-200 bg-slate-50/30 focus:bg-white focus:ring-4 focus:ring-blue-500/5 focus:border-[#1a355b] transition-all font-semibold text-slate-900 text-sm outline-none border appearance-none cursor-pointer"
                  >
                    <option value="">Nenhum setor (Geral)</option>
                    {sectors.filter(s => s.can_edit).map(sector => (
                      <option key={sector.id} value={sector.id}>{sector.name}</option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-focus-within:text-[#1a355b] transition-colors">
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <Label className="text-sm font-bold text-slate-700 ml-1">
                Cor da Pasta
              </Label>
              <div className="flex flex-wrap gap-2 px-1">
                {['#f59e0b', '#3b82f6', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#64748b', '#22d3ee'].map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewFolderColor(color)}
                    className={cn(
                      "w-8 h-8 rounded-xl transition-all hover:scale-110 active:scale-90 shadow-sm flex items-center justify-center",
                      newFolderColor === color ? "ring-2 ring-[#1a355b] ring-offset-2 scale-110" : "opacity-70 hover:opacity-100"
                    )}
                    style={{ backgroundColor: color }}
                  >
                    {newFolderColor === color && <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm" />}
                  </button>
                ))}
                <div className="relative ml-auto">
                  <input 
                    type="color" 
                    value={newFolderColor}
                    onChange={(e) => setNewFolderColor(e.target.value)}
                    className="h-8 w-8 rounded-xl border border-slate-200 cursor-pointer p-0.5 bg-white hover:bg-slate-50 transition-all"
                    title="Cor personalizada"
                  />
                </div>
              </div>
            </div>

            {currentFolder && (
              <div className="flex items-center gap-2 p-4 rounded-xl bg-blue-50 border border-blue-100 mb-2">
                <div className="p-2 rounded-xl bg-blue-100 text-[#1a355b]">
                  <Folder className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-blue-900">Subpasta de: {currentFolder.name}</p>
                  <p className="text-[10px] text-blue-700 font-medium">Esta pasta herdará o setor {currentFolder.sector_name || 'Geral'}.</p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => setIsCreateFolderOpen(false)}
                className="px-6 font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700 h-12 rounded-xl transition-all text-sm"
              >
                Cancelar
              </Button>
              <Button 
                type="submit" 
                disabled={actionLoading || !newFolderName.trim()}
                className={cn(
                  "px-8 font-bold h-12 rounded-xl shadow-lg transition-all active:scale-[0.97] flex items-center justify-center gap-2 text-sm",
                  newFolderName.trim() 
                    ? "bg-[#1a355b] hover:bg-[#10213d] text-white shadow-blue-900/10" 
                    : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                )}
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Criando...</span>
                  </>
                ) : (
                  <span>Criar Pasta</span>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Fazer Upload */}
      <Dialog open={isUploadOpen} onOpenChange={(open) => {
        setIsUploadOpen(open);
        if (open) {
          // Se estivermos dentro de uma pasta, herdar o setor e a própria pasta
          if (currentFolder) {
            setSelectedSectorId(currentFolder.sector_id || "");
            setSelectedFolderId(currentFolder.id);
          }
        } else {
          setSelectedFiles([]);
          setSelectedSectorId('');
          // Se estivermos navegando em uma pasta, manter o selectedFolderId para a listagem
          // mas resetar se fecharmos o modal e não estivermos navegando? 
          // Na verdade, o selectedFolderId controla a listagem, então se estivermos navegando,
          // ele deve permanecer. Se não estivermos navegando (breadcrumbs vazios), aí sim limpamos.
          if (!currentFolder) {
            setSelectedFolderId('');
          }
        }
      }}>
        <DialogContent className="w-[95vw] sm:max-w-[600px] rounded-2xl p-0 overflow-hidden border-none shadow-2xl bg-white animate-in fade-in zoom-in-95 duration-200">
          <div className="p-8 border-b border-slate-100/80">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-50">
                  <CloudUpload className="h-6 w-6 text-[#1a355b]" />
                </div>
                <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">Upload</DialogTitle>
              </div>
            </div>
            <DialogDescription className="text-slate-500 text-sm font-medium">
              Adicione seus arquivos ao sistema de forma segura.
            </DialogDescription>
          </div>

          <div className="p-6 sm:p-8 space-y-6 bg-white overflow-y-auto max-h-[70vh] custom-scrollbar">
            {/* Seleção de Setor e Pasta - Só exibe se não estivermos dentro de uma pasta específica */}
            {!currentFolder && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <Label htmlFor="uploadSector" className="text-sm font-bold text-slate-700 ml-1">
                    Vincular ao Setor
                  </Label>
                  <div className="relative group">
                    <select 
                      id="uploadSector"
                      value={selectedSectorId}
                      onChange={(e) => setSelectedSectorId(e.target.value)}
                      className="w-full h-12 px-4 rounded-xl border-slate-200 bg-slate-50/30 focus:bg-white focus:ring-4 focus:ring-blue-500/5 focus:border-[#1a355b] transition-all font-semibold text-slate-900 text-sm outline-none border appearance-none cursor-pointer"
                    >
                      <option value="">Nenhum setor (Geral)</option>
                      {sectors.filter(s => s.can_edit).map(sector => (
                        <option key={sector.id} value={sector.id}>{sector.name}</option>
                      ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-focus-within:text-[#1a355b] transition-colors">
                      <ChevronDown className="h-4 w-4" />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="uploadFolder" className="text-sm font-bold text-slate-700 ml-1">
                    Pasta de Destino
                  </Label>
                  <div className="relative group">
                    <select 
                      id="uploadFolder"
                      value={selectedFolderId}
                      onChange={(e) => setSelectedFolderId(e.target.value)}
                      className="w-full h-12 px-4 rounded-xl border-slate-200 bg-slate-50/30 focus:bg-white focus:ring-4 focus:ring-blue-500/5 focus:border-[#1a355b] transition-all font-semibold text-slate-900 text-sm outline-none border appearance-none cursor-pointer"
                    >
                      <option value="">Raiz (Nenhuma pasta)</option>
                      {folders.map(folder => (
                        <option key={folder.id} value={folder.id}>{folder.name}</option>
                      ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-focus-within:text-[#1a355b] transition-colors">
                      <ChevronDown className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentFolder && (
              <div className="flex items-center gap-2 p-4 rounded-xl bg-blue-50 border border-blue-100 mb-2">
                <div className="p-2 rounded-xl bg-blue-100 text-[#1a355b]">
                  <Folder className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-blue-900">Destino: {currentFolder.name}</p>
                  <p className="text-[10px] text-blue-700 font-medium">Os arquivos serão salvos nesta pasta e vinculados ao setor {currentFolder.sector_name || 'Geral'}.</p>
                </div>
              </div>
            )}

            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleSelectButtonClick}
              className={cn(
                "relative group flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-10 transition-all duration-300 cursor-pointer",
                isDragging 
                  ? "border-[#1a355b] bg-blue-50/50 scale-[0.99]" 
                  : "border-slate-200 bg-slate-50/30 hover:bg-slate-50 hover:border-[#1a355b]/50",
              )}
            >
              <input
                ref={fileInputRef}
                id="file"
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              
              <div className="flex flex-col items-center text-center z-10">
                <div className={cn(
                  "w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-all duration-300 shadow-sm",
                  isDragging ? "bg-[#1a355b] text-white scale-110 shadow-blue-500/20" : "bg-blue-50 text-[#1a355b] group-hover:scale-105"
                )}>
                  <CloudUpload className="h-8 w-8" />
                </div>
                <h4 className="text-lg font-bold text-slate-900 mb-1">Arraste e solte arquivos aqui</h4>
                <p className="text-sm text-slate-500 mb-6">ou clique para buscar no seu dispositivo</p>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-6">Formatos aceitos: PDF, DOCX, PNG (Máx. 25MB)</p>
                
                <Button 
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectButtonClick();
                  }}
                  className="bg-[#1a355b] hover:bg-[#10213d] text-white font-bold px-8 h-12 rounded-xl shadow-lg shadow-blue-500/10 transition-all active:scale-[0.97]"
                >
                  Selecionar Arquivos
                </Button>
              </div>
            </div>

            {selectedFiles.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h5 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                    ARQUIVOS SELECIONADOS ({selectedFiles.length})
                  </h5>
                </div>
                <div className="max-h-[220px] overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                  {selectedFiles.map((item) => (
                    <div 
                      key={item.id} 
                      className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 bg-white shadow-sm hover:shadow-md transition-all group"
                    >
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center",
                        item.status === 'completed' ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-[#1a355b]"
                      )}>
                        {item.status === 'completed' ? <CheckCircle2 className="h-5 w-5" /> : <FileIcon className="h-5 w-5" />}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-bold text-slate-900 truncate pr-4">{item.file.name}</p>
                          {item.status === 'uploading' ? (
                            <span className="text-[10px] font-bold text-[#1a355b] animate-pulse">Enviando...</span>
                          ) : item.status === 'completed' ? (
                            <span className="text-[10px] font-bold text-emerald-500 uppercase">Concluído</span>
                          ) : item.status === 'error' ? (
                            <span className="text-[10px] font-bold text-rose-500 uppercase">Erro</span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Pendente</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{formatSize(item.file.size)}</p>
                          {item.status === 'uploading' && (
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-[#1a355b] transition-all duration-300" 
                                style={{ width: `${item.progress}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {item.status !== 'uploading' && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => removeFile(item.id)}
                            className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!currentFolder && (
              <div className="space-y-3">
                <Label htmlFor="sector" className="text-sm font-bold text-slate-700 ml-1">
                  Vincular ao Setor
                </Label>
                <div className="relative group">
                  <select 
                    id="sector"
                    value={selectedSectorId}
                    onChange={(e) => setSelectedSectorId(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl border-slate-200 bg-slate-50/30 focus:bg-white focus:ring-4 focus:ring-blue-500/5 focus:border-[#1a355b] transition-all font-semibold text-slate-900 text-sm outline-none border appearance-none cursor-pointer"
                  >
                    <option value="">Nenhum setor (Geral)</option>
                    {sectors.map(sector => (
                      <option key={sector.id} value={sector.id}>{sector.name}</option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-focus-within:text-[#1a355b] transition-colors">
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="p-8 pt-0 flex items-center justify-end gap-3 bg-white">
            <Button 
              type="button" 
              variant="ghost" 
              onClick={() => setIsUploadOpen(false)}
              className="px-6 font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700 h-12 rounded-xl transition-all text-sm"
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleUpload}
              disabled={actionLoading || selectedFiles.length === 0 || selectedFiles.every(f => f.status === 'completed')}
              className={cn(
                "px-8 font-bold h-12 rounded-xl shadow-lg transition-all active:scale-[0.97] flex items-center justify-center gap-2 text-sm",
                selectedFiles.length > 0 && !selectedFiles.every(f => f.status === 'completed')
                  ? "bg-[#1a355b] hover:bg-[#10213d] text-white shadow-blue-900/10" 
                  : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
              )}
            >
              {actionLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Enviando...</span>
                </>
              ) : (
                <>
                  <span>Confirmar Envio</span>
                  <Share2 className="h-4 w-4 rotate-90" />
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Gerenciar Etiquetas */}
      <Dialog open={isTagsModalOpen} onOpenChange={setIsTagsModalOpen}>
        <DialogContent className="w-[95vw] sm:max-w-[450px] rounded-2xl p-0 overflow-hidden border-none shadow-2xl bg-white animate-in fade-in zoom-in-95 duration-200">
          <div className="p-8 border-b border-slate-100/80 relative">
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 rounded-xl bg-blue-50">
                <TagIcon className="h-6 w-6 text-[#1a355b]" />
              </div>
              <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">Etiquetas</DialogTitle>
            </div>
            <DialogDescription className="text-slate-500 text-sm font-medium">
              Gerencie etiquetas para {selectedItemForTags?.name}
            </DialogDescription>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {/* Criar Nova Etiqueta */}
            <div className="space-y-4 p-5 rounded-xl bg-slate-50/50 border border-slate-100">
              <Label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">Criar Nova Etiqueta</Label>
              <div className="flex gap-2">
                <div className="relative flex-1 group">
                  <Input 
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Nome da etiqueta..."
                    className="h-11 rounded-xl border-slate-200 bg-white focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500/30 transition-all font-medium text-sm"
                  />
                </div>
                <div className="relative">
                  <input 
                    type="color" 
                    value={newTagColor}
                    onChange={(e) => setNewTagColor(e.target.value)}
                    className="h-11 w-11 rounded-xl border border-slate-200 cursor-pointer p-1 bg-white hover:bg-slate-50 transition-all"
                  />
                </div>
                <Button 
                  onClick={handleCreateTag} 
                  disabled={!newTagName.trim()}
                  size="icon" 
                  className={cn(
                    "h-11 w-11 rounded-xl transition-all shadow-lg active:scale-95",
                    newTagName.trim() ? "bg-[#1a355b] hover:bg-[#10213d] shadow-blue-500/20" : "bg-slate-200 text-slate-400 cursor-not-allowed"
                  )}
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </div>

              {/* Sugestões de Cores */}
              <div className="flex flex-wrap gap-2 mt-2 px-1">
                {['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b', '#e66a31'].map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewTagColor(color)}
                    className={cn(
                      "w-6 h-6 rounded-full transition-all hover:scale-125 active:scale-90 shadow-sm",
                      newTagColor === color ? "ring-2 ring-blue-500 ring-offset-2 scale-110" : ""
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            {/* Listagem de Etiquetas do Sistema */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <Label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Etiquetas Disponíveis</Label>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full uppercase">
                  {allTags.length} Total
                </span>
              </div>
              
              <div className="max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                {allTags.length === 0 ? (
                  <div className="py-8 text-center bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                    <TagIcon className="h-8 w-8 text-slate-200 mx-auto mb-2" />
                    <p className="text-xs font-medium text-slate-400">Nenhuma etiqueta criada ainda</p>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {allTags.map(tag => {
                      const isAssigned = selectedItemForTags?.tags?.some((t: Tag) => t.id === tag.id);
                      return (
                        <button
                          key={tag.id}
                          onClick={() => isAssigned ? handleUnassignTag(tag.id) : handleAssignTag(tag.id)}
                          className={cn(
                            "group flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all border shadow-sm",
                            isAssigned 
                              ? "bg-[#1a355b] border-[#1a355b] text-white hover:bg-[#10213d] shadow-blue-500/10" 
                              : "bg-white border-slate-100 text-slate-600 hover:border-blue-200 hover:bg-blue-50/30"
                          )}
                        >
                          <span 
                            className={cn(
                              "w-2 h-2 rounded-full",
                              isAssigned ? "bg-white shadow-sm" : ""
                            )} 
                            style={!isAssigned ? { backgroundColor: tag.color } : {}}
                          />
                          {tag.name}
                          {isAssigned ? (
                            <div className="h-3 w-3" />
                          ) : (
                            <Plus className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="p-8 pt-0 flex justify-end">
            <Button 
              onClick={() => setIsTagsModalOpen(false)} 
              className="w-full sm:w-auto px-8 h-12 rounded-xl font-bold bg-slate-900 text-white hover:bg-slate-800 shadow-lg shadow-slate-900/10 transition-all active:scale-[0.98]"
            >
              Concluir
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Compartilhamento */}
      {selectedItemForShare && (
        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          itemId={selectedItemForShare.id}
          itemName={selectedItemForShare.name}
          isFolder={selectedItemForShare.itemType === 'folder'}
        />
      )}

      <Dialog open={isConfidentialPromptOpen} onOpenChange={(open) => {
        setIsConfidentialPromptOpen(open);
        if (!open) {
          setConfidentialPassword('');
          setConfidentialItem(null);
          setConfidentialAction(null);
        }
      }}>
        <DialogContent className="w-[90vw] sm:max-w-[420px] rounded-2xl p-0 overflow-hidden border-none shadow-2xl bg-white animate-in fade-in zoom-in-95 duration-200">
          <div className="p-8 text-center relative">
            <div className="w-20 h-20 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-6">
              <Shield className="h-9 w-9 text-rose-500" />
            </div>
            <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight mb-2">
              Acesso Confidencial
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm font-medium px-4">
              Informe a senha para acessar {confidentialItem?.name || 'o documento'}.
            </DialogDescription>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); confirmConfidentialAccess(); }} className="p-6 sm:p-8 bg-slate-50/50 flex flex-col gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-bold text-slate-700 ml-1">Senha</Label>
              <Input
                type="password"
                value={confidentialPassword}
                onChange={(e) => setConfidentialPassword(e.target.value)}
                className="h-12 bg-white border-slate-200 rounded-xl font-semibold text-slate-800 focus:ring-2 focus:ring-rose-500/10 transition-all"
                placeholder="Digite a senha"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              <Button 
                type="button"
                variant="ghost"
                onClick={() => setIsConfidentialPromptOpen(false)}
                className="px-6 font-bold text-slate-500 hover:bg-white hover:text-slate-700 h-12 rounded-xl transition-all text-sm"
              >
                Cancelar
              </Button>
              <Button 
                type="submit"
                disabled={!confidentialPassword.trim()}
                className="px-8 font-bold h-12 rounded-xl shadow-lg transition-all active:scale-[0.97] flex items-center justify-center gap-2 text-sm bg-[#1a355b] hover:bg-[#10213d] text-white"
              >
                Confirmar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de Exclusão Elegante */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="w-[90vw] sm:max-w-[400px] rounded-2xl p-0 overflow-hidden border-none shadow-2xl bg-white animate-in fade-in zoom-in-95 duration-200">
          <div className="p-8 text-center relative">
            <div className="w-20 h-20 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-6 transition-transform duration-500 hover:rotate-12 group">
              <Trash2 className="h-10 w-10 text-rose-500 transition-colors group-hover:text-rose-600" />
            </div>
            
            <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight mb-2">
              Confirmar Exclusão
            </DialogTitle>
            
            <DialogDescription className="text-slate-500 text-sm font-medium px-4">
              Você está prestes a excluir <span className="font-bold text-slate-900">"{selectedItemForDelete?.name}"</span>. 
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </div>

          <div className="p-6 sm:p-8 bg-slate-50/50 flex flex-col gap-3">
            <Button 
              onClick={confirmDelete}
              disabled={processingId === selectedItemForDelete?.id}
              className="w-full h-12 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold shadow-lg shadow-rose-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {processingId === selectedItemForDelete?.id ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Excluindo...</span>
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  <span>Sim, excluir agora</span>
                </>
              )}
            </Button>
            
            <Button 
              variant="ghost" 
              onClick={() => setIsDeleteModalOpen(false)}
              className="w-full h-12 rounded-xl font-bold text-slate-500 hover:bg-white hover:text-slate-700 transition-all text-sm"
            >
              Não, manter item
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Renomeação */}
      <Dialog open={isRenameModalOpen} onOpenChange={setIsRenameModalOpen}>
        <DialogContent className="w-[95vw] sm:max-w-[400px] rounded-2xl p-0 overflow-hidden border-none shadow-2xl bg-white animate-in fade-in zoom-in-95 duration-200">
          <div className="p-8 border-b border-slate-100/80 relative">
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 rounded-xl bg-blue-50">
                <Pencil className="h-6 w-6 text-[#1a355b]" />
              </div>
              <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">Renomear</DialogTitle>
            </div>
            <DialogDescription className="text-slate-500 text-sm font-medium">
              Alterar o nome de <span className="font-bold text-slate-900">"{selectedItemForRename?.name}"</span>
            </DialogDescription>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleRename(); }} className="p-8 space-y-6">
            <div className="space-y-3">
              <Label htmlFor="renameItem" className="text-sm font-bold text-slate-700 ml-1">
                Novo Nome
              </Label>
              <Input
                id="renameItem"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="Digite o novo nome..."
                className="h-12 pl-4 rounded-xl border-slate-200 bg-slate-50/30 focus:bg-white focus:ring-4 focus:ring-blue-500/5 focus:border-[#1a355b] transition-all font-semibold text-slate-900 text-sm placeholder:text-slate-400"
                required
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4">
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => setIsRenameModalOpen(false)}
                className="px-6 font-bold text-slate-500 hover:bg-slate-100 h-12 rounded-xl transition-all text-sm"
              >
                Cancelar
              </Button>
              <Button 
                type="submit"
                disabled={actionLoading || !newItemName.trim() || newItemName === selectedItemForRename?.name}
                className={cn(
                  "px-8 font-bold h-12 rounded-xl shadow-lg transition-all active:scale-[0.97] flex items-center justify-center gap-2 text-sm",
                  newItemName.trim() && newItemName !== selectedItemForRename?.name
                    ? "bg-[#1a355b] hover:bg-[#10213d] text-white" 
                    : "bg-slate-100 text-slate-400 cursor-not-allowed"
                )}
              >
                {actionLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <span>Salvar Alteração</span>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Drawer de Ações - Adaptado para Mobile (PWA) e Desktop (Web) */}
      <Sheet open={isMobileActionSheetOpen} onOpenChange={setIsMobileActionSheetOpen}>
        <SheetContent 
          side={isDesktop ? "right" : "bottom"} 
          className={cn(
            "p-0 overflow-hidden border-none bg-white",
            isDesktop ? "sm:max-w-[420px] rounded-l-3xl shadow-2xl" : "rounded-t-2xl"
          )}
        >
          {isDesktop ? (
            <div className="flex flex-col h-full bg-white">
              {/* Header Elegante Desktop */}
              <div className="p-8 border-b border-slate-50 relative shrink-0">
                <div className="flex items-center justify-between relative z-10">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center border border-blue-100/50">
                      <Plus className="h-7 w-7 text-[#1a355b]" />
                    </div>
                    <div>
                      <SheetTitle className="text-2xl font-black text-slate-900 tracking-tight">Criar Novo</SheetTitle>
                      <p className="text-sm font-medium text-slate-500 mt-0.5">Escolha o que deseja adicionar</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Opções Desktop */}
              <div className="flex-1 p-8 space-y-4 overflow-y-auto">
                <button 
                  onClick={() => {
                    setIsMobileActionSheetOpen(false);
                    setIsCreateFolderOpen(true);
                  }}
                  className="w-full flex items-center gap-6 p-6 rounded-2xl bg-white border border-slate-100 hover:border-[#1a355b] hover:shadow-xl hover:shadow-blue-900/5 transition-all group relative overflow-hidden text-left"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50/30 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-150" />
                  <div className="w-16 h-16 rounded-xl bg-blue-50 flex items-center justify-center text-[#1a355b] group-hover:scale-110 transition-transform relative z-10">
                    <Folder className="h-8 w-8 fill-[#1a355b]/10" />
                  </div>
                  <div className="relative z-10">
                    <span className="block text-lg font-bold text-slate-800">Nova Pasta</span>
                    <span className="text-xs font-medium text-slate-500">Crie um novo diretório para seus arquivos</span>
                  </div>
                </button>

                <button 
                  onClick={() => {
                    setIsMobileActionSheetOpen(false);
                    setIsUploadOpen(true);
                  }}
                  className="w-full flex items-center gap-6 p-6 rounded-2xl bg-white border border-slate-100 hover:border-[#1a355b] hover:shadow-xl hover:shadow-blue-900/5 transition-all group relative overflow-hidden text-left"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50/30 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-150" />
                  <div className="w-16 h-16 rounded-xl bg-blue-50 flex items-center justify-center text-[#1a355b] group-hover:scale-110 transition-transform relative z-10">
                    <CloudUpload className="h-8 w-8" />
                  </div>
                  <div className="relative z-10">
                    <span className="block text-lg font-bold text-slate-800">Fazer Upload</span>
                    <span className="text-xs font-medium text-slate-500">Selecione arquivos do seu computador</span>
                  </div>
                </button>
              </div>

              {/* Footer Desktop */}
              <div className="p-8 border-t border-slate-50 bg-slate-50/30">
                <Button 
                  variant="outline" 
                  onClick={() => setIsMobileActionSheetOpen(false)}
                  className="w-full h-12 rounded-xl font-bold text-slate-500 hover:text-slate-700 hover:bg-white transition-all border-slate-200 hidden"
                >
                  Fechar
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="p-8 border-b border-slate-50">
                <SheetHeader className="text-left">
                  <SheetTitle className="text-xl font-bold text-slate-900">Ações Rápidas</SheetTitle>
                  <p className="text-xs font-medium text-slate-500 mt-1">O que você deseja fazer agora?</p>
                </SheetHeader>
              </div>
              <div className="p-6 grid grid-cols-2 gap-4">
                <button 
                  onClick={() => {
                    setIsMobileActionSheetOpen(false);
                    setIsCreateFolderOpen(true);
                  }}
                  className="flex flex-col items-center justify-center gap-3 p-6 rounded-xl bg-blue-50/50 border border-blue-100/50 hover:bg-blue-50 transition-all active:scale-95 group"
                >
                  <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center text-[#1a355b] group-hover:scale-110 transition-transform">
                    <Folder className="h-6 w-6 fill-[#1a355b]/10" />
                  </div>
                  <span className="text-sm font-bold text-slate-700">Nova Pasta</span>
                </button>
                <button 
                  onClick={() => {
                    setIsMobileActionSheetOpen(false);
                    setIsUploadOpen(true);
                  }}
                  className="flex flex-col items-center justify-center gap-3 p-6 rounded-xl bg-blue-50/50 border border-blue-100/50 hover:bg-blue-50 transition-all active:scale-95 group"
                >
                  <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center text-[#1a355b] group-hover:scale-110 transition-transform">
                    <CloudUpload className="h-6 w-6" />
                  </div>
                  <span className="text-sm font-bold text-slate-700">Fazer Upload</span>
                </button>
              </div>
              <div className="px-6 pb-8 hidden">
                <Button 
                  variant="ghost" 
                  onClick={() => setIsMobileActionSheetOpen(false)}
                  className="w-full h-12 rounded-xl font-bold text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
                >
                  Cancelar
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Visualizador de Documentos */}
      {viewerDoc && (
        <DocumentViewer 
          documentId={viewerDoc.id}
          documentName={viewerDoc.name}
          fileUrl={viewerDoc.url}
          canEdit={viewerDoc.can_edit}
          onClose={() => {
            window.URL.revokeObjectURL(viewerDoc.url);
            setViewerDoc(null);
          }}
        />
      )}
    </div>
  );
}
