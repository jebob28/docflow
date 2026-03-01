import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { 
  FileText, 
  Download, 
  Globe, 
  Folder, 
  Clock, 
  Lock,
  ArrowRight
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
import { toast } from 'sonner';

interface SharedFile {
  id: string;
  name: string;
  extension: string;
  size_bytes: number;
  content_type: string;
  created_at: string;
  document_type?: string;
}

interface ShareData {
  folder_name?: string;
  documents?: SharedFile[];
  // If it's a single document, it will be returned differently or we'll fetch it
  is_document?: boolean;
  document_name?: string;
  document_type?: string;
}

export default function PublicShareView() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ShareData | null>(null);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (p?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/v1/public/view/${token}${p ? `?p=${encodeURIComponent(p)}` : ''}`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json'
        }
      });

      if (response.status === 401) {
        setNeedsPassword(true);
        setLoading(false);
        return;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Erro ao carregar link');
      }

      // Check if it's a file or JSON
      const contentType = response.headers.get('Content-Type');
      if (contentType && contentType.includes('application/json')) {
        const json = await response.json();
        setData(json);
        setNeedsPassword(false);
      } else {
        // It's a file, redirect or handle as document
        // Actually, for now, we'll assume the backend will be updated to return JSON metadata if requested
        setData({ is_document: true });
        setNeedsPassword(false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro ao carregar link';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchData(password);
  };

  const handleDownload = (docId?: string) => {
    const url = `/api/v1/public/view/${token}${password ? `?p=${encodeURIComponent(password)}` : ''}${docId ? `&doc_id=${docId}` : ''}`;
    window.open(url, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="h-16 w-16 bg-white rounded-3xl shadow-xl shadow-blue-900/5 flex items-center justify-center mx-auto animate-pulse">
            <Globe className="h-8 w-8 text-blue-500 animate-spin-slow" />
          </div>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Carregando acesso seguro...</p>
        </div>
      </div>
    );
  }

  if (needsPassword) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 rounded-[40px] border-none shadow-2xl shadow-blue-900/5 space-y-8 bg-white/80 backdrop-blur-xl">
          <div className="text-center space-y-3">
            <div className="h-16 w-16 bg-blue-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
              <Lock className="h-8 w-8 text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Link Protegido</h1>
            <p className="text-slate-500 text-sm font-medium">Este link requer uma senha para acesso.</p>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Digite a senha de acesso"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-14 rounded-2xl border-slate-100 bg-slate-50/50 focus:bg-white transition-all text-center font-bold tracking-widest"
                autoFocus
              />
            </div>
            <Button 
              type="submit"
              className="w-full h-14 bg-primary hover:bg-[#10213d] text-white font-bold rounded-2xl transition-all active:scale-[0.98] shadow-lg shadow-blue-900/10 uppercase tracking-widest text-xs"
            >
              Acessar Conteúdo
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 rounded-[40px] border-none shadow-2xl shadow-blue-900/5 space-y-6 text-center bg-white/80 backdrop-blur-xl">
          <div className="h-16 w-16 bg-red-50 rounded-3xl flex items-center justify-center mx-auto">
            <Clock className="h-8 w-8 text-red-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Link Indisponível</h1>
            <p className="text-slate-500 text-sm font-medium">{error}</p>
          </div>
          <Button 
            variant="outline"
            onClick={() => window.location.reload()}
            className="w-full h-12 rounded-2xl border-slate-200 text-slate-600 font-bold uppercase tracking-widest text-[10px]"
          >
            Tentar novamente
          </Button>
        </Card>
      </div>
    );
  }

  const isFolder = !!data?.folder_name;

  const ShareCard = ({ doc }: { doc: SharedFile }) => (
    <Card className="p-4 border-none shadow-sm bg-white rounded-2xl overflow-hidden hover:shadow-md transition-all duration-300">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0">
            <FileText className="h-6 w-6 text-blue-500" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900 text-sm truncate pr-2">
              {doc.name}
              {doc.document_type && (
                <span className="ml-2 px-1 py-0.5 rounded bg-blue-50 text-blue-600 text-[7px] font-black uppercase tracking-widest border border-blue-100/50 inline-block align-middle">
                  {doc.document_type}
                </span>
              )}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                {(doc.size_bytes / 1024 / 1024).toFixed(2)} MB
              </span>
              <div className="w-1 h-1 rounded-full bg-slate-300" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                {doc.extension.replace('.', '')}
              </span>
            </div>
          </div>
        </div>
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => handleDownload(doc.id)}
          className="h-10 w-10 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 shrink-0"
        >
          <Download className="h-5 w-5" />
        </Button>
      </div>
    </Card>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-4 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-blue-600 bg-blue-50 w-fit px-4 py-1.5 rounded-full">
              <Globe className="h-4 w-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Acesso Público Seguro</span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
                  {isFolder ? data?.folder_name : (data?.document_name || 'Documento Compartilhado')}
                </h1>
                {!isFolder && data?.document_type && (
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-widest border border-blue-200">
                    {data.document_type}
                  </span>
                )}
              </div>
              <p className="text-slate-500 font-medium text-sm sm:text-base">
                {isFolder 
                  ? `Este link contém ${data?.documents?.length || 0} arquivos compartilhados.` 
                  : 'Você recebeu um documento para visualização e download.'}
              </p>
            </div>
          </div>
          
          {!isFolder && (
            <Button 
              onClick={() => handleDownload()}
              className="bg-primary hover:bg-[#10213d] text-white h-14 w-full sm:w-fit px-8 font-bold rounded-2xl transition-all active:scale-[0.98] shadow-lg shadow-blue-900/10 uppercase tracking-widest text-xs"
            >
              <Download className="h-4 w-4 mr-2" />
              Baixar Documento
            </Button>
          )}
        </div>

        {isFolder && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 px-2">
              <div className="h-10 w-10 bg-blue-50 rounded-2xl flex items-center justify-center">
                <Folder className="h-5 w-5 text-blue-600" />
              </div>
              <span className="font-bold text-slate-800 tracking-tight">Arquivos na Pasta</span>
            </div>

            {/* Desktop View */}
            <Card className="hidden md:block rounded-[40px] border-none shadow-2xl shadow-blue-900/5 overflow-hidden bg-white/80 backdrop-blur-xl">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-slate-100">
                      <TableHead className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-8 py-5">Nome do Arquivo</TableHead>
                      <TableHead className="text-[10px] font-bold text-slate-400 uppercase tracking-widest py-5">Tamanho</TableHead>
                      <TableHead className="text-[10px] font-bold text-slate-400 uppercase tracking-widest py-5 text-right pr-8">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.documents?.map((doc) => (
                      <TableRow key={doc.id} className="group hover:bg-slate-50/50 transition-all border-slate-50">
                        <TableCell className="pl-8 py-5">
                          <div className="flex items-center gap-4">
                            <div className="h-12 w-12 rounded-2xl bg-white shadow-sm border border-slate-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                              <FileText className="h-6 w-6 text-blue-500" />
                            </div>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-slate-900">{doc.name}</span>
                                {doc.document_type && (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[8px] font-black uppercase tracking-widest border border-blue-100/50">
                                    {doc.document_type}
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{doc.extension.replace('.', '')}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-5">
                          <span className="text-xs font-bold text-slate-500">
                            {(doc.size_bytes / 1024 / 1024).toFixed(2)} MB
                          </span>
                        </TableCell>
                        <TableCell className="text-right pr-8 py-5">
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => handleDownload(doc.id)}
                            className="h-10 w-10 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                          >
                            <Download className="h-5 w-5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>

            {/* Mobile View */}
            <div className="md:hidden grid grid-cols-1 gap-3">
              {data?.documents?.map((doc) => (
                <ShareCard key={doc.id} doc={doc} />
              ))}
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-8 border-t border-slate-200 text-center md:text-left">
          <div className="flex items-center gap-2 text-slate-400">
            <Globe className="h-4 w-4" />
            <span className="text-[10px] font-bold uppercase tracking-widest">GED SaaS - Gestão de Documentos</span>
          </div>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            Protegido por criptografia de ponta a ponta
          </p>
        </div>
      </div>
    </div>
  );
}
