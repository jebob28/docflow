package service

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type OCRService struct{}

func NewOCRService() *OCRService {
	return &OCRService{}
}

// ExtractText extrai texto de um arquivo usando Tesseract OCR
func (s *OCRService) ExtractText(ctx context.Context, filePath string) (string, error) {
	// Verifica se o arquivo existe
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return "", fmt.Errorf("arquivo não encontrado: %s", filePath)
	}

	ext := strings.ToLower(filepath.Ext(filePath))
	var processingPath = filePath

	// Se for PDF, converte para imagem primeiro
	if ext == ".pdf" {
		// 1. Verificação básica de cabeçalho PDF
		fHeader, err := os.Open(filePath)
		if err == nil {
			header := make([]byte, 5)
			_, _ = fHeader.Read(header)
			fHeader.Close()
			if string(header) != "%PDF-" {
				// Tenta verificar se é uma imagem com extensão errada
				// Se for, processa direto como imagem
				return s.processAsImage(ctx, filePath)
			}
		}

		imgBase := filepath.Join(os.TempDir(), fmt.Sprintf("ocr_img_%d_%d", os.Getpid(), time.Now().UnixNano()))
		// ... resto do código
		// Tenta converter PDF para PNG usando pdftoppm (300 DPI)
		// Adicionamos flags para lidar melhor com PDFs problemáticos:
		// -sep "" : evita espaços extras nos nomes
		// -r 300  : resolução adequada para OCR
		cmd := exec.CommandContext(ctx, "pdftoppm", "-png", "-r", "300", filePath, imgBase)
		output, err := cmd.CombinedOutput()
		if err != nil {
			// Se falhar, tentamos uma abordagem alternativa: gs (Ghostscript) se disponível,
			// ou tentamos processar mesmo com erros se houver saída parcial.
			if !strings.Contains(string(output), "Syntax Error") {
				return "", fmt.Errorf("erro ao converter PDF para imagem: %v, output: %s", err, string(output))
			}
			// Se for erro de sintaxe, verificamos se alguma imagem foi gerada apesar do erro
		}

		// pdftoppm gera arquivos como imgBase-1.png, imgBase-2.png etc.
		matches, _ := filepath.Glob(imgBase + "-*.png")
		if len(matches) == 0 {
			// Se pdftoppm falhou totalmente, tentamos usar o pdfcpu para "limpar" o PDF antes de tentar novamente
			cleanPath := filePath + ".clean.pdf"
			cleanCmd := exec.CommandContext(ctx, "pdfcpu", "optimize", filePath, cleanPath)
			if errClean := cleanCmd.Run(); errClean == nil {
				defer os.Remove(cleanPath)
				// Tenta pdftoppm novamente com o arquivo limpo
				cmdRetry := exec.CommandContext(ctx, "pdftoppm", "-png", "-r", "300", cleanPath, imgBase)
				if _, errRetry := cmdRetry.CombinedOutput(); errRetry == nil {
					matches, _ = filepath.Glob(imgBase + "-*.png")
				}
			}

			if len(matches) == 0 {
				return "", fmt.Errorf("falha crítica ao processar PDF: o arquivo parece estar corrompido ou em formato inválido. Erro original: %s", string(output))
			}
		}

		// Cria um arquivo de lista para o Tesseract processar todas as imagens de uma vez
		listFile := imgBase + ".list.txt"
		f, err := os.Create(listFile)
		if err != nil {
			return "", err
		}
		for _, m := range matches {
			f.WriteString(m + "\n")
		}
		f.Close()

		processingPath = listFile
		defer func() {
			os.Remove(listFile)
			for _, m := range matches {
				os.Remove(m)
			}
		}()
	}

	return s.runTesseract(ctx, processingPath)
}

func (s *OCRService) runTesseract(ctx context.Context, processingPath string) (string, error) {
	outputBase := filepath.Join(os.TempDir(), fmt.Sprintf("ocr_out_%d_%d", os.Getpid(), time.Now().UnixNano()))
	outputFile := outputBase + ".txt"
	defer os.Remove(outputFile)

	cmd := exec.CommandContext(ctx, "tesseract", processingPath, outputBase, "-l", "por+eng", "txt")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("erro ao executar tesseract: %v, output: %s", err, string(output))
	}

	content, err := os.ReadFile(outputFile)
	if err != nil {
		return "", fmt.Errorf("erro ao ler arquivo de saída do ocr: %v", err)
	}

	return strings.TrimSpace(string(content)), nil
}

func (s *OCRService) processAsImage(ctx context.Context, filePath string) (string, error) {
	return s.runTesseract(ctx, filePath)
}
