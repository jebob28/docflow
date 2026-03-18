package handlers

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gestao_documentos/internal/api/middleware"
	"gestao_documentos/internal/database"
	"gestao_documentos/internal/service"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

type DocumentHandler struct {
	db       *database.DB
	storage  *service.StorageService
	vault    *service.VaultService
	redis    *service.RedisService
	security *service.SecurityService
	os       *service.OpenSearchService
}

func NewDocumentHandler(db *database.DB, storage *service.StorageService, vault *service.VaultService, redis *service.RedisService, security *service.SecurityService, os *service.OpenSearchService) *DocumentHandler {
	// Forçar pdfcpu a não tentar criar pastas de configuração globalmente
	model.ConfigPath = "disable"
	return &DocumentHandler{
		db:       db,
		storage:  storage,
		vault:    vault,
		redis:    redis,
		security: security,
		os:       os,
	}
}

// sanitizeFilename remove caracteres potencialmente perigosos e evita path traversal
func sanitizeFilename(filename string) string {
	// 1. Pegar apenas o nome base (evita path traversal como ../../../etc/passwd)
	base := filepath.Base(filename)

	// 2. Substituir caracteres não alfanuméricos por underscore, mantendo o ponto da extensão
	// Mas uma abordagem mais simples e segura é permitir apenas caracteres conhecidos
	var result strings.Builder
	for _, r := range base {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			result.WriteRune(r)
		} else {
			result.WriteRune('_')
		}
	}

	finalName := result.String()
	if finalName == "" || finalName == "." || finalName == ".." {
		return "arquivo_sem_nome_" + time.Now().Format("20060102150405")
	}

	return finalName
}

