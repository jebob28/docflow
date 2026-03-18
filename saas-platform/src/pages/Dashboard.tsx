import { useState, useEffect } from 'react';
import type { ElementType } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, 
  Share2, 
  Eye, 
  Folder,
  FileSpreadsheet,
  FileImage,
  MoreHorizontal,
  Tag as TagIcon,
  Download,
  Trash2,
  HardDrive,
  BarChart3,
  ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import ShareModal from '@/components/ShareModal';

// import { useNavigate } from 'react-router-dom';

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface FolderItem {
  id: string;
  name: string;
  extension?: string;
  size?: number;
  created_at?: string;
  owner?: string;
  itemType?: 'folder';
  tags?: Tag[];
}

interface DocumentItem {
  id: string;
  name: string;
  extension?: string;
  size?: number;
  created_at?: string;
  owner?: string;
  itemType?: 'file';
  tags?: Tag[];
  document_type?: string;
}

interface Stats {
  total_files: number;
  pending: number;
  shared: number;
  views: number;
  used_storage?: number;
  max_storage?: number;
  storage_usage?: number;
}

interface MonthlyUpload {
  label: string;
  count: number;
  key: string;
}

interface TypeDistribution {
  label: string;
  count: number;
  color?: string;
  hex?: string;
}

interface TagStat {
  name: string;
  color: string;
  count: number;
}

interface ContractAlert {
  id: string;
  name: string;
  extension: string;
  contract_expires_at: string;
  is_expired: boolean;
  can_edit: boolean;
  document_type?: string;
}

type Item = (FolderItem & { itemType: 'folder' }) | (DocumentItem & { itemType: 'file' });

interface SummaryCardProps {
  icon: ElementType;
  label: string;
  value: string;
  color: string;
}

interface RecentFileCardProps {
  item: DocumentItem;
  icon: ElementType;
  color: string;
  onShare: (item: Item) => void;
  onDownload: (item: Item) => void;
  onDelete: (item: Item) => void;
}

const SummaryCard = ({ icon: Icon, label, value, color }: SummaryCardProps) => (
  <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden group hover:shadow-md transition-all duration-300">
    <CardContent className="p-4 sm:p-6 flex items-center gap-3 sm:gap-4">
      <div className={cn("p-2.5 sm:p-3 rounded-xl transition-transform group-hover:scale-110 duration-300", color)}>
        <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
      </div>
      <div>
        <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">{value}</p>
      </div>
    </CardContent>
  </Card>
);

