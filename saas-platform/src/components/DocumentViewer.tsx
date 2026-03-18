import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  X, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  MessageSquare, 
  Maximize2, 
  Minimize2, 
  Download,
  Save,
  Trash2,
  Pin,
  Type,
  Highlighter,
  Type as FontIcon,
  Palette,
  Loader2,
  History,
  FileUp,
  Clock,
  Info
} from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Avatar, AvatarFallback } from './ui/avatar';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";

// Error Boundary simples para o PDF
class PDFErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Erro no componente PDF:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-20 text-red-500">
          <X className="h-10 w-10 mb-2" />
          <p className="text-center">Ocorreu um erro ao renderizar o PDF.<br/>Tente recarregar o documento.</p>
          <Button 
            variant="outline" 
            className="mt-4 border-red-200 text-red-600 hover:bg-red-50"
            onClick={() => window.location.reload()}
          >
            Recarregar Página
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Configurar o worker do PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

interface Annotation {
  id: string;
  page_number: number;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  content: string;
  color: string;
  user_id: number;
  font_family: string;
  annotation_type: 'post-it' | 'text' | 'highlighter';
  created_at?: string;
}

interface DocumentVersion {
  id: string;
  version_number: number;
  minio_key: string;
  size_bytes: number;
  created_at: string;
  created_by_name: string;
  change_summary: string;
}

interface DocumentViewerProps {
  documentId: string;
  documentName: string;
  fileUrl: string;
  canEdit?: boolean;
  documentType?: string;
  ocrText?: string;
  ocrProcessedAt?: string;
  onClose: () => void;
}