func (h *DocumentHandler) canWrite(r *http.Request, sectorID *uuid.UUID) bool {
	claims, _ := middleware.GetClaims(r.Context())
	if claims.IsMaster || claims.Role == "MASTER" || claims.Role == "ADMIN" || claims.Role == "SAAS_ADMIN" {
		return true
	}

	// Se o item não tem setor, apenas MASTER/ADMIN pode editar
	if sectorID == nil {
		return false
	}

	// Verificar se o usuário tem permissão de 'GESTOR' ou 'WRITE' no setor
	var hasPerm bool
	err := h.db.Conn.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM user_sectors 
			WHERE user_id = $1 AND sector_id = $2 AND permission_type IN ('GESTOR', 'WRITE')
		)`, claims.UserID, sectorID).Scan(&hasPerm)

	if err != nil {
		log.Printf("Erro ao verificar permissão de setor: %v", err)
		return false
	}

	return hasPerm
}

func (h *DocumentHandler) isConfidential(tenantID uuid.UUID, itemID string, isFolder bool) bool {
	var hasConfidentialTag bool
	var query string
	if isFolder {
		query = `
			SELECT EXISTS (
				SELECT 1 FROM folder_tag_assignments fta
				JOIN document_tags dt ON dt.id = fta.tag_id
				WHERE fta.folder_id = $1 AND dt.tenant_id = $2 AND LOWER(dt.name) = LOWER('Confidencial')
			)`
	} else {
		query = `
			SELECT EXISTS (
				SELECT 1 FROM document_tag_assignments dta
				JOIN document_tags dt ON dt.id = dta.tag_id
				WHERE dta.document_id = $1 AND dt.tenant_id = $2 AND LOWER(dt.name) = LOWER('Confidencial')
			)`
	}

	err := h.db.Conn.QueryRow(query, itemID, tenantID).Scan(&hasConfidentialTag)
	if err != nil {
		log.Printf("Erro ao verificar se item é confidencial: %v", err)
		return false
	}
	return hasConfidentialTag
}

func (h *DocumentHandler) decryptDocument(ctx context.Context, tenantID uuid.UUID, encryptedData io.Reader) ([]byte, error) {
	fullCiphertext, err := io.ReadAll(encryptedData)
	if err != nil {
		return nil, fmt.Errorf("erro ao ler dados criptografados: %v", err)
	}

	// Suporte a legado: Se começar com "vault:v1:", foi criptografado diretamente no Vault (método antigo)
	if bytes.HasPrefix(fullCiphertext, []byte("vault:v1:")) {
		var plaintext []byte
		plaintext, err = h.vault.DecryptData(ctx, tenantID.String(), string(fullCiphertext))
		if err != nil {
			return nil, fmt.Errorf("erro na descriptografia Vault legado: %v", err)
		}
		return plaintext, nil
	}

	// Método Novo: Criptografia de Envelope
	// 1. Extrair a DEK criptografada do header
	if len(fullCiphertext) < 4 {
		return nil, fmt.Errorf("arquivo corrompido: cabeçalho ausente")
	}

	dekLen := binary.BigEndian.Uint32(fullCiphertext[:4])
	if len(fullCiphertext) < int(4+dekLen) {
		return nil, fmt.Errorf("arquivo corrompido: payload incompleto")
	}

	encryptedDEK := string(fullCiphertext[4 : 4+dekLen])
	encryptedFileData := fullCiphertext[4+dekLen:]

	// 2. Descriptografar a DEK usando o Vault
	var dek []byte
	dek, err = h.vault.DecryptData(ctx, tenantID.String(), encryptedDEK)
	if err != nil {
		return nil, fmt.Errorf("erro na descriptografia Vault (DEK): %v", err)
	}

	// 3. Descriptografar o arquivo localmente com a DEK
	var plaintext []byte
	plaintext, err = h.security.DecryptAES(encryptedFileData, dek)
	if err != nil {
		return nil, fmt.Errorf("erro na descriptografia AES: %v", err)
	}

	return plaintext, nil
}

func (h *DocumentHandler) Upload(w http.ResponseWriter, r *http.Request) {
	// 1. Obter Tenant ID e User ID do contexto
	tenantID, ok := middleware.GetTenantID(r.Context())
	if !ok {
		RespondWithError(w, http.StatusUnauthorized, "Tenant não identificado")
		return
	}

	claims, _ := middleware.GetClaims(r.Context())
	userID := claims.UserID

	// 2. Parse do multipart form (Limite de 10MB por enquanto)
	err := r.ParseMultipartForm(10 << 20)
	if err != nil {
		RespondWithError(w, http.StatusBadRequest, "Arquivo muito grande ou formato inválido")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		RespondWithError(w, http.StatusBadRequest, "Arquivo não enviado (campo 'file')")
		return
	}
	defer file.Close()

	// Obter sector_id, folder_id e document_type_id se fornecidos
	sectorIDStr := r.FormValue("sector_id")
	folderIDStr := r.FormValue("folder_id")
	typeIDStr := r.FormValue("document_type_id")

	var sectorID *uuid.UUID
	var folderID *uuid.UUID
	var typeID *uuid.UUID

	if folderIDStr != "" {
		if id, e := uuid.Parse(folderIDStr); e == nil {
			folderID = &id
			// Se estiver em uma pasta, herdamos o setor dela se não for fornecido
			if sectorIDStr == "" {
				err = h.db.Conn.QueryRow("SELECT sector_id FROM folders WHERE id = $1 AND tenant_id = $2", folderID, tenantID).Scan(&sectorID)
				if err != nil {
					log.Printf("Erro ao buscar setor da pasta: %v", err)
				}
			}
		}
	}

	if sectorID == nil && sectorIDStr != "" {
		if id, e := uuid.Parse(sectorIDStr); e == nil {
			sectorID = &id
		}
	}

	if typeIDStr != "" {
		if id, e := uuid.Parse(typeIDStr); e == nil {
			typeID = &id
		}
	}

	// 2.5 Validação de permissão de escrita no setor
	if !h.canWrite(r, sectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão de escrita neste setor ou setor não especificado")
		return
	}

	// 2.6 Cálculo de retenção se tiver tipo
	var retentionDate *time.Time
	if typeID != nil {
		var years int
		err = h.db.Conn.QueryRow("SELECT retention_years FROM document_types WHERE id = $1 AND tenant_id = $2", typeID, tenantID).Scan(&years)
		if err == nil {
			rd := time.Now().AddDate(years, 0, 0)
			retentionDate = &rd
		}
	}

	// 3. Validação de Quota em Tempo Real (Redis)
	// Buscar limite do tenant no banco (ou cache se disponível)
	var maxStorage int64
	err = h.db.Conn.QueryRow("SELECT max_storage_bytes FROM tenant_quotas WHERE tenant_id = $1", tenantID).Scan(&maxStorage)
	if err != nil {
		// Se não tiver quota definida, assume 5GB padrão
		maxStorage = 5 * 1024 * 1024 * 1024
	}

	allowed, err := h.redis.CheckQuota(r.Context(), tenantID.String(), header.Size, maxStorage)
	if err != nil {
		log.Printf("Erro ao validar quota: %v", err)
	} else if !allowed {
		RespondWithError(w, http.StatusForbidden, "Limite de armazenamento atingido para este Tenant")
		return
	}

	// 4. Ler conteúdo para criptografia e validação
	fileBytes, err := io.ReadAll(file)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao ler arquivo")
		return
	}

	// 4.1 Validação de Segurança: Detectar Content-Type real (Magic Bytes)
	// Isso evita que um atacante envie um .exe renomeado para .pdf
	detectedType := http.DetectContentType(fileBytes)

	// Lista de tipos permitidos (ajuste conforme necessário)
	allowedTypes := map[string]bool{
		"application/pdf":    true,
		"image/jpeg":         true,
		"image/png":          true,
		"image/gif":          true,
		"image/webp":         true,
		"application/msword": true, // .doc
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true, // .docx
		"application/vnd.ms-excel": true, // .xls
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         true, // .xlsx
		"application/vnd.ms-powerpoint":                                             true, // .ppt
		"application/vnd.openxmlformats-officedocument.presentationml.presentation": true, // .pptx
		"text/plain":      true,
		"text/csv":        true,
		"application/zip": true,
	}

	if !allowedTypes[detectedType] {
		log.Printf("Aviso: Upload bloqueado - Tipo de conteúdo não permitido: %s", detectedType)
		RespondWithError(w, http.StatusForbidden, "Tipo de arquivo não permitido para upload")
		return
	}

	// 4.2 Sanitização de Nome de Arquivo
	// Remove caracteres potencialmente perigosos e evita path traversal
	originalName := filepath.Base(header.Filename)
	safeName := sanitizeFilename(originalName)

	// 5. Criptografia de Envelope (Vault Transit + AES-GCM local)
	// Para arquivos grandes, não enviamos o arquivo todo para o Vault.
	// 5.1 Gerar uma chave de criptografia de dados (DEK) aleatória
	dek, err := h.security.GenerateRandomKey()
	if err != nil {
		log.Printf("Erro ao gerar chave DEK: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro interno de segurança")
		return
	}

	// 5.2 Criptografar o arquivo localmente com AES-GCM usando a DEK
	encryptedFile, err := h.security.EncryptAES(fileBytes, dek)
	if err != nil {
		log.Printf("Erro na criptografia AES: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao criptografar arquivo")
		return
	}

	// 5.3 Criptografar a DEK usando o Vault Transit (a DEK é pequena, 32 bytes)
	encryptedDEK, err := h.vault.EncryptData(r.Context(), tenantID.String(), dek)
	if err != nil {
		log.Printf("Erro na criptografia Vault (DEK): %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Falha na segurança do arquivo")
		return
	}

	// 5.4 Preparar payload final: [4 bytes length of DEK string] + [DEK string] + [Encrypted File]
	dekLen := uint32(len(encryptedDEK))
	payload := new(bytes.Buffer)
	binary.Write(payload, binary.BigEndian, dekLen)
	payload.WriteString(encryptedDEK)
	payload.Write(encryptedFile)

	// 6. Upload para MinIO
	// Usamos .enc no MinIO para indicar que o dado está criptografado
	objectName := fmt.Sprintf("%s/%s.enc", tenantID.String(), uuid.New().String())
	finalPayload := payload.Bytes()
	reader := bytes.NewReader(finalPayload)

	err = h.storage.UploadEncrypted(r.Context(), objectName, reader, int64(len(finalPayload)), detectedType)
	if err != nil {
		log.Printf("Erro no upload MinIO: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Falha ao salvar arquivo no storage")
		return
	}

	// 7. Salvar Metadados no Banco de Dados com Status em Quarentena
	// 7.1 Realizar Scan de Segurança (VirusTotal por Hash)
	isSafe, scanResult, scanErr := h.security.ScanFileHash(fileBytes)
	initialStatus := "QUARANTINE"
	if scanErr == nil && !isSafe {
		initialStatus = "INFECTED"
		log.Printf("Aviso: Documento marcado como INFECTED pelo VirusTotal: %s (ID: %s)", safeName, scanResult)
	} else if scanErr == nil && scanResult == "SAFE" {
		initialStatus = "ACTIVE"
	}

	query := `
		INSERT INTO documents (tenant_id, owner_id, sector_id, folder_id, document_type_id, retention_date, name, extension, size_bytes, minio_key, content_type, is_encrypted, current_version, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13)
		RETURNING id`

	var docID uuid.UUID
	err = h.db.Conn.QueryRow(query,
		tenantID, userID, sectorID, folderID, typeID, retentionDate, safeName, filepath.Ext(safeName), header.Size, objectName, detectedType, true, initialStatus,
	).Scan(&docID)

	if err != nil {
		log.Printf("Erro ao salvar no banco: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao registrar documento")
		return
	}

	// 7.1 Registrar Versão Inicial
	_, err = h.db.Conn.Exec(`
		INSERT INTO document_versions (document_id, tenant_id, version_number, minio_key, size_bytes, created_by, change_summary)
		VALUES ($1, $2, 1, $3, $4, $5, 'Versão inicial')`,
		docID, tenantID, objectName, header.Size, userID)
	if err != nil {
		log.Printf("Erro ao registrar versão inicial: %v", err)
		// Não bloqueia o upload se falhar o registro da versão, mas loga o erro
	}

	// 8. Atualizar Cache de Quota no Redis
	_ = h.redis.UpdateQuotaCache(r.Context(), tenantID.String(), header.Size)

	// 9. Indexar metadados no OpenSearch (sem OCR por enquanto, será atualizado depois pelo worker de OCR)
	if h.os != nil {
		go func() {
			err := h.os.IndexDocument(context.Background(), service.DocumentIndex{
				ID:        docID.String(),
				TenantID:  tenantID,
				Name:      header.Filename,
				Extension: filepath.Ext(header.Filename),
				SectorID:  sectorID,
				UpdatedAt: time.Now().Format(time.RFC3339),
			})
			if err != nil {
				log.Printf("Erro ao indexar documento no OpenSearch: %v", err)
			}
		}()
	}

	// Resposta de sucesso
	RespondWithJSON(w, http.StatusCreated, map[string]any{
		"message":     "Documento enviado com sucesso!",
		"document_id": docID.String(),
	})
}

func (h *DocumentHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())

	// Obter os setores do usuário do banco com seus tipos de permissão
	userPermissions := make(map[uuid.UUID]string)
	var userSectorIDs []uuid.UUID
	rowsSectors, err := h.db.Conn.Query("SELECT sector_id, permission_type FROM user_sectors WHERE user_id = $1", claims.UserID)
	if err == nil {
		defer rowsSectors.Close()
		for rowsSectors.Next() {
			var sid uuid.UUID
			var pt string
			if e := rowsSectors.Scan(&sid, &pt); e == nil {
				userPermissions[sid] = pt
				userSectorIDs = append(userSectorIDs, sid)
			}
		}
	} else {
		log.Printf("Erro ao buscar setores do usuário: %v", err)
	}

	// Listar Pastas
	queryFolders := `
		WITH RECURSIVE folder_tree AS (
			SELECT id, id as root_folder_id FROM folders WHERE tenant_id = $1 AND deleted_at IS NULL
			UNION ALL
			SELECT f.id, ft.root_folder_id
			FROM folders f
			JOIN folder_tree ft ON f.parent_id = ft.id
			WHERE f.deleted_at IS NULL
		),
		folder_sizes AS (
			SELECT ft.root_folder_id, SUM(d.size_bytes) as total_size, COUNT(d.id) as files_count
			FROM folder_tree ft
			JOIN documents d ON ft.id = d.folder_id
			WHERE d.deleted_at IS NULL
			GROUP BY ft.root_folder_id
		)
		SELECT f.id, f.name, f.parent_id, f.created_at, f.color, f.owner_id, s.name as sector_name, f.sector_id,
			   COALESCE(json_agg(json_build_object('id', dt.id, 'name', dt.name, 'color', dt.color)) FILTER (WHERE dt.id IS NOT NULL), '[]') as tags,
			   COALESCE(fs.total_size, 0) as total_size,
			   COALESCE(fs.files_count, 0) as files_count
		FROM folders f
		LEFT JOIN sectors s ON f.sector_id = s.id
		LEFT JOIN folder_tag_assignments fta ON f.id = fta.folder_id
		LEFT JOIN document_tags dt ON fta.tag_id = dt.id
		LEFT JOIN folder_sizes fs ON f.id = fs.root_folder_id
		WHERE f.tenant_id = $1 AND f.deleted_at IS NULL`

	argsFolders := []any{tenantID}

	// Filtro de visibilidade por setor (se não for MASTER)
	if !claims.IsMaster {
		if len(userSectorIDs) > 0 {
			// Pode ver pastas dos seus setores ou sem setor
			queryFolders += " AND (f.sector_id IS NULL"
			for i, sid := range userSectorIDs {
				queryFolders += fmt.Sprintf(" OR f.sector_id = $%d", len(argsFolders)+1)
				argsFolders = append(argsFolders, sid)
				_ = i
			}
			queryFolders += ")"
		} else {
			// Se não tem setores, vê apenas o que não tem setor
			queryFolders += " AND f.sector_id IS NULL"
		}

		// Filtro de confidencialidade para papel USER
		if claims.Role == "USER" {
			queryFolders += ` AND NOT EXISTS (
				SELECT 1 FROM folder_tag_assignments fta2 
				JOIN document_tags dt2 ON fta2.tag_id = dt2.id 
				WHERE fta2.folder_id = f.id AND LOWER(dt2.name) = 'confidencial'
			)`
		}
	}
	sectorID := r.URL.Query().Get("sector_id")
	folderID := r.URL.Query().Get("folder_id")
	tagID := r.URL.Query().Get("tag_id")
	statusFilter := r.URL.Query().Get("status")

	if sectorID != "" {
		queryFolders += " AND f.sector_id = $" + fmt.Sprint(len(argsFolders)+1)
		argsFolders = append(argsFolders, sectorID)
	}

	if tagID != "" {
		queryFolders += " AND EXISTS (SELECT 1 FROM folder_tag_assignments fta2 WHERE fta2.folder_id = f.id AND fta2.tag_id = $" + fmt.Sprint(len(argsFolders)+1) + ")"
		argsFolders = append(argsFolders, tagID)
	}

	if folderID != "" {
		queryFolders += " AND f.parent_id = $" + fmt.Sprint(len(argsFolders)+1)
		argsFolders = append(argsFolders, folderID)
	} else if tagID == "" {
		queryFolders += " AND f.parent_id IS NULL"
	}
	queryFolders += " GROUP BY f.id, f.name, f.parent_id, f.created_at, f.color, f.owner_id, s.name, f.sector_id, fs.total_size, fs.files_count ORDER BY f.name ASC"

	rows, err := h.db.Conn.Query(queryFolders, argsFolders...)
	if err != nil {
		log.Printf("Erro ao buscar pastas: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao buscar pastas")
		return
	}
	defer rows.Close()

	var folders []map[string]any
	for rows.Next() {
		var id, name string
		var parentID, color *string
		var ownerID *int
		var sectorName *string
		var sectorID *uuid.UUID
		var createdAt any
		var tagsJSON []byte
		var totalSize, filesCount int64
		if e := rows.Scan(&id, &name, &parentID, &createdAt, &color, &ownerID, &sectorName, &sectorID, &tagsJSON, &totalSize, &filesCount); e != nil {
			log.Printf("Erro ao scanear pasta: %v", e)
			continue
		}

		var tags []any
		json.Unmarshal(tagsJSON, &tags)

		canEdit := claims.IsMaster || (ownerID != nil && *ownerID == claims.UserID)
		if !canEdit && sectorID != nil {
			if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
				canEdit = true
			}
		}

		folders = append(folders, map[string]any{
			"id":          id,
			"name":        name,
			"parent_id":   parentID,
			"type":        "folder",
			"created_at":  createdAt,
			"color":       color,
			"sector_name": sectorName,
			"sector_id":   sectorID,
			"tags":        tags,
			"total_size":  totalSize,
			"files_count": filesCount,
			"can_edit":    canEdit,
		})
	}
	if e := rows.Err(); e != nil {
		log.Printf("Erro após iterar pastas: %v", e)
	}

	// Listar Documentos
	queryDocs := `
		SELECT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.owner_id, u.full_name as owner_name, s.name as sector_name, d.sector_id,
			   COALESCE(json_agg(json_build_object('id', dt.id, 'name', dt.name, 'color', dt.color)) FILTER (WHERE dt.id IS NOT NULL), '[]') as tags,
			   d.current_version, d.status, dtp.name as document_type_name, d.ocr_processed_at
		FROM documents d
		LEFT JOIN users u ON d.owner_id = u.id
		LEFT JOIN sectors s ON d.sector_id = s.id
		LEFT JOIN document_tag_assignments dta ON d.id = dta.document_id
		LEFT JOIN document_tags dt ON dta.tag_id = dt.id
		LEFT JOIN document_types dtp ON d.document_type_id = dtp.id
		WHERE d.tenant_id = $1 AND d.deleted_at IS NULL`

	argsDocs := []any{tenantID}

	// 1. Filtro de visibilidade por setor e status (Workflow de Aprovação)
	if !claims.IsMaster {
		// Construir lista de setores onde o usuário é GESTOR
		var gestorSectorIDs []uuid.UUID
		for sid, perm := range userPermissions {
			if perm == "GESTOR" {
				gestorSectorIDs = append(gestorSectorIDs, sid)
			}
		}

		// Filtro complexo:
		// (É o dono) OR
		// (Está no meu setor E (Sou Gestor OR Status é ACTIVE/ARCHIVED)) OR
		// (Não tem setor E Status é ACTIVE/ARCHIVED)

		queryDocs += " AND ("
		queryDocs += " d.owner_id = $" + fmt.Sprint(len(argsDocs)+1)
		argsDocs = append(argsDocs, claims.UserID)

		// Setores onde sou GESTOR (pode ver tudo)
		if len(gestorSectorIDs) > 0 {
			queryDocs += " OR d.sector_id IN ("
			for i, sid := range gestorSectorIDs {
				if i > 0 {
					queryDocs += ","
				}
				queryDocs += "$" + fmt.Sprint(len(argsDocs)+1)
				argsDocs = append(argsDocs, sid)
			}
			queryDocs += ")"
		}

		// Outros setores ou sem setor (só vê ACTIVE/ARCHIVED)
		queryDocs += " OR (d.status IN ('ACTIVE', 'ARCHIVED')"
		if len(userSectorIDs) > 0 {
			queryDocs += " AND (d.sector_id IS NULL"
			for _, sid := range userSectorIDs {
				queryDocs += " OR d.sector_id = $" + fmt.Sprint(len(argsDocs)+1)
				argsDocs = append(argsDocs, sid)
			}
			queryDocs += ")"
		} else {
			queryDocs += " AND d.sector_id IS NULL"
		}
		queryDocs += ")"

		queryDocs += ")"

		// Filtro de confidencialidade para papel USER
		if claims.Role == "USER" {
			queryDocs += ` AND NOT EXISTS (
				SELECT 1 FROM document_tag_assignments dta2 
				JOIN document_tags dt2 ON dta2.tag_id = dt2.id 
				WHERE dta2.document_id = d.id AND LOWER(dt2.name) = 'confidencial'
			)`
		}
	}

	// Filtro de visibilidade de pastas para papel USER (apenas não confidenciais)
	if !claims.IsMaster && claims.Role == "USER" {
		queryFolders = strings.Replace(queryFolders, "WHERE tenant_id = $1", "WHERE tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM folder_tag_assignments fta JOIN document_tags dt ON fta.tag_id = dt.id WHERE fta.folder_id = folders.id AND LOWER(dt.name) = 'confidencial')", 1)
	}

	if sectorID != "" {
		queryDocs += " AND d.sector_id = $" + fmt.Sprint(len(argsDocs)+1)
		argsDocs = append(argsDocs, sectorID)
	}

	if tagID != "" {
		queryDocs += " AND EXISTS (SELECT 1 FROM document_tag_assignments dta2 WHERE dta2.document_id = d.id AND dta2.tag_id = $" + fmt.Sprint(len(argsDocs)+1) + ")"
		argsDocs = append(argsDocs, tagID)
	}

	if statusFilter != "" {
		queryDocs += " AND d.status = $" + fmt.Sprint(len(argsDocs)+1)
		argsDocs = append(argsDocs, statusFilter)
	}

	if folderID != "" {
		queryDocs += " AND d.folder_id = $" + fmt.Sprint(len(argsDocs)+1)
		argsDocs = append(argsDocs, folderID)
	} else if tagID == "" && statusFilter == "" {
		queryDocs += " AND d.folder_id IS NULL"
	}
	queryDocs += " GROUP BY d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.owner_id, u.full_name, s.name, d.sector_id, d.current_version, d.status, dtp.name, d.ocr_processed_at ORDER BY d.created_at DESC"

	rowsDocs, err := h.db.Conn.Query(queryDocs, argsDocs...)
	if err != nil {
		log.Printf("Erro ao buscar documentos: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao buscar documentos")
		return
	}
	defer rowsDocs.Close()

	var docs []map[string]any
	for rowsDocs.Next() {
		var id, name, ext, contentType string
		var ownerID *int
		var ownerName, sectorName, documentTypeName *string
		var sectorID *uuid.UUID
		var size int64
		var createdAt any
		var tagsJSON []byte
		var currentVersion int
		var status string
		var ocrProcessedAt *time.Time
		if e := rowsDocs.Scan(&id, &name, &ext, &size, &contentType, &createdAt, &ownerID, &ownerName, &sectorName, &sectorID, &tagsJSON, &currentVersion, &status, &documentTypeName, &ocrProcessedAt); e != nil {
			log.Printf("Erro ao scanear documento: %v", e)
			continue
		}

		var tags []any
		json.Unmarshal(tagsJSON, &tags)

		owner := "Sistema"
		if ownerName != nil {
			owner = *ownerName
		}

		canEdit := claims.IsMaster || (ownerID != nil && *ownerID == claims.UserID)
		if !canEdit && sectorID != nil {
			if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
				canEdit = true
			}
		}

		docs = append(docs, map[string]any{
			"id":               id,
			"name":             name,
			"extension":        ext,
			"size":             size,
			"content_type":     contentType,
			"type":             "file",
			"created_at":       createdAt,
			"owner":            owner,
			"sector_name":      sectorName,
			"sector_id":        sectorID,
			"tags":             tags,
			"can_edit":         canEdit,
			"current_version":  currentVersion,
			"status":           status,
			"document_type":    documentTypeName,
			"ocr_processed_at": ocrProcessedAt,
		})
	}
	if e := rowsDocs.Err(); e != nil {
		log.Printf("Erro após iterar documentos: %v", e)
	}

	// Buscar estatísticas básicas
	var totalFiles int
	var sharedCount int
	var totalViews int
	var pendingCount int
	var maxStorage, usedStorage int64

	h.db.Conn.QueryRow("SELECT COUNT(*) FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL", tenantID).Scan(&totalFiles)
	h.db.Conn.QueryRow("SELECT COUNT(*) FROM documents WHERE tenant_id = $1 AND status = 'PENDING_APPROVAL' AND deleted_at IS NULL", tenantID).Scan(&pendingCount)
	h.db.Conn.QueryRow("SELECT COUNT(DISTINCT document_id) FROM document_links WHERE tenant_id = $1 AND active = TRUE", tenantID).Scan(&sharedCount)
	h.db.Conn.QueryRow("SELECT COALESCE(SUM(view_count), 0) FROM document_links WHERE tenant_id = $1", tenantID).Scan(&totalViews)

	// Buscar quota e uso
	h.db.Conn.QueryRow("SELECT COALESCE(SUM(size_bytes), 0) FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL", tenantID).Scan(&usedStorage)
	err = h.db.Conn.QueryRow("SELECT max_storage_bytes FROM tenant_quotas WHERE tenant_id = $1", tenantID).Scan(&maxStorage)
	if err != nil {
		maxStorage = 10 * 1024 * 1024 * 1024
	}

	// 2. Uploads por mês (Últimos 6 meses)
	response := map[string]any{
		"folders":   folders,
		"documents": docs,
		"stats": map[string]any{
			"total_files":   totalFiles,
			"pending":       pendingCount,
			"shared":        sharedCount,
			"views":         totalViews,
			"used_storage":  usedStorage,
			"max_storage":   maxStorage,
			"storage_usage": float64(usedStorage) / float64(maxStorage) * 100,
		},
	}

	RespondWithJSON(w, http.StatusOK, response)
}

func (h *DocumentHandler) GetDashboardData(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())

	// Obter os setores do usuário do banco com seus tipos de permissão
	userPermissions := make(map[uuid.UUID]string)
	var userSectorIDs []uuid.UUID
	rowsSectors, err := h.db.Conn.Query("SELECT sector_id, permission_type FROM user_sectors WHERE user_id = $1", claims.UserID)
	if err == nil {
		defer rowsSectors.Close()
		for rowsSectors.Next() {
			var sid uuid.UUID
			var pt string
			if e := rowsSectors.Scan(&sid, &pt); e == nil {
				userPermissions[sid] = pt
				userSectorIDs = append(userSectorIDs, sid)
			}
		}
	} else {
		log.Printf("Erro ao buscar setores do usuário: %v", err)
	}

	// Helper para adicionar filtro de setor
	addSectorFilter := func(query string, args []any) (string, []any) {
		if claims.IsMaster {
			return query, args
		}

		filter := " AND (sector_id IS NULL"
		if len(userSectorIDs) > 0 {
			for _, sid := range userSectorIDs {
				filter += fmt.Sprintf(" OR sector_id = $%d", len(args)+1)
				args = append(args, sid)
			}
		}
		filter += ")"

		// Inserir o filtro antes do GROUP BY ou ORDER BY se existirem
		if strings.Contains(query, "GROUP BY") {
			return strings.Replace(query, "GROUP BY", filter+" GROUP BY", 1), args
		}
		if strings.Contains(query, "ORDER BY") {
			return strings.Replace(query, "ORDER BY", filter+" ORDER BY", 1), args
		}
		return query + filter, args
	}

	_ = userPermissions // Evitar erro de linter se não for usado antes de ser re-declarado ou usado em loops

	// 1. Estatísticas Gerais
	var totalFiles int
	var sharedCount int
	var totalViews int
	var pendingCount int
	var maxStorage, usedStorage int64

	queryTotalFiles := "SELECT COUNT(*) FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL"
	argsTotalFiles := []any{tenantID}
	queryTotalFiles, argsTotalFiles = addSectorFilter(queryTotalFiles, argsTotalFiles)
	h.db.Conn.QueryRow(queryTotalFiles, argsTotalFiles...).Scan(&totalFiles)

	queryPending := "SELECT COUNT(*) FROM documents WHERE tenant_id = $1 AND status = 'PENDING_APPROVAL' AND deleted_at IS NULL"
	argsPending := []any{tenantID}
	queryPending, argsPending = addSectorFilter(queryPending, argsPending)
	h.db.Conn.QueryRow(queryPending, argsPending...).Scan(&pendingCount)

	h.db.Conn.QueryRow("SELECT COUNT(DISTINCT document_id) FROM document_links WHERE tenant_id = $1 AND active = TRUE", tenantID).Scan(&sharedCount)
	h.db.Conn.QueryRow("SELECT COALESCE(SUM(view_count), 0) FROM document_links WHERE tenant_id = $1", tenantID).Scan(&totalViews)

	queryUsedStorage := "SELECT COALESCE(SUM(size_bytes), 0) FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL"
	argsUsedStorage := []any{tenantID}
	queryUsedStorage, argsUsedStorage = addSectorFilter(queryUsedStorage, argsUsedStorage)
	h.db.Conn.QueryRow(queryUsedStorage, argsUsedStorage...).Scan(&usedStorage)

	h.db.Conn.QueryRow("SELECT max_storage_bytes FROM tenant_quotas WHERE tenant_id = $1", tenantID).Scan(&maxStorage)
	if maxStorage == 0 {
		maxStorage = 10 * 1024 * 1024 * 1024 // 10GB default
	}

	// 2. Uploads por mês (últimos 6 meses)
	type MonthlyUpload struct {
		Month string `json:"label"`
		Count int    `json:"count"`
		Key   string `json:"key"`
	}
	var monthlyUploads []MonthlyUpload
	queryMonthly := `
		SELECT 
			to_char(date_trunc('month', created_at), 'YYYY-MM') as key,
			to_char(date_trunc('month', created_at), 'Mon') as label,
			COUNT(*) as count
		FROM documents
		WHERE tenant_id = $1 AND deleted_at IS NULL AND created_at >= date_trunc('month', now()) - interval '5 months'
		GROUP BY 1, 2
		ORDER BY 1 ASC`

	argsMonthly := []any{tenantID}
	queryMonthly, argsMonthly = addSectorFilter(queryMonthly, argsMonthly)

	rowsMonthly, err := h.db.Conn.Query(queryMonthly, argsMonthly...)
	if err == nil {
		defer rowsMonthly.Close()
		for rowsMonthly.Next() {
			var m MonthlyUpload
			rowsMonthly.Scan(&m.Key, &m.Month, &m.Count)
			monthlyUploads = append(monthlyUploads, m)
		}
	}

	// 3. Distribuição por tipo
	type TypeStat struct {
		Label string `json:"label"`
		Count int    `json:"count"`
	}
	var typeStats []TypeStat
	queryTypes := `
		SELECT 
			CASE 
				WHEN extension IN ('.pdf') THEN 'PDF'
				WHEN extension IN ('.xlsx', '.xls', '.csv') THEN 'Planilhas'
				WHEN extension IN ('.jpg', '.jpeg', '.png', '.gif') THEN 'Imagens'
				WHEN extension IN ('.doc', '.docx') THEN 'Docs'
				ELSE 'Outros'
			END as label,
			COUNT(*) as count
		FROM documents
		WHERE tenant_id = $1 AND deleted_at IS NULL
		GROUP BY 1
		ORDER BY 2 DESC`

	argsTypes := []any{tenantID}
	queryTypes, argsTypes = addSectorFilter(queryTypes, argsTypes)

	rowsTypes, err := h.db.Conn.Query(queryTypes, argsTypes...)
	if err == nil {
		defer rowsTypes.Close()
		for rowsTypes.Next() {
			var t TypeStat
			rowsTypes.Scan(&t.Label, &t.Count)
			typeStats = append(typeStats, t)
		}
	}

	// 4. Tags mais usadas
	type TagStat struct {
		Name  string `json:"name"`
		Color string `json:"color"`
		Count int    `json:"count"`
	}
	var topTags []TagStat
	queryTags := `
		SELECT dt.name, dt.color, COUNT(*) as count
		FROM document_tags dt
		JOIN document_tag_assignments dta ON dt.id = dta.tag_id
		JOIN documents d ON dta.document_id = d.id
		WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
		GROUP BY 1, 2
		ORDER BY 3 DESC
		LIMIT 5`

	// O filtro de setor aqui precisa ser em d.sector_id
	if !claims.IsMaster {
		sectorFilter := " AND (d.sector_id IS NULL"
		argsTags := []any{tenantID}
		if len(userSectorIDs) > 0 {
			for _, sid := range userSectorIDs {
				sectorFilter += fmt.Sprintf(" OR d.sector_id = $%d", len(argsTags)+1)
				argsTags = append(argsTags, sid)
			}
		}
		sectorFilter += ")"
		queryTags = strings.Replace(queryTags, "GROUP BY", sectorFilter+" GROUP BY", 1)

		rowsTags, errTags := h.db.Conn.Query(queryTags, argsTags...)
		if errTags == nil {
			defer rowsTags.Close()
			for rowsTags.Next() {
				var t TagStat
				if e := rowsTags.Scan(&t.Name, &t.Color, &t.Count); e == nil {
					topTags = append(topTags, t)
				}
			}
		}
	} else {
		rowsTags, errTags := h.db.Conn.Query(queryTags, tenantID)
		if errTags == nil {
			defer rowsTags.Close()
			for rowsTags.Next() {
				var t TagStat
				if e := rowsTags.Scan(&t.Name, &t.Color, &t.Count); e == nil {
					topTags = append(topTags, t)
				}
			}
		}
	}

	// 5. Documentos Recentes
	queryRecent := `
		SELECT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.owner_id, u.full_name as owner_name, d.sector_id,
			   COALESCE(json_agg(json_build_object('id', dt.id, 'name', dt.name, 'color', dt.color)) FILTER (WHERE dt.id IS NOT NULL), '[]') as tags,
			   dtp.name as document_type_name
		FROM documents d
		LEFT JOIN users u ON d.owner_id = u.id
		LEFT JOIN document_tag_assignments dta ON d.id = dta.document_id
		LEFT JOIN document_tags dt ON dta.tag_id = dt.id
		LEFT JOIN document_types dtp ON d.document_type_id = dtp.id
		WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
		GROUP BY d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.owner_id, u.full_name, d.sector_id, dtp.name
		ORDER BY d.created_at DESC
		LIMIT 10`

	argsRecent := []any{tenantID}
	if !claims.IsMaster {
		sectorFilter := " AND (d.sector_id IS NULL"
		if len(userSectorIDs) > 0 {
			for _, sid := range userSectorIDs {
				sectorFilter += fmt.Sprintf(" OR d.sector_id = $%d", len(argsRecent)+1)
				argsRecent = append(argsRecent, sid)
			}
		}
		sectorFilter += ")"
		queryRecent = strings.Replace(queryRecent, "GROUP BY", sectorFilter+" GROUP BY", 1)
	}

	rowsRecent, errRecent := h.db.Conn.Query(queryRecent, argsRecent...)
	var recentDocs []map[string]any
	if errRecent == nil {
		defer rowsRecent.Close()
		for rowsRecent.Next() {
			var id, name, ext, contentType string
			var ownerID *int
			var ownerName *string
			var size int64
			var createdAt time.Time
			var tagsJSON []byte
			var sectorID *uuid.UUID
			var documentTypeName *string
			if e := rowsRecent.Scan(&id, &name, &ext, &size, &contentType, &createdAt, &ownerID, &ownerName, &sectorID, &tagsJSON, &documentTypeName); e != nil {
				log.Printf("Erro ao scanear documento recente: %v", e)
				continue
			}

			var tags []any
			json.Unmarshal(tagsJSON, &tags)

			owner := "Sistema"
			if ownerName != nil {
				owner = *ownerName
			}

			canEdit := claims.IsMaster || (ownerID != nil && *ownerID == claims.UserID)
			if !canEdit && sectorID != nil {
				if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
					canEdit = true
				}
			}

			recentDocs = append(recentDocs, map[string]any{
				"id":            id,
				"name":          name,
				"extension":     ext,
				"size":          size,
				"content_type":  contentType,
				"created_at":    createdAt,
				"owner":         owner,
				"tags":          tags,
				"type":          "file",
				"sector_id":     sectorID,
				"document_type": documentTypeName,
				"can_edit":      canEdit,
			})
		}
	}

	// 6. Pastas Recentes
	var recentFolders []map[string]any
	queryRecentFolders := `SELECT id, name, color, created_at, owner_id, sector_id FROM folders WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5`
	argsRecentFolders := []any{tenantID}
	if !claims.IsMaster {
		sectorFilter := " AND (sector_id IS NULL"
		if len(userSectorIDs) > 0 {
			for _, sid := range userSectorIDs {
				sectorFilter += fmt.Sprintf(" OR sector_id = $%d", len(argsRecentFolders)+1)
				argsRecentFolders = append(argsRecentFolders, sid)
			}
		}
		sectorFilter += ")"
		queryRecentFolders = strings.Replace(queryRecentFolders, "ORDER BY", sectorFilter+" ORDER BY", 1)
	}

	rowsFolders, err := h.db.Conn.Query(queryRecentFolders, argsRecentFolders...)
	if err == nil {
		defer rowsFolders.Close()
		for rowsFolders.Next() {
			var id, name, color string
			var createdAt time.Time
			var ownerID *int
			var sectorID *uuid.UUID
			rowsFolders.Scan(&id, &name, &color, &createdAt, &ownerID, &sectorID)

			canEdit := claims.IsMaster || (ownerID != nil && *ownerID == claims.UserID)
			if !canEdit && sectorID != nil {
				if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
					canEdit = true
				}
			}

			recentFolders = append(recentFolders, map[string]any{
				"id":         id,
				"name":       name,
				"color":      color,
				"created_at": createdAt,
				"type":       "folder",
				"sector_id":  sectorID,
				"can_edit":   canEdit,
			})
		}
	}

	response := map[string]any{
		"stats": map[string]any{
			"total_files":   totalFiles,
			"pending":       pendingCount,
			"shared":        sharedCount,
			"views":         totalViews,
			"used_storage":  usedStorage,
			"max_storage":   maxStorage,
			"storage_usage": float64(usedStorage) / float64(maxStorage) * 100,
		},
		"monthly_uploads":   monthlyUploads,
		"type_distribution": typeStats,
		"top_tags":          topTags,
		"recent_documents":  recentDocs,
		"recent_folders":    recentFolders,
	}

	RespondWithJSON(w, http.StatusOK, response)
}

func (h *DocumentHandler) GetDocument(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	docID := chi.URLParam(r, "id")

	// 1. Buscar metadados do documento
	query := `
		SELECT 
			d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.status,
			d.owner_id, u.full_name as owner_name, 
			d.sector_id, s.name as sector_name,
			dtp.name as document_type_name,
			d.ocr_text, d.ocr_processed_at,
			COALESCE((
				SELECT json_agg(json_build_object('id', dt.id, 'name', dt.name, 'color', dt.color))
				FROM document_tag_assignments dta
				JOIN document_tags dt ON dta.tag_id = dt.id
				WHERE dta.document_id = d.id
			), '[]'::json) as tags
		FROM documents d
		LEFT JOIN users u ON d.owner_id = u.id
		LEFT JOIN sectors s ON d.sector_id = s.id
		LEFT JOIN document_types dtp ON d.document_type_id = dtp.id
		WHERE d.id = $1 AND d.tenant_id = $2 AND d.deleted_at IS NULL`

	var doc struct {
		ID               string          `json:"id"`
		Name             string          `json:"name"`
		Extension        string          `json:"extension"`
		SizeBytes        int64           `json:"size_bytes"`
		ContentType      string          `json:"content_type"`
		CreatedAt        time.Time       `json:"created_at"`
		Status           string          `json:"status"`
		OwnerID          *int            `json:"owner_id"`
		OwnerName        *string         `json:"owner_name"`
		SectorID         *uuid.UUID      `json:"sector_id"`
		SectorName       *string         `json:"sector_name"`
		DocumentTypeName *string         `json:"document_type"`
		OCRText          *string         `json:"ocr_text"`
		OCRProcessedAt   *time.Time      `json:"ocr_processed_at"`
		Tags             json.RawMessage `json:"tags"`
	}

	err := h.db.Conn.QueryRow(query, docID, tenantID).Scan(
		&doc.ID, &doc.Name, &doc.Extension, &doc.SizeBytes, &doc.ContentType, &doc.CreatedAt, &doc.Status,
		&doc.OwnerID, &doc.OwnerName, &doc.SectorID, &doc.SectorName, &doc.DocumentTypeName,
		&doc.OCRText, &doc.OCRProcessedAt, &doc.Tags,
	)

	if err != nil {
		log.Printf("GetDocument Error: %v", err)
		RespondWithError(w, http.StatusNotFound, "Documento não encontrado")
		return
	}

	// 2. Validação de acesso
	canEdit := claims.IsMaster || (doc.OwnerID != nil && *doc.OwnerID == claims.UserID)
	if !claims.IsMaster && doc.SectorID != nil {
		var hasAccess bool
		var permission string
		err = h.db.Conn.QueryRow(`
			SELECT permission_type FROM user_sectors WHERE user_id = $1 AND sector_id = $2`,
			claims.UserID, doc.SectorID).Scan(&permission)

		if err == nil {
			hasAccess = true
			if permission == "GESTOR" || permission == "WRITE" {
				canEdit = true
			}
		} else {
			// Verificar se foi compartilhado diretamente
			err = h.db.Conn.QueryRow(`
				SELECT permission_type FROM document_shares WHERE document_id = $1 AND user_id = $2`,
				docID, claims.UserID).Scan(&permission)

			if err == nil {
				hasAccess = true
				if permission == "WRITE" {
					canEdit = true
				}
			}
		}

		if !hasAccess {
			RespondWithError(w, http.StatusForbidden, "Sem acesso a este documento")
			return
		}
	}

	RespondWithJSON(w, http.StatusOK, map[string]any{
		"id":               doc.ID,
		"name":             doc.Name,
		"extension":        doc.Extension,
		"size_bytes":       doc.SizeBytes,
		"content_type":     doc.ContentType,
		"created_at":       doc.CreatedAt,
		"status":           doc.Status,
		"owner":            doc.OwnerName,
		"sector":           doc.SectorName,
		"document_type":    doc.DocumentTypeName,
		"ocr_text":         doc.OCRText,
		"ocr_processed_at": doc.OCRProcessedAt,
		"tags":             doc.Tags,
		"can_edit":         canEdit,
	})
}

func (h *DocumentHandler) Download(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	docID := chi.URLParam(r, "id")
	versionStr := r.URL.Query().Get("version")

	// 1. Buscar metadados do documento e setor
	var minioKey, contentType, name, status string
	var isEncrypted bool
	var size int64
	var docSectorID *uuid.UUID
	var ownerID *int
	err := h.db.Conn.QueryRow(`
		SELECT minio_key, content_type, name, is_encrypted, size_bytes, sector_id, status, owner_id
		FROM documents 
		WHERE id = $1 AND tenant_id = $2`, docID, tenantID).Scan(&minioKey, &contentType, &name, &isEncrypted, &size, &docSectorID, &status, &ownerID)

	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Documento não encontrado")
		return
	}

	// 1.1 Se uma versão específica foi solicitada, buscar os metadados daquela versão
	if versionStr != "" {
		versionNum, err := strconv.Atoi(versionStr)
		if err == nil {
			var vMinioKey string
			var vSizeBytes int64
			err = h.db.Conn.QueryRow(`
				SELECT minio_key, size_bytes 
				FROM document_versions 
				WHERE document_id = $1 AND tenant_id = $2 AND version_number = $3`,
				docID, tenantID, versionNum).Scan(&vMinioKey, &vSizeBytes)

			if err == nil {
				minioKey = vMinioKey
				size = vSizeBytes
				log.Printf("[DOWNLOAD] Baixando versão específica: %d do documento %s", versionNum, docID)
			} else {
				log.Printf("[DOWNLOAD] Versão %s não encontrada para o documento %s, baixando versão atual", versionStr, docID)
			}
		}
	}

	// 1.1 Validação de status (Workflow de Aprovação)
	if (status == "PENDING_APPROVAL" || status == "REJECTED" || status == "EXPIRED") && !claims.IsMaster {
		if ownerID == nil || *ownerID != claims.UserID {
			RespondWithError(w, http.StatusForbidden, "Documento aguardando aprovação ou não disponível")
			return
		}
	}

	// Validação de acesso ao setor (se não for MASTER)
	if !claims.IsMaster && docSectorID != nil {
		var hasAccess bool
		err = h.db.Conn.QueryRow(`
			SELECT EXISTS(SELECT 1 FROM user_sectors WHERE user_id = $1 AND sector_id = $2)`,
			claims.UserID, docSectorID).Scan(&hasAccess)
		if err != nil || !hasAccess {
			// Se não tem acesso via setor, verificar se foi compartilhado diretamente
			err = h.db.Conn.QueryRow(`
				SELECT EXISTS(
					SELECT 1 FROM document_shares WHERE document_id = $1 AND user_id = $2
					UNION
					SELECT 1 FROM document_sector_shares dss 
					JOIN user_sectors us ON dss.sector_id = us.sector_id 
					WHERE dss.document_id = $1 AND us.user_id = $2
				)`, docID, claims.UserID).Scan(&hasAccess)

			if err != nil || !hasAccess {
				RespondWithError(w, http.StatusForbidden, "Sem acesso a este documento")
				return
			}
		}
	}

	var confidentialRequired bool
	var confidentialHash string
	var hasConfidentialTag bool
	var tenantName string
	var watermarkText string
	var watermarkSize int
	var watermarkOffsetY int
	var watermarkRotation int
	var watermarkOpacity int
	err = h.db.Conn.QueryRow(`
		SELECT COALESCE(t.confidential_required, false),
		       COALESCE(t.confidential_password_hash, ''),
		       EXISTS (
		         SELECT 1 FROM document_tag_assignments dta
		         JOIN document_tags dt ON dt.id = dta.tag_id
		         WHERE dta.document_id = $1 AND dt.tenant_id = $2 AND LOWER(dt.name) = LOWER('Confidencial')
		       ),
		       t.name,
		       COALESCE(t.watermark_text, 'CONFIDENCIAL'),
		       COALESCE(t.watermark_size, 80),
		       COALESCE(t.watermark_offset_y, 0),
		       COALESCE(t.watermark_rotation, 45),
		       COALESCE(t.watermark_opacity, 20)
		FROM tenants t WHERE t.id = $2`, docID, tenantID).Scan(&confidentialRequired, &confidentialHash, &hasConfidentialTag, &tenantName, &watermarkText, &watermarkSize, &watermarkOffsetY, &watermarkRotation, &watermarkOpacity)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao validar acesso confidencial")
		return
	}
	if confidentialRequired && hasConfidentialTag {
		// Restrição para papel USER: não pode acessar itens confidenciais
		// Requisito: "confidencial so apenas gestores e admin"
		if claims.Role == "USER" && !claims.IsMaster {
			RespondWithError(w, http.StatusForbidden, "Acesso restrito: itens marcados como Confidencial são acessíveis apenas por Gestores e Administradores")
			return
		}

		if confidentialHash == "" {
			RespondWithError(w, http.StatusConflict, "Senha confidencial não configurada")
			return
		}
		confidentialPassword := r.Header.Get("X-Confidential-Password")
		if confidentialPassword == "" || !h.security.CheckPasswordHash(confidentialPassword, confidentialHash) {
			RespondWithError(w, http.StatusUnauthorized, "Senha necessária ou incorreta")
			return
		}
	}

	// 2. Baixar do MinIO
	encryptedData, err := h.storage.GetEncrypted(r.Context(), minioKey)
	if err != nil {
		log.Printf("Erro ao baixar do MinIO: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao recuperar arquivo do storage")
		return
	}
	defer encryptedData.Close()

	// 3. Descriptografia em tempo real se necessário
	var finalData []byte
	if isEncrypted {
		plaintext, err := h.decryptDocument(r.Context(), tenantID, encryptedData)
		if err != nil {
			log.Printf("Erro na descriptografia do documento: %v", err)
			RespondWithError(w, http.StatusInternalServerError, "Falha na segurança ao descriptografar arquivo")
			return
		}
		finalData = plaintext
	} else {
		finalData, _ = io.ReadAll(encryptedData)
	}

	// 4. Aplicar Marca d'água se for PDF e for Confidencial/Sensível
	// Somente se não for solicitado o download original (opção para administradores)
	isOriginal := r.URL.Query().Get("original") == "true"

	if isOriginal && !h.canWrite(r, docSectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para baixar o arquivo original (Apenas Admin/Gestor)")
		return
	}

	if strings.ToLower(contentType) == "application/pdf" && !isOriginal && (hasConfidentialTag || (watermarkText != "" && watermarkText != "CONFIDENCIAL")) {
		// Garantir que o tamanho nunca seja zero para evitar erros
		if watermarkSize <= 0 {
			watermarkSize = 80
		}

		log.Printf("[WATERMARK_DEBUG] Doc: %s | Tenant: %s | Text: '%s' | Scale: %.2f | OffsetY: %d | Rotation: %d | Opacity: %.2f", docID, tenantID, watermarkText, float64(watermarkSize)/100.0, watermarkOffsetY, watermarkRotation, float64(watermarkOpacity)/100.0)

		scale := float64(watermarkSize) / 100.0
		opacity := float64(watermarkOpacity) / 100.0
		watermarkedData, err := h.applyWatermark(finalData, watermarkText, scale, watermarkOffsetY, watermarkRotation, opacity)
		if err == nil {
			finalData = watermarkedData
			log.Printf("[DEBUG] Marca d'água aplicada com sucesso. Novo tamanho: %d", len(finalData))
		} else {
			log.Printf("[ERROR] Erro ao aplicar marca d'água no doc %s: %v", docID, err)
		}
	} else {
		log.Printf("[DEBUG] Marca d'água NÃO aplicada no doc %s. PDF=%v, Confidencial=%v, Original=%v, WatermarkText='%s'",
			docID, strings.ToLower(contentType) == "application/pdf", hasConfidentialTag, isOriginal, watermarkText)
	}

	// 5. Enviar arquivo para o navegador
	fileName := name
	if isOriginal && hasConfidentialTag {
		fileName = "ORIGINAL_" + name
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", fileName))
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(int64(len(finalData)), 10))
	w.Write(finalData)
}

func (h *DocumentHandler) applyWatermark(data []byte, text string, scale float64, offsetY int, rotation int, opacity float64) ([]byte, error) {
	// Configuração do pdfcpu
	conf := model.NewDefaultConfiguration()
	model.ConfigPath = "disable"
	conf.Offline = true

	// Se a opacidade for muito baixa, forçamos um valor mínimo para ser visível
	if opacity < 0.05 {
		opacity = 0.20
	}

	// Usando scale (relativo à página) que é mais consistente para diferentes tamanhos de PDF
	// Cor preta (0.0 0.0 0.0) com opacidade controlada é mais garantido de aparecer do que cinza claro
	// O parâmetro 'onTop:true' (terceiro argumento) garante que a marca d'água fique sobre o conteúdo
	wm, err := api.TextWatermark(text, fmt.Sprintf("fontname:Helvetica, rotation:%d, scale:%.2f, opacity:%.2f, color:0 0 0, offset:0 %d", rotation, scale, opacity, offsetY), true, false, types.POINTS)
	if err != nil {
		return nil, err
	}

	// Aplicar em todas as páginas
	reader := bytes.NewReader(data)
	var out bytes.Buffer
	// AddWatermarks(rs io.ReadSeeker, w io.Writer, selectedPages []string, wm *model.Watermark, conf *model.Configuration) error
	err = api.AddWatermarks(reader, &out, nil, wm, conf)
	if err != nil {
		return nil, err
	}

	return out.Bytes(), nil
}

func (h *DocumentHandler) CreateFolder(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	userID := claims.UserID

	var req struct {
		Name     string  `json:"name"`
		ParentID *string `json:"parent_id"`
		SectorID *string `json:"sector_id"`
		Color    *string `json:"color"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Requisição inválida")
		return
	}

	var folderID uuid.UUID
	var sectorID_UUID *uuid.UUID

	// Se houver parent_id, herdamos o setor dela se não for fornecido
	if req.ParentID != nil && *req.ParentID != "" {
		if req.SectorID == nil || *req.SectorID == "" {
			err := h.db.Conn.QueryRow("SELECT sector_id FROM folders WHERE id = $1 AND tenant_id = $2", *req.ParentID, tenantID).Scan(&sectorID_UUID)
			if err != nil {
				log.Printf("Erro ao buscar setor da pasta pai: %v", err)
			}
		}
	}

	// Validação de permissão de escrita no setor
	if sectorID_UUID == nil && req.SectorID != nil && *req.SectorID != "" {
		if id, err := uuid.Parse(*req.SectorID); err == nil {
			sectorID_UUID = &id
		}
	}

	if !h.canWrite(r, sectorID_UUID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão de escrita neste setor ou setor não especificado")
		return
	}

	// Tratar strings vazias como nil para o banco
	var parentID, finalSectorID, color any
	parentID = req.ParentID
	if req.ParentID != nil && *req.ParentID == "" {
		parentID = nil
	}

	if sectorID_UUID != nil {
		finalSectorID = sectorID_UUID
	} else {
		finalSectorID = nil
	}

	color = req.Color
	if req.Color != nil && *req.Color == "" {
		color = "#f59e0b" // Default color
	}

	err := h.db.Conn.QueryRow(`
		INSERT INTO folders (tenant_id, owner_id, name, parent_id, sector_id, color) 
		VALUES ($1, $2, $3, $4, $5, $6) 
		RETURNING id`, tenantID, userID, req.Name, parentID, finalSectorID, color).Scan(&folderID)

	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao criar pasta")
		return
	}

	RespondWithJSON(w, http.StatusCreated, map[string]any{
		"message": "Pasta criada",
		"id":      folderID.String(),
	})
}

