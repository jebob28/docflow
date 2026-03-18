import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, Search, Calendar, Loader2, Edit2, Trash2, Upload, CheckCircle2, ChevronDown, XCircle, Eye, Zap, Clock, ClipboardList, PenLine, BarChart3, RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Drawer, Form, Input as AntInput, Select as AntSelect, Switch as AntSwitch, Space, Typography, ConfigProvider } from 'antd';
const { Title, Text } = Typography;
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Contract {
  id: string;
  title: string;
  description?: string | null;
  counterparty_name?: string | null;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  value_amount?: number | null;
  currency?: string | null;
  owner_name?: string | null;
  sector_name?: string | null;
  sector_id?: string | null;
  folder_id?: string | null;
  is_confidential?: boolean;
  can_edit?: boolean;
  is_expired?: boolean;
  document_id?: string | null;
  signed_document_id?: string | null;
  signed_at?: string | null;
}

interface Folder {
  id: string;
  name: string;
  parent_id?: string;
  sector_id?: string;
}

interface Sector {
  id: string;
  name: string;
}

interface ContractObligation {
  id: string;
  title: string;
  description?: string | null;
  obligation_type: string;
  due_date?: string | null;
  status: string;
  amount?: number | null;
  currency?: string | null;
  reminder_days?: number | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface ContractSignature {
  id: string;
  provider: string;
  signer_name?: string | null;
  signer_email?: string | null;
  external_id?: string | null;
  signing_url?: string | null;
  status: string;
  signed_at?: string | null;
  signed_hash?: string | null;
  document_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface ContractAnalytics {
  total_contracts: number;
  status_counts: Record<string, number>;
  obligations_pending: number;
  obligations_overdue: number;
  approvals_pending: number;
  signatures_pending: number;
  renewals_due: number;
  avg_approval_hours?: number | null;
}

const statusOptions = [
  { value: 'ALL', label: 'Todos' },
  { value: 'DRAFT', label: 'Rascunho' },
  { value: 'IN_REVIEW', label: 'Em Revisão' },
  { value: 'ACTIVE', label: 'Ativo' },
  { value: 'SUSPENDED', label: 'Suspenso' },
  { value: 'EXPIRED', label: 'Expirado' },
  { value: 'TERMINATED', label: 'Encerrado' },
];

const editableStatusOptions = statusOptions.filter(option => option.value !== 'ALL');

const statusLabelMap: Record<string, string> = {
  DRAFT: 'Rascunho',
  IN_REVIEW: 'Em Revisão',
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  EXPIRED: 'Expirado',
  TERMINATED: 'Encerrado',
};

const statusStyleMap: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border border-slate-200',
  IN_REVIEW: 'bg-amber-100 text-amber-800 border border-amber-200',
  ACTIVE: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  SUSPENDED: 'bg-orange-100 text-orange-800 border border-orange-200',
  EXPIRED: 'bg-rose-100 text-rose-800 border border-rose-200',
  TERMINATED: 'bg-purple-100 text-purple-800 border border-purple-200',
};

export default function Contracts() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<'contracts' | 'obligations' | 'signatures' | 'analytics'>('contracts');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedSectorId, setSelectedSectorId] = useState<string>('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [isConfidential, setIsConfidential] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterSectorId, setFilterSectorId] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [deletingContract, setDeletingContract] = useState<Contract | null>(null);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isPWA, setIsPWA] = useState(false);

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

  const [selectedObligationContractId, setSelectedObligationContractId] = useState('');
  const [obligations, setObligations] = useState<ContractObligation[]>([]);
  const [obligationsLoading, setObligationsLoading] = useState(false);
  const [isObligationOpen, setIsObligationOpen] = useState(false);
  const [isObligationEditOpen, setIsObligationEditOpen] = useState(false);
  const [editingObligation, setEditingObligation] = useState<ContractObligation | null>(null);
  const [obligationFormData, setObligationFormData] = useState({
    title: '',
    description: '',
    obligation_type: 'GENERAL',
    due_date: '',
    status: 'PENDING',
    amount: '',
    currency: 'BRL',
    reminder_days: '15',
  });
  const [selectedSignatureContractId, setSelectedSignatureContractId] = useState('');
  const [signatures, setSignatures] = useState<ContractSignature[]>([]);
  const [signaturesLoading, setSignaturesLoading] = useState(false);
  const [isSignatureOpen, setIsSignatureOpen] = useState(false);
  const [isUploadSignedOpen, setIsUploadSignedOpen] = useState(false);
  const [selectedUploadSignatureId, setSelectedUploadSignatureId] = useState<string | null>(null);
  const [selectedUploadContractId, setSelectedUploadContractId] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [signatureFormData, setSignatureFormData] = useState({
    provider: '',
    signer_name: '',
    signer_email: '',
    signing_url: '',
    external_id: ''
  });
  const [analytics, setAnalytics] = useState<ContractAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    counterparty_name: '',
    status: 'DRAFT',
    start_date: '',
    end_date: '',
    value_amount: '',
    currency: 'BRL',
    sector_id: 'none',
    folder_id: 'none',
    new_folder_name: '',
    is_confidential: false,
  });

  const [editFormData, setEditFormData] = useState({
    title: '',
    description: '',
    counterparty_name: '',
    status: 'DRAFT',
    start_date: '',
    end_date: '',
    value_amount: '',
    currency: 'BRL',
    sector_id: 'none',
    folder_id: 'none',
    new_folder_name: '',
    is_confidential: false,
  });

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (filterStatus !== 'ALL') {
        params.set('status', filterStatus);
      }
      if (filterSectorId !== 'all') {
        params.set('sector_id', filterSectorId);
      }
      if (searchTerm.trim()) {
        params.set('q', searchTerm.trim());
      }
      const queryString = params.toString();
      const response = await fetch(`/api/v1/contracts${queryString ? `?${queryString}` : ''}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data: Contract[] = await response.json();
        setContracts(data || []);
      } else {
        toast.error('Erro ao carregar contratos');
      }
    } catch (error) {
      console.error('Erro ao buscar contratos:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterSectorId, searchTerm]);

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

  const fetchFolders = async (sectorId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents?sector_id=${sectorId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setFolders(data.folders || []);
      }
    } catch (error) {
      console.error('Erro ao carregar pastas:', error);
    }
  };

  const fetchObligations = useCallback(async (contractId: string) => {
    if (!contractId) {
      setObligations([]);
      return;
    }
    setObligationsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/contracts/${contractId}/obligations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data: ContractObligation[] = await response.json();
        setObligations(data || []);
      } else {
        toast.error('Erro ao carregar obrigações');
      }
    } catch (error) {
      console.error('Erro ao buscar obrigações:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setObligationsLoading(false);
    }
  }, []);

  const fetchSignatures = useCallback(async (contractId: string) => {
    if (!contractId) {
      setSignatures([]);
      return;
    }
    setSignaturesLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/contracts/${contractId}/signatures`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data: ContractSignature[] = await response.json();
        setSignatures(data || []);
      } else {
        toast.error('Erro ao carregar assinaturas');
      }
    } catch (error) {
      console.error('Erro ao buscar assinaturas:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setSignaturesLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/contracts/analytics', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data: ContractAnalytics = await response.json();
        setAnalytics(data);
      } else {
        toast.error('Erro ao carregar analytics');
      }
    } catch (error) {
      console.error('Erro ao buscar analytics:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContracts();
  }, [fetchContracts]);

  useEffect(() => {
    fetchSectors();
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  useEffect(() => {
    if (selectedObligationContractId) {
      fetchObligations(selectedObligationContractId);
    }
  }, [selectedObligationContractId, fetchObligations]);

  useEffect(() => {
    if (selectedSignatureContractId) {
      fetchSignatures(selectedSignatureContractId);
    }
  }, [selectedSignatureContractId, fetchSignatures]);

  const formatDate = (value?: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}/${month}/${year}`;
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? '-'
      : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  };

  const formatCurrency = (value?: number | null, currency?: string | null) => {
    if (value === null || value === undefined) return '-';
    const formatter = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'BRL'
    });
    return formatter.format(value);
  };

  const handleCreate = async () => {
    if (!formData.title.trim()) {
      toast.error('Informe o título do contrato');
      return;
    }
    setCreating(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/contracts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: formData.title.trim(),
          description: formData.description.trim() || null,
          counterparty_name: formData.counterparty_name.trim() || null,
          status: formData.status,
          start_date: formData.start_date || null,
          end_date: formData.end_date || null,
          value_amount: formData.value_amount ? Number(formData.value_amount) : null,
          currency: formData.currency || 'BRL',
          sector_id: formData.sector_id !== 'none' ? formData.sector_id : null,
          folder_id: formData.folder_id !== 'none' ? formData.folder_id : null,
          new_folder_name: formData.new_folder_name.trim() || null,
          is_confidential: formData.is_confidential
        })
      });

      if (response.ok) {
        toast.success('Contrato criado com sucesso');
        setIsCreateOpen(false);
        setFormData({
          title: '',
          description: '',
          counterparty_name: '',
          status: 'DRAFT',
          start_date: '',
          end_date: '',
          value_amount: '',
          currency: 'BRL',
          sector_id: 'none',
          folder_id: 'none',
          new_folder_name: '',
          is_confidential: false,
        });
        fetchContracts();
      } else {
        toast.error('Erro ao criar contrato');
      }
    } catch (error) {
      console.error('Erro ao criar contrato:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setCreating(false);
    }
  };

  const formatDateInput = (value?: string | null) => {
    if (!value) return '';
    return value.slice(0, 10);
  };

  const openEditModal = (contract: Contract) => {
    setEditingContract(contract);
    setEditFormData({
      title: contract.title || '',
      description: contract.description || '',
      counterparty_name: contract.counterparty_name || '',
      status: contract.status || 'DRAFT',
      start_date: formatDateInput(contract.start_date),
      end_date: formatDateInput(contract.end_date),
      value_amount: contract.value_amount !== null && contract.value_amount !== undefined ? String(contract.value_amount) : '',
      currency: contract.currency || 'BRL',
      sector_id: contract.sector_id || 'none',
      folder_id: contract.folder_id || 'none',
      new_folder_name: '',
      is_confidential: contract.is_confidential || false
    });
    if (contract.sector_id) {
      fetchFolders(contract.sector_id);
    } else {
      setFolders([]);
    }
    setIsEditOpen(true);
  };

  const handleUpdate = async () => {
    if (!editingContract) return;
    if (!editFormData.title.trim()) {
      toast.error('Informe o título do contrato');
      return;
    }
    setUpdating(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/contracts/${editingContract.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: editFormData.title.trim(),
          description: editFormData.description.trim() || null,
          counterparty_name: editFormData.counterparty_name.trim() || null,
          status: editFormData.status,
          start_date: editFormData.start_date || null,
          end_date: editFormData.end_date || null,
          value_amount: editFormData.value_amount ? Number(editFormData.value_amount) : null,
          currency: editFormData.currency || 'BRL',
          sector_id: editFormData.sector_id !== 'none' ? editFormData.sector_id : null,
          folder_id: editFormData.folder_id !== 'none' ? editFormData.folder_id : null,
          new_folder_name: editFormData.new_folder_name.trim() || null,
          is_confidential: editFormData.is_confidential
        })
      });

      if (response.ok) {
        toast.success('Contrato atualizado');
        setIsEditOpen(false);
        fetchContracts();
      } else {
        toast.error('Erro ao atualizar contrato');
      }
    } catch (error) {
      console.error('Erro ao atualizar contrato:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingContract) return;
    setDeleting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/contracts/${deletingContract.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success('Contrato excluído');
        setIsDeleteOpen(false);
        fetchContracts();
      } else {
        toast.error('Erro ao excluir contrato');
      }
    } catch (error) {
      console.error('Erro ao excluir contrato:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setDeleting(false);
    }
  };

  const handleObligationCreate = async () => {
    if (!selectedObligationContractId) {
      toast.error('Selecione um contrato');
      return;
    }
    if (!obligationFormData.title.trim()) {
      toast.error('Informe o título da obrigação');
      return;
    }
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/contracts/${selectedObligationContractId}/obligations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: obligationFormData.title.trim(),
          description: obligationFormData.description.trim() || null,
          obligation_type: obligationFormData.obligation_type,
          due_date: obligationFormData.due_date || null,
          status: obligationFormData.status,
          amount: obligationFormData.amount ? Number(obligationFormData.amount) : null,
          currency: obligationFormData.currency || 'BRL',
          reminder_days: obligationFormData.reminder_days ? Number(obligationFormData.reminder_days) : 15
        })
      });
      if (response.ok) {
        toast.success('Obrigação criada');
        setIsObligationOpen(false);
        setObligationFormData({
          title: '',
          description: '',
          obligation_type: 'GENERAL',
          due_date: '',
          status: 'PENDING',
          amount: '',
          currency: 'BRL',
          reminder_days: '15',
        });
        fetchObligations(selectedObligationContractId);
      } else {
        toast.error('Erro ao criar obrigação');
      }
    } catch (error) {
      console.error('Erro ao criar obrigação:', error);
      toast.error('Erro ao conectar com o servidor');
    }
  };

  const openObligationEdit = (obligation: ContractObligation) => {
    setEditingObligation(obligation);
    setObligationFormData({
      title: obligation.title || '',
      description: obligation.description || '',
      obligation_type: obligation.obligation_type || 'GENERAL',
      due_date: formatDateInput(obligation.due_date),
      status: obligation.status || 'PENDING',
      amount: obligation.amount !== null && obligation.amount !== undefined ? String(obligation.amount) : '',
      currency: obligation.currency || 'BRL',
      reminder_days: obligation.reminder_days !== null && obligation.reminder_days !== undefined ? String(obligation.reminder_days) : '15',
    });
    setIsObligationEditOpen(true);
  };

  const handleObligationUpdate = async () => {
    if (!editingObligation || !selectedObligationContractId) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/contracts/${selectedObligationContractId}/obligations/${editingObligation.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: obligationFormData.title.trim(),
          description: obligationFormData.description.trim() || null,
          obligation_type: obligationFormData.obligation_type,
          due_date: obligationFormData.due_date || null,
          status: obligationFormData.status,
          amount: obligationFormData.amount ? Number(obligationFormData.amount) : null,
          currency: obligationFormData.currency || 'BRL',
          reminder_days: obligationFormData.reminder_days ? Number(obligationFormData.reminder_days) : 15
        })
      });
      if (response.ok) {
        toast.success('Obrigação atualizada');
        setIsObligationEditOpen(false);
        fetchObligations(selectedObligationContractId);
      } else {
        toast.error('Erro ao atualizar obrigação');
      }
    } catch (error) {
      console.error('Erro ao atualizar obrigação:', error);
      toast.error('Erro ao conectar com o servidor');
    }
  };

  const handleObligationDelete = async (obligationId: string) => {
    if (!selectedObligationContractId) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/contracts/${selectedObligationContractId}/obligations/${obligationId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        toast.success('Obrigação excluída');
        fetchObligations(selectedObligationContractId);
      } else {
        toast.error('Erro ao excluir obrigação');
      }
    } catch (error) {
      console.error('Erro ao excluir obrigação:', error);
      toast.error('Erro ao conectar com o servidor');
    }
  };

  const handleSignatureCreate = async () => {
    if (!selectedSignatureContractId) {
      toast.error('Selecione um contrato');
      return;
    }
    if (!signatureFormData.provider.trim()) {
      toast.error('Informe o fornecedor');
      return;
    }
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/contracts/${selectedSignatureContractId}/signatures`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          provider: signatureFormData.provider.trim(),
          signer_name: signatureFormData.signer_name.trim() || undefined,
          signer_email: signatureFormData.signer_email.trim() || undefined,
          signing_url: signatureFormData.signing_url.trim() || undefined,
          external_id: signatureFormData.external_id.trim() || undefined
        })
      });
      if (response.ok) {
        toast.success('Assinatura criada');
        setIsSignatureOpen(false);
        setSignatureFormData({
          provider: '',
          signer_name: '',
          signer_email: '',
          signing_url: '',
          external_id: ''
        });
        fetchSignatures(selectedSignatureContractId);
      } else {
        toast.error('Erro ao criar assinatura');
      }
    } catch (error) {
      console.error('Erro ao criar assinatura:', error);
      toast.error('Erro ao conectar com o servidor');
    }
  };

  const handleSignatureStatus = async (signatureId: string, status: string) => {
    if (!selectedSignatureContractId) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/contracts/${selectedSignatureContractId}/signatures/${signatureId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status,
          signed_at: status === 'SIGNED' ? new Date().toISOString() : undefined
        })
      });
      if (response.ok) {
        toast.success('Assinatura atualizada');
        fetchSignatures(selectedSignatureContractId);
      } else {
        toast.error('Erro ao atualizar assinatura');
      }
    } catch (error) {
      console.error('Erro ao atualizar assinatura:', error);
      toast.error('Erro ao conectar com o servidor');
    }
  };

  const handleUploadSigned = async () => {
    if (!uploadFile || !selectedUploadContractId) {
      toast.error('Selecione um arquivo');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', uploadFile);
    if (selectedUploadSignatureId) {
      formData.append('signature_id', selectedUploadSignatureId);
    }

    if (selectedSectorId) {
      formData.append('sector_id', selectedSectorId);
    }
    if (selectedFolderId && selectedFolderId !== 'root') {
      formData.append('folder_id', selectedFolderId);
    }
    if (newFolderName) {
      formData.append('new_folder_name', newFolderName);
    }
    if (isConfidential) {
      formData.append('is_confidential', 'true');
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/contracts/${selectedUploadContractId}/upload-signed`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (response.ok) {
        toast.success('Contrato assinado enviado com sucesso');
        setIsUploadSignedOpen(false);
        setUploadFile(null);
        setSelectedUploadSignatureId(null);
        setSelectedSectorId('');
        setSelectedFolderId('');
        setNewFolderName('');
        setIsConfidential(false);
        if (selectedSignatureContractId) {
          fetchSignatures(selectedSignatureContractId);
        }
        fetchContracts();
      } else {
        const errorData = await response.json();
        toast.error(errorData.message || 'Erro ao enviar contrato assinado');
      }
    } catch (error) {
      console.error('Erro no upload:', error);
      toast.error('Erro ao conectar com o servidor');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAnalyticsExport = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/contracts/analytics/export', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        toast.error('Erro ao exportar relatório');
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'contract-analytics.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro ao exportar relatório:', error);
      toast.error('Erro ao conectar com o servidor');
    }
  };

  const statusCounts = useMemo(() => {
    return contracts.reduce<Record<string, number>>((acc, contract) => {
      acc[contract.status] = (acc[contract.status] || 0) + 1;
      return acc;
    }, {});
  }, [contracts]);

  const getStatusBadge = (status: string, showChevron = false) => {
    return (
      <div className={`inline-flex items-center gap-2 px-2.5 py-0.5 rounded-md text-[11px] font-semibold tracking-tight ${statusStyleMap[status] || 'bg-slate-100  text-slate-700'}`}>
        {statusLabelMap[status] || status}
        {showChevron && <ChevronDown className="h-3 w-3 opacity-50" />}
      </div>
    );
  };

  const ContractCard = ({ contract }: { contract: Contract }) => (
    <Card className="p-2 border border-slate-200 shadow-sm bg-white rounded-md mb-2 hover:shadow-md transition-shadow w-full max-w-full overflow-hidden">
      <div className="flex justify-between items-start gap-2 mb-1.5">
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold text-slate-900 leading-tight truncate">{contract.title}</span>
          <span className="text-[11px] text-slate-500 font-medium truncate">{contract.counterparty_name || 'Sem contraparte'}</span>
        </div>
        <div className="shrink-0">
          {getStatusBadge(contract.status)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 mb-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Setor</span>
          <span className="text-[11px] font-semibold text-slate-700 truncate">{contract.sector_name || 'Sem setor'}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Valor</span>
          <span className="text-[11px] font-bold text-slate-900">
            {formatCurrency(contract.value_amount, contract.currency)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Período</span>
          <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
            <Calendar className="h-2.5 w-2.5 text-slate-400" />
            <span>{formatDate(contract.end_date)}</span>
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Vínculo</span>
          {contract.document_id ? (
            <div className="flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-2.5 w-2.5" />
              <span className="text-[10px] font-bold uppercase">Sim</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-slate-400">
              <XCircle className="h-2.5 w-2.5" />
              <span className="text-[10px] font-bold uppercase">Não</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
        <div className="flex items-center gap-1">
          {contract.can_edit ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100"
                onClick={() => openEditModal(contract)}
              >
                <Edit2 className="h-3 w-3" />
              </Button>
              {contract.document_id && !contract.signed_document_id && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md text-slate-400 hover:text-blue-600"
                  onClick={() => navigate(`/documents/view/${contract.document_id}`)}
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              )}
              {contract.signed_document_id ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md text-slate-400 hover:text-emerald-600"
                  onClick={() => navigate(`/documents/view/${contract.signed_document_id}`)}
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md text-slate-400 hover:text-blue-600"
                  onClick={() => {
                    setSelectedUploadContractId(contract.id);
                    setSelectedUploadSignatureId(null);
                    setSelectedSectorId(contract.sector_id || '');
                    setSelectedFolderId(contract.folder_id || 'root');
                    setIsConfidential(contract.is_confidential || false);
                    if (contract.sector_id) {
                      fetchFolders(contract.sector_id);
                    }
                    setIsUploadSignedOpen(true);
                  }}
                >
                  <Upload className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md text-slate-400 hover:text-rose-600"
                onClick={() => {
                  setDeletingContract(contract);
                  setIsDeleteOpen(true);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest px-2">Somente leitura</span>
          )}
        </div>
        <div className="text-[10px] text-slate-400 font-medium italic truncate max-w-[80px]">{contract.owner_name || 'Sistema'}</div>
      </div>
    </Card>
  );


  const isMobilePwa = isPWA && !isDesktop;

  const pwaContent = (
    <div
      className="w-full min-h-screen bg-slate-50/50 px-3 pt-3 space-y-3 overflow-x-hidden"
      style={{
        '--border': '214.3 31.8% 91.4%',
        '--input': '214.3 31.8% 91.4%',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 120px)',
      } as React.CSSProperties}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-md bg-slate-900 flex items-center justify-center text-white shadow-sm shrink-0">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-bold text-slate-900 tracking-tight">Gestão de Contratos</h1>
          <p className="text-xs leading-snug text-slate-500 font-medium">Controle e acompanhamento de prazos e conformidade</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="relative group min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
          <Input
            placeholder="Buscar contrato..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 w-full h-10 rounded-md bg-white border-slate-200 focus:border-slate-400 focus:ring-0 transition-all shadow-sm text-sm"
          />
        </div>

        <AntSelect 
          value={filterSectorId} 
          onChange={setFilterSectorId}
          placeholder="Setor"
          className="w-full h-10"
          options={[
            { value: 'all', label: 'Todos os setores' },
            { value: 'none', label: 'Sem setor' },
            ...sectors.map(sector => ({ value: sector.id, label: sector.name }))
          ]}
        />
      </div>

      <div className="w-full">
        <div className="flex flex-wrap items-center gap-2 bg-slate-900 p-2 rounded-md border border-slate-800 shadow-sm">
          {statusOptions.map(option => (
            <Button
              key={option.value}
              variant={filterStatus === option.value ? 'default' : 'ghost'}
              onClick={() => setFilterStatus(option.value)}
              className={`h-8 rounded-sm px-2.5 font-semibold text-xs transition-all whitespace-nowrap ${filterStatus === option.value
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
            >
              {option.label}
              {option.value !== 'ALL' && statusCounts[option.value] ? (
                <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded-sm ${filterStatus === option.value ? 'bg-slate-100 text-slate-600' : 'bg-slate-800 text-slate-400'
                  }`}>
                  {statusCounts[option.value]}
                </span>
              ) : null}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500 bg-white rounded-md border border-slate-200">
            <Loader2 className="h-8 w-8 animate-spin mb-4 text-slate-400" />
            <p className="text-sm font-medium">Carregando contratos...</p>
          </div>
        ) : contracts.length === 0 ? (
          <div className="text-center py-12 text-slate-500 bg-white rounded-md border border-slate-200">
            <p className="text-sm font-medium">Nenhum contrato encontrado.</p>
          </div>
        ) : (
          contracts.map(contract => (
            <ContractCard key={contract.id} contract={contract} />
          ))
        )}
      </div>

      <Button
        onClick={() => setIsCreateOpen(true)}
        className="fixed right-6 h-14 w-14 rounded-full shadow-2xl z-40 transition-all active:scale-95 flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-white p-0"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 7rem)' }}
      >
        <Plus className="h-6 w-6" />
      </Button>
    </div>
  );

  // ─── DESKTOP CONTENT ────────────────────────────────────────────

  const subNavItems = [
    { id: 'contracts' as const, label: 'Gestão de Contratos', icon: FileText, desc: 'Todos os contratos' },
    { id: 'obligations' as const, label: 'Obrigações', icon: ClipboardList, desc: 'Entregas e marcos' },
    { id: 'signatures' as const, label: 'Assinaturas', icon: PenLine, desc: 'Fluxo eletrônico' },
    { id: 'analytics' as const, label: 'Analytics', icon: BarChart3, desc: 'Indicadores' },
  ];

  const SubNav = () => (
    <nav className="w-full border-b border-slate-100 bg-white px-8">
      <div className="flex items-center gap-1 max-w-7xl mx-auto">
        {subNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={cn(
                'relative flex items-center gap-2 px-4 py-4 transition-all text-sm font-medium',
                isActive
                  ? 'text-slate-900 border-b-2 border-slate-900'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-slate-900' : 'text-slate-400')} />
              <span>{item.label}</span>
              {isActive && (
                <div className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-slate-900" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );

  const desktopContent = (
    <div
      className="flex flex-col h-full w-full min-w-0"
      style={{
        '--border': '214.3 31.8% 91.4%',
        '--input': '214.3 31.8% 91.4%',
        ...(!isDesktop ? { paddingBottom: 'calc(env(safe-area-inset-bottom) + 120px)' } : {}),
      } as React.CSSProperties}
    >
      {/* ── Page Header ── */}
      <div className="shrink-0 bg-white">
        <div className="flex items-center justify-between px-8 py-5 w-full max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-md bg-slate-900 flex items-center justify-center shadow-sm">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Contratos</h1>
              <p className="text-xs text-slate-400 font-medium mt-0.5">
                {subNavItems.find(n => n.id === activeSection)?.label}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
              <Input
                placeholder="Buscar contrato..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-64 h-10 rounded-md bg-slate-50 border-slate-200 focus:border-slate-400 focus:ring-0 transition-all shadow-sm text-sm"
              />
            </div>
            {activeSection === 'contracts' && (
              <Button
                onClick={() => setIsCreateOpen(true)}
                className="h-10 rounded-md px-5 font-semibold text-sm text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-sm"
              >
                <Plus className="h-4 w-4 mr-2" />
                Novo Contrato
              </Button>
            )}
            {activeSection === 'obligations' && (
              <Button
                onClick={() => setIsObligationOpen(true)}
                className="h-10 rounded-md px-5 font-semibold text-sm text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-sm"
              >
                <Plus className="h-4 w-4 mr-2" />
                Nova Obrigação
              </Button>
            )}
            {activeSection === 'signatures' && (
              <Button
                onClick={() => setIsSignatureOpen(true)}
                className="h-10 rounded-md px-5 font-semibold text-sm text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-sm"
              >
                <Plus className="h-4 w-4 mr-2" />
                Nova Assinatura
              </Button>
            )}
            {activeSection === 'analytics' && (
              <>
                <Button
                  variant="ghost"
                  className="h-10 rounded-md px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100 border border-slate-200"
                  onClick={fetchAnalytics}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-2" />
                  Atualizar
                </Button>
                <Button
                  className="h-10 rounded-md px-5 font-semibold text-sm text-white bg-slate-900 hover:bg-slate-800 shadow-sm"
                  onClick={handleAnalyticsExport}
                >
                  <Download className="h-3.5 w-3.5 mr-2" />
                  Exportar CSV
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Submenu superior (Tabs) ── */}
      <SubNav />

      {/* ── Body: Content Panel ── */}
      <div className="flex-1 overflow-y-auto bg-slate-50 min-w-0">
        <div className="p-8 space-y-6 w-full max-w-7xl mx-auto">

            {/* ── Section: Contracts ── */}
            {activeSection === 'contracts' && (
              <div className="space-y-4">
                {/* Sector filter + status bar */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <AntSelect 
                    value={filterSectorId} 
                    onChange={setFilterSectorId}
                    placeholder="Todos os setores"
                    className="w-full sm:w-52 h-10"
                    options={[
                      { value: 'all', label: 'Todos os setores' },
                      { value: 'none', label: 'Sem setor' },
                      ...sectors.map(sector => ({ value: sector.id, label: sector.name }))
                    ]}
                  />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {statusOptions.map(option => (
                      <button
                        key={option.value}
                        onClick={() => setFilterStatus(option.value)}
                        className={cn(
                          'h-8 px-3 rounded-md text-xs font-semibold transition-all border',
                          filterStatus === option.value
                            ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                            : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400 hover:text-slate-700'
                        )}
                      >
                        {option.label}
                        {option.value !== 'ALL' && statusCounts[option.value] ? (
                          <span className={cn('ml-1.5 text-[9px] px-1.5 py-0.5 rounded-sm', filterStatus === option.value ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500')}>
                            {statusCounts[option.value]}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Contracts table */}
                <Card className="border border-slate-200 shadow-sm bg-white rounded-md overflow-hidden">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-slate-50/80">
                          <TableRow className="hover:bg-transparent border-slate-200">
                            <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Contrato</TableHead>
                            <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Setor / Responsável</TableHead>
                            <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Período</TableHead>
                            <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Valor</TableHead>
                            <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Status</TableHead>
                            <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Vínculo</TableHead>
                            <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12 text-right">Ações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {loading && (
                            <TableRow>
                              <TableCell colSpan={7} className="px-6 py-12 text-center">
                                <div className="flex items-center justify-center gap-2 text-slate-500">
                                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                          {!loading && contracts.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={7} className="px-6 py-12 text-center text-slate-500">Nenhum contrato encontrado.</TableCell>
                            </TableRow>
                          )}
                          {!loading && contracts.map((contract) => (
                            <TableRow key={contract.id} className="border-slate-100 hover:bg-slate-50/80 group transition-colors">
                              <TableCell className="px-6 py-4">
                                <div className="flex flex-col">
                                  <span className="text-sm font-semibold text-slate-900">{contract.title}</span>
                                  <span className="text-[12px] text-slate-500 font-medium">{contract.counterparty_name || 'Sem contraparte'}</span>
                                </div>
                              </TableCell>
                              <TableCell className="px-6 py-4">
                                <div className="flex flex-col">
                                  <span className="text-xs font-semibold text-slate-700">{contract.sector_name || 'Sem setor'}</span>
                                  <span className="text-[11px] text-slate-400 font-medium italic">{contract.owner_name || 'Sistema'}</span>
                                </div>
                              </TableCell>
                              <TableCell className="px-6 py-4">
                                <div className="flex items-center gap-2 text-[12px] text-slate-600 font-medium">
                                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                                  <span>{formatDate(contract.start_date)} – {formatDate(contract.end_date)}</span>
                                </div>
                              </TableCell>
                              <TableCell className="px-6 py-4">
                                <span className="text-sm font-bold text-slate-900 tabular-nums">{formatCurrency(contract.value_amount, contract.currency)}</span>
                              </TableCell>
                              <TableCell className="px-6 py-4">
                                <div className="flex flex-col gap-1">
                                  <AntSelect
                                    value={contract.status}
                                    onChange={async (newStatus) => {
                                      try {
                                        const token = localStorage.getItem('token');
                                        const response = await fetch(`/api/v1/contracts/${contract.id}`, {
                                          method: 'PATCH',
                                          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ status: newStatus })
                                        });
                                        if (response.ok) { toast.success('Status atualizado'); fetchContracts(); }
                                        else { toast.error('Erro ao atualizar status'); }
                                      } catch { toast.error('Erro ao conectar com o servidor'); }
                                    }}
                                    className="h-fit w-fit border-none shadow-none bg-transparent"
                                    suffixIcon={null}
                                    variant="borderless"
                                    options={editableStatusOptions.map(option => ({
                                      value: option.value,
                                      label: getStatusBadge(option.value, true),
                                      className: "text-xs font-semibold py-2"
                                    }))}
                                  />
                                  {contract.is_expired && (
                                    <span className="text-[10px] font-bold uppercase tracking-tight text-rose-600 flex items-center gap-1">
                                      <span className="w-1 h-1 rounded-full bg-rose-600 animate-pulse" />Vencido
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="px-6 py-4">
                                {contract.document_id ? (
                                  <div className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                                    <CheckCircle2 className="h-3.5 w-3.5" /><span className="text-[10px] font-bold uppercase">Vinculado</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                                    <XCircle className="h-3.5 w-3.5" /><span className="text-[10px] font-bold uppercase whitespace-nowrap">Sem vínculo</span>
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {contract.can_edit ? (
                                    <>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all" onClick={() => openEditModal(contract)} title="Editar">
                                        <Edit2 className="h-3.5 w-3.5" />
                                      </Button>
                                      {contract.document_id && !contract.signed_document_id && (
                                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50" onClick={() => navigate(`/documents/view/${contract.document_id}`)} title="Visualizar rascunho">
                                          <Eye className="h-4 w-4" />
                                        </Button>
                                      )}
                                      {contract.signed_document_id ? (
                                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-50" onClick={() => navigate(`/documents/view/${contract.signed_document_id}`)} title="Ver assinado">
                                          <Eye className="h-4 w-4" />
                                        </Button>
                                      ) : (
                                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                                          onClick={() => {
                                            setSelectedUploadContractId(contract.id);
                                            setSelectedUploadSignatureId(null);
                                            setSelectedSectorId(contract.sector_id || '');
                                            setSelectedFolderId(contract.folder_id || 'root');
                                            setIsConfidential(contract.is_confidential || false);
                                            if (contract.sector_id) fetchFolders(contract.sector_id);
                                            setIsUploadSignedOpen(true);
                                          }} title="Upload assinado">
                                          <Upload className="h-4 w-4" />
                                        </Button>
                                      )}
                                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                        onClick={() => { setDeletingContract(contract); setIsDeleteOpen(true); }} title="Excluir">
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </>
                                  ) : (
                                    <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest px-2">Somente leitura</span>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── Section: Obligations ── */}
            {activeSection === 'obligations' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <AntSelect 
                    value={selectedObligationContractId} 
                    onChange={setSelectedObligationContractId}
                    placeholder="Selecionar contrato"
                    className="w-72 h-10"
                  >
                    {contracts.map(c => (
                      <AntSelect.Option key={c.id} value={c.id}>{c.title}</AntSelect.Option>
                    ))}
                  </AntSelect>
                </div>
                <Card className="border border-slate-200 shadow-sm bg-white rounded-md overflow-hidden">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-slate-50/80">
                        <TableRow className="hover:bg-transparent border-slate-200">
                          <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Obrigação</TableHead>
                          <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Tipo</TableHead>
                          <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Vencimento</TableHead>
                          <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Valor</TableHead>
                          <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Status</TableHead>
                          <TableHead className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12 text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {obligationsLoading && (
                          <TableRow><TableCell colSpan={6} className="px-6 py-12 text-center"><div className="flex items-center justify-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div></TableCell></TableRow>
                        )}
                        {!obligationsLoading && !selectedObligationContractId && (
                          <TableRow><TableCell colSpan={6} className="px-6 py-12 text-center text-slate-400 text-sm">Selecione um contrato acima para ver suas obrigações.</TableCell></TableRow>
                        )}
                        {!obligationsLoading && selectedObligationContractId && obligations.length === 0 && (
                          <TableRow><TableCell colSpan={6} className="px-6 py-12 text-center text-slate-500">Nenhuma obrigação registrada.</TableCell></TableRow>
                        )}
                        {!obligationsLoading && obligations.map(obligation => (
                          <TableRow key={obligation.id} className="border-slate-100 hover:bg-slate-50/80 transition-colors">
                            <TableCell className="px-6 py-4">
                              <div className="flex flex-col">
                                <span className="text-sm font-semibold text-slate-900">{obligation.title}</span>
                                <span className="text-[11px] text-slate-500 font-medium italic">{obligation.description || 'Sem descrição'}</span>
                              </div>
                            </TableCell>
                            <TableCell className="px-6 py-4"><span className="text-xs font-semibold text-slate-600">{obligation.obligation_type}</span></TableCell>
                            <TableCell className="px-6 py-4"><span className="text-xs font-bold text-slate-800 tabular-nums">{formatDate(obligation.due_date)}</span></TableCell>
                            <TableCell className="px-6 py-4"><span className="text-xs font-bold text-slate-900 tabular-nums">{formatCurrency(obligation.amount || null, obligation.currency || null)}</span></TableCell>
                            <TableCell className="px-6 py-4">
                              <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-tight border ${obligation.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : obligation.status === 'OVERDUE' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>
                                {obligation.status === 'COMPLETED' ? 'Concluída' : obligation.status === 'OVERDUE' ? 'Vencida' : 'Pendente'}
                              </span>
                            </TableCell>
                            <TableCell className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100" onClick={() => openObligationEdit(obligation)}>
                                  <Edit2 className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50" onClick={() => handleObligationDelete(obligation.id)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── Section: Signatures ── */}
            {activeSection === 'signatures' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <AntSelect 
                    value={selectedSignatureContractId} 
                    onChange={setSelectedSignatureContractId}
                    placeholder="Selecionar contrato"
                    className="w-72 h-10"
                  >
                    {contracts.map(c => (
                      <AntSelect.Option key={c.id} value={c.id}>{c.title}</AntSelect.Option>
                    ))}
                  </AntSelect>
                </div>
                <Card className="border border-slate-200 shadow-sm bg-white rounded-md overflow-hidden">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-slate-50/80">
                        <TableRow className="hover:bg-transparent border-slate-200">
                          <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Assinante</TableHead>
                          <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Provedor</TableHead>
                          <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Status</TableHead>
                          <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12">Assinado em</TableHead>
                          <TableHead className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-6 h-12 text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {signaturesLoading && (
                          <TableRow><TableCell colSpan={5} className="px-6 py-12 text-center"><div className="flex items-center justify-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div></TableCell></TableRow>
                        )}
                        {!signaturesLoading && !selectedSignatureContractId && (
                          <TableRow><TableCell colSpan={5} className="px-6 py-12 text-center text-slate-400 text-sm">Selecione um contrato acima para ver assinaturas.</TableCell></TableRow>
                        )}
                        {!signaturesLoading && selectedSignatureContractId && signatures.length === 0 && (
                          <TableRow><TableCell colSpan={5} className="px-6 py-12 text-center text-slate-500 font-medium italic">Nenhuma assinatura registrada.</TableCell></TableRow>
                        )}
                        {!signaturesLoading && signatures.map(signature => (
                          <TableRow key={signature.id} className="border-slate-100 hover:bg-slate-50/80 transition-colors">
                            <TableCell className="px-6 py-4">
                              <div className="flex flex-col">
                                <span className="text-sm font-semibold text-slate-900">{signature.signer_name || 'Sem nome'}</span>
                                <span className="text-[11px] text-slate-500 font-medium truncate max-w-[180px]">{signature.signer_email || 'Sem e-mail'}</span>
                              </div>
                            </TableCell>
                            <TableCell className="px-6 py-4"><span className="text-xs font-semibold text-slate-600">{signature.provider}</span></TableCell>
                            <TableCell className="px-6 py-4">
                              <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-tight border ${signature.status === 'SIGNED' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : signature.status === 'CANCELED' ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>
                                {signature.status === 'SIGNED' ? 'Assinado' : signature.status === 'CANCELED' ? 'Cancelado' : 'Pendente'}
                              </span>
                            </TableCell>
                            <TableCell className="px-6 py-4"><span className="text-xs font-bold text-slate-800 tabular-nums">{signature.signed_at ? formatDateTime(signature.signed_at) : '-'}</span></TableCell>
                            <TableCell className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {signature.signing_url && signature.status === 'PENDING' && (
                                  <Button variant="ghost" size="sm" className="h-8 px-3 rounded-md text-slate-600 hover:bg-slate-100 font-bold text-[11px] uppercase" onClick={() => window.open(signature.signing_url || '', '_blank')}>Abrir</Button>
                                )}
                                {signature.status !== 'SIGNED' && (
                                  <>
                                    <Button variant="ghost" size="sm" className="h-8 px-3 rounded-md text-emerald-700 hover:bg-emerald-50 font-bold text-[11px] uppercase" onClick={() => handleSignatureStatus(signature.id, 'SIGNED')}>Concluir</Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100" title="Upload assinado"
                                      onClick={() => {
                                        setSelectedUploadSignatureId(signature.id);
                                        setSelectedUploadContractId(selectedSignatureContractId);
                                        const c = contracts.find(c => c.id === selectedSignatureContractId);
                                        if (c) { setSelectedSectorId(c.sector_id || ''); setSelectedFolderId(c.folder_id || 'root'); setIsConfidential(c.is_confidential || false); if (c.sector_id) fetchFolders(c.sector_id); }
                                        setIsUploadSignedOpen(true);
                                      }}>
                                      <Upload className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                )}
                                {signature.status !== 'CANCELED' && (
                                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50" onClick={() => handleSignatureStatus(signature.id, 'CANCELED')} title="Cancelar">
                                    <XCircle className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── Section: Analytics ── */}
            {activeSection === 'analytics' && (
              <div className="space-y-6">
                {analyticsLoading && (
                  <div className="flex items-center gap-2 text-slate-500 py-16 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-xs font-medium italic">Processando indicadores...</span>
                  </div>
                )}
                {!analyticsLoading && analytics && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="p-5 rounded-md bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition-all">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total de contratos</p>
                        <div className="p-1.5 rounded-md bg-slate-50 border border-slate-100"><FileText className="h-3.5 w-3.5 text-slate-400" /></div>
                      </div>
                      <p className="text-3xl font-bold text-slate-900 tabular-nums">{analytics.total_contracts}</p>
                      <p className="text-[11px] text-slate-400 font-medium mt-1 italic">Base total cadastrada</p>
                    </div>
                    <div className="p-5 rounded-md bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition-all">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Obrigações pendentes</p>
                        <div className="p-1.5 rounded-md bg-slate-50 border border-slate-100"><Clock className="h-3.5 w-3.5 text-slate-400" /></div>
                      </div>
                      <p className="text-3xl font-bold text-slate-900 tabular-nums">{analytics.obligations_pending}</p>
                      <p className="text-[11px] text-slate-400 font-medium mt-1 italic">Aguardando execução</p>
                    </div>
                    <div className="p-5 rounded-md bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition-all relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-1 h-full bg-rose-500" />
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Obrigações vencidas</p>
                        <span className="px-2 py-0.5 rounded-md bg-rose-50 text-[10px] font-bold text-rose-600 border border-rose-100 uppercase">Atenção</span>
                      </div>
                      <p className="text-3xl font-bold text-rose-600 tabular-nums">{analytics.obligations_overdue}</p>
                      <p className="text-[11px] text-rose-400/80 font-medium mt-1 italic">Prazo expirado</p>
                    </div>
                    <div className="p-5 rounded-md bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition-all">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Aprovações pendentes</p>
                        <div className="p-1.5 rounded-md bg-slate-50 border border-slate-100"><CheckCircle2 className="h-3.5 w-3.5 text-slate-400" /></div>
                      </div>
                      <p className="text-3xl font-bold text-slate-900 tabular-nums">{analytics.approvals_pending}</p>
                      <p className="text-[11px] text-slate-400 font-medium mt-1 italic">Fluxos em aberto</p>
                    </div>
                    <div className="p-5 rounded-md bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition-all">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Assinaturas pendentes</p>
                        <div className="p-1.5 rounded-md bg-slate-50 border border-slate-100"><Edit2 className="h-3.5 w-3.5 text-slate-400" /></div>
                      </div>
                      <p className="text-3xl font-bold text-slate-900 tabular-nums">{analytics.signatures_pending}</p>
                      <p className="text-[11px] text-slate-400 font-medium mt-1 italic">Aguardando formalização</p>
                    </div>
                    <div className="p-5 rounded-md bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition-all relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-1 h-full bg-amber-400" />
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Renovações próximas</p>
                        <span className="px-2 py-0.5 rounded-md bg-amber-50 text-[10px] font-bold text-amber-600 border border-amber-100 uppercase">Monitorar</span>
                      </div>
                      <p className="text-3xl font-bold text-amber-600 tabular-nums">{analytics.renewals_due}</p>
                      <p className="text-[11px] text-amber-500/80 font-medium mt-1 italic">Próximos 30 dias</p>
                    </div>
                    <div className="p-6 rounded-md bg-slate-50/50 border border-slate-200 shadow-sm sm:col-span-2 lg:col-span-3">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 rounded-md bg-white border border-slate-200"><Zap className="h-3.5 w-3.5 text-amber-500" /></div>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Eficiência Operacional</p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Tempo médio de aprovação</p>
                          <div className="flex items-baseline gap-2">
                            <p className="text-3xl font-bold text-slate-900 tabular-nums">{analytics.avg_approval_hours !== null && analytics.avg_approval_hours !== undefined ? analytics.avg_approval_hours.toFixed(1) : '-'}</p>
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-tight">horas</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Distribuição por status</p>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(analytics.status_counts || {}).map(([status, count]) => (
                              <div key={status} className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-white border border-slate-200 shadow-sm">
                                <span className="text-[10px] font-bold text-slate-500 uppercase">{status}</span>
                                <span className="text-xs font-bold text-slate-900 tabular-nums">{count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>{/* /p-8 content */}
        </div>{/* /flex-1 scroll panel */}
    </div>
  );


  const sheets = (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 4,
          colorPrimary: '#0f172a',
        },
        components: {
          Drawer: {
            footerPaddingBlock: 16,
            footerPaddingInline: 24,
          }
        }
      }}
    >
      {/* ── Create Contract ── */}
      <Drawer
        title={<Title level={4} style={{ margin: 0 }}>Novo Contrato</Title>}
        placement="right"
        onClose={() => setIsCreateOpen(false)}
        open={isCreateOpen}
        size="large"
        mask={false}
        extra={
          <Space>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating} className="text-white">
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Criar contrato
            </Button>
          </Space>
        }
      >
        <Form layout="vertical" className="space-y-4">
          <Form.Item label={<Text strong className="text-slate-600">Título</Text>} required>
            <AntInput 
              value={formData.title} 
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))} 
              placeholder="Ex: Contrato de prestação de serviços" 
              className="h-10 rounded-md"
            />
          </Form.Item>
          
          <Form.Item label={<Text strong className="text-slate-600">Descrição</Text>}>
            <AntInput.TextArea 
              value={formData.description} 
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))} 
              placeholder="Escopo, cláusulas ou observações"
              rows={3}
              className="rounded-md"
            />
          </Form.Item>

          <Form.Item label={<Text strong className="text-slate-600">Contraparte</Text>}>
            <AntInput 
              value={formData.counterparty_name} 
              onChange={(e) => setFormData(prev => ({ ...prev, counterparty_name: e.target.value }))} 
              placeholder="Empresa ou cliente"
              className="h-10 rounded-md"
            />
          </Form.Item>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item label={<Text strong className="text-slate-600">Status</Text>}>
              <AntSelect 
                value={formData.status} 
                onChange={(v) => setFormData(prev => ({ ...prev, status: v }))}
                className="w-full h-10"
                options={editableStatusOptions}
              />
            </Form.Item>

            <Form.Item label={<Text strong className="text-slate-600">Setor</Text>}>
              <AntSelect 
                value={formData.sector_id} 
                onChange={(v) => { 
                  setFormData(prev => ({ ...prev, sector_id: v, folder_id: 'none' })); 
                  if (v !== 'none') fetchFolders(v); 
                  else setFolders([]); 
                }}
                className="w-full h-10"
                options={[
                  { value: 'none', label: 'Sem setor' },
                  ...sectors.map(s => ({ value: s.id, label: s.name }))
                ]}
              />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item label={<Text strong className="text-slate-600">Pasta</Text>}>
              <AntSelect 
                value={formData.folder_id} 
                onChange={(v) => setFormData(prev => ({ ...prev, folder_id: v }))} 
                disabled={formData.sector_id === 'none'}
                className="w-full h-10"
                options={[
                  { value: 'none', label: 'Pasta Raiz' },
                  ...folders.map(f => ({ value: f.id, label: f.name }))
                ]}
              />
            </Form.Item>

            <Form.Item label={<Text strong className="text-slate-600">Nova pasta</Text>}>
              <AntInput 
                value={formData.new_folder_name} 
                onChange={(e) => setFormData(prev => ({ ...prev, new_folder_name: e.target.value }))} 
                placeholder="Nome da nova pasta" 
                disabled={formData.sector_id === 'none'}
                className="h-10 rounded-md"
              />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item label={<Text strong className="text-slate-600">Início</Text>}>
              <AntInput 
                type="date" 
                value={formData.start_date} 
                onChange={(e) => setFormData(prev => ({ ...prev, start_date: e.target.value }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
            <Form.Item label={<Text strong className="text-slate-600">Fim</Text>}>
              <AntInput 
                type="date" 
                value={formData.end_date} 
                onChange={(e) => setFormData(prev => ({ ...prev, end_date: e.target.value }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Form.Item label={<Text strong className="text-slate-600">Valor</Text>}>
                <AntInput 
                  type="number" 
                  value={formData.value_amount} 
                  onChange={(e) => setFormData(prev => ({ ...prev, value_amount: e.target.value }))} 
                  placeholder="0,00"
                  prefix={<span className="text-slate-400">R$</span>}
                  className="h-10 rounded-md"
                />
              </Form.Item>
            </div>
            <Form.Item label={<Text strong className="text-slate-600">Moeda</Text>}>
              <AntInput 
                value={formData.currency} 
                onChange={(e) => setFormData(prev => ({ ...prev, currency: e.target.value.toUpperCase() }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-md bg-slate-50/50">
            <div className="space-y-0.5">
              <Text strong className="text-sm">Confidencial</Text>
              <p className="text-xs text-slate-500 m-0">Restringe o acesso a gestores</p>
            </div>
            <AntSwitch 
              checked={formData.is_confidential} 
              onChange={(v) => setFormData(prev => ({ ...prev, is_confidential: v }))} 
            />
          </div>
        </Form>
      </Drawer>

      {/* ── Edit Contract ── */}
      <Drawer
        title={<Title level={4} style={{ margin: 0 }}>Editar Contrato</Title>}
        placement="right"
        onClose={() => setIsEditOpen(false)}
        open={isEditOpen}
        size="large"
        mask={false}
        extra={
          <Space>
            <Button variant="ghost" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={updating} className="text-white">
              {updating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Salvar alterações
            </Button>
          </Space>
        }
      >
        <Form layout="vertical" className="space-y-4">
          <Form.Item label={<Text strong className="text-slate-600">Título</Text>} required>
            <AntInput 
              value={editFormData.title} 
              onChange={(e) => setEditFormData(prev => ({ ...prev, title: e.target.value }))} 
              className="h-10 rounded-md"
            />
          </Form.Item>
          
          <Form.Item label={<Text strong className="text-slate-600">Descrição</Text>}>
            <AntInput.TextArea 
              value={editFormData.description} 
              onChange={(e) => setEditFormData(prev => ({ ...prev, description: e.target.value }))} 
              rows={3}
              className="rounded-md"
            />
          </Form.Item>

          <Form.Item label={<Text strong className="text-slate-600">Contraparte</Text>}>
            <AntInput 
              value={editFormData.counterparty_name} 
              onChange={(e) => setEditFormData(prev => ({ ...prev, counterparty_name: e.target.value }))} 
              className="h-10 rounded-md"
            />
          </Form.Item>

          <Form.Item label={<Text strong className="text-slate-600">Status</Text>}>
            <AntSelect 
              value={editFormData.status} 
              onChange={(v) => setEditFormData(prev => ({ ...prev, status: v }))}
              className="w-full h-10"
              options={editableStatusOptions}
            />
          </Form.Item>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item label={<Text strong className="text-slate-600">Início</Text>}>
              <AntInput 
                type="date" 
                value={editFormData.start_date} 
                onChange={(e) => setEditFormData(prev => ({ ...prev, start_date: e.target.value }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
            <Form.Item label={<Text strong className="text-slate-600">Fim</Text>}>
              <AntInput 
                type="date" 
                value={editFormData.end_date} 
                onChange={(e) => setEditFormData(prev => ({ ...prev, end_date: e.target.value }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Form.Item label={<Text strong className="text-slate-600">Valor</Text>}>
                <AntInput 
                  type="number" 
                  value={editFormData.value_amount} 
                  onChange={(e) => setEditFormData(prev => ({ ...prev, value_amount: e.target.value }))} 
                  prefix={<span className="text-slate-400">R$</span>}
                  className="h-10 rounded-md"
                />
              </Form.Item>
            </div>
            <Form.Item label={<Text strong className="text-slate-600">Moeda</Text>}>
              <AntInput 
                value={editFormData.currency} 
                onChange={(e) => setEditFormData(prev => ({ ...prev, currency: e.target.value.toUpperCase() }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item label={<Text strong className="text-slate-600">Setor</Text>}>
              <AntSelect 
                value={editFormData.sector_id} 
                onChange={(v) => { 
                  setEditFormData(prev => ({ ...prev, sector_id: v, folder_id: 'none' })); 
                  if (v !== 'none') fetchFolders(v); 
                  else setFolders([]); 
                }}
                className="w-full h-10"
                options={[
                  { value: 'none', label: 'Sem setor' },
                  ...sectors.map(s => ({ value: s.id, label: s.name }))
                ]}
              />
            </Form.Item>

            <Form.Item label={<Text strong className="text-slate-600">Pasta</Text>}>
              <AntSelect 
                value={editFormData.folder_id} 
                onChange={(v) => setEditFormData(prev => ({ ...prev, folder_id: v }))} 
                disabled={editFormData.sector_id === 'none'}
                className="w-full h-10"
                options={[
                  { value: 'none', label: 'Pasta Raiz' },
                  ...folders.map(f => ({ value: f.id, label: f.name }))
                ]}
              />
            </Form.Item>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-md bg-slate-50/50">
            <div className="space-y-0.5">
              <Text strong className="text-sm">Confidencial</Text>
              <p className="text-xs text-slate-500 m-0">Restringe o acesso a gestores</p>
            </div>
            <AntSwitch 
              checked={editFormData.is_confidential} 
              onChange={(v) => setEditFormData(prev => ({ ...prev, is_confidential: v }))} 
            />
          </div>
        </Form>
      </Drawer>

      {/* ── Delete Confirm ── */}
      <Drawer
        title={<Title level={4} style={{ margin: 0 }}>Excluir Contrato</Title>}
        placement="right"
        onClose={() => setIsDeleteOpen(false)}
        open={isDeleteOpen}
        width={400}
        mask={false}
        extra={
          <Space>
            <Button variant="ghost" onClick={() => setIsDeleteOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="text-white">
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Excluir
            </Button>
          </Space>
        }
      >
        <div className="space-y-4">
          <p className="text-slate-600">
            Tem certeza que deseja excluir o contrato <Text strong className="text-slate-900">{deletingContract?.title}</Text>?
          </p>
          <div className="p-4 bg-rose-50 border border-rose-100 rounded-md">
            <p className="text-xs text-rose-600 font-semibold uppercase tracking-wider m-0">Aviso importante</p>
            <p className="text-sm text-rose-700 mt-1 mb-0">Esta ação é irreversível e removerá permanentemente todos os dados vinculados a este contrato.</p>
          </div>
        </div>
      </Drawer>

      {/* ── New Obligation ── */}
      <Drawer
        title={<Title level={4} style={{ margin: 0 }}>Nova Obrigação</Title>}
        placement="right"
        onClose={() => setIsObligationOpen(false)}
        open={isObligationOpen}
        size="large"
        mask={false}
        extra={
          <Space>
            <Button variant="ghost" onClick={() => setIsObligationOpen(false)}>Cancelar</Button>
            <Button onClick={handleObligationCreate} className="text-white">Criar obrigação</Button>
          </Space>
        }
      >
        <Form layout="vertical" className="space-y-4">
          <Form.Item label={<Text strong className="text-slate-600">Título</Text>} required>
            <AntInput 
              value={obligationFormData.title} 
              onChange={(e) => setObligationFormData(prev => ({ ...prev, title: e.target.value }))} 
              placeholder="Ex: Pagamento mensal" 
              className="h-10 rounded-md"
            />
          </Form.Item>
          
          <Form.Item label={<Text strong className="text-slate-600">Descrição</Text>}>
            <AntInput.TextArea 
              value={obligationFormData.description} 
              onChange={(e) => setObligationFormData(prev => ({ ...prev, description: e.target.value }))} 
              rows={3}
              className="rounded-md"
            />
          </Form.Item>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item label={<Text strong className="text-slate-600">Tipo</Text>}>
              <AntInput 
                value={obligationFormData.obligation_type} 
                onChange={(e) => setObligationFormData(prev => ({ ...prev, obligation_type: e.target.value }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
            <Form.Item label={<Text strong className="text-slate-600">Status</Text>}>
              <AntInput 
                value={obligationFormData.status} 
                onChange={(e) => setObligationFormData(prev => ({ ...prev, status: e.target.value }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item label={<Text strong className="text-slate-600">Vencimento</Text>}>
              <AntInput 
                type="date" 
                value={obligationFormData.due_date} 
                onChange={(e) => setObligationFormData(prev => ({ ...prev, due_date: e.target.value }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
            <Form.Item label={<Text strong className="text-slate-600">Lembrete (dias)</Text>}>
              <AntInput 
                type="number" 
                value={obligationFormData.reminder_days} 
                onChange={(e) => setObligationFormData(prev => ({ ...prev, reminder_days: e.target.value }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item label={<Text strong className="text-slate-600">Valor</Text>}>
              <AntInput 
                type="number" 
                value={obligationFormData.amount} 
                onChange={(e) => setObligationFormData(prev => ({ ...prev, amount: e.target.value }))}
                prefix={<span className="text-slate-400">R$</span>}
                className="h-10 rounded-md"
              />
            </Form.Item>
            <Form.Item label={<Text strong className="text-slate-600">Moeda</Text>}>
              <AntInput 
                value={obligationFormData.currency} 
                onChange={(e) => setObligationFormData(prev => ({ ...prev, currency: e.target.value.toUpperCase() }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
          </div>
        </Form>
      </Drawer>

      {/* ── Edit Obligation ── */}
      <Drawer
        title={<Title level={4} style={{ margin: 0 }}>Editar Obrigação</Title>}
        placement="right"
        onClose={() => setIsObligationEditOpen(false)}
        open={isObligationEditOpen}
        size="large"
        mask={false}
        extra={
          <Space>
            <Button variant="ghost" onClick={() => setIsObligationEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleObligationUpdate} className="text-white">Salvar alterações</Button>
          </Space>
        }
      >
        <Form layout="vertical" className="space-y-4">
          <Form.Item label={<Text strong className="text-slate-600">Título</Text>} required>
            <AntInput 
              value={obligationFormData.title} 
              onChange={(e) => setObligationFormData(prev => ({ ...prev, title: e.target.value }))} 
              className="h-10 rounded-md"
            />
          </Form.Item>
          
          <Form.Item label={<Text strong className="text-slate-600">Descrição</Text>}>
            <AntInput.TextArea 
              value={obligationFormData.description} 
              onChange={(e) => setObligationFormData(prev => ({ ...prev, description: e.target.value }))} 
              rows={3}
              className="rounded-md"
            />
          </Form.Item>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item label={<Text strong className="text-slate-600">Tipo</Text>}>
              <AntInput 
                value={obligationFormData.obligation_type} 
                onChange={(e) => setObligationFormData(prev => ({ ...prev, obligation_type: e.target.value }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
            <Form.Item label={<Text strong className="text-slate-600">Status</Text>}>
              <AntInput 
                value={obligationFormData.status} 
                onChange={(e) => setObligationFormData(prev => ({ ...prev, status: e.target.value }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item label={<Text strong className="text-slate-600">Vencimento</Text>}>
              <AntInput 
                type="date" 
                value={obligationFormData.due_date} 
                onChange={(e) => setObligationFormData(prev => ({ ...prev, due_date: e.target.value }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
            <Form.Item label={<Text strong className="text-slate-600">Lembrete (dias)</Text>}>
              <AntInput 
                type="number" 
                value={obligationFormData.reminder_days} 
                onChange={(e) => setObligationFormData(prev => ({ ...prev, reminder_days: e.target.value }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item label={<Text strong className="text-slate-600">Valor</Text>}>
              <AntInput 
                type="number" 
                value={obligationFormData.amount} 
                onChange={(e) => setObligationFormData(prev => ({ ...prev, amount: e.target.value }))}
                prefix={<span className="text-slate-400">R$</span>}
                className="h-10 rounded-md"
              />
            </Form.Item>
            <Form.Item label={<Text strong className="text-slate-600">Moeda</Text>}>
              <AntInput 
                value={obligationFormData.currency} 
                onChange={(e) => setObligationFormData(prev => ({ ...prev, currency: e.target.value.toUpperCase() }))}
                className="h-10 rounded-md"
              />
            </Form.Item>
          </div>
        </Form>
      </Drawer>

      {/* ── New Signature ── */}
      <Drawer
        title={<Title level={4} style={{ margin: 0 }}>Nova Assinatura</Title>}
        placement="right"
        onClose={() => setIsSignatureOpen(false)}
        open={isSignatureOpen}
        size="large"
        mask={false}
        extra={
          <Space>
            <Button variant="ghost" onClick={() => setIsSignatureOpen(false)}>Cancelar</Button>
            <Button onClick={handleSignatureCreate} className="text-white">Criar assinatura</Button>
          </Space>
        }
      >
        <Form layout="vertical" className="space-y-4">
          <Form.Item label={<Text strong className="text-slate-600">Fornecedor</Text>} required>
            <AntInput 
              value={signatureFormData.provider} 
              onChange={(e) => setSignatureFormData(prev => ({ ...prev, provider: e.target.value }))} 
              placeholder="Ex: DocuSign" 
              className="h-10 rounded-md"
            />
          </Form.Item>
          
          <Form.Item label={<Text strong className="text-slate-600">Nome do assinante</Text>}>
            <AntInput 
              value={signatureFormData.signer_name} 
              onChange={(e) => setSignatureFormData(prev => ({ ...prev, signer_name: e.target.value }))}
              className="h-10 rounded-md"
            />
          </Form.Item>

          <Form.Item label={<Text strong className="text-slate-600">Email do assinante</Text>}>
            <AntInput 
              type="email"
              value={signatureFormData.signer_email} 
              onChange={(e) => setSignatureFormData(prev => ({ ...prev, signer_email: e.target.value }))}
              className="h-10 rounded-md"
            />
          </Form.Item>

          <Form.Item label={<Text strong className="text-slate-600">URL de assinatura</Text>}>
            <AntInput 
              value={signatureFormData.signing_url} 
              onChange={(e) => setSignatureFormData(prev => ({ ...prev, signing_url: e.target.value }))} 
              placeholder="https://..."
              className="h-10 rounded-md"
            />
          </Form.Item>

          <Form.Item label={<Text strong className="text-slate-600">ID externo</Text>}>
            <AntInput 
              value={signatureFormData.external_id} 
              onChange={(e) => setSignatureFormData(prev => ({ ...prev, external_id: e.target.value }))}
              className="h-10 rounded-md"
            />
          </Form.Item>
        </Form>
      </Drawer>

      {/* ── Upload Signed ── */}
      <Drawer
        title={<Title level={4} style={{ margin: 0 }}>Upload do Contrato Assinado</Title>}
        placement="right"
        onClose={() => { setIsUploadSignedOpen(false); setUploadFile(null); }}
        open={isUploadSignedOpen}
        size="large"
        mask={false}
        extra={
          <Space>
            <Button variant="ghost" onClick={() => { setIsUploadSignedOpen(false); setUploadFile(null); }} disabled={isUploading}>Cancelar</Button>
            <Button onClick={handleUploadSigned} disabled={!uploadFile || isUploading} className="text-white">
              {isUploading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Enviar documento
            </Button>
          </Space>
        }
      >
        <Form layout="vertical" className="space-y-4">
          <div className="p-8 border-2 border-dashed border-slate-200 rounded-md flex flex-col items-center gap-3 bg-slate-50/50 hover:bg-slate-100/50 transition-colors cursor-pointer"
               onClick={() => document.getElementById('signed-contract-upload')?.click()}>
            <Upload className="h-10 w-10 text-slate-400" />
            <div className="text-center">
              <p className="text-sm font-bold text-slate-700 m-0">{uploadFile ? uploadFile.name : 'Selecione o arquivo assinado'}</p>
              <p className="text-xs text-slate-500 mt-1 mb-0">PDF, DOCX ou Imagens</p>
            </div>
            <input type="file" id="signed-contract-upload" className="hidden" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
            <Button variant="outline" size="sm" className="mt-2">Procurar arquivo</Button>
          </div>

          <Form.Item label={<Text strong className="text-slate-600">Setor de destino</Text>}>
            <AntSelect 
              value={selectedSectorId} 
              onChange={(v) => { setSelectedSectorId(v); fetchFolders(v); }}
              placeholder="Selecione o setor"
              className="w-full h-10"
              options={sectors.map(s => ({ value: s.id, label: s.name }))}
            />
          </Form.Item>

          <Form.Item label={<Text strong className="text-slate-600">Pasta de destino</Text>}>
            <AntSelect 
              value={selectedFolderId} 
              onChange={setSelectedFolderId} 
              disabled={!selectedSectorId}
              placeholder={selectedSectorId ? 'Selecione a pasta' : 'Selecione um setor primeiro'}
              className="w-full h-10"
              options={[
                { value: 'root', label: 'Raiz do setor' },
                ...folders.map(f => ({ value: f.id, label: f.name }))
              ]}
            />
          </Form.Item>

          <Form.Item label={<Text strong className="text-slate-600">Nova pasta</Text>}>
            <AntInput 
              value={newFolderName} 
              onChange={(e) => setNewFolderName(e.target.value)} 
              placeholder="Nome da nova pasta" 
              disabled={!selectedSectorId}
              className="h-10 rounded-md"
            />
          </Form.Item>

          <div className="flex items-center justify-between p-4 border rounded-md bg-slate-50/50">
            <div className="space-y-0.5">
              <Text strong className="text-sm">Confidencial</Text>
              <p className="text-xs text-slate-500 m-0">Restringe o acesso a gestores</p>
            </div>
            <AntSwitch checked={isConfidential} onChange={setIsConfidential} />
          </div>
        </Form>
      </Drawer>
    </ConfigProvider>
  );


  return (
    <>
      {isMobilePwa ? pwaContent : desktopContent}
      {sheets}
    </>
  );
}