const DocumentViewer: React.FC<DocumentViewerProps> = ({ 
  documentId, 
  documentName, 
  fileUrl, 
  canEdit = false,
  documentType,
  ocrText,
  ocrProcessedAt,
  onClose 
}) => {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [selectedType, setSelectedType] = useState<'post-it' | 'text' | 'highlighter'>('post-it');
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [annotationToDelete, setAnnotationToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [activeTab, setActiveTab] = useState<'document' | 'ocr'>('document');
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchVersions = useCallback(async () => {
    setIsLoadingVersions(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/${documentId}/versions`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setVersions(data);
      }
    } catch (error) {
      console.error('Erro ao buscar versões:', error);
    } finally {
      setIsLoadingVersions(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (showVersions) {
      fetchVersions();
    }
  }, [showVersions, fetchVersions]);

  useEffect(() => {
    setNumPages(null);
    setCurrentPage(1);
  }, [fileUrl]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const FONT_OPTIONS = [
    { label: 'Padrão', value: 'Inter' },
    { label: 'Escrita 1', value: "'Kalam', cursive" },
    { label: 'Escrita 2', value: "'Caveat', cursive" },
    { label: 'Escrita 3', value: "'Indie Flower', cursive" },
  ];

  const COLOR_OPTIONS = [
    '#fef3c7', // Amarelo Post-it
    '#dcfce7', // Verde
    '#fee2e2', // Vermelho/Rosa
    '#e0f2fe', // Azul
    '#f3e8ff', // Roxo
    '#ffedd5', // Laranja
    '#ffffff', // Branco
  ];

  const fetchAnnotations = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/${documentId}/annotations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setAnnotations(data || []);
      }
    } catch (error) {
      console.error('Erro ao buscar anotações:', error);
    }
  }, [documentId]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchAnnotations();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [fetchAnnotations]);

  const handleAddAnnotation = async (e: React.MouseEvent) => {
    if (!canEdit || !isAddingNote || !containerRef.current) return;

    // Only add if clicking the container directly or the overlay
    const target = e.target as HTMLElement;
    if (!target.classList.contains('absolute') && !target.classList.contains('relative')) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/${documentId}/annotations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          page_number: currentPage,
          pos_x: x,
          pos_y: y,
          width: selectedType === 'post-it' ? 200 : selectedType === 'text' ? 150 : 100,
          height: selectedType === 'post-it' ? 150 : selectedType === 'text' ? 40 : 20,
          content: selectedType === 'post-it' ? 'Nova nota...' : selectedType === 'text' ? 'Novo texto...' : '',
          color: selectedType === 'post-it' ? '#fef3c7' : selectedType === 'text' ? 'transparent' : '#fef08a',
          is_private: false,
          font_family: 'Inter',
          annotation_type: selectedType
        })
      });

      if (response.ok) {
        toast.success('Nota adicionada!');
        fetchAnnotations();
        setIsAddingNote(false);
      }
    } catch {
      toast.error('Erro ao salvar nota');
    }
  };

  const handleUpdateAnnotation = async (id: string, updates: Partial<Annotation>) => {
    if (!canEdit) return;
    try {
      const token = localStorage.getItem('token');
      // Busca a nota atual para manter os valores que não foram alterados
      const currentNote = annotations.find(a => a.id === id);
      if (!currentNote) return;

      const payload = {
        content: updates.content !== undefined ? updates.content : currentNote.content,
        color: updates.color !== undefined ? updates.color : currentNote.color,
        pos_x: updates.pos_x !== undefined ? updates.pos_x : currentNote.pos_x,
        pos_y: updates.pos_y !== undefined ? updates.pos_y : currentNote.pos_y,
        width: updates.width !== undefined ? updates.width : currentNote.width,
        height: updates.height !== undefined ? updates.height : currentNote.height,
        font_family: updates.font_family !== undefined ? updates.font_family : currentNote.font_family,
        annotation_type: updates.annotation_type !== undefined ? updates.annotation_type : currentNote.annotation_type,
      };

      const response = await fetch(`/api/v1/documents/annotations/${id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        setAnnotations(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
      }
    } catch (error) {
      console.error('Erro ao atualizar nota:', error);
    }
  };

  const handleDragStart = (e: React.MouseEvent, id: string) => {
    if (!canEdit) return;
    e.stopPropagation();
    const note = annotations.find(a => a.id === id);
    if (!note || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const noteX = (note.pos_x / 100) * rect.width;
    const noteY = (note.pos_y / 100) * rect.height;

    setDraggingNoteId(id);
    setDragOffset({
      x: e.clientX - rect.left - noteX,
      y: e.clientY - rect.top - noteY
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!draggingNoteId || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    let newX = ((e.clientX - rect.left - dragOffset.x) / rect.width) * 100;
    let newY = ((e.clientY - rect.top - dragOffset.y) / rect.height) * 100;

    // Limites (0-95%)
    newX = Math.max(0, Math.min(95, newX));
    newY = Math.max(0, Math.min(95, newY));

    setAnnotations(prev => prev.map(a => 
      a.id === draggingNoteId ? { ...a, pos_x: newX, pos_y: newY } : a
    ));
  };

  const handleDragEnd = () => {
    if (!draggingNoteId) return;
    const note = annotations.find(a => a.id === draggingNoteId);
    if (note) {
      handleUpdateAnnotation(note.id, { pos_x: note.pos_x, pos_y: note.pos_y });
    }
    setDraggingNoteId(null);
  };

  const handleDeleteAnnotation = (id: string) => {
    setAnnotationToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const confirmDeleteAnnotation = async () => {
    if (!annotationToDelete) return;
    
    setIsDeleting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/annotations/${annotationToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success('Nota excluída');
        setAnnotations(prev => prev.filter(a => a.id !== annotationToDelete));
        setIsDeleteModalOpen(false);
        setAnnotationToDelete(null);
      } else {
        toast.error('Erro ao deletar nota');
      }
    } catch {
      toast.error('Erro de conexão ao deletar nota');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDownloadFile = async (original: boolean = false) => {
    try {
      const token = localStorage.getItem('token');
      let url = `/api/v1/documents/${documentId}`;
      if (original) {
        url += '?original=true';
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const disposition = response.headers.get('Content-Disposition');
        let fileName = documentName;
        if (disposition && disposition.includes('filename=')) {
          const match = disposition.match(/filename="(.+)"/);
          if (match && match[1]) fileName = match[1];
        }

        const blob = await response.blob();
        const urlBlob = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = urlBlob;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(urlBlob);
        toast.success(original ? "Download do original iniciado!" : "Download iniciado!");
      } else if (response.status === 403) {
        toast.error("Sem permissão para baixar o original.");
      } else {
        toast.error("Erro ao baixar arquivo.");
      }
    } catch {
      toast.error("Erro de conexão ao baixar arquivo.");
    }
  };

  const handleOpenVersion = async (versionNumber: number) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/${documentId}?version=${versionNumber}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        toast.error("Erro ao abrir versão.");
        return;
      }

      const blob = await response.blob();
      const urlBlob = window.URL.createObjectURL(blob);
      window.open(urlBlob, '_blank', 'noopener,noreferrer');
      setTimeout(() => window.URL.revokeObjectURL(urlBlob), 60000);
    } catch {
      toast.error("Erro de conexão ao abrir versão.");
    }
  };

  /*
  const handleDownloadWithAnnotations = async () => {
    if (!containerRef.current) return;
    
    setIsDownloading(true);
    const toastId = toast.loading("Gerando PDF com anotações...");

    try {
      // 1. Identificar o canvas do PDF gerado pelo react-pdf
      const pdfCanvas = containerRef.current.querySelector('canvas');
      if (!pdfCanvas) throw new Error("Canvas do PDF não encontrado");

      // 2. Criar um novo canvas temporário para combinar PDF + Anotações
      // Usamos as dimensões reais do canvas do PDF para manter a qualidade original
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = pdfCanvas.width;
      finalCanvas.height = pdfCanvas.height;
      const ctx = finalCanvas.getContext('2d');
      if (!ctx) throw new Error("Erro ao criar contexto 2D");

      // 3. Desenhar o PDF original (o fundo)
      ctx.drawImage(pdfCanvas, 0, 0);

      // 4. Capturar as anotações separadamente usando html2canvas
      // Importante: capturamos apenas o overlay de anotações, sem o zoom do container
      const annotationsOverlay = containerRef.current.querySelector('.absolute.inset-0.z-20') as HTMLElement;
      if (annotationsOverlay) {
        const annotationsCanvas = await html2canvas(annotationsOverlay, {
          backgroundColor: null,
          scale: pdfCanvas.width / annotationsOverlay.offsetWidth, // Ajusta escala das anotações para o canvas do PDF
          useCORS: true,
          logging: false,
          onclone: (clonedDoc) => {
            // Remover todas as funções de cor modernas (oklch, oklab, display-p3) 
            // que o html2canvas não suporta.
            const styleTags = clonedDoc.getElementsByTagName('style');
            for (let i = 0; i < styleTags.length; i++) {
              styleTags[i].innerHTML = styleTags[i].innerHTML.replace(/(oklch|oklab|display-p3)\([^)]+\)/g, '#000000');
            }

            const allElements = clonedDoc.getElementsByTagName('*');
            for (let i = 0; i < allElements.length; i++) {
              const el = allElements[i] as HTMLElement;
              
              // Limpar estilos inline
              const inlineStyle = el.getAttribute('style');
              if (inlineStyle && (inlineStyle.includes('oklch') || inlineStyle.includes('oklab') || inlineStyle.includes('display-p3'))) {
                el.setAttribute('style', inlineStyle.replace(/(oklch|oklab|display-p3)\([^)]+\)/g, '#000000'));
              }

              // Garantir cores visíveis para anotações
              if (el.classList.contains('p-4') && el.classList.contains('rotate-1')) {
                el.style.setProperty('background-color', '#fef3c7', 'important');
                el.style.setProperty('color', '#000000', 'important');
              }
            }
          }
        });

        // 5. Sobrepor as anotações ao canvas do PDF
        ctx.drawImage(annotationsCanvas, 0, 0);
      }

      // 6. Gerar o PDF final com as dimensões exatas do canvas
      const imgData = finalCanvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF({
        orientation: pdfCanvas.width > pdfCanvas.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [pdfCanvas.width, pdfCanvas.height]
      });

      pdf.addImage(imgData, 'JPEG', 0, 0, pdfCanvas.width, pdfCanvas.height);
      pdf.save(`${documentName}-com-anotacoes.pdf`);
      
      toast.dismiss(toastId);
      toast.success("Download concluído!");
    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      toast.dismiss(toastId);
      toast.error("Erro ao gerar PDF com anotações.");
    } finally {
      setIsDownloading(false);
    }
  };
  */

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/95 backdrop-blur-sm animate-in fade-in duration-300 sm:bg-slate-900/95">
      <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Indie+Flower&family=Kalam:wght@300;400;700&display=swap" rel="stylesheet" />
      
      {/* Header - Native App Style */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 bg-white border-b border-border shadow-sm pt-safe">
        <div className="flex items-center gap-3 sm:gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose} 
            className="rounded-full hover:bg-slate-100 transition-colors h-9 w-9 bg-slate-50 border border-border shadow-sm"
          >
            <ChevronLeft className="h-6 w-6 text-slate-900" />
          </Button>
          <div className="flex-1 min-w-0 flex items-center gap-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-widest leading-none">Visualizando</span>
                {documentType && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[8px] font-black uppercase tracking-widest border border-blue-100">
                    {documentType}
                  </span>
                )}
                {ocrProcessedAt && (
                  <span className="flex items-center gap-1 text-green-600 bg-green-50 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border border-green-100">
                    OCR CONCLUÍDO
                  </span>
                )}
              </div>
              <h2 className="text-sm sm:text-lg font-extrabold text-slate-900 leading-none truncate max-w-[150px] sm:max-w-md">{documentName}</h2>
            </div>

            {/* Tabs */}
            <div className="hidden md:flex items-center bg-slate-100 p-1 rounded-xl gap-1 ml-4">
              <Button 
                variant={activeTab === 'document' ? 'default' : 'ghost'} 
                size="sm"
                className={cn("h-8 rounded-lg text-xs font-bold", activeTab === 'document' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
                onClick={() => setActiveTab('document')}
              >
                Documento
              </Button>
              <Button 
                variant={activeTab === 'ocr' ? 'default' : 'ghost'} 
                size="sm"
                className={cn("h-8 rounded-lg text-xs font-bold", activeTab === 'ocr' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
                onClick={() => setActiveTab('ocr')}
                disabled={!ocrText}
              >
                Texto Extraído (OCR)
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-3">
          <div className="hidden sm:flex items-center bg-slate-100 rounded-full px-3 py-1 mr-4">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setZoom(prev => Math.max(50, prev - 10))}>
              <Minimize2 className="h-4 w-4" />
            </Button>
            <span className="text-sm font-bold text-slate-600 min-w-[3rem] text-center">{zoom}%</span>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setZoom(prev => Math.min(200, prev + 10))}>
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
          
          <Button 
            variant="ghost" 
            size="icon"
            className="rounded-full text-slate-900 h-9 w-9 lg:hidden"
            onClick={() => handleDownloadFile(false)}
          >
            <Download className="h-5 w-5" />
          </Button>

          <Button 
            variant="outline" 
            className="hidden lg:flex rounded-full gap-2 border-border hover:bg-slate-50 font-bold"
            onClick={() => setShowVersions(!showVersions)}
          >
            <History className="h-4 w-4" />
            Histórico
          </Button>

          {canEdit && (
            <Button 
              variant="outline" 
              className="hidden lg:flex rounded-full gap-2 border-border hover:bg-slate-50 font-bold"
              onClick={() => handleDownloadFile(true)}
            >
              <Download className="h-4 w-4" />
              Baixar Original
            </Button>
          )}

          <Button 
            variant="outline" 
            className="hidden lg:flex rounded-full gap-2 border-border hover:bg-slate-50 font-bold"
            onClick={() => handleDownloadFile(false)}
          >
            <Download className="h-4 w-4" />
            Baixar PDF
          </Button>

          {canEdit && (
            <Button 
              className="rounded-full gap-2 bg-[#0f172a] hover:bg-[#1e293b] shadow-md transition-all active:scale-95 font-bold h-9 px-4 sm:h-10 text-white"
              onClick={() => toast.success("Todas as alterações foram salvas!")}
            >
              <Save className="h-4 w-4" />
              <span className="hidden sm:inline">Salvar</span>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Annotation Toolbar (Desktop) */}
        {canEdit && (
          <div className="hidden lg:flex flex-col gap-2 p-2 bg-white border-r border-border z-30 shadow-sm">
            <Button 
              variant={isAddingNote && selectedType === 'post-it' ? 'default' : 'ghost'} 
              size="icon" 
              className={cn("h-10 w-10 rounded-xl", isAddingNote && selectedType === 'post-it' && "bg-blue-600")}
              onClick={() => {
                if (isAddingNote && selectedType === 'post-it') {
                  setIsAddingNote(false);
                } else {
                  setIsAddingNote(true);
                  setSelectedType('post-it');
                }
              }}
              title="Post-it"
            >
              <Pin className="h-5 w-5" />
            </Button>
            <Button 
              variant={isAddingNote && selectedType === 'text' ? 'default' : 'ghost'} 
              size="icon" 
              className={cn("h-10 w-10 rounded-xl", isAddingNote && selectedType === 'text' && "bg-blue-600")}
              onClick={() => {
                if (isAddingNote && selectedType === 'text') {
                  setIsAddingNote(false);
                } else {
                  setIsAddingNote(true);
                  setSelectedType('text');
                }
              }}
              title="Texto"
            >
              <Type className="h-5 w-5" />
            </Button>
            <Button 
              variant={isAddingNote && selectedType === 'highlighter' ? 'default' : 'ghost'} 
              size="icon" 
              className={cn("h-10 w-10 rounded-xl", isAddingNote && selectedType === 'highlighter' && "bg-blue-600")}
              onClick={() => {
                if (isAddingNote && selectedType === 'highlighter') {
                  setIsAddingNote(false);
                } else {
                  setIsAddingNote(true);
                  setSelectedType('highlighter');
                }
              }}
              title="Marca-texto"
            >
              <Highlighter className="h-5 w-5" />
            </Button>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 relative overflow-hidden bg-slate-50 flex scrollbar-hide">
          {activeTab === 'document' ? (
            <div className="flex-1 overflow-auto flex justify-center p-4 sm:p-8 relative">
            <div 
              ref={containerRef}
              className="relative bg-white shadow-2xl origin-top transition-transform duration-200 mb-20 sm:mb-20"
              style={{ 
                transform: `scale(${zoom / 100})`,
                minWidth: 'fit-content',
                maxWidth: '100%'
              }}
            >
              {/* PDF Content */}
              <PDFErrorBoundary>
                <Document
                  file={fileUrl}
                  onLoadSuccess={onDocumentLoadSuccess}
                  onLoadError={(error) => {
                    console.error("Erro no PDF:", error);
                    toast.error("Erro ao carregar o documento PDF.");
                  }}
                  loading={
                    <div className="flex items-center justify-center p-20">
                      <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
                    </div>
                  }
                  error={
                    <div className="flex flex-col items-center justify-center p-20 text-red-500">
                      <X className="h-10 w-10 mb-2" />
                      <p>Erro ao carregar o PDF.</p>
                    </div>
                  }
                >
                  {numPages && (
                    <Page 
                      pageNumber={currentPage} 
                      renderAnnotationLayer={false}
                      renderTextLayer={false}
                      loading={
                        <div className="flex items-center justify-center p-20">
                          <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
                        </div>
                      }
                      width={window.innerWidth < 640 ? window.innerWidth - 32 : undefined}
                    />
                  )}
                </Document>
              </PDFErrorBoundary>

              {/* Sticky Notes Overlay */}
              <div 
                className={`absolute inset-0 z-20 ${isAddingNote ? 'cursor-crosshair' : 'pointer-events-none'}`}
                onMouseMove={handleMouseMove}
                onMouseUp={handleDragEnd}
                onMouseLeave={handleDragEnd}
                onClick={(e) => {
                  if (isAddingNote) handleAddAnnotation(e);
                }}
                style={{ pointerEvents: isAddingNote ? 'auto' : 'none' }}
              >
                {annotations.filter(a => a.page_number === currentPage).map((note) => (
                  <div
                    key={note.id}
                    className={`absolute shadow-lg rounded-sm transition-all pointer-events-auto group ${
                      draggingNoteId === note.id ? 'z-50 scale-105' : 'hover:scale-105'
                    } ${
                      note.annotation_type === 'post-it' ? 'p-4 border-l-4 rotate-1' : 
                      note.annotation_type === 'highlighter' ? 'bg-opacity-50 blur-[1px]' : 'p-2'
                    }`}
                    style={{
                      left: `${note.pos_x}%`,
                      top: `${note.pos_y}%`,
                      width: note.annotation_type === 'text' ? 'auto' : `${note.width}px`,
                      height: note.annotation_type === 'text' ? 'auto' : `${note.height}px`,
                      backgroundColor: note.color,
                      borderColor: note.annotation_type === 'post-it' ? 'rgba(0,0,0,0.1)' : 'transparent',
                      cursor: draggingNoteId === note.id ? 'grabbing' : 'move',
                      fontFamily: note.font_family,
                      minWidth: note.annotation_type === 'text' ? '100px' : 'none'
                    }}
                    onMouseDown={(e) => handleDragStart(e, note.id)}
                  >
                    {note.annotation_type === 'post-it' && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-30 drop-shadow-md pointer-events-none group-hover:scale-110 transition-transform">
                        <Pin className="h-6 w-6 text-red-600 fill-red-600 -rotate-45 drop-shadow-[0_2px_2px_rgba(0,0,0,0.3)]" />
                      </div>
                    )}
                    {canEdit && (
                      <div className="flex items-center justify-between mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/5 rounded px-1">
                        <div className="flex items-center gap-1">
                          {/* Color Picker */}
                          <div className="relative group/colors">
                            <Palette className="h-3 w-3 text-slate-500 cursor-pointer" />
                            <div className="absolute top-full left-0 hidden group-hover/colors:flex bg-white shadow-xl rounded-lg p-1 gap-1 z-50 border border-border">
                              {COLOR_OPTIONS.map(c => (
                                <div 
                                  key={c} 
                                  className="w-4 h-4 rounded-full border border-border cursor-pointer hover:scale-110" 
                                  style={{ backgroundColor: c }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUpdateAnnotation(note.id, { color: c });
                                  }}
                                />
                              ))}
                            </div>
                          </div>

                          {/* Font Picker */}
                          <div className="relative group/fonts">
                            <FontIcon className="h-3 w-3 text-slate-500 cursor-pointer" />
                            <div className="absolute top-full left-0 hidden group-hover/fonts:flex flex-col bg-white shadow-xl rounded-lg p-1 z-50 border border-border min-w-[100px]">
                              {FONT_OPTIONS.map(f => (
                                <div 
                                  key={f.value} 
                                  className="px-2 py-1 text-[10px] hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                                  style={{ fontFamily: f.value }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUpdateAnnotation(note.id, { font_family: f.value });
                                  }}
                                >
                                  {f.label}
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Type Picker */}
                          <div className="relative group/types">
                            <Type className="h-3 w-3 text-slate-500 cursor-pointer" />
                            <div className="absolute top-full left-0 hidden group-hover/types:flex flex-col bg-white shadow-xl rounded-lg p-1 z-50 border border-border min-w-[100px]">
                              <div className="px-2 py-1 text-[10px] hover:bg-slate-100 cursor-pointer flex items-center gap-2" onClick={(e) => { e.stopPropagation(); handleUpdateAnnotation(note.id, { annotation_type: 'post-it' }); }}>
                                <div className="w-2 h-2 bg-yellow-200 border border-border" /> Post-it
                              </div>
                              <div className="px-2 py-1 text-[10px] hover:bg-slate-100 cursor-pointer flex items-center gap-2" onClick={(e) => { e.stopPropagation(); handleUpdateAnnotation(note.id, { annotation_type: 'text', color: 'transparent' }); }}>
                                <FontIcon className="h-2 w-2" /> Texto Livre
                              </div>
                              <div className="px-2 py-1 text-[10px] hover:bg-slate-100 cursor-pointer flex items-center gap-2" onClick={(e) => { e.stopPropagation(); handleUpdateAnnotation(note.id, { annotation_type: 'highlighter', color: '#fef08a' }); }}>
                                <Highlighter className="h-2 w-2" /> Marca-texto
                              </div>
                            </div>
                          </div>
                        </div>

                        <Trash2 
                          className="h-3 w-3 text-slate-400 cursor-pointer hover:text-rose-500" 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteAnnotation(note.id);
                          }}
                        />
                      </div>
                    )}

                    {note.annotation_type === 'highlighter' ? (
                      <div className="w-full h-full min-h-[20px]" />
                    ) : (
                      <textarea 
                        className={`w-full h-full bg-transparent border-none resize-none text-sm font-medium focus:outline-none placeholder:text-slate-400 ${
                          note.annotation_type === 'text' ? 'text-slate-900' : 'text-slate-700'
                        }`}
                        style={{ fontFamily: note.font_family }}
                        defaultValue={note.content}
                        readOnly={!canEdit}
                        onBlur={(e) => {
                          if (canEdit) handleUpdateAnnotation(note.id, { content: e.target.value });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-4 sm:p-8 flex justify-center bg-slate-50">
              <div className="bg-white p-6 sm:p-10 shadow-xl rounded-2xl w-full max-w-4xl min-h-[80vh] border border-border">
                <div className="flex items-center justify-between mb-8 border-b border-border pb-6">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-2xl bg-blue-50 flex items-center justify-center shadow-sm">
                      <Type className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-black text-slate-900 tracking-tight">Texto Extraído via OCR</h3>
                      <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Conteúdo Reconhecido</p>
                    </div>
                  </div>
                  {ocrProcessedAt && (
                    <div className="text-right">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Processado em</p>
                      <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-border">
                        <Clock className="h-3 w-3 text-slate-400" />
                        <span className="text-sm font-bold text-slate-700">{new Date(ocrProcessedAt).toLocaleString('pt-BR')}</span>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-blue-100 to-indigo-100 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                  <div className="relative bg-white p-8 rounded-xl border border-border min-h-[60vh] whitespace-pre-wrap font-mono text-sm leading-relaxed text-slate-700 shadow-inner">
                    {ocrText || "Nenhum texto extraído para este documento."}
                  </div>
                </div>

                <div className="mt-10 p-5 bg-blue-50/50 rounded-2xl border border-blue-100/50 flex gap-4 items-start">
                  <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0 shadow-sm">
                    <Info className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-black text-blue-900 uppercase tracking-tight">Nota de Precisão</p>
                    <p className="text-xs text-blue-700/80 leading-relaxed font-medium">
                      O texto acima foi gerado automaticamente por inteligência artificial e pode conter imprecisões. 
                      Este conteúdo é utilizado primariamente para indexação e facilitação de buscas no sistema.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Versions Sidebar */}
          {showVersions && (
            <div className="w-80 bg-white border-l border-border flex flex-col animate-in slide-in-from-right duration-300">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-extrabold text-slate-900 flex items-center gap-2">
                  <History className="h-4 w-4 text-blue-600" />
                  Histórico de Versões
                </h3>
                <Button variant="ghost" size="icon" onClick={() => setShowVersions(false)} className="h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {canEdit && (
                    <Button 
                      variant="outline" 
                      className="w-full justify-start gap-2 border-dashed border-border text-slate-600 font-bold h-auto py-3 px-4 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-all"
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.pdf';
                        input.onchange = async (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) {
                            const summary = prompt("Resumo da alteração (opcional):");
                            const formData = new FormData();
                            formData.append('file', file);
                            formData.append('summary', summary || '');
                            
                            const token = localStorage.getItem('token');
                            const toastId = toast.loading("Enviando nova versão...");
                            try {
                              const response = await fetch(`/api/v1/documents/${documentId}/versions`, {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${token}` },
                                body: formData
                              });
                              if (response.ok) {
                                toast.success("Nova versão enviada!", { id: toastId });
                                fetchVersions();
                              } else {
                                toast.error("Erro ao enviar versão", { id: toastId });
                              }
                            } catch {
                              toast.error("Erro de conexão", { id: toastId });
                            }
                          }
                        };
                        input.click();
                      }}
                    >
                      <FileUp className="h-4 w-4" />
                      Upload Nova Versão
                    </Button>
                  )}

                  {isLoadingVersions ? (
                    <div className="flex items-center justify-center p-8">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                    </div>
                  ) : versions.length === 0 ? (
                    <p className="text-center text-slate-500 text-sm py-8">Nenhuma versão encontrada.</p>
                  ) : (
                    versions.map((v) => (
                      <div key={v.id} className="p-3 rounded-lg border border-border bg-slate-50 hover:border-blue-200 transition-all">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase tracking-tighter">
                            Versão {v.version_number}
                          </span>
                          <span className="text-[10px] text-slate-400 font-bold flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(v.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-slate-900 mb-1">{v.change_summary || 'Sem descrição'}</p>
                        <p className="text-[10px] text-slate-500 mb-2">Por: {v.created_by_name || 'Desconhecido'}</p>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="w-full h-7 text-[10px] font-bold text-blue-600 hover:bg-blue-100 hover:text-blue-700 p-0"
                            onClick={() => handleOpenVersion(v.version_number)}
                          >
                            <Download className="h-3 w-3 mr-1" />
                            Visualizar esta versão
                          </Button>
                          {canEdit && v.version_number !== versions[0]?.version_number && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full h-7 text-[10px] font-bold text-rose-600 hover:bg-rose-100 hover:text-rose-700 p-0 mt-1"
                              onClick={async () => {
                                if (confirm(`Deseja restaurar para a Versão ${v.version_number}? Uma nova versão será criada.`)) {
                                  const token = localStorage.getItem('token');
                                  const toastId = toast.loading("Restaurando versão...");
                                  try {
                                    const response = await fetch(`/api/v1/documents/${documentId}/restore`, {
                                      method: 'POST',
                                      headers: { 
                                        'Authorization': `Bearer ${token}`,
                                        'Content-Type': 'application/json'
                                      },
                                      body: JSON.stringify({ version_number: v.version_number })
                                    });
                                    if (response.ok) {
                                      toast.success("Versão restaurada com sucesso!", { id: toastId });
                                      fetchVersions();
                                    } else {
                                      toast.error("Erro ao restaurar versão", { id: toastId });
                                    }
                                  } catch {
                                    toast.error("Erro de conexão", { id: toastId });
                                  }
                                }
                              }}
                            >
                              <History className="h-3 w-3 mr-1" />
                              Restaurar esta versão
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>

        {/* Sidebar for annotations (Desktop only) */}
        <div className="hidden lg:flex w-80 bg-white border-l border-border flex-col shadow-xl">
          <div className="p-6 border-b border-border bg-slate-50/50">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-blue-600" />
              Anotações do Documento
            </h3>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">Clique no documento para adicionar notas</p>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {annotations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3">
                    <Pin className="h-6 w-6 text-slate-300" />
                  </div>
                  <p className="text-sm font-bold text-slate-400">Nenhuma anotação ainda.</p>
                  <p className="text-[11px] text-slate-400 mt-1">As notas que você criar aparecerão aqui para fácil acesso.</p>
                </div>
              ) : (
                annotations.map((note) => (
                  <div 
                    key={note.id} 
                    className="p-3 rounded-xl border border-border hover:border-blue-100 hover:bg-blue-50/30 transition-all cursor-pointer group"
                    onClick={() => {
                      setCurrentPage(note.page_number);
                      // Adicionar lógica de scroll para a nota
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase tracking-tighter">
                        Pág. {note.page_number}
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {note.created_at ? new Date(note.created_at).toLocaleDateString() : 'Agora'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-3 font-medium leading-relaxed">
                      {note.content || 'Sem conteúdo...'}
                    </p>
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                      <Avatar className="h-5 w-5 border border-white shadow-sm">
                        <AvatarFallback className="text-[8px] bg-slate-200 font-bold">U</AvatarFallback>
                      </Avatar>
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Usuário</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          {canEdit && (
            <div className="p-4 bg-slate-50 border-t border-border">
              <Button 
                className={`w-full rounded-xl gap-2 font-bold shadow-sm transition-all active:scale-95 ${
                  isAddingNote ? 'bg-rose-500 hover:bg-rose-600' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                onClick={() => setIsAddingNote(!isAddingNote)}
              >
                {isAddingNote ? (
                  <>
                    <X className="h-4 w-4" />
                    Cancelar Adição
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Nova Anotação
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Floating Toolbar for Mobile - Native Style */}
        <div className="lg:hidden fixed bottom-6 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-xl border border-border/50 shadow-2xl rounded-2xl flex items-center gap-1 p-1.5 z-40">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-10 w-10 rounded-xl"
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          
          <div className="px-3 flex flex-col items-center min-w-[60px]">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-tighter leading-none mb-0.5">Página</span>
            <span className="text-xs font-bold text-slate-900">{currentPage} / {numPages || '?'}</span>
          </div>

          <Button 
            variant="ghost" 
            size="icon" 
            className="h-10 w-10 rounded-xl"
            onClick={() => setCurrentPage(prev => Math.min(numPages || prev, prev + 1))}
            disabled={currentPage === numPages}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {canEdit && (
            <>
              <Button 
                variant={isAddingNote && selectedType === 'post-it' ? "default" : "ghost"} 
                size="icon" 
                className={`h-10 w-10 rounded-xl ${isAddingNote && selectedType === 'post-it' ? 'bg-blue-600' : ''}`}
                onClick={() => {
                  if (isAddingNote && selectedType === 'post-it') setIsAddingNote(false);
                  else { setIsAddingNote(true); setSelectedType('post-it'); }
                }}
              >
                <Pin className="h-5 w-5" />
              </Button>
              <Button 
                variant={isAddingNote && selectedType === 'text' ? "default" : "ghost"} 
                size="icon" 
                className={`h-10 w-10 rounded-xl ${isAddingNote && selectedType === 'text' ? 'bg-blue-600' : ''}`}
                onClick={() => {
                  if (isAddingNote && selectedType === 'text') setIsAddingNote(false);
                  else { setIsAddingNote(true); setSelectedType('text'); }
                }}
              >
                <Type className="h-5 w-5" />
              </Button>
              <Button 
                variant={isAddingNote && selectedType === 'highlighter' ? "default" : "ghost"} 
                size="icon" 
                className={`h-10 w-10 rounded-xl ${isAddingNote && selectedType === 'highlighter' ? 'bg-blue-600' : ''}`}
                onClick={() => {
                  if (isAddingNote && selectedType === 'highlighter') setIsAddingNote(false);
                  else { setIsAddingNote(true); setSelectedType('highlighter'); }
                }}
              >
                <Highlighter className="h-5 w-5" />
              </Button>
            </>
          )}

          <Button 
            variant="ghost" 
            size="icon" 
            className="h-10 w-10 rounded-xl"
            onClick={() => setZoom(prev => prev === 100 ? 150 : 100)}
          >
            {zoom > 100 ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-3xl p-8">
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mb-4">
              <Trash2 className="h-8 w-8 text-rose-500" />
            </div>
            <DialogTitle className="text-xl font-extrabold text-slate-900 mb-2">Excluir Anotação?</DialogTitle>
            <DialogDescription className="text-slate-500 font-medium">
              Esta ação não pode ser desfeita. A nota será removida permanentemente deste documento.
            </DialogDescription>
            <div className="flex w-full gap-3 mt-8">
              <Button 
                variant="outline" 
                className="flex-1 rounded-2xl h-12 font-bold border-border"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
              >
                Cancelar
              </Button>
              <Button 
                variant="destructive" 
                className="flex-1 rounded-2xl h-12 font-bold bg-rose-500 hover:bg-rose-600 shadow-lg shadow-rose-200"
                onClick={confirmDeleteAnnotation}
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Excluir"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DocumentViewer;