// --- Handlers para Anotações (Post-its Digitais) ---

func (h *DocumentHandler) ListAnnotations(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	docID := chi.URLParam(r, "id")

	// 1. Validar acesso ao documento (setor)
	var docSectorID *uuid.UUID
	err := h.db.Conn.QueryRow("SELECT sector_id FROM documents WHERE id = $1 AND tenant_id = $2", docID, tenantID).Scan(&docSectorID)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Documento não encontrado")
		return
	}

	if !claims.IsMaster && docSectorID != nil {
		// Verificar se o usuário pertence ao setor
		var hasAccess bool
		err = h.db.Conn.QueryRow(`
			SELECT EXISTS(SELECT 1 FROM user_sectors WHERE user_id = $1 AND sector_id = $2)`,
			claims.UserID, docSectorID).Scan(&hasAccess)
		if err != nil || !hasAccess {
			RespondWithError(w, http.StatusForbidden, "Sem acesso a este documento")
			return
		}
	}

	rows, err := h.db.Conn.Query(`
		SELECT id, page_number, pos_x, pos_y, width, height, content, color, is_private, user_id, font_family, annotation_type
		FROM document_annotations 
		WHERE document_id = $1 AND tenant_id = $2`, docID, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao buscar anotações")
		return
	}
	defer rows.Close()

	var annotations []map[string]any
	for rows.Next() {
		var id, content, color, fontFamily, annotationType string
		var pageNum, userID int
		var x, y, w, h_val float64
		var isPrivate bool
		if e := rows.Scan(&id, &pageNum, &x, &y, &w, &h_val, &content, &color, &isPrivate, &userID, &fontFamily, &annotationType); e != nil {
			log.Printf("Erro ao scanear anotação: %v", e)
			continue
		}

		annotations = append(annotations, map[string]any{
			"id":              id,
			"page_number":     pageNum,
			"pos_x":           x,
			"pos_y":           y,
			"width":           w,
			"height":          h_val,
			"content":         content,
			"color":           color,
			"is_private":      isPrivate,
			"user_id":         userID,
			"font_family":     fontFamily,
			"annotation_type": annotationType,
		})
	}

	RespondWithJSON(w, http.StatusOK, annotations)
}

