import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/auth';
import { Loader2, Activity, Users, BarChart3, HardDrive, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface AuditLog {
  id: string;
  tenant_id: string;
  tenant_name: string;
  action: string;
  description: string;
  ip_address: string;
  created_at: string;
}

export const StatCard = ({ 
  title, 
  value, 
  sub, 
  icon: Icon, 
  trend, 
  trendValue 
}: { 
  title: string, 
  value: string, 
  sub: string, 
  icon?: React.ElementType, 
  trend?: 'up' | 'down', 
  trendValue?: string 
}) => (
  <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden relative group">
    <CardContent className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">{title}</p>
          <h3 className="text-2xl font-bold text-slate-800 tracking-tight">{value}</h3>
          <div className="flex items-center gap-1.5 mt-2">
            {trend && (
              <span className={`flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                trend === 'up' ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50'
              }`}>
                {trend === 'up' ? <ArrowUpRight size={10} className="mr-0.5" /> : <ArrowDownRight size={10} className="mr-0.5" />}
                {trendValue}
              </span>
            )}
            <p className="text-[10px] text-slate-400 font-medium">{sub}</p>
          </div>
        </div>
        {Icon && (
          <div className="w-12 h-12 bg-[#f4f7fe] rounded-2xl flex items-center justify-center text-[#1b254b] group-hover:bg-[#1b254b] group-hover:text-white transition-all duration-300 shadow-sm">
            <Icon size={24} />
          </div>
        )}
      </div>
    </CardContent>
    <div className="absolute bottom-0 left-0 w-full h-1 bg-transparent group-hover:bg-blue-500/20 transition-all" />
  </Card>
);

interface DashboardStats {
  total_tenants: number;
  active_leads: number;
  total_storage: string;
}

export default function Dashboard() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [logsRes, statsRes] = await Promise.all([
          api.get('/admin/audit').catch(() => ({ data: [] })),
          api.get('/admin/dashboard/stats').catch(() => ({ data: { total_tenants: 0, active_leads: 0, total_storage: '0' } }))
        ]);
        setLogs(Array.isArray(logsRes.data) ? logsRes.data : []);
        setStats(statsRes.data);
      } catch {
        console.error("Erro ao carregar dados do dashboard");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
        <StatCard 
          title="Total Tenants" 
          value={stats?.total_tenants.toString() || "0"} 
          sub="Empresas ativas" 
          icon={Users}
          trend="up"
          trendValue="12%"
        />
        <StatCard 
          title="Leads Ativos" 
          value={stats?.active_leads.toString() || "0"} 
          sub="Novas oportunidades" 
          icon={BarChart3}
          trend="up"
          trendValue="5%"
        />
        <StatCard 
          title="Espaço Total" 
          value={stats?.total_storage || "0"} 
          sub="Uso global MinIO" 
          icon={HardDrive}
        />
      </div>
      
      <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden">
        <CardHeader className="py-4 px-4 lg:py-5 lg:px-6 border-b border-slate-50 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
              <Activity size={16} className="text-blue-600" />
            </div>
            <span className="truncate">Auditoria Global Recente</span>
          </CardTitle>
          <button 
            className="text-[10px] lg:text-[11px] font-bold text-blue-600 hover:text-blue-700 transition-colors uppercase tracking-wider whitespace-nowrap ml-2"
            onClick={() => {
              // No futuro, isso poderia navegar para uma página de logs completa
              toast.info('A funcionalidade de ver todos os logs será implementada em breve.');
            }}
          >
            Ver Todos
          </button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto scrollbar-hide">
            <div className="inline-block min-w-full align-middle">
              <Table>
                <TableHeader className="bg-slate-50/50">
                  <TableRow className="hover:bg-transparent border-none">
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap">Tenant</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap">Ação</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap hidden sm:table-cell">Descrição</TableHead>
                    <TableHead className="h-10 lg:h-11 text-[10px] lg:text-[11px] font-bold uppercase text-slate-400 px-4 lg:px-6 whitespace-nowrap">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id} className="hover:bg-slate-50/30 transition-colors border-b border-slate-50 last:border-0">
                      <TableCell className="font-bold text-[11px] lg:text-xs text-slate-700 px-4 lg:px-6 py-3 lg:py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 lg:gap-3">
                          <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-full bg-[#1b254b]/5 flex items-center justify-center text-[9px] lg:text-[10px] text-[#1b254b] font-bold shrink-0">
                            {log.tenant_name?.substring(0, 2).toUpperCase() || 'SI'}
                          </div>
                          <span className="truncate max-w-[80px] lg:max-w-none">{log.tenant_name || 'Sistema'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 lg:px-6 py-3 lg:py-4 whitespace-nowrap">
                        <span className="px-2 py-0.5 lg:px-2.5 lg:py-1 rounded-lg bg-blue-50 text-blue-600 text-[9px] lg:text-[10px] font-bold uppercase tracking-wider border border-blue-100">
                          {log.action}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[150px] lg:max-w-xs truncate text-[11px] lg:text-xs text-slate-500 px-4 lg:px-6 py-3 lg:py-4 font-medium hidden sm:table-cell">
                        {log.description}
                      </TableCell>
                      <TableCell className="text-[10px] lg:text-[11px] text-slate-400 px-4 lg:px-6 py-3 lg:py-4 whitespace-nowrap font-medium">
                        {new Date(log.created_at).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                  {logs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 lg:py-12 text-xs lg:text-sm text-slate-400 font-medium italic">
                        Nenhuma atividade recente registrada.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
