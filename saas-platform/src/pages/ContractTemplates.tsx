import { useCallback, useEffect, useState } from 'react';
import { FileText, Plus, Loader2, Edit2, Trash2, Eye } from 'lucide-react';
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
  DialogHeader, 
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface ContractTemplate {
  id: string;
  name: string;
  html_content: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const formatDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

const sanitizePreviewHtml = (rawHtml: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  doc.querySelectorAll('script, iframe, object, embed, base, meta[http-equiv="refresh"]').forEach((node) => {
    node.remove();
  });

  const allElements = doc.body.querySelectorAll('*');
  allElements.forEach((element) => {
    Array.from(element.attributes).forEach((attr) => {
      const attrName = attr.name.toLowerCase();
      const attrValue = attr.value.trim().toLowerCase();

      if (attrName.startsWith('on')) {
        element.removeAttribute(attr.name);
        return;
      }

      if ((attrName === 'href' || attrName === 'src' || attrName === 'xlink:href') && (attrValue.startsWith('javascript:') || attrValue.startsWith('data:text/html'))) {
        element.removeAttribute(attr.name);
      }
    });
  });

  return doc.body.innerHTML;
};

interface TemplateCardProps {
  template: ContractTemplate;
  onEdit: (template: ContractTemplate) => void;
  onPreview: (template: ContractTemplate) => void;
  onDelete: (id: string) => void;
}

const TemplateCard = ({ template, onEdit, onPreview, onDelete }: TemplateCardProps) => {
  return (
    <Card className="border border-slate-200 shadow-sm bg-white rounded-xl overflow-hidden p-3 w-full max-w-full">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">{template.name}</p>
              <p className="text-[11px] text-slate-500 font-medium truncate">{formatDateTime(template.created_at)}</p>
            </div>
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-tight border ${
          template.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-50 text-slate-600 border-slate-100'
        }`}>
          {template.is_active ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-3 rounded-md text-slate-600 font-bold text-[10px] uppercase tracking-wider border border-slate-200"
          onClick={() => onPreview(template)}
        >
          <Eye className="h-3.5 w-3.5 mr-2" />
          Ver
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-3 rounded-md text-slate-600 font-bold text-[10px] uppercase tracking-wider border border-slate-200"
          onClick={() => onEdit(template)}
        >
          <Edit2 className="h-3.5 w-3.5 mr-2" />
          Editar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-3 rounded-md text-slate-600 font-bold text-[10px] uppercase tracking-wider border border-slate-200 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50"
          onClick={() => onDelete(template.id)}
        >
          <Trash2 className="h-3.5 w-3.5 mr-2" />
          Excluir
        </Button>
      </div>
    </Card>
  );
};

export default function ContractTemplates() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<ContractTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isPWA, setIsPWA] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    html_content: '',
    is_active: true,
  });

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/contracts/templates', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data: ContractTemplate[] = await response.json();
        setTemplates(data || []);
      } else {
        toast.error('Erro ao carregar templates');
      }
    } catch (error) {
      console.error('Erro ao buscar templates:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  useEffect(() => {
    const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
    const checkPWA = () => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
        navigatorWithStandalone.standalone === true ||
        document.referrer.includes('android-app://');
      setIsPWA(isStandalone);
    };

    checkPWA();
    const pwaQuery = window.matchMedia('(display-mode: standalone)');
    const pwaHandler = (e: MediaQueryListEvent) => setIsPWA(e.matches);
    pwaQuery.addEventListener('change', pwaHandler);

    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => {
      mediaQuery.removeEventListener('change', handler);
      pwaQuery.removeEventListener('change', pwaHandler);
    };
  }, []);

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast.error('Informe o nome do template');
      return;
    }
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/contracts/templates', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      if (response.ok) {
        toast.success('Template criado com sucesso');
        setIsCreateOpen(false);
        setFormData({ name: '', html_content: '', is_active: true });
        fetchTemplates();
      } else {
        toast.error('Erro ao criar template');
      }
    } catch (error) {
      console.error('Erro ao criar template:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingTemplate) return;
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/contracts/templates/${editingTemplate.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      if (response.ok) {
        toast.success('Template atualizado com sucesso');
        setIsEditOpen(false);
        fetchTemplates();
      } else {
        toast.error('Erro ao atualizar template');
      }
    } catch (error) {
      console.error('Erro ao atualizar template:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja realmente excluir este template?')) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/contracts/templates/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        toast.success('Template excluído');
        fetchTemplates();
      } else {
        toast.error('Erro ao excluir template');
      }
    } catch (error) {
      console.error('Erro ao excluir template:', error);
    }
  };

  const openEditModal = (template: ContractTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      html_content: template.html_content,
      is_active: template.is_active,
    });
    setIsEditOpen(true);
  };


  if (isPWA && !isDesktop) {
    return (
      <div
        className="w-full min-h-screen bg-slate-50/50 px-3 pt-3 space-y-3 overflow-x-hidden"
        style={{
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 120px)',
        } as React.CSSProperties}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-slate-900 flex items-center justify-center text-white shadow-sm shrink-0">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Templates</h1>
            <p className="text-[11px] text-slate-500 font-medium truncate">Modelos rápidos de contrato</p>
          </div>
        </div>

        <Button 
          onClick={() => setIsCreateOpen(true)}
          className="w-full h-11 rounded-lg px-6 font-semibold text-sm text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-sm"
        >
          <Plus className="h-4 w-4 mr-2" />
          Novo Template
        </Button>

        <div className="space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-8 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Carregando templates...
            </div>
          )}

          {!loading && templates.length === 0 && (
            <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-slate-200">
              <p className="text-sm font-medium">Nenhum template encontrado.</p>
            </div>
          )}

          {!loading && templates.map(template => (
            <TemplateCard 
              key={template.id} 
              template={template} 
              onEdit={openEditModal}
              onPreview={(t) => {
                setPreviewContent(sanitizePreviewHtml(t.html_content));
                setIsPreviewOpen(true);
              }}
              onDelete={handleDelete}
            />
          ))}
        </div>

        {/* Modal Criar/Editar */}
        <Dialog open={isCreateOpen || isEditOpen} onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false);
            setIsEditOpen(false);
          }
        }}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{isEditOpen ? 'Editar Template' : 'Novo Template'}</DialogTitle>
              <DialogDescription>
                {isEditOpen ? 'Atualize as informações do seu template de contrato.' : 'Crie um novo template de contrato para facilitar a geração de novos documentos.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome do Template</Label>
                <Input 
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ex: Contrato de Prestação de Serviços"
                />
              </div>
              <div className="space-y-2">
                <Label>Conteúdo HTML</Label>
                <textarea 
                  className="w-full h-64 p-3 text-sm font-mono border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-all"
                  value={formData.html_content}
                  onChange={(e) => setFormData(prev => ({ ...prev, html_content: e.target.value }))}
                  placeholder="Insira o HTML do template..."
                />
                <p className="text-[10px] text-slate-500 italic">
                  Dica: Use tags como {"{{contract_title}}"}, {"{{counterparty_name}}"} para variáveis dinâmicas.
                </p>
              </div>
              <div className="flex items-center justify-between p-3 border rounded-lg bg-slate-50/50">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Template Ativo</Label>
                  <p className="text-xs text-slate-500">Disponível para uso na criação de novos contratos</p>
                </div>
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => { setIsCreateOpen(false); setIsEditOpen(false); }}>
                Cancelar
              </Button>
              <Button onClick={isEditOpen ? handleUpdate : handleCreate} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {isEditOpen ? 'Salvar Alterações' : 'Criar Template'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal Preview */}
        <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
          <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Visualização do Template</DialogTitle>
              <DialogDescription>Prévia de como o contrato será gerado com as informações atuais.</DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto border rounded-lg bg-white p-8 mt-4 shadow-inner">
              <div dangerouslySetInnerHTML={{ __html: previewContent }} />
            </div>
            <DialogFooter className="mt-4">
              <Button onClick={() => setIsPreviewOpen(false)}>Fechar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between border-b pb-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-slate-900 flex items-center justify-center text-white shadow-sm">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Templates de Contrato</h1>
            <p className="text-sm text-slate-500 font-medium">Gerencie modelos padronizados para criação rápida de documentos</p>
          </div>
        </div>

        <Button 
          onClick={() => setIsCreateOpen(true)}
          className="h-11 rounded-lg px-6 font-semibold text-sm text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-sm"
        >
          <Plus className="h-4 w-4 mr-2" />
          Novo Template
        </Button>
      </div>

      <Card className="border border-slate-200 shadow-md bg-white rounded-xl overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/80">
              <TableRow className="hover:bg-transparent border-slate-200">
                <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Nome</TableHead>
                <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Status</TableHead>
                <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Criado em</TableHead>
                <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={4} className="px-6 py-12 text-center">
                    <div className="flex items-center justify-center gap-2 text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Carregando templates...
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!loading && templates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="px-6 py-12 text-center text-slate-500">
                    Nenhum template encontrado.
                  </TableCell>
                </TableRow>
              )}

              {!loading && templates.map((template) => (
                <TableRow key={template.id} className="border-slate-100 hover:bg-slate-50/80 transition-colors">
                  <TableCell className="px-6 py-4 font-semibold text-slate-900">{template.name}</TableCell>
                  <TableCell className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight ${
                      template.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}>
                      {template.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </TableCell>
                  <TableCell className="px-6 py-4 text-xs text-slate-500">{formatDateTime(template.created_at)}</TableCell>
                  <TableCell className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => {
                          setPreviewContent(sanitizePreviewHtml(template.html_content));
                          setIsPreviewOpen(true);
                        }}
                        title="Visualizar"
                      >
                        <Eye className="h-4 w-4 text-slate-400 hover:text-blue-600" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => openEditModal(template)}
                        title="Editar"
                      >
                        <Edit2 className="h-4 w-4 text-slate-400 hover:text-slate-900" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => handleDelete(template.id)}
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4 text-slate-400 hover:text-rose-600" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Modal Criar/Editar */}
      <Dialog open={isCreateOpen || isEditOpen} onOpenChange={(open) => {
        if (!open) {
          setIsCreateOpen(false);
          setIsEditOpen(false);
        }
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditOpen ? 'Editar Template' : 'Novo Template'}</DialogTitle>
            <DialogDescription>
              {isEditOpen ? 'Atualize as informações do seu template de contrato.' : 'Crie um novo template de contrato para facilitar a geração de novos documentos.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome do Template</Label>
              <Input 
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Ex: Contrato de Prestação de Serviços"
              />
            </div>
            <div className="space-y-2">
              <Label>Conteúdo HTML</Label>
              <textarea 
                className="w-full h-64 p-3 text-sm font-mono border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-all"
                value={formData.html_content}
                onChange={(e) => setFormData(prev => ({ ...prev, html_content: e.target.value }))}
                placeholder="Insira o HTML do template..."
              />
              <p className="text-[10px] text-slate-500 italic">
                Dica: Use tags como {"{{contract_title}}"}, {"{{counterparty_name}}"} para variáveis dinâmicas.
              </p>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg bg-slate-50/50">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Template Ativo</Label>
                <p className="text-xs text-slate-500">Disponível para uso na criação de novos contratos</p>
              </div>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setIsCreateOpen(false); setIsEditOpen(false); }}>
              Cancelar
            </Button>
            <Button onClick={isEditOpen ? handleUpdate : handleCreate} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {isEditOpen ? 'Salvar Alterações' : 'Criar Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Preview */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Visualização do Template</DialogTitle>
            <DialogDescription>Prévia de como o contrato será gerado com as informações atuais.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto border rounded-lg bg-white p-8 mt-4 shadow-inner">
            <div dangerouslySetInnerHTML={{ __html: previewContent }} />
          </div>
          <DialogFooter className="mt-4">
            <Button onClick={() => setIsPreviewOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