func (h *DocumentHandler) Search(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())

	// Obter os setores do usuário do banco com seus tipos de permissão
	userPermissions := make(map[uuid.UUID]string)
	var userSectorIDs []uuid.UUID
	rowsSectors, err := h.db.Conn.Query("SELECT sector_id, permission_type FROM user_sectors WHERE user_id = $1", claims.UserID)
	if err == nil {
		defer rowsSectors.Close()
		for rowsSectors.Next() {
			var sid uuid.UUID
			var pt string
			if e := rowsSectors.Scan(&sid, &pt); e == nil {
				userPermissions[sid] = pt
				userSectorIDs = append(userSectorIDs, sid)
			}
		}
	}

	// Parâmetros de busca
	query := r.URL.Query().Get("q")            // Nome do arquivo
	tag := r.URL.Query().Get("tag")            // Tag específica
	metaKey := r.URL.Query().Get("meta_k")     // Chave de metadado
	metaVal := r.URL.Query().Get("meta_v")     // Valor de metadado
	ocrQuery := r.URL.Query().Get("ocr")       // Texto reconhecido via OCR
	folderID := r.URL.Query().Get("folder_id") // ID da pasta (opcional)

	// Se houver busca OCR e OpenSearch estiver configurado
	if ocrQuery != "" && h.os != nil {
		log.Printf("[DEBUG] Iniciando busca OCR para tenant %s, query: %s, setores: %v", tenantID, ocrQuery, userSectorIDs)
		docIDs, e := h.os.Search(r.Context(), tenantID, ocrQuery, userSectorIDs)
		if e != nil {
			log.Printf("[DEBUG] Erro na busca OpenSearch: %v", e)
		} else {
			log.Printf("[DEBUG] OpenSearch retornou %d documentos: %v", len(docIDs), docIDs)
		}

		if e == nil && len(docIDs) > 0 {
			// Se encontramos IDs no OpenSearch, filtramos a query SQL por esses IDs
			sqlQuery := `
				SELECT DISTINCT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.sector_id, dtp.name as document_type_name, d.ocr_processed_at
				FROM documents d
				LEFT JOIN document_types dtp ON d.document_type_id = dtp.id
				WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND d.id = ANY($2)`

			argsOS := []any{tenantID, docIDs}
			argIdx := 3

			if folderID != "" {
				sqlQuery += fmt.Sprintf(" AND d.folder_id = $%d", argIdx)
				argsOS = append(argsOS, folderID)
				argIdx++
			}

			// Filtro de confidencialidade para papel USER
			if claims.Role == "USER" && !claims.IsMaster {
				sqlQuery += ` AND NOT EXISTS (
					SELECT 1 FROM document_tag_assignments dta2 
					JOIN document_tags dt2 ON dta2.tag_id = dt2.id 
					WHERE dta2.document_id = d.id AND LOWER(dt2.name) = 'confidencial'
				)`
			}

			rowsOS, errOS := h.db.Conn.Query(sqlQuery, argsOS...)
			if errOS != nil {
				log.Printf("Erro ao buscar documentos do OpenSearch no SQL: %v", errOS)
				RespondWithError(w, http.StatusInternalServerError, "Erro na busca")
				return
			}
			defer rowsOS.Close()

			var docs []map[string]any
			for rowsOS.Next() {
				var id, name, ext, contentType string
				var sectorID *uuid.UUID
				var documentTypeName *string
				var size int64
				var createdAt time.Time
				var ocrProcessedAt *time.Time
				if e := rowsOS.Scan(&id, &name, &ext, &size, &contentType, &createdAt, &sectorID, &documentTypeName, &ocrProcessedAt); e != nil {
					log.Printf("Erro ao scanear documento do OpenSearch: %v", e)
					continue
				}
				docs = append(docs, map[string]any{
					"id": id, "name": name, "extension": ext, "size": size, "content_type": contentType, "created_at": createdAt, "sector_id": sectorID, "document_type": documentTypeName, "ocr_processed_at": ocrProcessedAt,
				})
			}
			log.Printf("[DEBUG] SQL da busca OCR retornou %d resultados", len(docs))
			RespondWithJSON(w, http.StatusOK, docs)
			return
		}
	}

	sqlQuery := `
		SELECT DISTINCT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.sector_id, dtp.name as document_type_name, d.ocr_processed_at
		FROM documents d
		LEFT JOIN document_tag_assignments dta ON d.id = dta.document_id
		LEFT JOIN document_tags dt ON dta.tag_id = dt.id
		LEFT JOIN document_metadata dm ON d.id = dm.document_id
		LEFT JOIN document_types dtp ON d.document_type_id = dtp.id
		WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
	`
	args := []any{tenantID}
	argID := 2

	// Filtro de visibilidade por setor (se não for MASTER)
	if !claims.IsMaster {
		if len(userSectorIDs) > 0 {
			sqlQuery += " AND (d.sector_id IS NULL"
			for _, sid := range userSectorIDs {
				sqlQuery += fmt.Sprintf(" OR d.sector_id = $%d", argID)
				args = append(args, sid)
				argID++
			}
			sqlQuery += ")"
		} else {
			sqlQuery += " AND d.sector_id IS NULL"
		}

		// Filtro de confidencialidade para papel USER
		if claims.Role == "USER" {
			sqlQuery += ` AND NOT EXISTS (
				SELECT 1 FROM document_tag_assignments dta2 
				JOIN document_tags dt2 ON dta2.tag_id = dt2.id 
				WHERE dta2.document_id = d.id AND LOWER(dt2.name) = 'confidencial'
			)`
		}
	}

	if query != "" {
		sqlQuery += fmt.Sprintf(" AND d.name ILIKE $%d", argID)
		args = append(args, "%"+query+"%")
		argID++
	}

	if tag != "" {
		sqlQuery += fmt.Sprintf(" AND dt.name = $%d", argID)
		args = append(args, tag)
		argID++
	}

	if metaKey != "" && metaVal != "" {
		sqlQuery += fmt.Sprintf(" AND dm.key = $%d AND dm.value = $%d", argID, argID+1)
		args = append(args, metaKey, metaVal)
		argID += 2
	}

	if ocrQuery != "" {
		sqlQuery += fmt.Sprintf(" AND to_tsvector('simple', COALESCE(d.ocr_text, '')) @@ plainto_tsquery('simple', $%d)", argID)
		args = append(args, ocrQuery)
		argID++
	}

	sqlQuery += " ORDER BY d.created_at DESC"

	rows, err := h.db.Conn.Query(sqlQuery, args...)
	if err != nil {
		log.Printf("Erro na busca avançada: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao realizar busca")
		return
	}
	defer rows.Close()

	var docs []map[string]any
	for rows.Next() {
		var id, name, ext, contentType string
		var size int64
		var createdAt any
		var sectorID *uuid.UUID
		var documentTypeName *string
		var ocrProcessedAt *time.Time
		if e := rows.Scan(&id, &name, &ext, &size, &contentType, &createdAt, &sectorID, &documentTypeName, &ocrProcessedAt); e != nil {
			log.Printf("Erro ao scanear documento na busca avançada: %v", e)
			continue
		}

		canEdit := claims.IsMaster
		if !canEdit && sectorID != nil {
			if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
				canEdit = true
			}
		}

		docs = append(docs, map[string]any{
			"id":               id,
			"name":             name,
			"extension":        ext,
			"size":             size,
			"content_type":     contentType,
			"created_at":       createdAt,
			"sector_id":        sectorID,
			"document_type":    documentTypeName,
			"can_edit":         canEdit,
			"type":             "file",
			"ocr_processed_at": ocrProcessedAt,
		})
	}

	RespondWithJSON(w, http.StatusOK, docs)
}

func (h *DocumentHandler) ListVersions(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	docID := chi.URLParam(r, "id")

	// 1. Verificar acesso ao documento
	var docSectorID *uuid.UUID
	err := h.db.Conn.QueryRow("SELECT sector_id FROM documents WHERE id = $1 AND tenant_id = $2", docID, tenantID).Scan(&docSectorID)
	if err != nil {
		http.Error(w, "Documento não encontrado", http.StatusNotFound)
		return
	}

	// Reutilizar lógica de permissão simplificada
	claims, _ := middleware.GetClaims(r.Context())
	if !claims.IsMaster && docSectorID != nil {
		var hasAccess bool
		h.db.Conn.QueryRow(`SELECT EXISTS(SELECT 1 FROM user_sectors WHERE user_id = $1 AND sector_id = $2)`, claims.UserID, docSectorID).Scan(&hasAccess)
		if !hasAccess {
			RespondWithError(w, http.StatusForbidden, "Sem acesso a este documento")
			return
		}
	}

	rows, err := h.db.Conn.Query(`
		SELECT v.id, v.version_number, v.size_bytes, v.created_at, v.change_summary, u.full_name as created_by_name, dtp.name as document_type_name
		FROM document_versions v
		INNER JOIN documents d ON v.document_id = d.id
		LEFT JOIN users u ON v.created_by = u.id
		LEFT JOIN document_types dtp ON d.document_type_id = dtp.id
		WHERE v.document_id = $1 AND v.tenant_id = $2
		ORDER BY v.version_number DESC`, docID, tenantID)
	if err != nil {
		log.Printf("Erro ao listar versões: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao buscar versões")
		return
	}
	defer rows.Close()

	var versions []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var versionNum int
		var size int64
		var createdAt time.Time
		var summary, createdByName, documentTypeName *string
		if err := rows.Scan(&id, &versionNum, &size, &createdAt, &summary, &createdByName, &documentTypeName); err != nil {
			log.Printf("Erro ao scanear versão: %v", err)
			continue
		}

		versions = append(versions, map[string]any{
			"id":             id,
			"version_number": versionNum,
			"size":           size,
			"created_at":     createdAt,
			"change_summary": summary,
			"created_by":     createdByName,
			"document_type":  documentTypeName,
		})
	}

	RespondWithJSON(w, http.StatusOK, versions)
}

func (h *DocumentHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	docID := chi.URLParam(r, "id")

	var input struct {
		Status string `json:"status"`
	}

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	// Validar status permitidos
	validStatus := map[string]bool{
		"ACTIVE":           true,
		"ARCHIVED":         true,
		"PENDING_APPROVAL": true,
		"REJECTED":         true,
	}

	if !validStatus[input.Status] {
		RespondWithError(w, http.StatusBadRequest, "Status inválido")
		return
	}

	_, err := h.db.Conn.Exec(`
		UPDATE documents 
		SET status = $1 
		WHERE id = $2 AND tenant_id = $3`,
		input.Status, docID, tenantID)

	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar status")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Status atualizado com sucesso"})
}

func (h *DocumentHandler) UploadNewVersion(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	docID := chi.URLParam(r, "id")
	claims, _ := middleware.GetClaims(r.Context())
	userID := claims.UserID

	// 1. Validar documento e permissão
	var sectorID *uuid.UUID
	var currentVersion int
	var oldMinioKey string
	err := h.db.Conn.QueryRow(`
		SELECT sector_id, current_version, minio_key 
		FROM documents 
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
		docID, tenantID).Scan(&sectorID, &currentVersion, &oldMinioKey)

	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Documento não encontrado")
		return
	}

	if !h.canWrite(r, sectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para atualizar este documento")
		return
	}

	// 2. Parse do arquivo
	err = r.ParseMultipartForm(10 << 20)
	if err != nil {
		RespondWithError(w, http.StatusBadRequest, "Arquivo muito grande ou formato inválido")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		RespondWithError(w, http.StatusBadRequest, "Arquivo não enviado")
		return
	}
	defer file.Close()

	// 2.1 Validação de Segurança e Leitura de Conteúdo
	fileBytes, err := io.ReadAll(file)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao ler arquivo")
		return
	}

	// Detectar Content-Type real (Magic Bytes)
	detectedType := http.DetectContentType(fileBytes)
	allowedTypes := map[string]bool{
		"application/pdf":    true,
		"image/jpeg":         true,
		"image/png":          true,
		"image/gif":          true,
		"image/webp":         true,
		"application/msword": true,
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
		"application/vnd.ms-excel": true,
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         true,
		"application/vnd.ms-powerpoint":                                             true,
		"application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
		"text/plain":      true,
		"text/csv":        true,
		"application/zip": true,
	}

	if !allowedTypes[detectedType] {
		log.Printf("Aviso: Upload de versão bloqueado - Tipo não permitido: %s", detectedType)
		RespondWithError(w, http.StatusForbidden, "Tipo de arquivo não permitido")
		return
	}

	// Sanitização de Nome de Arquivo
	safeName := sanitizeFilename(filepath.Base(header.Filename))

	changeSummary := r.FormValue("change_summary")
	if changeSummary == "" {
		changeSummary = fmt.Sprintf("Nova versão enviada por %s", claims.Role)
	}

	// 3. Validação de Quota (Redis)
	var maxStorage int64
	err = h.db.Conn.QueryRow("SELECT max_storage_bytes FROM tenant_quotas WHERE tenant_id = $1", tenantID).Scan(&maxStorage)
	if err != nil {
		maxStorage = 5 * 1024 * 1024 * 1024
	}

	allowed, _ := h.redis.CheckQuota(r.Context(), tenantID.String(), header.Size, maxStorage)
	if !allowed {
		RespondWithError(w, http.StatusForbidden, "Limite de armazenamento atingido")
		return
	}

	// 4. Criptografia
	// 4.1 Realizar Scan de Segurança (VirusTotal por Hash) antes da criptografia
	isSafe, scanResult, scanErr := h.security.ScanFileHash(fileBytes)
	initialStatus := "QUARANTINE"
	if scanErr == nil && !isSafe {
		initialStatus = "INFECTED"
		log.Printf("Aviso: Nova versão marcada como INFECTED pelo VirusTotal: %s (ID: %s)", safeName, scanResult)
	} else if scanErr == nil && scanResult == "SAFE" {
		initialStatus = "ACTIVE"
	}

	dek, err := h.security.GenerateRandomKey()
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro de segurança")
		return
	}

	encryptedFile, err := h.security.EncryptAES(fileBytes, dek)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao criptografar")
		return
	}

	encryptedDEK, err := h.vault.EncryptData(r.Context(), tenantID.String(), dek)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro no Vault")
		return
	}

	dekLen := uint32(len(encryptedDEK))
	payload := new(bytes.Buffer)
	binary.Write(payload, binary.BigEndian, dekLen)
	payload.WriteString(encryptedDEK)
	payload.Write(encryptedFile)

	// 5. Upload MinIO
	newVersionNumber := currentVersion + 1
	objectName := fmt.Sprintf("%s/%s_v%d.enc", tenantID.String(), docID, newVersionNumber)
	finalPayload := payload.Bytes()
	reader := bytes.NewReader(finalPayload)

	err = h.storage.UploadEncrypted(r.Context(), objectName, reader, int64(len(finalPayload)), detectedType)
	if err != nil {
		log.Printf("Erro no upload MinIO (versão): %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Falha ao salvar no storage")
		return
	}

	// 6. Atualizar documento e Registrar Versão em Transação
	tx, err := h.db.Conn.BeginTx(r.Context(), nil)
	if err != nil {
		log.Printf("Erro ao iniciar transação: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro interno ao processar versão")
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		UPDATE documents 
		SET current_version = $1, 
			minio_key = $2, 
			size_bytes = $3, 
			content_type = $4,
			name = $5,
			extension = $6,
			status = $7,
			updated_at = NOW()
		WHERE id = $8 AND tenant_id = $9`,
		newVersionNumber, objectName, header.Size, detectedType, safeName, filepath.Ext(safeName), initialStatus, docID, tenantID)

	if err != nil {
		log.Printf("Erro ao atualizar documento: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar metadados")
		return
	}

	_, err = tx.Exec(`
		INSERT INTO document_versions (document_id, tenant_id, version_number, minio_key, size_bytes, created_by, change_summary)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		docID, tenantID, newVersionNumber, objectName, header.Size, userID, changeSummary)

	if err != nil {
		log.Printf("Erro ao registrar versão: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao registrar versão no banco")
		return
	}

	// 7. Audit Log
	tx.Exec(`
		INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, new_values)
		VALUES ($1, $2, 'UPLOAD_VERSION', 'DOCUMENT', $3, $4)`,
		tenantID, userID, docID, fmt.Sprintf(`{"version": %d}`, newVersionNumber))

	if err := tx.Commit(); err != nil {
		log.Printf("Erro ao commitar transação: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao finalizar upload de versão")
		return
	}

	// 8. Atualizar Cache de Quota
	_ = h.redis.UpdateQuotaCache(r.Context(), tenantID.String(), header.Size)

	RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Nova versão enviada com sucesso", "version": newVersionNumber})
}

func (h *DocumentHandler) UpdateOCR(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	docID := chi.URLParam(r, "id")

	var input struct {
		OCRText           *string   `json:"ocr_text"`
		ContractExpiresAt *JSONTime `json:"contract_expires_at"`
	}

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	if input.OCRText == nil && input.ContractExpiresAt == nil {
		RespondWithError(w, http.StatusBadRequest, "Nenhuma informação de OCR informada")
		return
	}

	var sectorID *uuid.UUID
	var name, extension string
	err := h.db.Conn.QueryRow(`
		SELECT sector_id, name, extension FROM documents 
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
		docID, tenantID).Scan(&sectorID, &name, &extension)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Documento não encontrado")
		return
	}

	if !h.canWrite(r, sectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para atualizar OCR deste documento")
		return
	}

	_, err = h.db.Conn.Exec(`
		UPDATE documents 
		SET ocr_text = COALESCE($1, ocr_text),
		    ocr_processed_at = CASE WHEN $1 IS NULL THEN ocr_processed_at ELSE NOW() END,
		    contract_expires_at = COALESCE($2, contract_expires_at),
		    updated_at = NOW()
		WHERE id = $3 AND tenant_id = $4`,
		input.OCRText, input.ContractExpiresAt, docID, tenantID)
	if err != nil {
		log.Printf("Erro ao atualizar OCR: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar OCR")
		return
	}

	// 3. Indexar no OpenSearch se houver texto OCR
	if input.OCRText != nil && *input.OCRText != "" && h.os != nil {
		go func() {
			err := h.os.IndexDocument(context.Background(), service.DocumentIndex{
				ID:        docID,
				TenantID:  tenantID,
				Name:      name,
				OCRText:   *input.OCRText,
				Extension: extension,
				SectorID:  sectorID,
				UpdatedAt: time.Now().Format(time.RFC3339),
			})
			if err != nil {
				log.Printf("Erro ao indexar no OpenSearch: %v", err)
			}
		}()
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "OCR atualizado com sucesso"})
}

