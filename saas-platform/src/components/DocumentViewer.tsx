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
  Loader2
} from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Avatar, AvatarFallback } from './ui/avatar';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";

// Configurar o worker do PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

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

interface DocumentViewerProps {
  documentId: string;
  documentName: string;
  fileUrl: string;
  canEdit?: boolean;
  onClose: () => void;
}

const DocumentViewer: React.FC<DocumentViewerProps> = ({ 
  documentId, 
  documentName, 
  fileUrl, 
  canEdit = false,
  onClose 
}) => {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [annotationToDelete, setAnnotationToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
          width: 200,
          height: 150,
          content: 'Nova nota...',
          color: '#fef3c7',
          is_private: false,
          font_family: 'Inter',
          annotation_type: 'post-it'
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

  const handleDownloadFile = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/documents/${documentId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = documentName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        toast.success("Download iniciado!");
      } else {
        toast.error("Erro ao baixar arquivo.");
      }
    } catch {
      toast.error("Erro de conexão ao baixar arquivo.");
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
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 bg-white border-b border-slate-200 shadow-sm pt-safe">
        <div className="flex items-center gap-3 sm:gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose} 
            className="rounded-full hover:bg-slate-100 transition-colors h-9 w-9 bg-slate-50 border border-slate-200 shadow-sm"
          >
            <ChevronLeft className="h-6 w-6 text-slate-900" />
          </Button>
          <div className="flex flex-col">
            <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-widest leading-none mb-1">Visualizando</span>
            <h2 className="text-sm sm:text-lg font-extrabold text-slate-900 leading-none truncate max-w-[150px] sm:max-w-md">{documentName}</h2>
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
            onClick={handleDownloadFile}
          >
            <Download className="h-5 w-5" />
          </Button>

          <Button 
            variant="outline" 
            className="hidden lg:flex rounded-full gap-2 border-slate-200 hover:bg-slate-50 font-bold"
            onClick={handleDownloadFile}
          >
            <Download className="h-4 w-4" />
            Baixar Original
          </Button>

          {canEdit && (
            <Button 
              className="rounded-full gap-2 bg-[#0f172a] hover:bg-[#1e293b] shadow-md transition-all active:scale-95 font-bold h-9 px-4 sm:h-10"
              onClick={() => toast.success("Todas as alterações foram salvas!")}
            >
              <Save className="h-4 w-4" />
              <span className="hidden sm:inline">Salvar</span>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Main Content Area */}
        <div className="flex-1 relative overflow-auto bg-slate-50 flex justify-center p-4 sm:p-8 scrollbar-hide">
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
            <Document
              file={fileUrl}
              onLoadSuccess={onDocumentLoadSuccess}
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
              <Page 
                pageNumber={currentPage} 
                renderAnnotationLayer={false}
                renderTextLayer={false}
                loading={null}
                width={window.innerWidth < 640 ? window.innerWidth - 32 : undefined}
              />
            </Document>

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
                          <div className="absolute top-full left-0 hidden group-hover/colors:flex bg-white shadow-xl rounded-lg p-1 gap-1 z-50 border border-slate-200">
                            {COLOR_OPTIONS.map(c => (
                              <div 
                                key={c} 
                                className="w-4 h-4 rounded-full border border-slate-200 cursor-pointer hover:scale-110" 
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
                          <div className="absolute top-full left-0 hidden group-hover/fonts:flex flex-col bg-white shadow-xl rounded-lg p-1 z-50 border border-slate-200 min-w-[100px]">
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
                          <div className="absolute top-full left-0 hidden group-hover/types:flex flex-col bg-white shadow-xl rounded-lg p-1 z-50 border border-slate-200 min-w-[100px]">
                            <div className="px-2 py-1 text-[10px] hover:bg-slate-100 cursor-pointer flex items-center gap-2" onClick={(e) => { e.stopPropagation(); handleUpdateAnnotation(note.id, { annotation_type: 'post-it' }); }}>
                              <div className="w-2 h-2 bg-yellow-200 border border-slate-300" /> Post-it
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

        {/* Sidebar for annotations (Desktop only) */}
        <div className="hidden lg:flex w-80 bg-white border-l border-slate-200 flex-col shadow-xl">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
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
                    className="p-3 rounded-xl border border-slate-100 hover:border-blue-100 hover:bg-blue-50/30 transition-all cursor-pointer group"
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
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-50">
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
            <div className="p-4 bg-slate-50 border-t border-slate-100">
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
        <div className="lg:hidden fixed bottom-6 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-xl border border-slate-200/50 shadow-2xl rounded-2xl flex items-center gap-1 p-1.5 z-40">
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
            <Button 
              variant={isAddingNote ? "default" : "ghost"} 
              size="icon" 
              className={`h-10 w-10 rounded-xl ${isAddingNote ? 'bg-blue-600' : ''}`}
              onClick={() => setIsAddingNote(!isAddingNote)}
            >
              <Plus className="h-5 w-5" />
            </Button>
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
        <DialogContent className="sm:max-w-[425px] rounded-3xl">
          <div className="flex flex-col items-center text-center p-4">
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
                className="flex-1 rounded-2xl h-12 font-bold border-slate-200"
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
