import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Loader2, Eye, Search, Clock, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { toast } from 'sonner';

interface ContractAlert {
  id: string;
  name: string;
  extension: string;
  size: number;
  contract_expires_at: string;
  contract_end_date?: string | null;
  contract_renewed_until?: string | null;
  expiration_source?: 'CONTRACT' | 'DOCUMENT';
  is_expired?: boolean;
  sector_id?: string | null;
  document_type?: string | null;
  can_edit?: boolean;
}

interface Sector {
  id: string;
  name: string;
}

export default function ContractExpirations() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<ContractAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [alertsDays, setAlertsDays] = useState('30');
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [filterSectorId, setFilterSectorId] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isDesktop, setIsDesktop] = useState(false);
  const [isPWA, setIsPWA] = useState(false);
  const [isRenewOpen, setIsRenewOpen] = useState(false);
  const [renewAlert, setRenewAlert] = useState<ContractAlert | null>(null);
  const [renewDate, setRenewDate] = useState('');
  const [renewing, setRenewing] = useState(false);
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);
  const [discardAlert, setDiscardAlert] = useState<ContractAlert | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const sectorNameById = useMemo(() => {
    return sectors.reduce<Record<string, string>>((acc, sector) => {
      acc[sector.id] = sector.name;
      return acc;
    }, {});
  }, [sectors]);

  const fetchSectors = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/sectors', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setSectors(data.sectors || []);
      }
    } catch (error) {
      console.error('Erro ao buscar setores:', error);
    }
  };

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      params.set('days', alertsDays);
      if (filterSectorId !== 'all') {
        params.set('sector_id', filterSectorId);
      }
      const response = await fetch(`/api/v1/documents/alerts/contracts?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data: ContractAlert[] = await response.json();
        setAlerts(data || []);
      } else {
        toast.error('Erro ao carregar alertas de vencimento');
      }
    } catch (error) {
      console.error('Erro ao buscar alertas de vencimento:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setLoading(false);
    }
  }, [alertsDays, filterSectorId]);

  useEffect(() => {
    fetchSectors();
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

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

  const formatDate = (value?: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}/${month}/${year}`;
  };

  const formatBytes = (value?: number | null) => {
    if (value === null || value === undefined) return '-';
    if (value === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(value) / Math.log(k));
    return `${(value / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatDateInput = (value?: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const openRenewModal = (alert: ContractAlert) => {
    setRenewAlert(alert);
    setRenewDate(formatDateInput(alert.contract_expires_at));
    setIsRenewOpen(true);
  };

  const openDiscardModal = (alert: ContractAlert) => {
    setDiscardAlert(alert);
    setIsDiscardOpen(true);
  };

  const handleRenew = async () => {
    if (!renewAlert || !renewDate) {
      toast.error('Informe a nova data de vencimento');
      return;
    }
    setRenewing(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/${renewAlert.id}/ocr`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contract_expires_at: new Date(`${renewDate}T00:00:00`).toISOString()
        })
      });
      if (response.ok) {
        toast.success('Vencimento renovado');
        setIsRenewOpen(false);
        setRenewAlert(null);
        fetchAlerts();
      } else {
        toast.error('Erro ao renovar vencimento');
      }
    } catch (error) {
      console.error('Erro ao renovar vencimento:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setRenewing(false);
    }
  };

  const handleDiscard = async () => {
    if (!discardAlert) return;
    setDiscarding(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/${discardAlert.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        toast.success('Documento descartado');
        setIsDiscardOpen(false);
        setDiscardAlert(null);
        fetchAlerts();
      } else {
        toast.error('Erro ao descartar documento');
      }
    } catch (error) {
      console.error('Erro ao descartar documento:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setDiscarding(false);
    }
  };

  const filteredAlerts = alerts.filter(alert => 
    alert.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const AlertCard = ({ alert }: { alert: ContractAlert }) => {
    const extensionLabel = alert.extension ? alert.extension.replace('.', '') : '';
    const sectorLabel = alert.sector_id ? sectorNameById[alert.sector_id] || 'Sem setor' : 'Sem setor';
    const contractDateLabel = alert.contract_renewed_until || alert.contract_end_date;
    const originLabel = alert.expiration_source === 'CONTRACT' ? 'Contrato' : 'Documento';
    const showContractDateDiff = contractDateLabel && formatDate(contractDateLabel) !== formatDate(alert.contract_expires_at);
    return (
      <Card className="border border-slate-200 shadow-sm bg-white rounded-xl overflow-hidden p-3 w-full max-w-full">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
                <FileText className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 truncate">{alert.name}</p>
                <p className="text-[11px] text-slate-500 font-medium truncate">{sectorLabel}</p>
              </div>
            </div>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-tight border ${
            alert.is_expired ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'
          }`}>
            {alert.is_expired ? 'Vencido' : 'Em dia'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Vencimento</span>
            <span className="text-[10px] font-semibold text-slate-700">{formatDate(alert.contract_expires_at)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Tamanho</span>
            <span className="text-[10px] font-semibold text-slate-700">{formatBytes(alert.size)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Tipo</span>
            <span className="text-[10px] font-semibold text-slate-700 uppercase">{extensionLabel || '-'}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Categoria</span>
            <span className="text-[10px] font-semibold text-slate-700">{alert.document_type || '-'}</span>
          </div>
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-500 font-semibold">
          <span>Origem: {originLabel}</span>
          {showContractDateDiff ? (
            <span>Fim contrato: {formatDate(contractDateLabel)}</span>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-3 rounded-md text-slate-600 font-bold text-[9px] uppercase tracking-wider border border-slate-200"
            onClick={() => navigate(`/documents/view/${alert.id}`)}
          >
            <Eye className="h-3 w-3 mr-2" />
            Ver
          </Button>
          {alert.can_edit && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-3 rounded-md text-emerald-700 font-bold text-[9px] uppercase tracking-wider border border-emerald-100 hover:bg-emerald-50"
                onClick={() => openRenewModal(alert)}
              >
                <RefreshCw className="h-3 w-3 mr-2" />
                Renovar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-3 rounded-md text-rose-600 font-bold text-[9px] uppercase tracking-wider border border-rose-100 hover:bg-rose-50"
                onClick={() => openDiscardModal(alert)}
              >
                <Trash2 className="h-3 w-3 mr-2" />
                Descartar
              </Button>
            </>
          )}
        </div>
      </Card>
    );
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
          <div className="w-10 h-10 rounded-lg bg-rose-600 flex items-center justify-center text-white shadow-sm shrink-0">
            <Clock className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Vencimentos</h1>
            <p className="text-[11px] text-slate-500 font-medium truncate">Monitore prazos e expirações</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="relative group min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
            <Input 
              placeholder="Buscar documento..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 w-full h-11 rounded-lg bg-white border-slate-200 focus:border-slate-400 focus:ring-0 transition-all shadow-sm"
            />
          </div>

          <Select value={filterSectorId} onValueChange={setFilterSectorId}>
            <SelectTrigger className="w-full h-11 rounded-lg bg-white border-slate-200 focus:ring-0 shadow-sm font-medium text-slate-700">
              <SelectValue placeholder="Filtrar setor" />
            </SelectTrigger>
            <SelectContent className="rounded-lg border-slate-200 shadow-lg">
              <SelectItem value="all">Todos os setores</SelectItem>
              {sectors.map(sector => (
                <SelectItem key={sector.id} value={sector.id}>
                  {sector.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={alertsDays} onValueChange={setAlertsDays}>
            <SelectTrigger className="w-full h-11 rounded-lg bg-white border-slate-200 focus:ring-0 shadow-sm font-medium text-slate-700">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent className="rounded-lg border-slate-200 shadow-lg">
              <SelectItem value="7">Próximos 7 dias</SelectItem>
              <SelectItem value="30">Próximos 30 dias</SelectItem>
              <SelectItem value="60">Próximos 60 dias</SelectItem>
              <SelectItem value="90">Próximos 90 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-8 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Carregando alertas...
            </div>
          )}

          {!loading && filteredAlerts.length === 0 && (
            <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-slate-200">
              <p className="text-sm font-medium">Nenhum vencimento encontrado.</p>
            </div>
          )}

          {!loading && filteredAlerts.map(alert => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between border-b pb-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-rose-600 flex items-center justify-center text-white shadow-sm">
            <Clock className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Vencimentos de Contratos</h1>
            <p className="text-sm text-slate-500 font-medium">Monitore prazos e evite expirações indesejadas</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
            <Input 
              placeholder="Buscar documento..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 w-full sm:w-64 h-11 rounded-lg bg-white border-slate-200 focus:border-slate-400 focus:ring-0 transition-all shadow-sm"
            />
          </div>

          <Select value={filterSectorId} onValueChange={setFilterSectorId}>
            <SelectTrigger className="w-full sm:w-52 h-11 rounded-lg bg-white border-slate-200 focus:ring-0 shadow-sm font-medium text-slate-700">
              <SelectValue placeholder="Filtrar setor" />
            </SelectTrigger>
            <SelectContent className="rounded-lg border-slate-200 shadow-lg">
              <SelectItem value="all">Todos os setores</SelectItem>
              {sectors.map(sector => (
                <SelectItem key={sector.id} value={sector.id}>
                  {sector.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={alertsDays} onValueChange={setAlertsDays}>
            <SelectTrigger className="w-full sm:w-52 h-11 rounded-lg bg-white border-slate-200 focus:ring-0 shadow-sm font-medium text-slate-700">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent className="rounded-lg border-slate-200 shadow-lg">
              <SelectItem value="7">Próximos 7 dias</SelectItem>
              <SelectItem value="30">Próximos 30 dias</SelectItem>
              <SelectItem value="60">Próximos 60 dias</SelectItem>
              <SelectItem value="90">Próximos 90 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border border-slate-200 shadow-md bg-white rounded-xl overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/80">
                <TableRow className="hover:bg-transparent border-slate-200">
                  <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Documento</TableHead>
                  <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Setor</TableHead>
                  <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Vencimento</TableHead>
                  <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Origem</TableHead>
                  <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Tamanho</TableHead>
                  <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Status</TableHead>
                  <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12 text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="px-6 py-12 text-center">
                      <div className="flex items-center justify-center gap-2 text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Carregando alertas...
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {!loading && filteredAlerts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      Nenhum vencimento encontrado para o período selecionado.
                    </TableCell>
                  </TableRow>
                )}

                {!loading && filteredAlerts.map(alert => {
                  const extensionLabel = alert.extension ? alert.extension.replace('.', '') : '';
                  const sectorLabel = alert.sector_id ? sectorNameById[alert.sector_id] || 'Sem setor' : 'Sem setor';
                  const contractDateLabel = alert.contract_renewed_until || alert.contract_end_date;
                  const originLabel = alert.expiration_source === 'CONTRACT' ? 'Contrato' : 'Documento';
                  const showContractDateDiff = contractDateLabel && formatDate(contractDateLabel) !== formatDate(alert.contract_expires_at);
                  return (
                    <TableRow key={alert.id} className="border-slate-100 hover:bg-slate-50/80 group transition-colors">
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-slate-100 text-slate-400 group-hover:bg-white group-hover:text-slate-600 transition-all border border-transparent group-hover:border-slate-200">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-slate-900 group-hover:text-slate-950 transition-colors">
                              {alert.name}{extensionLabel ? `.${extensionLabel}` : ''}
                            </span>
                            <span className="text-[11px] text-slate-500 font-medium">
                              {alert.document_type || 'Sem tipo de documento'}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <span className="text-xs font-semibold text-slate-700">{sectorLabel}</span>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center gap-2 text-[12px] text-slate-800 font-bold tabular-nums">
                          <Calendar className="h-3.5 w-3.5 text-slate-400" />
                          <span>{formatDate(alert.contract_expires_at)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex flex-col text-[11px] text-slate-600 font-semibold">
                          <span>{originLabel}</span>
                          {showContractDateDiff ? (
                            <span className="text-slate-500">Fim contrato: {formatDate(contractDateLabel)}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <span className="text-xs font-medium text-slate-600 tabular-nums">{formatBytes(alert.size)}</span>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <div className="flex items-center">
                          <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-tight border ${
                            alert.is_expired 
                              ? 'bg-rose-50 text-rose-700 border-rose-100' 
                              : 'bg-amber-50 text-amber-700 border-amber-100'
                          }`}>
                            {alert.is_expired ? 'Vencido' : 'Próximo'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all"
                            onClick={() => navigate(`/documents/view/${alert.id}`)}
                            title="Visualizar documento"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {alert.can_edit && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 transition-all"
                                onClick={() => openRenewModal(alert)}
                                title="Renovar vencimento"
                              >
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-lg text-rose-600 hover:text-rose-700 hover:bg-rose-50 transition-all"
                                onClick={() => openDiscardModal(alert)}
                                title="Descartar documento"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isRenewOpen} onOpenChange={setIsRenewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renovar vencimento</DialogTitle>
            <DialogDescription>
              Defina a nova data de vencimento para o documento selecionado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500">Nova data</p>
            <Input
              type="date"
              value={renewDate}
              onChange={(e) => setRenewDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsRenewOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleRenew} disabled={renewing} className="text-white">
              {renewing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Renovar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDiscardOpen} onOpenChange={setIsDiscardOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Descartar documento</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja descartar <span className="font-bold text-slate-900">{discardAlert?.name}</span>? 
              O arquivo será movido para a lixeira.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDiscardOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDiscard} disabled={discarding} className="text-white">
              {discarding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