func (h *DocumentHandler) ListContractAlerts(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())

	daysParam := r.URL.Query().Get("days")
	sectorFilter := strings.TrimSpace(r.URL.Query().Get("sector_id"))
	days := 0
	if daysParam != "" {
		if parsed, err := strconv.Atoi(daysParam); err == nil && parsed >= 0 {
			days = parsed
		}
	}
	limitDate := time.Now().AddDate(0, 0, days)

	userPermissions := make(map[uuid.UUID]string)
	var userSectorIDs []uuid.UUID
	rowsSectors, err := h.db.Conn.Query("SELECT sector_id, permission_type FROM user_sectors WHERE user_id = $1", claims.UserID)
	if err == nil {
		defer rowsSectors.Close()
		for rowsSectors.Next() {
			var sid uuid.UUID
			var pt string
			if e := rowsSectors.Scan(&sid, &pt); e == nil {
				userPermissions[sid] = pt
				userSectorIDs = append(userSectorIDs, sid)
			}
		}
	}

	sqlQuery := `
		SELECT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.contract_expires_at, d.sector_id, d.owner_id,
		       c.id as contract_id, c.end_date, c.renewed_until,
		       dtp.name as document_type_name
		FROM documents d
		LEFT JOIN contracts c ON c.document_id = d.id AND c.tenant_id = d.tenant_id
		LEFT JOIN document_types dtp ON d.document_type_id = dtp.id
		WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND d.contract_expires_at IS NOT NULL
		  AND d.contract_expires_at <= $2
	`
	args := []any{tenantID, limitDate}
	argID := 3

	if !claims.IsMaster {
		if len(userSectorIDs) > 0 {
			sqlQuery += " AND (d.sector_id IS NULL"
			for _, sid := range userSectorIDs {
				sqlQuery += fmt.Sprintf(" OR d.sector_id = $%d", argID)
				args = append(args, sid)
				argID++
			}
			sqlQuery += ")"
		} else {
			sqlQuery += " AND d.sector_id IS NULL"
		}
	}

	if sectorFilter != "" {
		if sectorFilter == "none" {
			sqlQuery += " AND d.sector_id IS NULL"
		} else {
			sqlQuery += fmt.Sprintf(" AND d.sector_id = $%d", argID)
			args = append(args, sectorFilter)
			argID++
		}
	}

	sqlQuery += " ORDER BY d.contract_expires_at ASC"

	rows, err := h.db.Conn.Query(sqlQuery, args...)
	if err != nil {
		log.Printf("Erro ao buscar alertas de contratos: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao buscar alertas")
		return
	}
	defer rows.Close()

	var alerts []map[string]any
	for rows.Next() {
		var id, name, ext, contentType string
		var size int64
		var expiresAt time.Time
		var sectorID *uuid.UUID
		var ownerID *int
		var contractID *uuid.UUID
		var contractEndDate *time.Time
		var contractRenewedUntil *time.Time
		var documentTypeName *string
		if e := rows.Scan(&id, &name, &ext, &size, &contentType, &expiresAt, &sectorID, &ownerID, &contractID, &contractEndDate, &contractRenewedUntil, &documentTypeName); e != nil {
			log.Printf("Erro ao scanear alerta de contrato: %v", e)
			continue
		}

		canEdit := claims.IsMaster || (ownerID != nil && *ownerID == claims.UserID)
		if !canEdit && sectorID != nil {
			if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
				canEdit = true
			}
		}

		expirationSource := "DOCUMENT"
		if contractID != nil {
			expirationSource = "CONTRACT"
		}

		alerts = append(alerts, map[string]any{
			"id":                     id,
			"name":                   name,
			"extension":              ext,
			"size":                   size,
			"content_type":           contentType,
			"contract_expires_at":    expiresAt,
			"contract_end_date":      contractEndDate,
			"contract_renewed_until": contractRenewedUntil,
			"expiration_source":      expirationSource,
			"is_expired":             expiresAt.Before(time.Now()),
			"sector_id":              sectorID,
			"can_edit":               canEdit,
			"type":                   "file",
			"document_type":          documentTypeName,
		})
	}

	RespondWithJSON(w, http.StatusOK, alerts)
}

func (h *DocumentHandler) Rename(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	id := chi.URLParam(r, "id")

	var input struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	if input.Name == "" {
		RespondWithError(w, http.StatusBadRequest, "O nome não pode ser vazio")
		return
	}

	// Buscar documento e verificar permissão
	var sectorID *uuid.UUID
	var oldName string
	err := h.db.Conn.QueryRow(`
		SELECT name, sector_id FROM documents 
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
		id, tenantID).Scan(&oldName, &sectorID)

	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Documento não encontrado")
		return
	}

	if !h.canWrite(r, sectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para renomear este documento")
		return
	}

	// Atualizar nome
	_, err = h.db.Conn.Exec(`
		UPDATE documents SET name = $1, updated_at = NOW() 
		WHERE id = $2 AND tenant_id = $3`,
		input.Name, id, tenantID)

	if err != nil {
		log.Printf("Erro ao renomear documento: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao renomear documento")
		return
	}

	// Log de auditoria
	oldVals, _ := json.Marshal(map[string]string{"name": oldName})
	newVals, _ := json.Marshal(map[string]string{"name": input.Name})

	h.db.Conn.Exec(`
		INSERT INTO audit_logs (
			tenant_id, user_id, action, entity_name, entity_id, 
			old_values, new_values, ip_address, user_agent, severity, audit_level
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'info', 'tenancy')`,
		tenantID, claims.UserID, "RENAME", "DOCUMENT", id,
		oldVals, newVals, r.RemoteAddr, r.UserAgent())

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Documento renomeado com sucesso"})
}

func (h *DocumentHandler) RenameFolder(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	id := chi.URLParam(r, "id")

	var input struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	if input.Name == "" {
		RespondWithError(w, http.StatusBadRequest, "O nome não pode ser vazio")
		return
	}

	// Buscar pasta e verificar permissão
	var sectorID *uuid.UUID
	var oldName string
	err := h.db.Conn.QueryRow(`
		SELECT name, sector_id FROM folders 
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
		id, tenantID).Scan(&oldName, &sectorID)

	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Pasta não encontrada")
		return
	}

	if !h.canWrite(r, sectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para renomear esta pasta")
		return
	}

	// Atualizar nome
	_, err = h.db.Conn.Exec(`
		UPDATE folders SET name = $1, updated_at = NOW() 
		WHERE id = $2 AND tenant_id = $3`,
		input.Name, id, tenantID)

	if err != nil {
		log.Printf("Erro ao renomear pasta: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao renomear pasta")
		return
	}

	// Log de auditoria
	oldVals, _ := json.Marshal(map[string]string{"name": oldName})
	newVals, _ := json.Marshal(map[string]string{"name": input.Name})

	h.db.Conn.Exec(`
		INSERT INTO audit_logs (
			tenant_id, user_id, action, entity_name, entity_id, 
			old_values, new_values, ip_address, user_agent, severity, audit_level
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'info', 'tenancy')`,
		tenantID, claims.UserID, "RENAME", "FOLDER", id,
		oldVals, newVals, r.RemoteAddr, r.UserAgent())

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Pasta renomeada com sucesso"})
}

func (h *DocumentHandler) RestoreVersion(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	docID := chi.URLParam(r, "id")
	claims, _ := middleware.GetClaims(r.Context())
	userID := claims.UserID

	var input struct {
		VersionNumber int `json:"version_number"`
	}

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	// 1. Validar documento e permissão
	var sectorID *uuid.UUID
	var currentVersion int
	err := h.db.Conn.QueryRow(`
		SELECT sector_id, current_version 
		FROM documents 
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
		docID, tenantID).Scan(&sectorID, &currentVersion)

	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Documento não encontrado")
		return
	}

	if !h.canWrite(r, sectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para restaurar este documento")
		return
	}

	// 2. Buscar metadados da versão a ser restaurada
	var minioKey string
	var sizeBytes int64
	err = h.db.Conn.QueryRow(`
		SELECT minio_key, size_bytes 
		FROM document_versions 
		WHERE document_id = $1 AND tenant_id = $2 AND version_number = $3`,
		docID, tenantID, input.VersionNumber).Scan(&minioKey, &sizeBytes)

	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Versão não encontrada")
		return
	}

	// 3. Criar uma nova versão que é a restauração
	newVersionNumber := currentVersion + 1
	changeSummary := fmt.Sprintf("Restaurado para a versão %d por %s", input.VersionNumber, claims.Role)

	// Iniciar transação para garantir consistência
	tx, err := h.db.Conn.BeginTx(r.Context(), nil)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao iniciar transação")
		return
	}
	defer tx.Rollback()

	// 3.1 Atualizar documento
	_, err = tx.Exec(`
		UPDATE documents 
		SET current_version = $1, minio_key = $2, size_bytes = $3, updated_at = NOW()
		WHERE id = $4 AND tenant_id = $5`,
		newVersionNumber, minioKey, sizeBytes, docID, tenantID)

	if err != nil {
		log.Printf("Erro ao restaurar documento (update): %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar metadados do documento")
		return
	}

	// 3.2 Registrar Nova Versão
	_, err = tx.Exec(`
		INSERT INTO document_versions (document_id, tenant_id, version_number, minio_key, size_bytes, created_by, change_summary)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		docID, tenantID, newVersionNumber, minioKey, sizeBytes, userID, changeSummary)

	if err != nil {
		log.Printf("Erro ao restaurar versão (insert): %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao registrar nova versão")
		return
	}

	// 4. Audit Log
	_, err = tx.Exec(`
		INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, new_values)
		VALUES ($1, $2, 'RESTORE_VERSION', 'DOCUMENT', $3, $4)`,
		tenantID, userID, docID, fmt.Sprintf(`{"from_version": %d, "to_version": %d}`, input.VersionNumber, newVersionNumber))

	if err != nil {
		log.Printf("Erro ao registrar log de auditoria: %v", err)
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Erro ao commitar transação: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao finalizar restauração")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]any{
		"message": "Versão restaurada com sucesso",
		"version": newVersionNumber,
	})
}

func (h *DocumentHandler) CreateAnnotation(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	userID := claims.UserID
	docID := chi.URLParam(r, "id")

	var req struct {
		PageNumber     int     `json:"page_number"`
		PosX           float64 `json:"pos_x"`
		PosY           float64 `json:"pos_y"`
		Width          float64 `json:"width"`
		Height         float64 `json:"height"`
		Content        string  `json:"content"`
		Color          string  `json:"color"`
		IsPrivate      bool    `json:"is_private"`
		FontFamily     string  `json:"font_family"`
		AnnotationType string  `json:"annotation_type"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Requisição inválida")
		return
	}

	// Validação de permissão de escrita no setor do documento
	var docSectorID *uuid.UUID
	if err := h.db.Conn.QueryRow("SELECT sector_id FROM documents WHERE id = $1 AND tenant_id = $2", docID, tenantID).Scan(&docSectorID); err != nil {
		RespondWithError(w, http.StatusNotFound, "Documento não encontrado")
		return
	}
	if !h.canWrite(r, docSectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para criar anotações neste documento")
		return
	}

	// Valores padrão
	if req.FontFamily == "" {
		req.FontFamily = "Inter"
	}
	if req.AnnotationType == "" {
		req.AnnotationType = "post-it"
	}

	var annotationID uuid.UUID
	query := `
		INSERT INTO document_annotations 
		(tenant_id, document_id, user_id, page_number, pos_x, pos_y, width, height, content, color, is_private, font_family, annotation_type)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		RETURNING id`

	err := h.db.Conn.QueryRow(query,
		tenantID, docID, userID, req.PageNumber, req.PosX, req.PosY, req.Width, req.Height, req.Content, req.Color, req.IsPrivate,
		req.FontFamily, req.AnnotationType,
	).Scan(&annotationID)

	if err != nil {
		log.Printf("Erro ao criar anotação: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao salvar anotação")
		return
	}

	RespondWithJSON(w, http.StatusCreated, map[string]any{
		"message": "Anotação criada",
		"id":      annotationID.String(),
	})
}

func (h *DocumentHandler) UpdateAnnotation(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	annotationID := chi.URLParam(r, "annotationId")

	var req struct {
		Content        string  `json:"content"`
		Color          string  `json:"color"`
		PosX           float64 `json:"pos_x"`
		PosY           float64 `json:"pos_y"`
		Width          float64 `json:"width"`
		Height         float64 `json:"height"`
		FontFamily     string  `json:"font_family"`
		AnnotationType string  `json:"annotation_type"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Requisição inválida")
		return
	}

	// Validação de permissão de escrita no setor do documento da anotação
	var docSectorID *uuid.UUID
	err := h.db.Conn.QueryRow(`
		SELECT d.sector_id 
		FROM document_annotations da 
		JOIN documents d ON da.document_id = d.id 
		WHERE da.id = $1 AND da.tenant_id = $2`, annotationID, tenantID).Scan(&docSectorID)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Anotação não encontrada")
		return
	}
	if !h.canWrite(r, docSectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para atualizar anotações neste documento")
		return
	}

	_, err = h.db.Conn.Exec(`
		UPDATE document_annotations 
		SET content = $1, color = $2, pos_x = $3, pos_y = $4, width = $5, height = $6, font_family = $7, annotation_type = $8, updated_at = CURRENT_TIMESTAMP
		WHERE id = $9 AND tenant_id = $10`,
		req.Content, req.Color, req.PosX, req.PosY, req.Width, req.Height, req.FontFamily, req.AnnotationType, annotationID, tenantID)

	if err != nil {
		log.Printf("Erro ao atualizar anotação: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar anotação")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Anotação atualizada com sucesso"})
}

// --- Handlers para Compartilhamento Direto ---

