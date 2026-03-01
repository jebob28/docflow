package service

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gestao_documentos/internal/database"
	"github.com/google/uuid"
)

type WorkerService struct {
	db       *database.DB
	storage  *StorageService
	os       *OpenSearchService
	ocr      *OCRService
	vault    *VaultService
	security *SecurityService
}

func NewWorkerService(db *database.DB, storage *StorageService, os *OpenSearchService, ocr *OCRService, vault *VaultService, security *SecurityService) *WorkerService {
	return &WorkerService{
		db:       db,
		storage:  storage,
		os:       os,
		ocr:      ocr,
		vault:    vault,
		security: security,
	}
}

// Start inicia o loop do worker de OCR
func (s *WorkerService) Start(ctx context.Context) {
	log.Println("Worker de Processamento (OCR/Quarentena) iniciado...")
	tickerOCR := time.NewTicker(30 * time.Second)
	tickerQuarantine := time.NewTicker(1 * time.Minute)
	defer tickerOCR.Stop()
	defer tickerQuarantine.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("Worker de Processamento parando...")
			return
		case <-tickerOCR.C:
			s.ProcessPendingDocuments(ctx)
		case <-tickerQuarantine.C:
			s.ProcessQuarantineDocuments(ctx)
		}
	}
}

// ProcessQuarantineDocuments busca documentos em quarentena e envia para o VirusTotal
func (s *WorkerService) ProcessQuarantineDocuments(ctx context.Context) {
	query := `
		SELECT id, tenant_id, name, extension, minio_key 
		FROM documents 
		WHERE status = 'QUARANTINE' AND deleted_at IS NULL
		LIMIT 3`

	rows, err := s.db.Conn.QueryContext(ctx, query)
	if err != nil {
		log.Printf("Erro ao buscar documentos em QUARANTINE: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var docID, tenantID uuid.UUID
		var name, extension, minioKey string

		if err := rows.Scan(&docID, &tenantID, &name, &extension, &minioKey); err != nil {
			log.Printf("Erro ao escanear documento em quarentena: %v", err)
			continue
		}

		log.Printf("Iniciando Full Scan no VirusTotal para: %s (%s)", name, docID)
		if err := s.processFullScan(ctx, docID, tenantID, name, minioKey); err != nil {
			log.Printf("Erro no Full Scan do documento %s: %v", docID, err)
		}
	}
}

func (s *WorkerService) processFullScan(ctx context.Context, docID, tenantID uuid.UUID, name, minioKey string) error {
	// 1. Download do arquivo do MinIO
	reader, err := s.storage.GetEncrypted(ctx, minioKey)
	if err != nil {
		return err
	}
	defer reader.Close()

	payload, err := io.ReadAll(reader)
	if err != nil {
		return err
	}

	// 2. Descriptografar para obter o binário real
	var fileBytes []byte
	if strings.HasPrefix(string(payload), "vault:v1:") {
		decrypted, err := s.vault.DecryptData(ctx, tenantID.String(), string(payload))
		if err != nil {
			return err
		}
		fileBytes = decrypted
	} else if len(payload) > 4 {
		dekLen := binary.BigEndian.Uint32(payload[:4])
		if len(payload) >= int(4+dekLen) {
			encryptedDEK := string(payload[4 : 4+dekLen])
			encryptedFile := payload[4+dekLen:]
			dek, err := s.vault.DecryptData(ctx, tenantID.String(), encryptedDEK)
			if err != nil {
				return err
			}
			fileBytes, err = s.security.DecryptAES(encryptedFile, dek)
			if err != nil {
				return err
			}
		} else {
			fileBytes = payload
		}
	} else {
		fileBytes = payload
	}

	// 3. Upload para VirusTotal (Full Scan)
	analysisID, err := s.security.UploadFileToVT(fileBytes, name)
	if err != nil {
		return err
	}

	log.Printf("Arquivo %s enviado para VT. Analysis ID: %s. Aguardando resultado...", name, analysisID)

	// 4. Aguardar e verificar resultado (polling simples por ser worker)
	// Em um sistema real, poderíamos usar webhooks ou outro job para verificar depois.
	// Aqui faremos um pequeno retry/wait para o worker não travar.
	maxRetries := 5
	for i := 0; i < maxRetries; i++ {
		time.Sleep(15 * time.Second) // Aguarda o VT processar

		isSafe, status, err := s.security.GetVTAnalysisResult(analysisID)
		if err != nil {
			log.Printf("Erro ao consultar resultado do VT (tentativa %d): %v", i+1, err)
			continue
		}

		if status != "completed" {
			log.Printf("VT ainda processando %s (status: %s)...", name, status)
			continue
		}

		// Status final alcançado
		finalStatus := "ACTIVE"
		if !isSafe {
			finalStatus = "INFECTED"
			log.Printf("ALERTA: Documento %s identificado como MALICIOSO/SUSPEITO pelo VirusTotal!", name)
		} else {
			log.Printf("Documento %s verificado e limpo pelo VirusTotal.", name)
		}

		// 5. Atualizar banco de dados
		_, err = s.db.Conn.ExecContext(ctx, `
			UPDATE documents 
			SET status = $1, updated_at = NOW() 
			WHERE id = $2`, finalStatus, docID)
		return err
	}

	return fmt.Errorf("timeout aguardando análise do VirusTotal para %s", name)
}

// ProcessPendingDocuments busca e processa documentos que ainda não passaram pelo OCR
func (s *WorkerService) ProcessPendingDocuments(ctx context.Context) {
	query := `
		SELECT id, tenant_id, name, extension, minio_key, sector_id 
		FROM documents 
		WHERE ocr_text IS NULL AND ocr_processed_at IS NULL AND deleted_at IS NULL AND status = 'ACTIVE'
		LIMIT 5`

	rows, err := s.db.Conn.QueryContext(ctx, query)
	if err != nil {
		log.Printf("Erro ao buscar documentos pendentes de OCR: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var docID, tenantID uuid.UUID
		var name, extension, minioKey string
		var sectorID *uuid.UUID

		if err := rows.Scan(&docID, &tenantID, &name, &extension, &minioKey, &sectorID); err != nil {
			log.Printf("Erro ao escanear documento: %v", err)
			continue
		}

		log.Printf("Processando OCR para documento: %s (%s)", name, docID)
		if err := s.processDocument(ctx, docID, tenantID, name, extension, minioKey, sectorID); err != nil {
			log.Printf("Erro ao processar documento %s: %v", docID, err)
		}
	}
}

func (s *WorkerService) processDocument(ctx context.Context, docID, tenantID uuid.UUID, name, extension, minioKey string, sectorID *uuid.UUID) error {
	// 1. Download do arquivo do MinIO
	reader, err := s.storage.GetEncrypted(ctx, minioKey)
	if err != nil {
		return err
	}
	defer reader.Close()

	// 2. Ler o payload completo
	payload, err := io.ReadAll(reader)
	if err != nil {
		return err
	}

	if len(payload) < 4 {
		return fmt.Errorf("payload inválido (muito curto)")
	}

	// 3. Descriptografar
	var fileBytes []byte
	
	// Caso 1: Criptografia direta do Vault (começa com vault:v1:)
	if strings.HasPrefix(string(payload), "vault:v1:") {
		decrypted, err := s.vault.DecryptData(ctx, tenantID.String(), string(payload))
		if err != nil {
			return fmt.Errorf("falha ao descriptografar via Vault Transit para %s: %v", docID, err)
		}
		fileBytes = decrypted
	} else if len(payload) > 4 {
		// Caso 2: Criptografia de Envelope (DEK + AES)
		dekLen := binary.BigEndian.Uint32(payload[:4])
		if len(payload) >= int(4+dekLen) {
			encryptedDEK := string(payload[4 : 4+dekLen])
			encryptedFile := payload[4+dekLen:]

			dek, err := s.vault.DecryptData(ctx, tenantID.String(), encryptedDEK)
			if err != nil {
				return fmt.Errorf("falha ao descriptografar DEK no vault para %s: %v", docID, err)
			}
			fileBytes, err = s.security.DecryptAES(encryptedFile, dek)
			if err != nil {
				return fmt.Errorf("falha ao descriptografar arquivo %s com AES: %v", docID, err)
			}
		} else {
			fileBytes = payload
		}
	} else {
		fileBytes = payload
	}

	// 4. Salvar temporariamente para o Tesseract processar
	tempFile := filepath.Join(os.TempDir(), fmt.Sprintf("ocr_%s%s", docID, extension))
	if err := os.WriteFile(tempFile, fileBytes, 0644); err != nil {
		return err
	}
	defer os.Remove(tempFile)

	// 5. Extrair texto via OCR
	text, err := s.ocr.ExtractText(ctx, tempFile)
	if err != nil {
		return err
	}

	// 4. Atualizar Banco de Dados
	_, err = s.db.Conn.ExecContext(ctx, `
		UPDATE documents 
		SET ocr_text = $1, ocr_processed_at = NOW(), updated_at = NOW() 
		WHERE id = $2`, text, docID)
	if err != nil {
		return err
	}

	// 5. Indexar no OpenSearch
	if s.os != nil && text != "" {
		err = s.os.IndexDocument(ctx, DocumentIndex{
			ID:        docID.String(),
			TenantID:  tenantID,
			Name:      name,
			OCRText:   text,
			Extension: extension,
			SectorID:  sectorID,
			UpdatedAt: time.Now().Format(time.RFC3339),
		})
		if err != nil {
			log.Printf("Aviso: Falha ao indexar OCR no OpenSearch para %s: %v", docID, err)
		}
	}

	log.Printf("OCR concluído com sucesso para o documento: %s", name)
	return nil
}