const RecentFileCard = ({ item, icon: Icon, color, onShare, onDownload, onDelete }: RecentFileCardProps) => {
  const navigate = useNavigate();
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short'
    });
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <Card 
      className="border-none shadow-sm bg-white rounded-2xl hover:shadow-xl transition-all duration-300 cursor-pointer group border border-transparent hover:border-border"
      onClick={() => navigate(`/documents/view/${item.id}`)}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex justify-between items-start mb-3 sm:mb-4">
          <div className="flex flex-col gap-2">
            <div className={cn("p-2 sm:p-2.5 rounded-lg shadow-sm w-fit", color)}>
              <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            {item.document_type && (
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[8px] font-black uppercase tracking-widest border border-border/50 w-fit">
                {item.document_type}
              </span>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button 
                className="h-8 w-8 flex items-center justify-center text-slate-300 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-all"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-2xl shadow-xl border-border p-1.5 animate-in fade-in zoom-in-95 duration-200 bg-white">
              <DropdownMenuItem 
                className="flex items-center gap-2.5 py-2.5 px-3 cursor-pointer text-slate-600 focus:text-blue-600 focus:bg-blue-50 rounded-xl transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onShare({ ...item, itemType: 'file' });
                }}
              >
                <Share2 className="h-4 w-4" />
                <span className="font-bold text-xs">Compartilhar</span>
              </DropdownMenuItem>
              <DropdownMenuItem 
                className="flex items-center gap-2.5 py-2.5 px-3 cursor-pointer text-slate-600 focus:text-blue-600 focus:bg-blue-50 rounded-xl transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload({ ...item, itemType: 'file' });
                }}
              >
                <Download className="h-4 w-4" />
                <span className="font-bold text-xs">Baixar</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1 bg-slate-100" />
              <DropdownMenuItem 
                className="flex items-center gap-2.5 py-2.5 px-3 cursor-pointer text-rose-600 focus:text-rose-600 focus:bg-rose-50 rounded-xl transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete({ ...item, itemType: 'file' });
                }}
              >
                <Trash2 className="h-4 w-4" />
                <span className="font-bold text-xs">Excluir</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <h3 className="font-bold text-slate-800 text-sm truncate pr-2" title={item.name}>{item.name}</h3>
        
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {item.tags.slice(0, 2).map((tag) => (
              <div 
                key={tag.id}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[8px] font-black text-white shadow-sm uppercase tracking-tighter"
                style={{ backgroundColor: tag.color }}
              >
                <TagIcon className="h-2 w-2" />
                {tag.name}
              </div>
            ))}
            {item.tags.length > 2 && (
              <div className="px-1.5 py-0.5 rounded-md text-[8px] font-bold bg-slate-50 text-slate-400 border border-border">
                +{item.tags.length - 2}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{formatDate(item.created_at)}</p>
          <span className="text-[10px] font-black text-slate-600 bg-slate-50 px-2 py-0.5 rounded-md">{formatSize(item.size)}</span>
        </div>
      </CardContent>
    </Card>
  );
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [stats, setStats] = useState<Stats>({ total_files: 0, pending: 0, shared: 0, views: 0, used_storage: 0, max_storage: 0, storage_usage: 0 });
  const [monthlyUploads, setMonthlyUploads] = useState<MonthlyUpload[]>([]);
  const [fileTypeStats, setFileTypeStats] = useState<TypeDistribution[]>([]);
  const [topTags, setTopTags] = useState<TagStat[]>([]);
  const [contractAlerts, setContractAlerts] = useState<ContractAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [selectedItemForShare, setSelectedItemForShare] = useState<Item | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/v1/documents/dashboard', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const data: {
            recent_folders?: FolderItem[];
            recent_documents?: DocumentItem[];
            stats?: Stats;
            monthly_uploads?: MonthlyUpload[];
            type_distribution?: TypeDistribution[];
            top_tags?: TagStat[];
          } = await response.json();
          setFolders(data.recent_folders || []);
          setDocuments(data.recent_documents || []);
          if (data.stats) {
            setStats(data.stats);
          }
          if (data.monthly_uploads) {
            setMonthlyUploads(data.monthly_uploads);
          }
          if (data.type_distribution) {
            const colors: Record<string, { color: string; hex: string }> = {
              'PDF': { color: 'bg-rose-500', hex: '#f43f5e' },
              'Planilhas': { color: 'bg-emerald-500', hex: '#10b981' },
              'Imagens': { color: 'bg-purple-500', hex: '#a855f7' },
              'Docs': { color: 'bg-primary', hex: 'var(--color-primary)' },
              'Outros': { color: 'bg-slate-400', hex: '#94a3b8' }
            };
            
            const distribution = data.type_distribution.map((item) => ({
              ...item,
              color: colors[item.label]?.color || 'bg-slate-400',
              hex: colors[item.label]?.hex || '#94a3b8'
            }));
            setFileTypeStats(distribution);
          }
          if (data.top_tags) {
            setTopTags(data.top_tags);
          }
        }

        // Carregar alertas de contratos
        const alertsResponse = await fetch('/api/v1/documents/alerts/contracts', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (alertsResponse.ok) {
          const alertsData = await alertsResponse.json();
          setContractAlerts(alertsData || []);
        }
      } catch (error) {
        console.error("Erro ao carregar dados do dashboard:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const getFileIcon = (type: string, extension?: string) => {
    if (type === 'folder') return { icon: Folder, color: 'text-blue-500' };
    
    const ext = extension?.toLowerCase().replace('.', '');
    switch (ext) {
      case 'pdf': return { icon: FileText, color: 'text-rose-500' };
      case 'xlsx': case 'xls': case 'csv': return { icon: FileSpreadsheet, color: 'text-emerald-500' };
      case 'jpg': case 'jpeg': case 'png': case 'gif': return { icon: FileImage, color: 'text-purple-500' };
      case 'doc': case 'docx': return { icon: FileText, color: 'text-blue-500' };
      default: return { icon: FileText, color: 'text-slate-400' };
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };


  const handleOpenShare = (item: Item) => {
    setSelectedItemForShare(item);
    setIsShareModalOpen(true);
  };

  const handleDownload = async (item: Item) => {
    if (item.itemType === 'folder') return;
    
    const downloadFile = async () => {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/${item.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
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
      } else {
        throw new Error('Erro ao baixar arquivo');
      }
    };

    toast.promise(downloadFile(), {
      loading: `Preparando download de: ${item.name}...`,
      success: `Download de ${item.name} iniciado!`,
      error: 'Erro ao processar download.',
    });
  };

  const handleDelete = (item: Item) => {
    toast.error(`Para excluir "${item.name}", acesse a aba Documentos para confirmação de segurança.`, {
      action: {
        label: 'Ir para Documentos',
        onClick: () => navigate('/documents')
      },
      duration: 5000
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  const totalFolders = folders.length;
  const usedStorage = stats.used_storage || 0;
  const maxStorage = stats.max_storage || 0;
  const storageUsage = stats.storage_usage ?? (maxStorage > 0 ? (usedStorage / maxStorage) * 100 : 0);
  const storageUsagePercent = Math.min(100, Math.max(0, storageUsage));

  const finalFileTypeStats = fileTypeStats.length > 0 ? fileTypeStats : (() => {
    const counts = {
      pdf: 0,
      spreadsheets: 0,
      images: 0,
      documents: 0,
      others: 0
    };
    documents.forEach((doc) => {
      const ext = doc.extension?.toLowerCase().replace('.', '');
      if (!ext) {
        counts.others += 1;
        return;
      }
      if (ext === 'pdf') counts.pdf += 1;
      else if (['xlsx', 'xls', 'csv'].includes(ext)) counts.spreadsheets += 1;
      else if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) counts.images += 1;
      else if (['doc', 'docx'].includes(ext)) counts.documents += 1;
      else counts.others += 1;
    });
    const data = [
      { label: 'PDF', count: counts.pdf, color: 'bg-rose-500', hex: '#f43f5e' },
      { label: 'Planilhas', count: counts.spreadsheets, color: 'bg-emerald-500', hex: '#10b981' },
      { label: 'Imagens', count: counts.images, color: 'bg-purple-500', hex: '#a855f7' },
      { label: 'Docs', count: counts.documents, color: 'bg-primary', hex: 'var(--color-primary)' },
      { label: 'Outros', count: counts.others, color: 'bg-slate-400', hex: '#94a3b8' }
    ];
    return data.filter((item) => item.count > 0);
  })();

  const finalMonthlyUploads = monthlyUploads.length > 0 ? monthlyUploads : (() => {
    const now = new Date();
    const items = Array.from({ length: 6 }).map((_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      return {
        key,
        label: date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
        count: 0
      };
    });
    documents.forEach((doc) => {
      if (!doc.created_at) return;
      const created = new Date(doc.created_at);
      const key = `${created.getFullYear()}-${created.getMonth()}`;
      const target = items.find((item) => item.key === key);
      if (target) target.count += 1;
    });
    return items;
  })();

  const finalTopTags = topTags.length > 0 ? topTags : (() => {
    const tagCounts = new Map<string, { name: string; color: string; count: number }>();
    documents.forEach((doc) => {
      doc.tags?.forEach((tag) => {
        const existing = tagCounts.get(tag.id);
        if (existing) {
          existing.count += 1;
        } else {
          tagCounts.set(tag.id, { name: tag.name, color: tag.color, count: 1 });
        }
      });
    });
    return Array.from(tagCounts.values()).sort((a, b) => b.count - a.count).slice(0, 4);
  })();

  return (
    <div className="space-y-6 pb-24 lg:pb-0 px-4 sm:px-0">
      <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-6">
        <SummaryCard icon={FileText} label="Arquivos" value={String(stats.total_files)} color="bg-blue-50 text-blue-500" />
        <SummaryCard icon={Folder} label="Pastas" value={String(totalFolders)} color="bg-slate-100 text-slate-600" />
        <SummaryCard icon={Share2} label="Partilhados" value={String(stats.shared)} color="bg-emerald-50 text-emerald-500" />
        <SummaryCard icon={Eye} label="Vistas" value={String(stats.views)} color="bg-purple-50 text-purple-500" />
      </div>

      {contractAlerts.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              Alertas de Contratos
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-black text-white">
                {contractAlerts.length}
              </span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {contractAlerts.map((alert) => (
              <Card 
                key={alert.id} 
                className={cn(
                  "border-none shadow-sm rounded-2xl overflow-hidden cursor-pointer hover:shadow-md transition-all",
                  alert.is_expired ? "bg-rose-50 border-l-4 border-l-rose-500" : "bg-amber-50 border-l-4 border-l-amber-500"
                )}
                onClick={() => navigate(`/documents?id=${alert.id}`)}
              >
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn(
                    "p-3 rounded-xl shadow-sm",
                    alert.is_expired ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"
                  )}>
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-800 text-sm truncate">{alert.name}</h3>
                      {alert.document_type && (
                        <span className="px-1.5 py-0.5 rounded bg-white/50 text-slate-500 text-[8px] font-black uppercase tracking-widest border border-border/50">
                          {alert.document_type}
                        </span>
                      )}
                    </div>
                    <p className={cn(
                      "text-[10px] font-black uppercase tracking-wider mt-1",
                      alert.is_expired ? "text-rose-500" : "text-amber-600"
                    )}>
                      {alert.is_expired ? "Vencido em: " : "Vence em: "}
                      {new Date(alert.contract_expires_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border-none shadow-sm bg-white rounded-3xl overflow-hidden lg:col-span-1">
          <CardContent className="p-6 sm:p-8 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Armazenamento</p>
                <p className="text-3xl font-black text-slate-900 mt-1">{storageUsagePercent.toFixed(1)}%</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-indigo-50 text-indigo-500 shadow-sm border border-indigo-100/50">
                <HardDrive className="h-6 w-6" />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-xs font-bold text-slate-500 px-1">
                <span>{formatSize(usedStorage)} em uso</span>
                <span>{formatSize(maxStorage)} total</span>
              </div>
              <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden p-1 border border-border/50">
                <div 
                  className={cn(
                    "h-full rounded-full transition-all duration-1000 ease-out shadow-sm",
                    storageUsagePercent > 90 ? "bg-rose-500" : storageUsagePercent > 70 ? "bg-amber-500" : "bg-indigo-500"
                  )}
                  style={{ width: `${storageUsagePercent}%` }}
                />
              </div>
            </div>

            <div className="pt-6 border-t border-border">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 text-center sm:text-left">Distribuição por Tipo</p>
              <div className="flex flex-col sm:flex-row items-center gap-8 sm:gap-8">
                <div className="h-48 w-48 sm:h-44 sm:w-44 shrink-0 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={finalFileTypeStats}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={85}
                        paddingAngle={8}
                        dataKey="count"
                        nameKey="label"
                        stroke="none"
                      >
                        {finalFileTypeStats.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.hex} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '20px', 
                          border: 'none', 
                          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          padding: '12px'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total</span>
                    <span className="text-2xl font-black text-slate-900">{stats.total_files}</span>
                  </div>
                </div>
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-1 gap-2.5 sm:gap-3.5 w-full">
                  {finalFileTypeStats.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between group bg-slate-50/50 p-2.5 rounded-2xl hover:bg-slate-50 transition-colors border border-transparent hover:border-border">
                      <div className="flex items-center gap-2.5">
                        <div className={cn("w-2.5 h-2.5 rounded-full shadow-sm", item.color)} />
                        <span className="text-[10px] sm:text-xs font-bold text-slate-600 group-hover:text-slate-900 transition-colors">{item.label}</span>
                      </div>
                      <span className="text-[10px] sm:text-xs font-black text-slate-400 bg-white px-2 py-0.5 rounded-lg border border-border shadow-sm">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-white rounded-3xl overflow-hidden lg:col-span-2">
          <CardHeader className="p-6 sm:p-8 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-black text-slate-900 tracking-tight">Atividade de Upload</CardTitle>
                <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">Histórico Semestral</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-blue-50 text-blue-600 shadow-sm border border-blue-100/50">
                <BarChart3 className="h-6 w-6" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-8">
            <div className="h-64 sm:h-72 w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={finalMonthlyUploads} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="label" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 800 }}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 800 }}
                  />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc', radius: 10 }}
                    contentStyle={{ 
                      borderRadius: '20px', 
                      border: 'none', 
                      boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      padding: '12px'
                    }}
                  />
                  <Bar 
                    dataKey="count" 
                    fill="url(#barGradient)"
                    radius={[10, 10, 0, 0]} 
                    barSize={window.innerWidth < 640 ? 20 : 32}
                  />
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={1} />
                      <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.8} />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xl font-black text-slate-900 tracking-tight">Arquivos Recentes</h2>
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-blue-600 font-bold hover:bg-blue-50 rounded-2xl px-4"
              onClick={() => navigate('/documents')}
            >
              Ver todos
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {documents.slice(0, 4).map((doc) => {
              const { icon, color } = getFileIcon('file', doc.extension);
              const colorMap: Record<string, string> = {
                'text-rose-500': 'bg-rose-50 text-rose-500',
                'text-emerald-500': 'bg-emerald-50 text-emerald-500',
                'text-purple-500': 'bg-purple-50 text-purple-500',
                'text-blue-500': 'bg-blue-50 text-blue-500',
                'text-slate-400': 'bg-slate-50 text-slate-400',
              };
              return (
                <RecentFileCard 
                  key={doc.id} 
                  item={doc} 
                  icon={icon} 
                  color={colorMap[color] || 'bg-slate-50 text-slate-400'}
                  onShare={handleOpenShare}
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                />
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xl font-black text-slate-900 tracking-tight">Etiquetas em Alta</h2>
            <div className="p-2 rounded-xl bg-slate-50 text-slate-400">
              <TagIcon className="h-5 w-5" />
            </div>
          </div>
          <Card className="border-none shadow-sm bg-white rounded-3xl overflow-hidden">
            <CardContent className="p-6 sm:p-8 space-y-5">
              {finalTopTags.length > 0 ? finalTopTags.map((tag, idx) => (
                <div key={idx} className="flex items-center justify-between group cursor-pointer bg-slate-50/50 hover:bg-slate-50 p-3 rounded-2xl transition-all border border-transparent hover:border-border">
                  <div className="flex items-center gap-4">
                    <div 
                      className="w-11 h-11 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm bg-white"
                      style={{ color: tag.color }}
                    >
                      <TagIcon className="h-5.5 w-5.5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-700 group-hover:text-slate-900 transition-colors">{tag.name}</p>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{tag.count} arquivos</p>
                    </div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-white shadow-sm border border-border">
                    <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-blue-600 transition-all group-hover:translate-x-0.5" />
                  </div>
                </div>
              )) : (
                <div className="text-center py-10 bg-slate-50/50 rounded-2xl border border-dashed border-border">
                  <p className="text-sm font-bold text-slate-400">Nenhuma etiqueta em uso</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {selectedItemForShare && (
        <ShareModal 
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          itemId={selectedItemForShare.id}
          itemName={selectedItemForShare.name}
          itemType={selectedItemForShare.itemType}
        />
      )}
    </div>
  );
}