func (h *DocumentHandler) Share(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	docID := chi.URLParam(r, "id")

	var req struct {
		UserID         *int    `json:"user_id"`
		SectorID       *string `json:"sector_id"`
		PermissionType string  `json:"permission_type"` // 'READ', 'WRITE'
		IsFolder       bool    `json:"is_folder"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Requisição inválida")
		return
	}

	// Validação de permissão de escrita no setor do documento/pasta
	var targetSectorID *uuid.UUID
	var err error
	if req.IsFolder {
		err = h.db.Conn.QueryRow("SELECT sector_id FROM folders WHERE id = $1 AND tenant_id = $2", docID, tenantID).Scan(&targetSectorID)
	} else {
		err = h.db.Conn.QueryRow("SELECT sector_id FROM documents WHERE id = $1 AND tenant_id = $2", docID, tenantID).Scan(&targetSectorID)
	}
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Item não encontrado")
		return
	}
	if !h.canWrite(r, targetSectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para compartilhar este item")
		return
	}

	// Restrição para papel USER: não pode compartilhar itens confidenciais
	if claims.Role == "USER" && !claims.IsMaster {
		if h.isConfidential(tenantID, docID, req.IsFolder) {
			RespondWithError(w, http.StatusForbidden, "Usuários básicos não podem compartilhar itens marcados como Confidencial")
			return
		}
	}

	if req.PermissionType == "" {
		req.PermissionType = "READ"
	}

	if req.UserID != nil {
		// Compartilhar com usuário
		query := ""
		if req.IsFolder {
			query = `INSERT INTO document_shares (tenant_id, folder_id, user_id, permission_type) 
					 VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, folder_id) DO UPDATE SET permission_type = $4`
		} else {
			query = `INSERT INTO document_shares (tenant_id, document_id, user_id, permission_type) 
					 VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, document_id) DO UPDATE SET permission_type = $4`
		}
		_, err = h.db.Conn.Exec(query, tenantID, docID, *req.UserID, req.PermissionType)
	} else if req.SectorID != nil {
		// Compartilhar com setor
		query := ""
		if req.IsFolder {
			query = `INSERT INTO document_sector_shares (tenant_id, folder_id, sector_id, permission_type) 
					 VALUES ($1, $2, $3, $4) ON CONFLICT (sector_id, folder_id) DO UPDATE SET permission_type = $4`
		} else {
			query = `INSERT INTO document_sector_shares (tenant_id, document_id, sector_id, permission_type) 
					 VALUES ($1, $2, $3, $4) ON CONFLICT (sector_id, document_id) DO UPDATE SET permission_type = $4`
		}
		_, err = h.db.Conn.Exec(query, tenantID, docID, *req.SectorID, req.PermissionType)
	} else {
		RespondWithError(w, http.StatusBadRequest, "Usuário ou Setor deve ser informado")
		return
	}

	if err != nil {
		log.Printf("Erro ao compartilhar: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao processar compartilhamento")
		return
	}
	targetType := "user"
	if req.SectorID != nil {
		targetType = "sector"
	}
	newVals := fmt.Sprintf(`{"target_type":"%s","permission_type":"%s"}`, targetType, req.PermissionType)
	_, _ = h.db.Conn.Exec(`
		INSERT INTO audit_logs (tenant_id, user_id, action, entity_name, entity_id, new_values, ip_address, user_agent, severity, audit_level)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'info', 'tenancy')`,
		tenantID, claims.UserID, "SHARE", "DOCUMENT", docID, newVals, r.RemoteAddr, r.UserAgent())

	RespondWithJSON(w, http.StatusCreated, map[string]string{"message": "Compartilhamento criado com sucesso"})
}

func (h *DocumentHandler) GetShares(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	docID := chi.URLParam(r, "id")
	isFolder := r.URL.Query().Get("is_folder") == "true"

	// 1. Validar acesso ao item (setor)
	var sectorID *uuid.UUID
	var err error
	if isFolder {
		err = h.db.Conn.QueryRow("SELECT sector_id FROM folders WHERE id = $1 AND tenant_id = $2", docID, tenantID).Scan(&sectorID)
	} else {
		err = h.db.Conn.QueryRow("SELECT sector_id FROM documents WHERE id = $1 AND tenant_id = $2", docID, tenantID).Scan(&sectorID)
	}

	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Item não encontrado")
		return
	}

	if !claims.IsMaster && sectorID != nil {
		var hasAccess bool
		err = h.db.Conn.QueryRow(`
			SELECT EXISTS(SELECT 1 FROM user_sectors WHERE user_id = $1 AND sector_id = $2)`,
			claims.UserID, sectorID).Scan(&hasAccess)
		if err != nil || !hasAccess {
			RespondWithError(w, http.StatusForbidden, "Sem acesso a este item")
			return
		}
	}

	type ShareInfo struct {
		ID             string     `json:"id"`
		Type           string     `json:"type"` // 'user', 'sector' ou 'link'
		TargetName     string     `json:"target_name"`
		PermissionType string     `json:"permission_type"`
		CreatedAt      time.Time  `json:"created_at"`
		ExpiresAt      *time.Time `json:"expires_at,omitempty"`
		ViewCount      *int       `json:"view_count,omitempty"`
		MaxViews       *int       `json:"max_views,omitempty"`
	}

	shares := []ShareInfo{}

	// Buscar compartilhamentos com usuários
	queryUsers := ""
	if isFolder {
		queryUsers = `SELECT ds.id, 'user', u.full_name, ds.permission_type, ds.created_at 
					  FROM document_shares ds JOIN users u ON ds.user_id = u.id 
					  WHERE ds.folder_id = $1 AND ds.tenant_id = $2`
	} else {
		queryUsers = `SELECT ds.id, 'user', u.full_name, ds.permission_type, ds.created_at 
					  FROM document_shares ds JOIN users u ON ds.user_id = u.id 
					  WHERE ds.document_id = $1 AND ds.tenant_id = $2`
	}

	rows, err := h.db.Conn.Query(queryUsers, docID, tenantID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var s ShareInfo
			rows.Scan(&s.ID, &s.Type, &s.TargetName, &s.PermissionType, &s.CreatedAt)
			shares = append(shares, s)
		}
	}

	// Buscar compartilhamentos com setores
	querySectors := ""
	if isFolder {
		querySectors = `SELECT dss.id, 'sector', sec.name, dss.permission_type, dss.created_at 
						FROM document_sector_shares dss JOIN sectors sec ON dss.sector_id = sec.id 
						WHERE dss.folder_id = $1 AND dss.tenant_id = $2`
	} else {
		querySectors = `SELECT dss.id, 'sector', sec.name, dss.permission_type, dss.created_at 
						FROM document_sector_shares dss JOIN sectors sec ON dss.sector_id = sec.id 
						WHERE dss.document_id = $1 AND dss.tenant_id = $2`
	}

	rowsSec, err := h.db.Conn.Query(querySectors, docID, tenantID)
	if err == nil {
		defer rowsSec.Close()
		for rowsSec.Next() {
			var s ShareInfo
			rowsSec.Scan(&s.ID, &s.Type, &s.TargetName, &s.PermissionType, &s.CreatedAt)
			shares = append(shares, s)
		}
	}

	// Buscar links públicos
	queryLinks := ""
	if isFolder {
		queryLinks = `SELECT id, 'link', 'Link Público', 'READ', created_at, expires_at, view_count, max_views 
					   FROM document_links 
					   WHERE folder_id = $1 AND tenant_id = $2 AND active = TRUE`
	} else {
		queryLinks = `SELECT id, 'link', 'Link Público', 'READ', created_at, expires_at, view_count, max_views 
					   FROM document_links 
					   WHERE document_id = $1 AND tenant_id = $2 AND active = TRUE`
	}

	rowsLinks, err := h.db.Conn.Query(queryLinks, docID, tenantID)
	if err == nil {
		defer rowsLinks.Close()
		for rowsLinks.Next() {
			var s ShareInfo
			rowsLinks.Scan(&s.ID, &s.Type, &s.TargetName, &s.PermissionType, &s.CreatedAt, &s.ExpiresAt, &s.ViewCount, &s.MaxViews)
			shares = append(shares, s)
		}
	}

	if shares == nil {
		shares = []ShareInfo{}
	}
	RespondWithJSON(w, http.StatusOK, shares)
}

func (h *DocumentHandler) RevokeShare(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	shareID := chi.URLParam(r, "shareId")
	isSector := r.URL.Query().Get("type") == "sector"
	isLink := r.URL.Query().Get("type") == "link"

	// 1. Validar permissão (GESTOR no setor ou OWNER do item)
	var itemSectorID *uuid.UUID
	var itemOwnerID *int
	var err error
	if isSector {
		err = h.db.Conn.QueryRow(`
			SELECT COALESCE(d.sector_id, f.sector_id), COALESCE(d.owner_id, f.owner_id)
			FROM document_sector_shares dss 
			LEFT JOIN documents d ON dss.document_id = d.id 
			LEFT JOIN folders f ON dss.folder_id = f.id 
			WHERE dss.id = $1 AND dss.tenant_id = $2`, shareID, tenantID).Scan(&itemSectorID, &itemOwnerID)
	} else if isLink {
		err = h.db.Conn.QueryRow(`
			SELECT COALESCE(d.sector_id, f.sector_id), COALESCE(d.owner_id, f.owner_id)
			FROM document_links dl 
			LEFT JOIN documents d ON dl.document_id = d.id 
			LEFT JOIN folders f ON dl.folder_id = f.id 
			WHERE dl.id = $1 AND dl.tenant_id = $2`, shareID, tenantID).Scan(&itemSectorID, &itemOwnerID)
	} else {
		err = h.db.Conn.QueryRow(`
			SELECT COALESCE(d.sector_id, f.sector_id), COALESCE(d.owner_id, f.owner_id)
			FROM document_shares ds 
			LEFT JOIN documents d ON ds.document_id = d.id 
			LEFT JOIN folders f ON ds.folder_id = f.id 
			WHERE ds.id = $1 AND ds.tenant_id = $2`, shareID, tenantID).Scan(&itemSectorID, &itemOwnerID)
	}

	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Compartilhamento não encontrado")
		return
	}

	// Permite se for MASTER, GESTOR do setor ou OWNER do item
	isOwner := itemOwnerID != nil && *itemOwnerID == claims.UserID
	if !isOwner && !h.canWrite(r, itemSectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para revogar este compartilhamento")
		return
	}

	if isSector {
		_, err = h.db.Conn.Exec("DELETE FROM document_sector_shares WHERE id = $1 AND tenant_id = $2", shareID, tenantID)
	} else if isLink {
		_, err = h.db.Conn.Exec("UPDATE document_links SET active = FALSE WHERE id = $1 AND tenant_id = $2", shareID, tenantID)
	} else {
		_, err = h.db.Conn.Exec("DELETE FROM document_shares WHERE id = $1 AND tenant_id = $2", shareID, tenantID)
	}

	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao revogar compartilhamento")
		return
	}

	targetType := "user"
	if isSector {
		targetType = "sector"
	}
	if isLink {
		targetType = "link"
	}
	newVals := fmt.Sprintf(`{"share_id":"%s","type":"%s"}`, shareID, targetType)
	_, _ = h.db.Conn.Exec(`
		INSERT INTO audit_logs (tenant_id, user_id, action, entity_name, entity_id, new_values, ip_address, user_agent, severity, audit_level)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'info', 'tenancy')`,
		tenantID, claims.UserID, "REVOKE_SHARE", "SHARE", shareID, newVals, r.RemoteAddr, r.UserAgent())

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Compartilhamento revogado com sucesso"})
}

func (h *DocumentHandler) DeleteAnnotation(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	annotationID := chi.URLParam(r, "annotationId")

	// Validação de permissão de escrita no setor do documento da anotação
	var docSectorID *uuid.UUID
	err := h.db.Conn.QueryRow(`
		SELECT d.sector_id 
		FROM document_annotations da 
		JOIN documents d ON da.document_id = d.id 
		WHERE da.id = $1 AND da.tenant_id = $2`, annotationID, tenantID).Scan(&docSectorID)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Anotação não encontrada")
		return
	}
	if !h.canWrite(r, docSectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para excluir anotações neste documento")
		return
	}

	_, err = h.db.Conn.Exec(`
		DELETE FROM document_annotations 
		WHERE id = $1 AND tenant_id = $2`, annotationID, tenantID)

	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao excluir anotação")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Anotação excluída com sucesso"})
}

// --- Handlers para Etiquetas (Tags) ---

func (h *DocumentHandler) ListTags(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())

	rows, err := h.db.Conn.Query(`
		SELECT id, name, color 
		FROM document_tags 
		WHERE tenant_id = $1 
		ORDER BY name ASC`, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao buscar etiquetas")
		return
	}
	defer rows.Close()

	var tags []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var name, color string
		if err := rows.Scan(&id, &name, &color); err != nil {
			log.Printf("ListTags: Erro ao scanear tag: %v", err)
			continue
		}
		tags = append(tags, map[string]any{
			"id":    id.String(),
			"name":  name,
			"color": color,
		})
	}

	if tags == nil {
		tags = []map[string]any{}
	}
	RespondWithJSON(w, http.StatusOK, tags)
}

func (h *DocumentHandler) CreateTag(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := middleware.GetTenantID(r.Context())
	if !ok {
		log.Printf("CreateTag: Erro ao obter tenantID")
		RespondWithError(w, http.StatusUnauthorized, "Erro de autenticação")
		return
	}

	claims, _ := middleware.GetClaims(r.Context())
	// Apenas MASTER ou usuários com permissão GESTOR em pelo menos um setor podem criar etiquetas
	if !claims.IsMaster {
		var hasGestorPerm bool
		err := h.db.Conn.QueryRow(`
			SELECT EXISTS(
				SELECT 1 FROM user_sectors 
				WHERE user_id = $1 AND permission_type = 'GESTOR'
			)`, claims.UserID).Scan(&hasGestorPerm)
		if err != nil || !hasGestorPerm {
			RespondWithError(w, http.StatusForbidden, "Apenas gestores podem criar etiquetas")
			return
		}
	}

	var req struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("CreateTag: Erro ao decodificar corpo: %v", err)
		RespondWithError(w, http.StatusBadRequest, "Requisição inválida")
		return
	}

	log.Printf("CreateTag: Tentando criar tag '%s' com cor '%s' para tenant %s", req.Name, req.Color, tenantID)

	var tagID uuid.UUID
	err := h.db.Conn.QueryRow(`
		INSERT INTO document_tags (tenant_id, name, color) 
		VALUES ($1, $2, $3) 
		ON CONFLICT (tenant_id, name) DO UPDATE SET color = EXCLUDED.color
		RETURNING id`, tenantID, req.Name, req.Color).Scan(&tagID)

	if err != nil {
		log.Printf("CreateTag: Erro ao inserir/atualizar tag: %v", err)
		RespondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Erro ao criar etiqueta: %v", err))
		return
	}

	log.Printf("CreateTag: Etiqueta criada/atualizada com sucesso: ID %s", tagID.String())

	RespondWithJSON(w, http.StatusCreated, map[string]any{
		"message": "Etiqueta criada",
		"id":      tagID.String(),
	})
}

func (h *DocumentHandler) AssignTag(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	targetID := chi.URLParam(r, "id")
	var req struct {
		TagID string `json:"tag_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Requisição inválida")
		return
	}

	// Verificar se o targetID é um documento ou pasta e obter o setor
	var isDoc bool
	var sectorID *uuid.UUID
	err := h.db.Conn.QueryRow("SELECT sector_id FROM documents WHERE id = $1 AND tenant_id = $2", targetID, tenantID).Scan(&sectorID)
	if err == nil {
		isDoc = true
	} else {
		err = h.db.Conn.QueryRow("SELECT sector_id FROM folders WHERE id = $1 AND tenant_id = $2", targetID, tenantID).Scan(&sectorID)
		if err != nil {
			RespondWithError(w, http.StatusNotFound, "Item não encontrado")
			return
		}
	}

	// Validação de permissão de escrita
	if !h.canWrite(r, sectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para gerenciar etiquetas neste item")
		return
	}

	// Restrição para papel USER: não pode aplicar/remover etiqueta 'Confidencial'
	// Requisito: "confidencial so apenas gestores e admin"
	claims, _ := middleware.GetClaims(r.Context())
	if claims.Role == "USER" && !claims.IsMaster {
		var tagName string
		err := h.db.Conn.QueryRow("SELECT name FROM document_tags WHERE id = $1 AND tenant_id = $2", req.TagID, tenantID).Scan(&tagName)
		if err == nil && strings.ToLower(tagName) == "confidencial" {
			RespondWithError(w, http.StatusForbidden, "Apenas gestores e administradores podem gerenciar a etiqueta 'Confidencial'")
			return
		}
	}

	if isDoc {
		_, err = h.db.Conn.Exec(`
			INSERT INTO document_tag_assignments (document_id, tag_id) 
			VALUES ($1, $2) 
			ON CONFLICT DO NOTHING`, targetID, req.TagID)
	} else {
		_, err = h.db.Conn.Exec(`
			INSERT INTO folder_tag_assignments (folder_id, tag_id) 
			VALUES ($1, $2) 
			ON CONFLICT DO NOTHING`, targetID, req.TagID)
	}

	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao vincular etiqueta")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Etiqueta vinculada com sucesso"})
}

func (h *DocumentHandler) UnassignTag(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	targetID := chi.URLParam(r, "id")
	tagID := chi.URLParam(r, "tagId")

	// Verificar o setor do item para validar permissão
	var sectorID *uuid.UUID
	err := h.db.Conn.QueryRow("SELECT sector_id FROM documents WHERE id = $1 AND tenant_id = $2", targetID, tenantID).Scan(&sectorID)
	if err != nil {
		err = h.db.Conn.QueryRow("SELECT sector_id FROM folders WHERE id = $1 AND tenant_id = $2", targetID, tenantID).Scan(&sectorID)
		if err != nil {
			RespondWithError(w, http.StatusNotFound, "Item não encontrado")
			return
		}
	}

	// Validação de permissão de escrita
	if !h.canWrite(r, sectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para gerenciar etiquetas neste item")
		return
	}

	// Restrição para papel USER: não pode aplicar/remover etiqueta 'Confidencial'
	// Requisito: "confidencial so apenas gestores e admin"
	claims, _ := middleware.GetClaims(r.Context())
	if claims.Role == "USER" && !claims.IsMaster {
		var tagName string
		err := h.db.Conn.QueryRow("SELECT name FROM document_tags WHERE id = $1 AND tenant_id = $2", tagID, tenantID).Scan(&tagName)
		if err == nil && strings.ToLower(tagName) == "confidencial" {
			RespondWithError(w, http.StatusForbidden, "Apenas gestores e administradores podem gerenciar a etiqueta 'Confidencial'")
			return
		}
	}

	// Tentar remover de ambos (UUIDs são únicos, então não há problema)
	_, err = h.db.Conn.Exec(`
		DELETE FROM document_tag_assignments 
		WHERE document_id = $1 AND tag_id = $2`, targetID, tagID)

	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao remover etiqueta de documento")
		return
	}

	_, err = h.db.Conn.Exec(`
		DELETE FROM folder_tag_assignments 
		WHERE folder_id = $1 AND tag_id = $2`, targetID, tagID)

	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao remover etiqueta de pasta")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Etiqueta removida com sucesso"})
}

// --- Handlers para Links Temporários (Expiring Links) ---

func (h *DocumentHandler) CreateShareLink(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	itemID := chi.URLParam(r, "id")
	isFolder := r.URL.Query().Get("is_folder") == "true"

	var req struct {
		ExpiresInMinutes int    `json:"expires_in_minutes"`
		MaxViews         int    `json:"max_views"`
		Password         string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Requisição inválida")
		return
	}

	if req.Password == "" {
		RespondWithError(w, http.StatusBadRequest, "A senha é obrigatória para gerar um link público")
		return
	}

	// Validação de permissão de escrita no setor do item
	var itemSectorID *uuid.UUID
	var queryCheck string
	if isFolder {
		queryCheck = "SELECT sector_id FROM folders WHERE id = $1 AND tenant_id = $2"
	} else {
		queryCheck = "SELECT sector_id FROM documents WHERE id = $1 AND tenant_id = $2"
	}

	if err := h.db.Conn.QueryRow(queryCheck, itemID, tenantID).Scan(&itemSectorID); err != nil {
		RespondWithError(w, http.StatusNotFound, "Item não encontrado")
		return
	}
	if !h.canWrite(r, itemSectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para gerar link para este item")
		return
	}

	// Restrição para papel USER: não pode compartilhar itens confidenciais
	if claims.Role == "USER" && !claims.IsMaster {
		if h.isConfidential(tenantID, itemID, isFolder) {
			RespondWithError(w, http.StatusForbidden, "Usuários básicos não podem compartilhar itens marcados como Confidencial")
			return
		}
	}

	// Define expiração padrão de 1 hora se não informado
	if req.ExpiresInMinutes <= 0 {
		req.ExpiresInMinutes = 60
	}

	accessToken := uuid.New().String()
	expiresAt := time.Now().Add(time.Duration(req.ExpiresInMinutes) * time.Minute)

	// Hash da senha se fornecida
	var passwordHash *string
	if req.Password != "" {
		hash, _ := h.security.HashPassword(req.Password)
		passwordHash = &hash
	}

	var maxViews *int
	if req.MaxViews > 0 {
		maxViews = &req.MaxViews
	}

	var query string
	if isFolder {
		query = `
			INSERT INTO document_links (tenant_id, folder_id, access_token, expires_at, max_views, password_hash)
			VALUES ($1, $2, $3, $4, $5, $6)`
	} else {
		query = `
			INSERT INTO document_links (tenant_id, document_id, access_token, expires_at, max_views, password_hash)
			VALUES ($1, $2, $3, $4, $5, $6)`
	}

	_, err := h.db.Conn.Exec(query, tenantID, itemID, accessToken, expiresAt, maxViews, passwordHash)
	if err != nil {
		log.Printf("Erro ao criar link de compartilhamento: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao gerar link")
		return
	}

	maxViewsVal := "null"
	if maxViews != nil {
		maxViewsVal = strconv.Itoa(*maxViews)
	}
	newVals := fmt.Sprintf(`{"access_token":"%s","expires_at":"%s","max_views":%s,"is_folder":%v}`, accessToken, expiresAt.Format(time.RFC3339), maxViewsVal, isFolder)
	_, _ = h.db.Conn.Exec(`
		INSERT INTO audit_logs (tenant_id, user_id, action, entity_name, entity_id, new_values, ip_address, user_agent, severity, audit_level)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'info', 'tenancy')`,
		tenantID, claims.UserID, "CREATE_SHARE_LINK", "DOCUMENT_LINK", itemID, newVals, r.RemoteAddr, r.UserAgent())

	RespondWithJSON(w, http.StatusOK, map[string]any{
		"share_url":  fmt.Sprintf("/public/view/%s", accessToken),
		"expires_at": expiresAt.Format(time.RFC3339),
	})
}

