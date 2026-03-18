import { useState, useEffect, useCallback } from 'react';
import { 
  Users, 
  Loader2,
  Share2,
  X,
  Shield,
  Clock,
  Search,
  UserPlus,
  MoreVertical,
  Building2,
  Copy,
  Link2
} from 'lucide-react';
import { 
  Dialog, 
  DialogContent, 
  DialogTitle, 
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemId: string;
  itemName: string;
  itemType?: 'file' | 'folder';
  isFolder?: boolean;
  tags?: ShareTag[];
}


interface ShareInfo {
  id: string;
  type: 'user' | 'sector' | 'link';
  target_name: string;
  permission_type: string;
  created_at: string;
  expires_at?: string;
  view_count?: number;
  max_views?: number;
}

interface ApiUser {
  id: number;
  full_name: string;
  email: string;
}

interface Sector {
  id: string;
  name: string;
}

interface ShareTag {
  name?: string | null;
  color?: string | null;
}

export default function ShareModal({ isOpen, onClose, itemId, itemName, itemType, isFolder = false, tags = [] }: ShareModalProps) {
  const isFolderValue = itemType ? itemType === 'folder' : isFolder;
  const [activeTab, setActiveTab] = useState<'users' | 'sectors' | 'links'>('users');
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const [shares, setShares] = useState<ShareInfo[]>([]);

  const isConfidential = useCallback(() => {
    return tags.some(tag => (tag?.name || '').toLowerCase() === 'confidencial');
  }, [tags]);
  
  // States for User/Sector sharing
  const [availableUsers, setAvailableUsers] = useState<ApiUser[]>([]);
  const [availableSectors, setAvailableSectors] = useState<Sector[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [permissionType, setPermissionType] = useState<'READ' | 'WRITE'>('READ');
  

  // States for Link sharing
  const [shareLink, setShareLink] = useState('');
  const [expiresInMinutes, setExpiresInMinutes] = useState('10080');
  const [linkPassword, setLinkPassword] = useState('');

  const generateLink = async () => {
    if (!linkPassword) {
      toast.error("A senha é obrigatória para gerar um link público.");
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/${itemId}/share-link?is_folder=${isFolderValue}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          expires_in_minutes: parseInt(expiresInMinutes),
          max_views: 0,
          password: linkPassword
        })
      });

      if (response.ok) {
        const data = await response.json();
        const fullUrl = `${window.location.origin}${data.share_url}`;
        setShareLink(fullUrl);
        toast.success("Link gerado com sucesso!");
        fetchShares();
      } else {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.message || "Erro ao gerar link.");
      }
    } catch (error) {
      console.error("Erro ao gerar link:", error);
      toast.error("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  };
  const fetchShares = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/${itemId}/shares?is_folder=${isFolderValue}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setShares(data || []);
      }
    } catch (err) {
      console.error("Erro ao buscar compartilhamentos:", err);
    }
  }, [itemId, isFolderValue]);

  const fetchUsersAndSectors = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      
      // Fetch Sectors
      const resSectors = await fetch('/api/v1/sectors', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resSectors.ok) {
        const data = await resSectors.json();
        const sectorsList = Array.isArray(data) ? data : (data.sectors || []);
        setAvailableSectors(sectorsList);
      }

      // Fetch Users (Assuming there's a list users endpoint for the tenant)
      const resUsers = await fetch('/api/v1/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resUsers.ok) {
        const data = await resUsers.json();
        setAvailableUsers(data || []);
      }

      // Buscar perfil para obter a role
      const resProfile = await fetch('/api/v1/profile', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resProfile.ok) {
        const profileData = await resProfile.json();
        setUserRole(profileData.role || '');
      }
    } catch (err) {
      console.error("Erro ao buscar usuários/setores:", err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchShares();
      fetchUsersAndSectors();
    }
  }, [isOpen, fetchShares, fetchUsersAndSectors]);

  const handleShare = async () => {
    if (!selectedTargetId) {
      toast.error("Selecione um destinatário.");
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const body: {
        permission_type: string;
        is_folder: boolean;
        user_id?: number;
        sector_id?: string;
      } = {
        permission_type: permissionType,
        is_folder: isFolder
      };

      if (activeTab === 'users') {
        body.user_id = parseInt(selectedTargetId);
      } else {
        body.sector_id = selectedTargetId;
      }

      const response = await fetch(`/api/v1/documents/${itemId}/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      if (response.ok) {
        toast.success("Compartilhado com sucesso!");
        setSelectedTargetId('');
        fetchShares();
      } else {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.message || "Erro ao compartilhar.");
      }
    } catch (error) {
      console.error("Erro ao compartilhar:", error);
      toast.error("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (shareId: string, type: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/shares/${shareId}?type=${type}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success("Acesso removido.");
        fetchShares();
      }
    } catch (error) {
      console.error("Erro ao remover acesso:", error);
      toast.error("Erro ao remover acesso.");
    }
  };

  const handleUpdatePermission = async (shareId: string, type: string, newPermission: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/shares/${shareId}?type=${type}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ permission_type: newPermission })
      });

      if (response.ok) {
        toast.success("Permissão atualizada.");
        fetchShares();
      } else {
        toast.error("Erro ao atualizar permissão.");
      }
    } catch (error) {
      console.error("Erro ao atualizar permissão:", error);
      toast.error("Erro de conexão.");
    }
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  };

  if (userRole.toUpperCase() === 'USER' && isConfidential()) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[450px] p-8 text-center bg-white rounded-2xl">
          <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4 border border-amber-100">
            <Shield className="h-8 w-8 text-amber-600" />
          </div>
          <DialogTitle className="text-xl font-bold text-slate-900 mb-2">Acesso Restrito</DialogTitle>
          <DialogDescription className="text-slate-500 font-medium">
            Seu perfil de usuário não possui permissão para compartilhar documentos confidenciais. 
            Esta ação é restrita a Gestores e Administradores.
          </DialogDescription>
          <Button onClick={onClose} className="mt-6 w-full bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl h-12">
            Entendido
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[650px] p-0 gap-0 bg-white overflow-hidden border-none shadow-2xl h-[90vh] sm:h-auto max-h-[850px] flex flex-col rounded-2xl">
        {/* Header Elegante - Estilo Desktop Desktop */}
        <div className="p-8 border-b border-border relative shrink-0">
          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center border border-blue-100/50">
                <Share2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-2xl font-bold text-slate-900 tracking-tight">Compartilhar</DialogTitle>
                <DialogDescription className="text-slate-500 text-sm font-medium mt-0.5 truncate max-w-[400px]">
                  Gerencie quem pode acessar <span className="text-slate-900 font-bold">"{itemName}"</span>
                </DialogDescription>
              </div>
            </div>
          </div>
        </div>

        <Tabs defaultValue="users" className="flex-1 flex flex-col min-h-0" onValueChange={(v) => setActiveTab(v === 'sectors' || v === 'links' ? v : 'users')}>
          <div className="px-8 py-4 border-b border-border bg-slate-50/30 shrink-0">
            <TabsList className="w-full bg-slate-100/50 p-1 h-12 rounded-xl border border-border/50">
              <TabsTrigger value="users" className="flex-1 rounded-lg data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm gap-2 transition-all duration-200">
                <Users className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Usuários</span>
              </TabsTrigger>
              <TabsTrigger value="sectors" className="flex-1 rounded-lg data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm gap-2 transition-all duration-200">
                <Building2 className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Setores</span>
              </TabsTrigger>
              <TabsTrigger value="links" className="flex-1 rounded-lg data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm gap-2 transition-all duration-200">
                <Link2 className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Links Públicos</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-hidden px-8 pt-6 pb-6 min-h-0 flex flex-col">
            <TabsContent value="users" className="m-0 flex-1 flex flex-col min-h-0">
              {/* Search & Add for Users */}
              <div className="flex gap-3 mb-6 shrink-0">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Select value={selectedTargetId} onValueChange={setSelectedTargetId}>
                    <SelectTrigger className="pl-11 h-12 bg-white border-none rounded-xl focus:ring-4 focus:ring-blue-500/5 focus:border-primary transition-all font-medium">
                      <SelectValue placeholder="Buscar usuário por nome ou email..." />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border shadow-2xl">
                      {availableUsers.map(u => (
                        <SelectItem key={u.id} value={u.id.toString()} className="rounded-lg py-2.5">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-700">{u.full_name}</span>
                            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">{u.email}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Select value={permissionType} onValueChange={(v) => setPermissionType(v === 'WRITE' ? 'WRITE' : 'READ')}>
                    <SelectTrigger className="w-[120px] h-12 bg-white border-none rounded-xl focus:ring-4 focus:ring-blue-500/5 focus:border-primary transition-all font-bold text-slate-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border shadow-2xl">
                      <SelectItem value="READ" className="rounded-lg">Pode ver</SelectItem>
                      <SelectItem value="WRITE" className="rounded-lg">Pode editar</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button 
                    onClick={handleShare} 
                    disabled={loading || !selectedTargetId}
                    className="h-12 px-6 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold shadow-lg shadow-blue-900/10 transition-all active:scale-95 gap-2"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    Convidar
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between mb-3 px-1">
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Pessoas com acesso</h4>
                <Badge variant="outline" className="text-[10px] font-bold text-primary border-blue-100 bg-blue-50/50">
                  {shares.filter(s => s.type === 'user').length} usuários
                </Badge>
              </div>

              <ScrollArea className="flex-1 -mx-2 px-2">
                <div className="space-y-2.5 pb-4">
                  {shares.filter(s => s.type === 'user').length === 0 ? (
                    <div className="py-12 text-center border-2 border-dashed border-border rounded-2xl bg-slate-50/30">
                      <Users className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                      <p className="text-sm font-medium text-slate-400">Nenhum usuário convidado ainda.</p>
                    </div>
                  ) : (
                    shares.filter(s => s.type === 'user').map((share) => (
                      <div key={share.id} className="group bg-white p-4 rounded-xl border border-border shadow-sm hover:border-blue-200 hover:shadow-md transition-all duration-300 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-11 h-11 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100 text-primary font-bold text-xs">
                            {getInitials(share.target_name)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">{share.target_name}</p>
                            <p className="text-[11px] font-medium text-slate-500 truncate">Acesso individual</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select 
                            value={share.permission_type} 
                            onValueChange={(v) => handleUpdatePermission(share.id, share.type, v)}
                          >
                            <SelectTrigger className="h-8 border-none bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-600 rounded-lg w-[110px] transition-colors">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-border shadow-xl">
                              <SelectItem value="READ" className="text-xs">Pode visualizar</SelectItem>
                              <SelectItem value="WRITE" className="text-xs">Pode editar</SelectItem>
                            </SelectContent>
                          </Select>
                          <Separator orientation="vertical" className="h-4" />
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => handleRevoke(share.id, share.type)}
                            className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="sectors" className="m-0 flex-1 flex flex-col min-h-0">
              <div className="flex gap-3 mb-6 shrink-0">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Select value={selectedTargetId} onValueChange={setSelectedTargetId}>
                    <SelectTrigger className="pl-11 h-12 bg-white border-none rounded-xl focus:ring-4 focus:ring-blue-500/5 focus:border-primary transition-all font-medium">
                      <SelectValue placeholder="Selecionar setor..." />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border shadow-2xl">
                      {availableSectors.map(s => (
                        <SelectItem key={s.id} value={s.id} className="rounded-lg py-2.5 font-bold text-slate-700">{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Select value={permissionType} onValueChange={(v) => setPermissionType(v === 'WRITE' ? 'WRITE' : 'READ')}>
                    <SelectTrigger className="w-[120px] h-12 bg-white border-none rounded-xl focus:ring-4 focus:ring-blue-500/5 focus:border-primary transition-all font-bold text-slate-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border shadow-2xl">
                      <SelectItem value="READ" className="rounded-lg">Pode ver</SelectItem>
                      <SelectItem value="WRITE" className="rounded-lg">Pode editar</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button 
                    onClick={handleShare} 
                    disabled={loading || !selectedTargetId}
                    className="h-12 px-6 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold shadow-lg shadow-blue-900/10 transition-all active:scale-95 gap-2"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                    Liberar
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between mb-3 px-1">
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Setores com acesso</h4>
                <Badge variant="outline" className="text-[10px] font-bold text-primary border-blue-100 bg-blue-50/50">
                  {shares.filter(s => s.type === 'sector').length} setores
                </Badge>
              </div>

              <ScrollArea className="flex-1 -mx-2 px-2">
                <div className="space-y-2.5 pb-4">
                  {shares.filter(s => s.type === 'sector').length === 0 ? (
                    <div className="py-12 text-center border-2 border-dashed border-border rounded-2xl bg-slate-50/30">
                      <Building2 className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                      <p className="text-sm font-medium text-slate-400">Nenhum setor vinculado ainda.</p>
                    </div>
                  ) : (
                    shares.filter(s => s.type === 'sector').map((share) => (
                      <div key={share.id} className="group bg-white p-4 rounded-xl border border-border shadow-sm hover:border-blue-200 hover:shadow-md transition-all duration-300 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center border border-blue-100 text-primary">
                            <Building2 className="h-5.5 w-5.5" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">{share.target_name}</p>
                            <p className="text-[11px] font-medium text-slate-500">Acesso por departamento</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select 
                            value={share.permission_type} 
                            onValueChange={(v) => handleUpdatePermission(share.id, share.type, v)}
                          >
                            <SelectTrigger className="h-8 border-none bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-600 rounded-lg w-[110px] transition-colors">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-border shadow-xl">
                              <SelectItem value="READ" className="text-xs">Pode visualizar</SelectItem>
                              <SelectItem value="WRITE" className="text-xs">Pode editar</SelectItem>
                            </SelectContent>
                          </Select>
                          <Separator orientation="vertical" className="h-4" />
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => handleRevoke(share.id, share.type)}
                            className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="links" className="m-0 flex-1 flex flex-col min-h-0">
              <div className="mb-4 shrink-0">
                <Button 
                  onClick={generateLink}
                  disabled={loading}
                  className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-lg shadow-blue-200 flex items-center justify-center gap-2"
                >
                  <Link2 className="h-5 w-5" />
                  Gerar Novo Link
                </Button>
              </div>

              <ScrollArea className="flex-1 -mx-2 px-2">
                <div className="space-y-3 pb-4">
                  {shares.filter(s => s.type === 'link').map((share) => (
                    <div key={share.id} className="bg-white p-4 rounded-2xl border border-border shadow-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center border border-green-100">
                            <Link2 className="h-4 w-4 text-green-600" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-900">Link Público Ativo</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-slate-500 flex items-center">
                                <Clock className="h-3 w-3 mr-1" />
                                {share.expires_at ? `Expira em ${new Date(share.expires_at).toLocaleDateString()}` : 'Nunca expira'}
                              </span>
                              <span className="text-[10px] text-slate-500 flex items-center">
                                <Search className="h-3 w-3 mr-1" />
                                {share.view_count} visualizações
                              </span>
                            </div>
                          </div>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
                              <MoreVertical className="h-4 w-4 text-slate-400" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48 p-1.5 rounded-xl border-border shadow-xl bg-white">
                            <DropdownMenuItem className="rounded-lg text-xs font-semibold py-2">
                              <Clock className="h-4 w-4 mr-2 opacity-60" />
                              Definir Expiração
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              className="rounded-lg text-xs font-semibold py-2 text-red-600 focus:text-red-600 focus:bg-red-50"
                              onClick={() => handleRevoke(share.id, share.type)}
                            >
                              <X className="h-4 w-4 mr-2 opacity-60" />
                              Desativar Link
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      
                      <div className="flex gap-2">
                        <div className="flex-1 h-10 bg-slate-50 border border-border rounded-xl px-3 flex items-center overflow-hidden">
                          <span className="text-[11px] font-medium text-slate-500 truncate">{shareLink || 'Link gerado aparecerá aqui'}</span>
                        </div>
                        <Button 
                          variant="secondary" 
                          size="icon" 
                          className="h-10 w-10 bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-100 rounded-xl"
                          onClick={() => {
                            if (shareLink) {
                              navigator.clipboard.writeText(shareLink);
                              toast.success("Link copiado!");
                            }
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  
                  {shares.filter(s => s.type === 'link').length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                        <Link2 className="h-8 w-8 text-slate-300" />
                      </div>
                      <p className="text-sm font-bold text-slate-900">Nenhum link gerado</p>
                      <p className="text-xs text-slate-500 max-w-[200px] mt-1">Crie links para compartilhar com pessoas fora da plataforma.</p>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Link Configuration (if no link or when generating) */}
              <div className="mt-auto pt-4 border-t border-border space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Expiração</Label>
                    <Select value={expiresInMinutes} onValueChange={setExpiresInMinutes}>
                      <SelectTrigger className="h-10 bg-white border-none rounded-xl text-[11px] font-bold text-slate-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-border shadow-xl bg-white">
                        <SelectItem value="60" className="text-[11px] font-bold text-slate-700">1 HORA</SelectItem>
                        <SelectItem value="1440" className="text-[11px] font-bold text-slate-700">24 HORAS</SelectItem>
                        <SelectItem value="10080" className="text-[11px] font-bold text-slate-700">7 DIAS</SelectItem>
                        <SelectItem value="43200" className="text-[11px] font-bold text-slate-700">30 DIAS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Senha <span className="text-red-500">*</span></Label>
                    <Input
                      type="password"
                      value={linkPassword}
                      onChange={(e) => setLinkPassword(e.target.value)}
                      placeholder="Obrigatória"
                      className="h-10 bg-white border-border rounded-xl text-[11px] font-bold text-slate-700"
                    />
                  </div>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        {/* Footer info (Mobile friendly) */}
        <div className="p-4 bg-white border-t border-border flex items-center justify-center shrink-0">
          <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
            <Shield className="h-3 w-3" />
            Todos os acessos são criptografados e monitorados
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
