import { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { 
  X, 
  RefreshCw, 
  Zap, 
  ZapOff, 
  Image as ImageIcon,
  Check,
  RotateCcw,
  Loader2,
  FolderOpen,
  Building2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Sector {
  id: string;
  name: string;
}

interface Folder {
  id: string;
  name: string;
  sector_id: string;
}

export default function Scanner() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSelectModalOpen, setIsSelectModalOpen] = useState(false);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedSectorId, setSelectedSectorId] = useState<string>("");
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [isLoadingSectors, setIsLoadingSectors] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  // Debug Logger System
  useEffect(() => {
    const originalLog = console.log;
    const originalError = console.error;

    const addLog = (type: string, ...args: unknown[]) => {
      try {
        const msg = `[${type}] ${args.map(a => {
          if (a instanceof Error) return a.message;
          return typeof a === 'object' ? JSON.stringify(a) : String(a);
        }).join(' ')}`;
        setDebugLogs(prev => [msg, ...prev].slice(0, 30));
      } catch {
        // Silently fail to avoid infinite loop
      }
      originalLog.apply(console, args);
    };

    console.log = (...args) => addLog('LOG', ...args);
    console.error = (...args) => addLog('ERROR', ...args);

    const errorHandler = (event: ErrorEvent) => {
      addLog('CRASH', event.error?.message || event.message);
    };

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      addLog('PROMISE', event.reason?.message || String(event.reason));
    };

    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', rejectionHandler);

    return () => {
      console.log = originalLog;
      console.error = originalError;
      window.removeEventListener('error', errorHandler);
      window.removeEventListener('unhandledrejection', rejectionHandler);
    };
  }, []);
  const [cropPoints, setCropPoints] = useState<{ x: number, y: number }[]>([
    { x: 10, y: 10 },   // Top Left
    { x: 90, y: 10 },   // Top Right
    { x: 90, y: 90 },   // Bottom Right
    { x: 10, y: 90 }    // Bottom Left
  ]);
  const [isDragging, setIsDragging] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number, y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const startCamera = useCallback(async () => {
    try {
      setIsLoading(true);
      setCameraError(null);

      // Verificação de Contexto Seguro (HTTPS)
      if (!window.isSecureContext) {
        setCameraError("A câmera exige uma conexão HTTPS segura e válida. Certificados auto-assinados são bloqueados por navegadores mobile.");
        setIsLoading(false);
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Seu navegador não suporta acesso à câmera ou o HTTPS é inválido.");
      setIsLoading(false);
      return;
    }

    const constraints: MediaStreamConstraints = {
      video: { 
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };

    const newStream = await navigator.mediaDevices.getUserMedia(constraints);

    if (videoRef.current) {
      videoRef.current.srcObject = newStream;
      // Importante para mobile: muted e playsInline são essenciais
      videoRef.current.setAttribute('playsinline', 'true');
      videoRef.current.setAttribute('muted', 'true');
      
      try {
        await videoRef.current.play();
      } catch (playErr) {
        console.error("Erro ao dar play no vídeo:", playErr);
        // Tenta play novamente após interação se falhar
        const retryPlay = () => {
          videoRef.current?.play();
          document.removeEventListener('touchstart', retryPlay);
        };
        document.addEventListener('touchstart', retryPlay);
      }
      setStream(newStream);
      setIsCameraReady(true);
      setIsLoading(false);
    }
  } catch (err) {
    setIsLoading(false);
    console.error("Erro detalhado da câmera:", err);
    const error = err as Error;
    let errorMsg = "Não foi possível iniciar a câmera.";
    
    if (error.name === 'NotAllowedError') {
      errorMsg = "Acesso negado. Habilite a câmera nas configurações do seu celular.";
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      errorMsg = "Câmera traseira não encontrada.";
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      errorMsg = "A câmera já está sendo usada por outro aplicativo.";
    }
    
    setCameraError(errorMsg);
    toast.error(errorMsg);
  }
}, [facingMode]); // Agora depende apenas de facingMode, não de stream

  useEffect(() => {
    const checkPWAAndScreen = () => {
      if (window.innerWidth >= 1024) {
        navigate('/dashboard');
        return;
      }
    };

    checkPWAAndScreen();
    
    let active = true;
    const init = async () => {
      if (active && !capturedImage) await startCamera();
    };
    
    init();

    return () => {
      active = false;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [facingMode, navigate, startCamera, capturedImage]); // Adicionado capturedImage, stream removido para evitar loop
  const toggleCamera = () => {
    setIsCameraReady(false);
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const fetchSectors = async () => {
    console.log("Iniciando fetchSectors...");
    setIsLoadingSectors(true);
    try {
      const token = localStorage.getItem('token');
      console.log("Token obtido:", token ? "Sim" : "Não");
      const response = await fetch('/api/v1/sectors', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log("Resposta fetchSectors:", response.status);
      if (response.ok) {
        const data = await response.json();
        const sectorList = data.sectors || [];
        console.log("Setores carregados:", sectorList.length);
        setSectors(sectorList);
      } else {
        console.error("Erro na resposta de setores:", response.statusText);
      }
    } catch (error) {
      console.error("Erro ao carregar setores:", error);
      toast.error("Erro ao carregar setores. Verifique sua conexão.");
    } finally {
      setIsLoadingSectors(false);
    }
  };

  const fetchFolders = async (sectorId: string) => {
    console.log("Iniciando fetchFolders para setor:", sectorId);
    try {
      const token = localStorage.getItem('token');
      // O endpoint correto é /api/v1/documents com o parâmetro sector_id
      const response = await fetch(`/api/v1/documents?sector_id=${sectorId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log("Resposta fetchFolders:", response.status);
      if (response.ok) {
        const data = await response.json();
        const folderList = data.folders || [];
        console.log("Pastas carregadas:", folderList.length);
        setFolders(folderList);
      }
    } catch (error) {
      console.error("Erro ao carregar pastas:", error);
    }
  };

  const handleOpenSelectModal = () => {
    console.log("Botão Salvar PDF clicado. Chamando handleOpenSelectModal...");
    try {
      fetchSectors();
      setIsSelectModalOpen(true);
      console.log("isSelectModalOpen definido como true");
    } catch (err) {
      console.error("Erro em handleOpenSelectModal:", err);
    }
  };

  const capturePhoto = () => {
    setIsCapturing(true);
    console.log("Tentando capturar foto com recorte inteligente...");
    
    setTimeout(() => {
      if (videoRef.current && canvasRef.current && guideRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const guide = guideRef.current;
        const context = canvas.getContext('2d');

        if (context && video.videoWidth > 0) {
          // Obtém dimensões reais da stream
          const vWidth = video.videoWidth;
          const vHeight = video.videoHeight;
          
          // Obtém dimensões dos elementos na tela
          const videoRect = video.getBoundingClientRect();
          const guideRect = guide.getBoundingClientRect();
          
          // Calcula a escala do object-cover
          // O vídeo é escalado para preencher o container (videoRect) mantendo o aspecto
          const scale = Math.max(videoRect.width / vWidth, videoRect.height / vHeight);
          
          // Dimensões do vídeo renderizado (que pode ser maior que o videoRect)
          const renderedWidth = vWidth * scale;
          const renderedHeight = vHeight * scale;
          
          // Offsets do vídeo renderizado em relação ao elemento video (centralizado por padrão)
          const offsetX = (renderedWidth - videoRect.width) / 2;
          const offsetY = (renderedHeight - videoRect.height) / 2;
          
          // Posição do guia relativa ao vídeo renderizado
          const boxXInRendered = (guideRect.left - videoRect.left) + offsetX;
          const boxYInRendered = (guideRect.top - videoRect.top) + offsetY;
          
          // Converte as coordenadas do guia (tela) para coordenadas da stream (pixels reais)
          const sourceX = boxXInRendered / scale;
          const sourceY = boxYInRendered / scale;
          const sourceWidth = guideRect.width / scale;
          const sourceHeight = guideRect.height / scale;

          // Ajusta o canvas para o tamanho do recorte (mantendo a qualidade)
          canvas.width = sourceWidth;
          canvas.height = sourceHeight;
          
          // Desenha exatamente o que o usuário vê dentro do guia
          context.drawImage(
            video, 
            sourceX, sourceY, sourceWidth, sourceHeight, // Origem (pixels reais do vídeo)
            0, 0, sourceWidth, sourceHeight              // Destino (canvas)
          );
          
          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          setCapturedImage(dataUrl);
          
          // Reseta os pontos de ajuste para as bordas da imagem já recortada
          setCropPoints([
            { x: 2, y: 2 },
            { x: 98, y: 2 },
            { x: 98, y: 98 },
            { x: 2, y: 98 }
          ]);
          
          if (stream) {
            stream.getTracks().forEach(track => track.stop());
          }
        }
      }
      setIsCapturing(false);
    }, 150);
  };

  const handleRetake = () => {
    setCapturedImage(null);
    startCamera();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isDragging === null || !containerRef.current || !imageRef.current) return;
    
    const rect = imageRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    
    // Calcula posição percentual (0-100) relativa apenas à imagem
    let x = ((touch.clientX - rect.left) / rect.width) * 100;
    let y = ((touch.clientY - rect.top) / rect.height) * 100;
    
    // Magnetic Snapping (Intelligence) - Snap to edges if within 3%
    if (x < 3) x = 0;
    if (x > 97) x = 100;
    if (y < 3) y = 0;
    if (y > 97) y = 100;
    
    // Limites
    x = Math.max(0, Math.min(100, x));
    y = Math.max(0, Math.min(100, y));
    
    setDragPos({ x: touch.clientX, y: touch.clientY });
    setCropPoints(prev => {
      const newPoints = [...prev];
      newPoints[isDragging] = { x, y };
      return newPoints;
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(null);
    setDragPos(null);
  };

  const handleConfirm = async () => {
    console.log("Iniciando handleConfirm...");
    if (!capturedImage || !canvasRef.current || isSaving) {
      console.log("Abortando handleConfirm: captImg?", !!capturedImage, "canvas?", !!canvasRef.current, "isSaving?", isSaving);
      return;
    }

    if (!selectedSectorId) {
      console.log("Abortando: setor não selecionado");
      toast.error("Por favor, selecione um setor antes de salvar.");
      return;
    }

    setIsSaving(true);
    setIsSelectModalOpen(false);
    console.log("Iniciando processo de geração de PDF...");
    const toastId = toast.loading("Processando e salvando documento...");

    try {
      const img = new Image();
      img.src = capturedImage;
      
      console.log("Aguardando carregamento da imagem...");
      await new Promise((resolve, reject) => {
        img.onload = () => {
          console.log("Imagem carregada com sucesso");
          resolve(null);
        };
        img.onerror = (e) => {
          console.error("Erro ao carregar imagem:", e);
          reject(e);
        };
      });

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Não foi possível obter o contexto do canvas");

      console.log("Preparando canvas A4...");
      // Define tamanho do documento final (A4 proporcional - 300 DPI aprox)
      canvas.width = 2480;
      canvas.height = 3508;

      // Limpa e desenha fundo branco
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      console.log("Aplicando recorte e filtros...");
      // Calcula as coordenadas reais na imagem original baseada nos pontos percentuais
      const minX = Math.min(...cropPoints.map(p => p.x)) * img.width / 100;
      const maxX = Math.max(...cropPoints.map(p => p.x)) * img.width / 100;
      const minY = Math.min(...cropPoints.map(p => p.y)) * img.height / 100;
      const maxY = Math.max(...cropPoints.map(p => p.y)) * img.height / 100;

      const width = maxX - minX;
      const height = maxY - minY;

      // Aplica filtros de escaneamento
      ctx.filter = 'grayscale(1) contrast(1.4) brightness(1.1)';
      ctx.drawImage(img, minX, minY, width, height, 0, 0, canvas.width, canvas.height);

      console.log("Gerando PDF...");
      // 1. Gerar PDF usando jsPDF
      const finalImage = canvas.toDataURL('image/jpeg', 0.85);
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      pdf.addImage(finalImage, 'JPEG', 0, 0, 210, 297);
      const pdfBlob = pdf.output('blob');
      console.log("PDF gerado, tamanho do blob:", pdfBlob.size);

      // 2. Preparar Upload
      const token = localStorage.getItem('token');
      const timestamp = new Date().getTime();
      const fileName = `scanner_${timestamp}.pdf`;
      
      const formData = new FormData();
      formData.append('file', pdfBlob, fileName);
      formData.append('sector_id', selectedSectorId);
      if (selectedFolderId) {
        formData.append('folder_id', selectedFolderId);
      }

      console.log("Iniciando upload para o servidor...");
      // 3. Enviar para o Backend
      const response = await fetch('/api/v1/documents/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      console.log("Resposta do servidor:", response.status);
      if (!response.ok) {
        throw new Error(`Falha no upload: ${response.statusText}`);
      }

      toast.success("Documento salvo como PDF com sucesso!", { id: toastId });
      console.log("Sucesso! Redirecionando...");
      navigate('/documents');
    } catch (error) {
      console.error("Erro fatal em handleConfirm:", error);
      toast.error("Erro ao processar ou salvar o documento.", { id: toastId });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#0f172a] z-[100] flex flex-col overflow-hidden">
      {isLoading && !cameraError && (
        <div className="absolute inset-0 z-[120] bg-[#0f172a] flex flex-col items-center justify-center p-6 text-center">
          <RefreshCw className="h-10 w-10 text-blue-500 animate-spin mb-4" />
          <h2 className="text-white text-lg font-bold mb-2">Iniciando Câmera</h2>
          <p className="text-slate-400">Aguarde um momento...</p>
        </div>
      )}

      {cameraError && (
        <div className="absolute inset-0 z-[110] bg-slate-900 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
            <X className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="text-white text-lg font-bold mb-2">Erro na Câmera</h2>
          <p className="text-slate-400 mb-6">{cameraError}</p>
          <div className="flex flex-col w-full gap-3">
            <Button 
              onClick={() => startCamera()} 
              className="w-full bg-blue-600 hover:bg-blue-700 text-white h-12 rounded-xl"
            >
              Tentar Novamente
            </Button>
            <Button 
              variant="ghost"
              onClick={() => navigate('/dashboard')} 
              className="w-full text-slate-400 hover:text-white h-12"
            >
              Voltar ao Dashboard
            </Button>
          </div>
          
          <div className="mt-8 pt-8 border-t border-slate-800 w-full text-left">
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-2">Debug Info:</p>
            <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
              <p>HTTPS: <span className={window.isSecureContext ? "text-green-500" : "text-red-500"}>{window.isSecureContext ? "Sim" : "Não"}</span></p>
              <p>MediaDevices: <span className={navigator.mediaDevices ? "text-green-500" : "text-red-500"}>{navigator.mediaDevices ? "Sim" : "Não"}</span></p>
              <p>User Agent: <span className="text-slate-500 truncate block">{navigator.userAgent}</span></p>
            </div>
          </div>
        </div>
      )}

      {!capturedImage ? (
        <>
          {/* Camera View */}
          <div className="relative flex-1 flex items-center justify-center overflow-hidden">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
            
            {/* Flash Effect */}
            {isCapturing && (
              <div className="absolute inset-0 bg-white z-[30] animate-in fade-in duration-75" />
            )}
            
            {/* Scanning Overlay / Guide */}
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-8">
              {/* Darkened edges */}
              <div className="absolute inset-0 bg-black/40" />
              
              {/* Clear guide area */}
              <div 
                ref={guideRef}
                className="relative w-full aspect-[1/1.414] max-w-sm border-2 border-white/80 rounded-2xl shadow-[0_0_0_1000px_rgba(0,0,0,0.4)]"
              >
                {/* Corner Accents */}
                <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-blue-500 rounded-tl-xl" />
                <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-blue-500 rounded-tr-xl" />
                <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-blue-500 rounded-bl-xl" />
                <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-blue-500 rounded-br-xl" />
                
                {/* Scanning line animation */}
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.8)] animate-scan-line" />
              </div>
              
              <p className="mt-8 text-white text-sm font-medium bg-black px-4 py-2 rounded-full animate-pulse">
                Posicione o documento no quadro
              </p>
            </div>

            {/* Top Bar Controls */}
            <div className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between z-20 pt-safe">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => navigate(-1)}
                className="bg-[#0f172a] text-white hover:bg-slate-800 rounded-full"
              >
                <X className="h-6 w-6" />
              </Button>
              
              <div className="flex items-center gap-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setIsFlashOn(!isFlashOn)}
                  className="bg-[#0f172a] text-white hover:bg-slate-800 rounded-full"
                >
                  {isFlashOn ? <Zap className="h-5 w-5 text-yellow-400 fill-yellow-400" /> : <ZapOff className="h-5 w-5" />}
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={toggleCamera}
                  className="bg-[#0f172a] text-white hover:bg-slate-800 rounded-full"
                >
                  <RefreshCw className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Bottom Bar Controls */}
          <div className="bg-[#0f172a] p-8 pb-safe shrink-0 flex items-center justify-around z-20">
            <Button variant="ghost" size="icon" className="text-white opacity-60">
              <ImageIcon className="h-6 w-6" />
            </Button>
            
            <button 
              onClick={capturePhoto}
              disabled={!isCameraReady}
              className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-90 transition-transform disabled:opacity-50"
            >
              <div className="w-16 h-16 bg-white rounded-full border-2 border-black/10 shadow-inner" />
            </button>
            
            <div className="w-10 h-10" /> {/* Spacer */}
          </div>
        </>
      ) : (
        <>
          {/* Captured Image Preview & Cropping */}
          <div 
            className="flex-1 relative bg-slate-900 flex items-center justify-center p-4 overflow-hidden"
            ref={containerRef}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className="relative inline-block">
              <img 
                ref={imageRef}
                src={capturedImage} 
                alt="Captured" 
                className="max-w-full max-h-[70vh] object-contain shadow-2xl rounded-sm select-none pointer-events-none"
                style={{ 
                  filter: 'grayscale(1) contrast(1.5) brightness(1.1)',
                }}
              />
              
              {/* Crop Overlay Canvas / SVG */}
              <svg className="absolute inset-0 w-full h-full z-10 overflow-visible">
                {/* Connecting Lines */}
                <path
                  d={`M ${cropPoints[0].x}% ${cropPoints[0].y}% L ${cropPoints[1].x}% ${cropPoints[1].y}% L ${cropPoints[2].x}% ${cropPoints[2].y}% L ${cropPoints[3].x}% ${cropPoints[3].y}% Z`}
                  fill="rgba(59, 130, 246, 0.2)"
                  stroke="var(--color-primary)"
                  strokeWidth="2"
                  strokeDasharray="4"
                />
                
                {/* Corner Handles */}
                {cropPoints.map((point, idx) => (
                  <circle
                    key={idx}
                    cx={`${point.x}%`}
                    cy={`${point.y}%`}
                    r="15"
                    fill="white"
                    stroke="var(--color-primary)"
                    strokeWidth="3"
                    className="cursor-pointer active:scale-110 transition-transform shadow-xl"
                    onTouchStart={(e) => {
                      e.stopPropagation();
                      setIsDragging(idx);
                      const touch = e.touches[0];
                      setDragPos({ x: touch.clientX, y: touch.clientY });
                    }}
                  />
                ))}
              </svg>

              {/* Magnifier (Intelligence/UX) */}
              {isDragging !== null && dragPos && (
                <div 
                  className="fixed pointer-events-none z-50 overflow-hidden rounded-full border-4 border-white shadow-2xl"
                  style={{
                    left: dragPos.x - 60,
                    top: dragPos.y - 140, // Aparece acima do dedo
                    width: 120,
                    height: 120,
                    backgroundColor: '#000'
                  }}
                >
                  <div 
                    style={{
                      position: 'absolute',
                      width: '400%', // 4x zoom
                      height: '400%',
                      left: `${-cropPoints[isDragging].x * 4 + 12.5}%`,
                      top: `${-cropPoints[isDragging].y * 4 + 12.5}%`,
                      backgroundImage: `url(${capturedImage})`,
                      backgroundSize: '100% 100%',
                      filter: 'grayscale(1) contrast(1.5) brightness(1.1)',
                    }}
                  />
                  {/* Magnifier Crosshair */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-full h-0.5 bg-blue-500/50" />
                    <div className="h-full w-0.5 bg-blue-500/50 absolute" />
                  </div>
                </div>
              )}
            </div>

            <div className="absolute top-8 left-0 right-0 text-center">
              <span className="bg-blue-600 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest shadow-lg">
                Arraste os cantos com precisão
              </span>
            </div>
          </div>

          {/* Bottom Bar Review Controls */}
          <div className="bg-[#0f172a] p-8 pb-safe shrink-0 flex items-center gap-4 z-20">
            <Button 
              onClick={handleRetake}
              variant="outline"
              className="flex-1 h-14 bg-white/5 border-white/10 text-white rounded-2xl font-bold hover:bg-white/10"
            >
              <RotateCcw className="h-5 w-5 mr-2" />
              Repetir
            </Button>
            <Button 
              onClick={handleOpenSelectModal}
              disabled={isSaving}
              className="flex-1 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-lg shadow-blue-500/20"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Check className="h-5 w-5 mr-2" />
                  Salvar PDF
                </>
              )}
            </Button>
          </div>
        </>
      )}

      {/* Modal de Seleção de Setor e Pasta - Versão Estável para Mobile (Sem Portals) */}
      {isSelectModalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
            onClick={() => setIsSelectModalOpen(false)}
          />
          
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
                  <FolderOpen className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Salvar Documento</h3>
                  <p className="text-sm text-slate-500">Escolha o destino final</p>
                </div>
              </div>
              
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <Building2 className="h-3 w-3" />
                    Setor Responsável
                  </label>
                  <Select 
                    value={selectedSectorId} 
                    onValueChange={(val) => {
                      console.log("Setor selecionado:", val);
                      setSelectedSectorId(val);
                      setSelectedFolderId("");
                      fetchFolders(val);
                    }}
                  >
                    <SelectTrigger className="h-14 bg-white border-none rounded-2xl focus:ring-blue-500 text-slate-900">
                      <SelectValue placeholder={isLoadingSectors ? "Carregando..." : "Selecione o setor"} />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-border rounded-2xl shadow-xl z-[10001]">
                      {Array.isArray(sectors) && sectors.length > 0 ? (
                        sectors.map((sector) => (
                          <SelectItem key={sector.id} value={sector.id} className="h-12 focus:bg-blue-50">
                            {sector.name}
                          </SelectItem>
                        ))
                      ) : (
                        <div className="p-4 text-center text-sm text-slate-400">Nenhum setor encontrado</div>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <FolderOpen className="h-3 w-3" />
                    Pasta (Opcional)
                  </label>
                  <Select 
                    value={selectedFolderId} 
                    onValueChange={setSelectedFolderId}
                    disabled={!selectedSectorId}
                  >
                    <SelectTrigger className="h-14 bg-white border-none rounded-2xl focus:ring-blue-500 text-slate-900">
                      <SelectValue placeholder={!selectedSectorId ? "Selecione um setor primeiro" : "Selecione a pasta (opcional)"} />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-border rounded-2xl shadow-xl z-[10001]">
                      <SelectItem value="none" className="h-12 focus:bg-blue-50">Nenhuma (Raiz do Setor)</SelectItem>
                      {Array.isArray(folders) && folders.length > 0 ? (
                        folders.map((folder) => (
                          <SelectItem key={folder.id} value={folder.id} className="h-12 focus:bg-blue-50">
                            {folder.name}
                          </SelectItem>
                        ))
                      ) : (
                        <div className="p-4 text-center text-sm text-slate-400">Nenhuma pasta encontrada</div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <Button 
                  variant="ghost" 
                  onClick={() => setIsSelectModalOpen(false)}
                  className="flex-1 h-14 rounded-2xl text-slate-500 font-bold"
                >
                  Cancelar
                </Button>
                <Button 
                  onClick={handleConfirm}
                  disabled={!selectedSectorId || isSaving}
                  className="flex-1 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-lg shadow-blue-500/20"
                >
                  {isSaving ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    "Salvar Agora"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Canvas for Processing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Debug Console UI */}
      <div className="fixed top-20 left-4 z-[10001] pointer-events-none">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => setShowDebug(!showDebug)}
          className="bg-black/50 text-[10px] text-white border-white/20 h-6 pointer-events-auto"
        >
          {showDebug ? 'Ocultar Debug' : 'Ver Debug'}
        </Button>
      </div>

      {showDebug && (
        <div className="fixed bottom-0 left-0 right-0 h-1/3 bg-black/90 text-white p-2 z-[10000] overflow-y-auto text-[10px] font-mono pointer-events-auto">
          <div className="flex justify-between items-center mb-2 border-b border-white/20 pb-1">
            <span className="font-bold">DEBUG CONSOLE</span>
            <button onClick={() => setDebugLogs([])} className="text-red-400">Limpar</button>
          </div>
          {debugLogs.map((log, i) => (
            <div key={i} className={`mb-1 ${log.includes('ERROR') || log.includes('CRASH') ? 'text-red-400' : log.includes('LOG') ? 'text-blue-300' : 'text-yellow-200'}`}>
              {log}
            </div>
          ))}
        </div>
      )}
      
      <style>{`
        @keyframes scan-line {
          0% { top: 0%; opacity: 0.5; }
          50% { opacity: 1; }
          100% { top: 100%; opacity: 0.5; }
        }
        .animate-scan-line {
          animation: scan-line 2.5s ease-in-out infinite;
        }
        .pt-safe {
          padding-top: env(safe-area-inset-top);
        }
        .pb-safe {
          padding-bottom: env(safe-area-inset-bottom);
        }
      `}</style>
    </div>
  );
}