func (h *DocumentHandler) PublicView(w http.ResponseWriter, r *http.Request) {
	accessToken := chi.URLParam(r, "token")
	password := strings.TrimSpace(r.Header.Get("X-Share-Password"))
	allowLegacyQueryPassword := strings.EqualFold(strings.TrimSpace(os.Getenv("ALLOW_PUBLIC_SHARE_QUERY_PASSWORD")), "true")
	if password == "" && allowLegacyQueryPassword {
		password = r.URL.Query().Get("p")
	}
	requestedDocID := r.URL.Query().Get("doc_id")

	// 1. Validar Token e Expiração
	var docID, folderID *uuid.UUID
	var tenantID uuid.UUID
	var expiresAt time.Time
	var maxViews *int
	var viewCount int
	var passwordHash *string
	var minioKey, contentType *string

	query := `
		SELECT dl.document_id, dl.folder_id, dl.tenant_id, dl.expires_at, dl.max_views, dl.view_count, dl.password_hash,
		       d.minio_key, d.content_type, d.name as doc_name, f.name as folder_name, dtp.name as document_type_name
		FROM document_links dl
		LEFT JOIN documents d ON dl.document_id = d.id
		LEFT JOIN folders f ON dl.folder_id = f.id
		LEFT JOIN document_types dtp ON d.document_type_id = dtp.id
		WHERE dl.access_token = $1 AND dl.active = TRUE`

	var docName, folderName, documentTypeName *string
	err := h.db.Conn.QueryRow(query, accessToken).Scan(
		&docID, &folderID, &tenantID, &expiresAt, &maxViews, &viewCount, &passwordHash,
		&minioKey, &contentType, &docName, &folderName, &documentTypeName,
	)

	if err != nil {
		log.Printf("PublicView Error: %v", err)
		RespondWithError(w, http.StatusNotFound, "Link inválido ou expirado")
		return
	}

	// 2. Verificar Expiração
	if time.Now().After(expiresAt) {
		RespondWithError(w, http.StatusGone, "Este link expirou")
		return
	}

	// 3. Verificar Limite de Visualizações
	if maxViews != nil && viewCount >= *maxViews {
		RespondWithError(w, http.StatusGone, "Limite de visualizações atingido")
		return
	}

	// 4. Verificar Senha se existir
	if passwordHash != nil {
		if password == "" || !h.security.CheckPasswordHash(password, *passwordHash) {
			RespondWithError(w, http.StatusUnauthorized, "Senha necessária ou incorreta")
			return
		}
	}

	// 5. Se o cliente quer JSON ou se for uma pasta sem documento específico solicitado
	isJson := strings.Contains(r.Header.Get("Accept"), "application/json")
	if isJson || (folderID != nil && requestedDocID == "") {
		if folderID != nil && requestedDocID == "" {
			// Se for pasta, lista os documentos da pasta
			rowsPV, errPV := h.db.Conn.Query(`
				SELECT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, dtp.name as document_type_name
				FROM documents d
				LEFT JOIN document_types dtp ON d.document_type_id = dtp.id
				WHERE d.folder_id = $1 AND d.tenant_id = $2 AND d.deleted_at IS NULL`, folderID, tenantID)
			if errPV != nil {
				RespondWithError(w, http.StatusInternalServerError, "Erro ao listar pasta")
				return
			}
			defer rowsPV.Close()

			var docs []map[string]any
			for rowsPV.Next() {
				var d struct {
					ID               uuid.UUID
					Name             string
					Extension        string
					SizeBytes        int64
					ContentType      string
					CreatedAt        time.Time
					DocumentTypeName *string
				}
				if e := rowsPV.Scan(&d.ID, &d.Name, &d.Extension, &d.SizeBytes, &d.ContentType, &d.CreatedAt, &d.DocumentTypeName); e != nil {
					log.Printf("PublicView: Erro ao scanear documento da pasta: %v", e)
					continue
				}
				docs = append(docs, map[string]any{
					"id":            d.ID,
					"name":          d.Name,
					"extension":     d.Extension,
					"size_bytes":    d.SizeBytes,
					"content_type":  d.ContentType,
					"created_at":    d.CreatedAt,
					"document_type": d.DocumentTypeName,
				})
			}

			RespondWithJSON(w, http.StatusOK, map[string]any{
				"folder_name": folderName,
				"documents":   docs,
			})
			return
		} else if docID != nil {
			// Se for documento e quer JSON, retorna metadados
			RespondWithJSON(w, http.StatusOK, map[string]any{
				"is_document":   true,
				"document_name": docName,
				"content_type":  contentType,
				"document_type": documentTypeName,
			})
			return
		}
	}

	// 6. Incrementar contador de visualizações
	h.db.Conn.Exec("UPDATE document_links SET view_count = view_count + 1 WHERE access_token = $1", accessToken)

	// 7. Lógica de Download/Visualização
	var finalMinioKey, finalContentType, finalName string
	var finalDocID uuid.UUID

	if docID != nil {
		if minioKey == nil || contentType == nil || docName == nil {
			RespondWithError(w, http.StatusInternalServerError, "Erro ao recuperar dados do documento")
			return
		}
		finalMinioKey = *minioKey
		finalContentType = *contentType
		finalName = *docName
		finalDocID = *docID
	} else if folderID != nil && requestedDocID != "" {
		// Download individual de arquivo dentro de uma pasta compartilhada
		reqDocUUID, errUUID := uuid.Parse(requestedDocID)
		if errUUID != nil {
			RespondWithError(w, http.StatusBadRequest, "ID do documento inválido")
			return
		}
		finalDocID = reqDocUUID

		err = h.db.Conn.QueryRow(`
			SELECT minio_key, content_type, name 
			FROM documents 
			WHERE id = $1 AND folder_id = $2 AND tenant_id = $3`,
			requestedDocID, folderID, tenantID).Scan(&finalMinioKey, &finalContentType, &finalName)
		if err != nil {
			RespondWithError(w, http.StatusNotFound, "Documento não encontrado nesta pasta")
			return
		}
	} else {
		RespondWithError(w, http.StatusBadRequest, "Nenhum documento especificado")
		return
	}

	// 8. Verificar se o documento é confidencial e buscar configurações de marca d'água
	var hasConfidentialTag bool
	var watermarkText string
	var watermarkSize int
	var watermarkOffsetY int
	var watermarkRotation int
	var watermarkOpacity int

	err = h.db.Conn.QueryRow(`
		SELECT 
			EXISTS (
				SELECT 1 FROM document_tag_assignments dta
				JOIN document_tags dt ON dt.id = dta.tag_id
				WHERE dta.document_id = $1 AND dt.tenant_id = $2 AND LOWER(dt.name) = LOWER('Confidencial')
			),
			COALESCE(t.watermark_text, 'CONFIDENCIAL'),
			COALESCE(t.watermark_size, 80),
			COALESCE(t.watermark_offset_y, 0),
			COALESCE(t.watermark_rotation, 45),
			COALESCE(t.watermark_opacity, 20)
		FROM tenants t WHERE t.id = $2`, finalDocID, tenantID).Scan(
		&hasConfidentialTag, &watermarkText, &watermarkSize, &watermarkOffsetY, &watermarkRotation, &watermarkOpacity,
	)

	if err != nil {
		log.Printf("[ERROR] Erro ao buscar configurações de marca d'água (público): %v", err)
		// Continua sem marca d'água se falhar a busca, ou você pode decidir bloquear
	}

	encryptedData, errStorage := h.storage.GetEncrypted(r.Context(), finalMinioKey)
	if errStorage != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao recuperar arquivo")
		return
	}
	defer encryptedData.Close()

	plaintext, errDecrypt := h.decryptDocument(r.Context(), tenantID, encryptedData)
	if errDecrypt != nil {
		log.Printf("Erro na descriptografia do documento (público): %v", errDecrypt)
		RespondWithError(w, http.StatusInternalServerError, "Erro na segurança do documento")
		return
	}

	// 9. Aplicar marca d'água se for PDF e (confidencial ou configurada)
	finalData := plaintext
	if strings.ToLower(finalContentType) == "application/pdf" && (hasConfidentialTag || (watermarkText != "" && watermarkText != "CONFIDENCIAL")) {
		if watermarkSize <= 0 {
			watermarkSize = 80
		}
		scale := float64(watermarkSize) / 100.0
		opacity := float64(watermarkOpacity) / 100.0

		log.Printf("[WATERMARK_PUBLIC] Aplicando marca d'água no link público para doc: %s. Text='%s'", finalDocID, watermarkText)

		watermarkedData, errWM := h.applyWatermark(finalData, watermarkText, scale, watermarkOffsetY, watermarkRotation, opacity)
		if errWM == nil {
			finalData = watermarkedData
		} else {
			log.Printf("[ERROR] Erro ao aplicar marca d'água no link público: %v", errWM)
		}
	} else {
		log.Printf("[DEBUG] Marca d'água NÃO aplicada no doc público %s. PDF=%v, Confidencial=%v, Text='%s'",
			finalDocID, strings.ToLower(finalContentType) == "application/pdf", hasConfidentialTag, watermarkText)
	}

	w.Header().Set("Content-Type", finalContentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", finalName))
	w.Header().Set("Content-Length", strconv.FormatInt(int64(len(finalData)), 10))
	w.Write(finalData)

	_, _ = h.db.Conn.Exec(`
		INSERT INTO audit_logs (tenant_id, user_id, action, entity_name, entity_id, ip_address, user_agent, severity, audit_level)
		VALUES ($1, NULL, $2, $3, $4, $5, $6, 'info', 'tenancy')`,
		tenantID, "PUBLIC_VIEW", "DOCUMENT_LINK", accessToken, r.RemoteAddr, r.UserAgent())
}

func (h *DocumentHandler) UpdateSharePermission(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	shareID := chi.URLParam(r, "shareId")
	typ := r.URL.Query().Get("type")
	var req struct {
		PermissionType string `json:"permission_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || (req.PermissionType != "READ" && req.PermissionType != "WRITE") {
		RespondWithError(w, http.StatusBadRequest, "Permissão inválida")
		return
	}
	var itemSectorID *uuid.UUID
	var err error
	switch typ {
	case "sector":
		err = h.db.Conn.QueryRow(`
			SELECT COALESCE(d.sector_id, f.sector_id) 
			FROM document_sector_shares dss 
			LEFT JOIN documents d ON dss.document_id = d.id 
			LEFT JOIN folders f ON dss.folder_id = f.id 
			WHERE dss.id = $1 AND dss.tenant_id = $2`, shareID, tenantID).Scan(&itemSectorID)
	case "user":
		err = h.db.Conn.QueryRow(`
			SELECT COALESCE(d.sector_id, f.sector_id) 
			FROM document_shares ds 
			LEFT JOIN documents d ON ds.document_id = d.id 
			LEFT JOIN folders f ON ds.folder_id = f.id 
			WHERE ds.id = $1 AND ds.tenant_id = $2`, shareID, tenantID).Scan(&itemSectorID)
	default:
		RespondWithError(w, http.StatusBadRequest, "Tipo inválido")
		return
	}
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Compartilhamento não encontrado")
		return
	}
	if !h.canWrite(r, itemSectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para atualizar este compartilhamento")
		return
	}
	if typ == "sector" {
		_, err = h.db.Conn.Exec("UPDATE document_sector_shares SET permission_type = $1 WHERE id = $2 AND tenant_id = $3", req.PermissionType, shareID, tenantID)
	} else {
		_, err = h.db.Conn.Exec("UPDATE document_shares SET permission_type = $1 WHERE id = $2 AND tenant_id = $3", req.PermissionType, shareID, tenantID)
	}
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar permissão")
		return
	}
	newVals := fmt.Sprintf(`{"share_id":"%s","permission_type":"%s"}`, shareID, req.PermissionType)
	_, _ = h.db.Conn.Exec(`
		INSERT INTO audit_logs (tenant_id, user_id, action, entity_name, entity_id, new_values, ip_address, user_agent, severity, audit_level)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'info', 'tenancy')`,
		tenantID, claims.UserID, "UPDATE_SHARE_PERMISSION", "SHARE", shareID, newVals, r.RemoteAddr, r.UserAgent())
	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Permissão de compartilhamento atualizada com sucesso"})
}
func (h *DocumentHandler) DeleteFolder(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	folderID := chi.URLParam(r, "id")

	// 1. Verificar se a pasta existe e pertence ao tenant
	var id uuid.UUID
	var folderSectorID *uuid.UUID
	err := h.db.Conn.QueryRow("SELECT id, sector_id FROM folders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL", folderID, tenantID).Scan(&id, &folderSectorID)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Pasta não encontrada")
		return
	}

	// 1.5 Validar permissão de escrita
	if !h.canWrite(r, folderSectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para excluir esta pasta")
		return
	}

	// 2. Mover para a lixeira (Soft Delete)
	_, err = h.db.Conn.Exec("UPDATE folders SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2", folderID, tenantID)
	if err != nil {
		log.Printf("Erro ao mover pasta para lixeira: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao excluir pasta")
		return
	}

	// 3. Mover documentos e subpastas recursivamente (opcional, mas bom para consistência)
	// Como a consulta de listagem já filtra por deleted_at IS NULL na pasta pai,
	// os itens dentro dela "desaparecem" da visão normal.

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Pasta excluída com sucesso"})
}

func (h *DocumentHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	docID := chi.URLParam(r, "id")

	// 1. Verificar se o documento existe e pertence ao tenant
	var id uuid.UUID
	var docSectorID *uuid.UUID
	err := h.db.Conn.QueryRow("SELECT id, sector_id FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL", docID, tenantID).Scan(&id, &docSectorID)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Documento não encontrado")
		return
	}

	// 1.5 Validar permissão de escrita
	if !h.canWrite(r, docSectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para excluir este documento")
		return
	}

	// 2. Mover para a lixeira (Soft Delete)
	_, err = h.db.Conn.Exec("UPDATE documents SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2", docID, tenantID)
	if err != nil {
		log.Printf("Erro ao mover documento para lixeira: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao excluir documento")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Documento excluído com sucesso"})
}

func (h *DocumentHandler) Move(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	itemID := chi.URLParam(r, "id")

	var req struct {
		FolderID *string `json:"folder_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Requisição inválida")
		return
	}

	// 1. Verificar se o item é um documento ou uma pasta
	var isFolder bool
	var itemSectorID *uuid.UUID

	// Tentar buscar em documentos primeiro
	err := h.db.Conn.QueryRow("SELECT sector_id FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL", itemID, tenantID).Scan(&itemSectorID)
	if err != nil {
		// Se não achou em documentos, tentar em pastas
		err = h.db.Conn.QueryRow("SELECT sector_id FROM folders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL", itemID, tenantID).Scan(&itemSectorID)
		if err != nil {
			RespondWithError(w, http.StatusNotFound, "Item não encontrado")
			return
		}
		isFolder = true
	}

	// 2. Validar permissão de escrita no item de origem
	if !h.canWrite(r, itemSectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para mover este item")
		return
	}

	// 3. Se houver uma pasta de destino, validar permissão nela também
	var targetFolderID *uuid.UUID
	if req.FolderID != nil && *req.FolderID != "" && *req.FolderID != "root" {
		parsedID, err := uuid.Parse(*req.FolderID)
		if err != nil {
			RespondWithError(w, http.StatusBadRequest, "ID da pasta de destino inválido")
			return
		}
		targetFolderID = &parsedID

		var targetSectorID *uuid.UUID
		err = h.db.Conn.QueryRow("SELECT sector_id FROM folders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL", targetFolderID, tenantID).Scan(&targetSectorID)
		if err != nil {
			RespondWithError(w, http.StatusNotFound, "Pasta de destino não encontrada")
			return
		}

		if !h.canWrite(r, targetSectorID) {
			RespondWithError(w, http.StatusForbidden, "Sem permissão para mover para a pasta de destino")
			return
		}

		// Evitar mover uma pasta para dentro de si mesma
		if isFolder && itemID == targetFolderID.String() {
			RespondWithError(w, http.StatusBadRequest, "Não é possível mover uma pasta para dentro de si mesma")
			return
		}
	}

	// 4. Executar a movimentação
	var query string
	if isFolder {
		query = "UPDATE folders SET parent_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3"
	} else {
		query = "UPDATE documents SET folder_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3"
	}

	_, err = h.db.Conn.Exec(query, targetFolderID, itemID, tenantID)
	if err != nil {
		log.Printf("Erro ao mover item: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao mover item")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Item movido com sucesso"})
}

func (h *DocumentHandler) PermanentDelete(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	id := chi.URLParam(r, "id")
	isFolder := r.URL.Query().Get("is_folder") == "true"

	if isFolder {
		// 1. Verificar se a pasta existe e permissão de escrita
		var folderSectorID *uuid.UUID
		err := h.db.Conn.QueryRow("SELECT sector_id FROM folders WHERE id = $1 AND tenant_id = $2", id, tenantID).Scan(&folderSectorID)
		if err != nil {
			RespondWithError(w, http.StatusNotFound, "Pasta não encontrada")
			return
		}
		if !h.canWrite(r, folderSectorID) {
			RespondWithError(w, http.StatusForbidden, "Sem permissão para excluir esta pasta definitivamente")
			return
		}

		// Excluir subpastas e documentos recursivamente no banco
		// Para simplificar, vamos excluir apenas a pasta e seus documentos diretos primeiro
		// Uma implementação completa precisaria ser recursiva ou usar ON DELETE CASCADE

		// Buscar minio_keys de documentos dentro da pasta para limpar MinIO
		rows, err := h.db.Conn.Query("SELECT minio_key FROM documents WHERE folder_id = $1 AND tenant_id = $2", id, tenantID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var minioKey string
				if e := rows.Scan(&minioKey); e == nil {
					go h.storage.Delete(context.Background(), minioKey)
				}
			}
		}

		_, err = h.db.Conn.Exec("DELETE FROM folders WHERE id = $1 AND tenant_id = $2", id, tenantID)
		if err != nil {
			log.Printf("Erro ao excluir pasta definitivamente: %v", err)
			RespondWithError(w, http.StatusInternalServerError, "Erro ao excluir pasta definitivamente")
			return
		}
	} else {
		// 1. Buscar metadados para excluir do MinIO e validar permissão
		var minioKey string
		var docSectorID *uuid.UUID
		err := h.db.Conn.QueryRow("SELECT minio_key, sector_id FROM documents WHERE id = $1 AND tenant_id = $2", id, tenantID).Scan(&minioKey, &docSectorID)
		if err != nil {
			RespondWithError(w, http.StatusNotFound, "Documento não encontrado")
			return
		}
		if !h.canWrite(r, docSectorID) {
			RespondWithError(w, http.StatusForbidden, "Sem permissão para excluir este documento definitivamente")
			return
		}

		// 2. Excluir do banco
		_, err = h.db.Conn.Exec("DELETE FROM documents WHERE id = $1 AND tenant_id = $2", id, tenantID)
		if err != nil {
			log.Printf("Erro ao excluir do banco: %v", err)
			RespondWithError(w, http.StatusInternalServerError, "Erro ao excluir registro do documento")
			return
		}

		// 3. Excluir do MinIO (Async)
		go func() {
			err := h.storage.Delete(context.Background(), minioKey)
			if err != nil {
				log.Printf("Erro ao excluir do MinIO: %v", err)
			}
		}()
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Item excluído definitivamente"})
}

func (h *DocumentHandler) EmptyTrash(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	userID := claims.UserID

	// Obter os setores do usuário do banco onde ele é GESTOR
	var userGestorSectorIDs []uuid.UUID
	if !claims.IsMaster {
		rowsSectors, err := h.db.Conn.Query("SELECT sector_id FROM user_sectors WHERE user_id = $1 AND permission_type = 'GESTOR'", userID)
		if err == nil {
			defer rowsSectors.Close()
			for rowsSectors.Next() {
				var sid uuid.UUID
				if e := rowsSectors.Scan(&sid); e == nil {
					userGestorSectorIDs = append(userGestorSectorIDs, sid)
				}
			}
		}
	}

	// 1. Limpar documentos da lixeira
	queryDocs := "SELECT id, minio_key FROM documents WHERE tenant_id = $1 AND deleted_at IS NOT NULL"
	argsDocs := []any{tenantID}

	if !claims.IsMaster {
		if len(userGestorSectorIDs) > 0 {
			queryDocs += " AND (sector_id IS NULL"
			for _, sid := range userGestorSectorIDs {
				queryDocs += fmt.Sprintf(" OR sector_id = $%d", len(argsDocs)+1)
				argsDocs = append(argsDocs, sid)
			}
			queryDocs += ")"
		} else {
			queryDocs += " AND sector_id IS NULL"
		}
	}

	rowsDocs, err := h.db.Conn.Query(queryDocs, argsDocs...)
	if err == nil {
		defer rowsDocs.Close()
		for rowsDocs.Next() {
			var id uuid.UUID
			var minioKey string
			if e := rowsDocs.Scan(&id, &minioKey); e == nil {
				// Excluir do banco
				_, _ = h.db.Conn.Exec("DELETE FROM documents WHERE id = $1", id)
				// Excluir do MinIO (Async)
				go h.storage.Delete(context.Background(), minioKey)
			}
		}
	}

	// 2. Limpar pastas da lixeira
	queryFolders := "SELECT id FROM folders WHERE tenant_id = $1 AND deleted_at IS NOT NULL"
	argsFolders := []any{tenantID}

	if !claims.IsMaster {
		if len(userGestorSectorIDs) > 0 {
			queryFolders += " AND (sector_id IS NULL"
			for _, sid := range userGestorSectorIDs {
				queryFolders += fmt.Sprintf(" OR sector_id = $%d", len(argsFolders)+1)
				argsFolders = append(argsFolders, sid)
			}
			queryFolders += ")"
		} else {
			queryFolders += " AND sector_id IS NULL"
		}
	}

	rowsFolders, err := h.db.Conn.Query(queryFolders, argsFolders...)
	if err == nil {
		defer rowsFolders.Close()
		for rowsFolders.Next() {
			var id uuid.UUID
			if e := rowsFolders.Scan(&id); e == nil {
				// Excluir do banco (recursivo ou ON DELETE CASCADE seria melhor, mas aqui simplificamos)
				_, _ = h.db.Conn.Exec("DELETE FROM folders WHERE id = $1", id)
			}
		}
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Lixeira esvaziada com sucesso"})
}

func (h *DocumentHandler) Restore(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	id := chi.URLParam(r, "id")
	isFolder := r.URL.Query().Get("is_folder") == "true"

	var query string
	var itemSectorID *uuid.UUID
	if isFolder {
		err := h.db.Conn.QueryRow("SELECT sector_id FROM folders WHERE id = $1 AND tenant_id = $2", id, tenantID).Scan(&itemSectorID)
		if err != nil {
			RespondWithError(w, http.StatusNotFound, "Pasta não encontrada")
			return
		}
		query = "UPDATE folders SET deleted_at = NULL WHERE id = $1 AND tenant_id = $2"
	} else {
		err := h.db.Conn.QueryRow("SELECT sector_id FROM documents WHERE id = $1 AND tenant_id = $2", id, tenantID).Scan(&itemSectorID)
		if err != nil {
			RespondWithError(w, http.StatusNotFound, "Documento não encontrado")
			return
		}
		query = "UPDATE documents SET deleted_at = NULL WHERE id = $1 AND tenant_id = $2"
	}

	if !h.canWrite(r, itemSectorID) {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para restaurar este item")
		return
	}

	result, err := h.db.Conn.Exec(query, id, tenantID)
	if err != nil {
		log.Printf("Erro ao restaurar item: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao restaurar item")
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		RespondWithError(w, http.StatusNotFound, "Item não encontrado ou já restaurado")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Item restaurado com sucesso"})
}

func (h *DocumentHandler) ListTrash(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	userID := claims.UserID

	// Obter os setores do usuário do banco com seus tipos de permissão
	userPermissions := make(map[uuid.UUID]string)
	var userSectorIDs []uuid.UUID
	rowsSectors, err := h.db.Conn.Query("SELECT sector_id, permission_type FROM user_sectors WHERE user_id = $1", userID)
	if err == nil {
		defer rowsSectors.Close()
		for rowsSectors.Next() {
			var sid uuid.UUID
			var pt string
			if e := rowsSectors.Scan(&sid, &pt); e == nil {
				userPermissions[sid] = pt
				userSectorIDs = append(userSectorIDs, sid)
			}
		}
	}

	// Listar pastas deletadas
	queryFolders := `
		SELECT f.id, f.name, f.created_at, f.deleted_at, f.color, s.name as sector_name, f.sector_id, f.owner_id
		FROM folders f
		LEFT JOIN sectors s ON f.sector_id = s.id
		WHERE f.tenant_id = $1 AND f.deleted_at IS NOT NULL`

	argsFolders := []any{tenantID}
	if !claims.IsMaster {
		if len(userSectorIDs) > 0 {
			queryFolders += " AND (f.sector_id IS NULL"
			for _, sid := range userSectorIDs {
				queryFolders += fmt.Sprintf(" OR f.sector_id = $%d", len(argsFolders)+1)
				argsFolders = append(argsFolders, sid)
			}
			queryFolders += ")"
		} else {
			queryFolders += " AND f.sector_id IS NULL"
		}
	}

	rowsFolders, err := h.db.Conn.Query(queryFolders, argsFolders...)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao buscar pastas da lixeira")
		return
	}
	defer rowsFolders.Close()

	var trashItems []map[string]any
	for rowsFolders.Next() {
		var id, name, color string
		var sectorName *string
		var sectorID *uuid.UUID
		var ownerID *int
		var createdAt, deletedAt time.Time
		if e := rowsFolders.Scan(&id, &name, &createdAt, &deletedAt, &color, &sectorName, &sectorID, &ownerID); e != nil {
			log.Printf("ListTrash: Erro ao scanear pasta: %v", e)
			continue
		}

		canEdit := claims.IsMaster || (ownerID != nil && *ownerID == claims.UserID)
		if !canEdit && sectorID != nil {
			if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
				canEdit = true
			}
		}

		trashItems = append(trashItems, map[string]any{
			"id":          id,
			"name":        name,
			"type":        "folder",
			"color":       color,
			"sector_name": sectorName,
			"sector_id":   sectorID,
			"can_edit":    canEdit,
			"created_at":  createdAt,
			"deleted_at":  deletedAt,
		})
	}

	// Listar documentos deletados
	queryDocs := `
		SELECT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.deleted_at, s.name as sector_name, d.sector_id, d.owner_id, dtp.name as document_type_name
		FROM documents d
		LEFT JOIN sectors s ON d.sector_id = s.id
		LEFT JOIN document_types dtp ON d.document_type_id = dtp.id
		WHERE d.tenant_id = $1 AND d.deleted_at IS NOT NULL`

	argsDocs := []any{tenantID}
	if !claims.IsMaster {
		if len(userSectorIDs) > 0 {
			queryDocs += " AND (d.sector_id IS NULL"
			for _, sid := range userSectorIDs {
				queryDocs += fmt.Sprintf(" OR d.sector_id = $%d", len(argsDocs)+1)
				argsDocs = append(argsDocs, sid)
			}
			queryDocs += ")"
		} else {
			queryDocs += " AND d.sector_id IS NULL"
		}
	}

	rowsDocs, err := h.db.Conn.Query(queryDocs, argsDocs...)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao buscar documentos da lixeira")
		return
	}
	defer rowsDocs.Close()

	for rowsDocs.Next() {
		var id, name, ext, contentType string
		var sectorName *string
		var sectorID *uuid.UUID
		var ownerID *int
		var documentTypeName *string
		var size int64
		var createdAt, deletedAt time.Time
		if e := rowsDocs.Scan(&id, &name, &ext, &size, &contentType, &createdAt, &deletedAt, &sectorName, &sectorID, &ownerID, &documentTypeName); e != nil {
			log.Printf("ListTrash: Erro ao scanear documento: %v", e)
			continue
		}

		canEdit := claims.IsMaster || (ownerID != nil && *ownerID == claims.UserID)
		if !canEdit && sectorID != nil {
			if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
				canEdit = true
			}
		}

		trashItems = append(trashItems, map[string]any{
			"id":            id,
			"name":          name,
			"extension":     ext,
			"size":          size,
			"content_type":  contentType,
			"type":          "file",
			"sector_name":   sectorName,
			"sector_id":     sectorID,
			"can_edit":      canEdit,
			"created_at":    createdAt,
			"deleted_at":    deletedAt,
			"document_type": documentTypeName,
		})
	}

	RespondWithJSON(w, http.StatusOK, trashItems)
}

func (h *DocumentHandler) ListSharedWithMe(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	userID := claims.UserID

	// 1. Buscar setores do usuário para compartilhamentos por setor
	var sectorIDs []uuid.UUID
	rowsSectors, err := h.db.Conn.Query("SELECT sector_id FROM user_sectors WHERE user_id = $1", userID)
	if err == nil {
		defer rowsSectors.Close()
		for rowsSectors.Next() {
			var sid uuid.UUID
			if e := rowsSectors.Scan(&sid); e == nil {
				sectorIDs = append(sectorIDs, sid)
			}
		}
	}

	// 2. Query para documentos compartilhados diretamente ou via setor
	query := `
		SELECT DISTINCT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, 
		       u.full_name as shared_by, COALESCE(ds.permission_type, dss.permission_type) as permission,
			   dtp.name as document_type_name
		FROM documents d
		LEFT JOIN document_shares ds ON d.id = ds.document_id AND ds.user_id = $1
		LEFT JOIN document_sector_shares dss ON d.id = dss.document_id
		LEFT JOIN users u ON u.id = (SELECT user_id FROM audit_logs WHERE action = 'SHARE' AND entity_id = d.id::text ORDER BY created_at DESC LIMIT 1)
		LEFT JOIN document_types dtp ON d.document_type_id = dtp.id
		WHERE d.tenant_id = $2 AND d.deleted_at IS NULL 
		AND (ds.user_id = $1`

	args := []any{userID, tenantID}
	if len(sectorIDs) > 0 {
		query += " OR dss.sector_id IN ("
		for i, sid := range sectorIDs {
			if i > 0 {
				query += ", "
			}
			query += fmt.Sprintf("$%d", len(args)+1)
			args = append(args, sid)
		}
		query += ")"
	}
	query += ")"

	rows, err := h.db.Conn.Query(query, args...)
	if err != nil {
		log.Printf("Erro ao buscar compartilhados: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao buscar documentos")
		return
	}
	defer rows.Close()

	var docs []map[string]any
	for rows.Next() {
		var id, name, ext, contentType, permission string
		var sharedBy, documentTypeName *string
		var size int64
		var createdAt time.Time
		if e := rows.Scan(&id, &name, &ext, &size, &contentType, &createdAt, &sharedBy, &permission, &documentTypeName); e != nil {
			log.Printf("ListSharedWithMe: Erro ao scanear documento: %v", e)
			continue
		}

		docs = append(docs, map[string]any{
			"id":            id,
			"name":          name,
			"extension":     ext,
			"size":          size,
			"content_type":  contentType,
			"created_at":    createdAt,
			"shared_by":     sharedBy,
			"permission":    "READ",
			"can_edit":      permission == "WRITE",
			"type":          "document",
			"document_type": documentTypeName,
		})
	}

	// 3. Adicionar pastas compartilhadas
	queryFolders := `
		SELECT DISTINCT f.id, f.name, f.created_at, u.full_name as shared_by, 
		       COALESCE(ds.permission_type, dss.permission_type) as permission
		FROM folders f
		LEFT JOIN document_shares ds ON f.id = ds.folder_id AND ds.user_id = $1
		LEFT JOIN document_sector_shares dss ON f.id = dss.folder_id
		LEFT JOIN users u ON u.id = (SELECT user_id FROM audit_logs WHERE action = 'SHARE' AND entity_id = f.id::text ORDER BY created_at DESC LIMIT 1)
		WHERE f.tenant_id = $2 AND f.deleted_at IS NULL 
		AND (ds.user_id = $1`

	argsFolders := []any{userID, tenantID}
	if len(sectorIDs) > 0 {
		queryFolders += " OR dss.sector_id IN ("
		for i, sid := range sectorIDs {
			if i > 0 {
				queryFolders += ", "
			}
			queryFolders += fmt.Sprintf("$%d", len(argsFolders)+1)
			argsFolders = append(argsFolders, sid)
		}
		queryFolders += ")"
	}
	queryFolders += ")"

	rowsF, err := h.db.Conn.Query(queryFolders, argsFolders...)
	if err == nil {
		defer rowsF.Close()
		for rowsF.Next() {
			var id, name, permission string
			var sharedBy *string
			var createdAt time.Time
			if e := rowsF.Scan(&id, &name, &createdAt, &sharedBy, &permission); e != nil {
				log.Printf("ListSharedWithMe: Erro ao scanear pasta: %v", e)
				continue
			}

			docs = append(docs, map[string]any{
				"id":         id,
				"name":       name,
				"type":       "folder",
				"created_at": createdAt,
				"shared_by":  sharedBy,
				"permission": permission,
				"can_edit":   permission == "WRITE",
			})
		}
	}

	RespondWithJSON(w, http.StatusOK, docs)
}

func (h *DocumentHandler) ListSharedByMe(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	userID := claims.UserID

	// Documentos que eu compartilhei (via audit_logs de SHARE)
	query := `
		SELECT DISTINCT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, 'Eu' as shared_by, dtp.name as document_type_name
		FROM documents d
		LEFT JOIN document_types dtp ON d.document_type_id = dtp.id
		INNER JOIN audit_logs al ON al.entity_id = d.id::text AND al.action = 'SHARE' AND al.user_id = $1
		WHERE d.tenant_id = $2 AND d.deleted_at IS NULL`

	rows, err := h.db.Conn.Query(query, userID, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao buscar documentos")
		return
	}
	defer rows.Close()

	var docs []map[string]any
	for rows.Next() {
		var id, name, ext, contentType, sharedBy string
		var documentTypeName *string
		var size int64
		var createdAt time.Time
		if e := rows.Scan(&id, &name, &ext, &size, &contentType, &createdAt, &sharedBy, &documentTypeName); e != nil {
			log.Printf("ListSharedByMe: Erro ao scanear documento: %v", e)
			continue
		}

		docs = append(docs, map[string]any{
			"id":            id,
			"name":          name,
			"extension":     ext,
			"size":          size,
			"content_type":  contentType,
			"created_at":    createdAt,
			"shared_by":     sharedBy,
			"permission":    "OWNER",
			"can_edit":      true,
			"type":          "document",
			"document_type": documentTypeName,
		})
	}

	// Adicionar pastas compartilhadas por mim
	queryFolders := `
		SELECT DISTINCT f.id, f.name, f.created_at, 'Eu' as shared_by
		FROM folders f
		INNER JOIN audit_logs al ON al.entity_id = f.id::text AND al.action = 'SHARE' AND al.user_id = $1
		WHERE f.tenant_id = $2 AND f.deleted_at IS NULL`

	rowsF, err := h.db.Conn.Query(queryFolders, userID, tenantID)
	if err == nil {
		defer rowsF.Close()
		for rowsF.Next() {
			var id, name, sharedBy string
			var createdAt time.Time
			if e := rowsF.Scan(&id, &name, &createdAt, &sharedBy); e != nil {
				log.Printf("ListSharedByMe: Erro ao scanear pasta: %v", e)
				continue
			}

			docs = append(docs, map[string]any{
				"id":         id,
				"name":       name,
				"type":       "folder",
				"created_at": createdAt,
				"shared_by":  sharedBy,
				"permission": "OWNER",
				"can_edit":   true,
			})
		}
	}

	// Adicionar links públicos ativos criados por mim
	queryLinks := `
		SELECT dl.id, dl.document_id, dl.folder_id, COALESCE(d.name, f.name) as name, dl.created_at,
		       COALESCE(d.extension, '') as extension, COALESCE(d.size_bytes, 0) as size,
		       COALESCE(d.content_type, 'folder') as content_type,
		       dtp.name as document_type_name
		FROM document_links dl
		LEFT JOIN documents d ON dl.document_id = d.id
		LEFT JOIN folders f ON dl.folder_id = f.id
		LEFT JOIN document_types dtp ON d.document_type_id = dtp.id
		WHERE dl.tenant_id = $1 AND dl.active = TRUE AND (
			EXISTS (SELECT 1 FROM audit_logs WHERE action = 'CREATE_SHARE_LINK' AND entity_id = COALESCE(d.id::text, f.id::text) AND user_id = $2)
		)`

	rowsL, err := h.db.Conn.Query(queryLinks, tenantID, userID)
	if err == nil {
		defer rowsL.Close()
		for rowsL.Next() {
			var linkID uuid.UUID
			var docID, folderID *uuid.UUID
			var name, extension, contentType string
			var documentTypeName *string
			var size int64
			var createdAt time.Time
			if e := rowsL.Scan(&linkID, &docID, &folderID, &name, &createdAt, &extension, &size, &contentType, &documentTypeName); e != nil {
				log.Printf("ListSharedByMe: Erro ao scanear link: %v", e)
				continue
			}

			actualID := ""
			isFolder := false
			if docID != nil {
				actualID = docID.String()
			} else if folderID != nil {
				actualID = folderID.String()
				isFolder = true
			}

			itemType := "document"
			if isFolder {
				itemType = "folder"
			}

			docs = append(docs, map[string]any{
				"id":            actualID, // ID do documento/pasta para o ShareModal funcionar
				"link_id":       linkID,
				"name":          name,
				"extension":     extension,
				"size":          size,
				"content_type":  contentType,
				"created_at":    createdAt,
				"shared_by":     "Link Público",
				"permission":    "READ",
				"can_edit":      true, // Dono pode gerenciar o link
				"is_public":     true,
				"type":          itemType,
				"document_type": documentTypeName,
			})
		}
	}

	RespondWithJSON(w, http.StatusOK, docs)
}
