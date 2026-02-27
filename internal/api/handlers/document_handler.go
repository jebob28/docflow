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
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gestao_documentos/internal/api/middleware"
	"gestao_documentos/internal/database"
	"gestao_documentos/internal/service"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type DocumentHandler struct {
	db       *database.DB
	storage  *service.StorageService
	vault    *service.VaultService
	redis    *service.RedisService
	security *service.SecurityService
}

func NewDocumentHandler(db *database.DB, storage *service.StorageService, vault *service.VaultService, redis *service.RedisService, security *service.SecurityService) *DocumentHandler {
	return &DocumentHandler{
		db:       db,
		storage:  storage,
		vault:    vault,
		redis:    redis,
		security: security,
	}
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

	// Verificar se o usuário tem permissão de 'GESTOR' no setor
	var hasGestorPerm bool
	err := h.db.Conn.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM user_sectors 
			WHERE user_id = $1 AND sector_id = $2 AND permission_type = 'GESTOR'
		)`, claims.UserID, sectorID).Scan(&hasGestorPerm)

	if err != nil {
		log.Printf("Erro ao verificar permissão de setor: %v", err)
		return false
	}

	return hasGestorPerm
}

func (h *DocumentHandler) decryptDocument(ctx context.Context, tenantID uuid.UUID, encryptedData io.Reader) ([]byte, error) {
	fullCiphertext, err := io.ReadAll(encryptedData)
	if err != nil {
		return nil, fmt.Errorf("erro ao ler dados criptografados: %v", err)
	}

	// Suporte a legado: Se começar com "vault:v1:", foi criptografado diretamente no Vault (método antigo)
	if bytes.HasPrefix(fullCiphertext, []byte("vault:v1:")) {
		plaintext, err := h.vault.DecryptData(ctx, tenantID.String(), string(fullCiphertext))
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
	dek, err := h.vault.DecryptData(ctx, tenantID.String(), encryptedDEK)
	if err != nil {
		return nil, fmt.Errorf("erro na descriptografia Vault (DEK): %v", err)
	}

	// 3. Descriptografar o arquivo localmente com a DEK
	plaintext, err := h.security.DecryptAES(encryptedFileData, dek)
	if err != nil {
		return nil, fmt.Errorf("erro na descriptografia AES: %v", err)
	}

	return plaintext, nil
}

func (h *DocumentHandler) Upload(w http.ResponseWriter, r *http.Request) {
	// 1. Obter Tenant ID e User ID do contexto
	tenantID, ok := middleware.GetTenantID(r.Context())
	if !ok {
		http.Error(w, "Tenant não identificado", http.StatusUnauthorized)
		return
	}

	claims, _ := middleware.GetClaims(r.Context())
	userID := claims.UserID

	// 2. Parse do multipart form (Limite de 10MB por enquanto)
	err := r.ParseMultipartForm(10 << 20)
	if err != nil {
		http.Error(w, "Arquivo muito grande ou formato inválido", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Arquivo não enviado (campo 'file')", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Obter sector_id e folder_id se fornecidos
	sectorIDStr := r.FormValue("sector_id")
	folderIDStr := r.FormValue("folder_id")

	var sectorID *uuid.UUID
	var folderID *uuid.UUID

	if folderIDStr != "" {
		if id, err := uuid.Parse(folderIDStr); err == nil {
			folderID = &id
			// Se estiver em uma pasta, herdamos o setor dela se não for fornecido
			if sectorIDStr == "" {
				err := h.db.Conn.QueryRow("SELECT sector_id FROM folders WHERE id = $1 AND tenant_id = $2", folderID, tenantID).Scan(&sectorID)
				if err != nil {
					log.Printf("Erro ao buscar setor da pasta: %v", err)
				}
			}
		}
	}

	if sectorID == nil && sectorIDStr != "" {
		if id, err := uuid.Parse(sectorIDStr); err == nil {
			sectorID = &id
		}
	}

	// 2.5 Validação de permissão de escrita no setor
	if !h.canWrite(r, sectorID) {
		http.Error(w, "Sem permissão de escrita neste setor ou setor não especificado", http.StatusForbidden)
		return
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
		http.Error(w, "Limite de armazenamento atingido para este Tenant", http.StatusForbidden)
		return
	}

	// 4. Ler conteúdo para criptografia
	fileBytes, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Erro ao ler arquivo", http.StatusInternalServerError)
		return
	}

	// 5. Criptografia de Envelope (Vault Transit + AES-GCM local)
	// Para arquivos grandes, não enviamos o arquivo todo para o Vault.
	// 5.1 Gerar uma chave de criptografia de dados (DEK) aleatória
	dek, err := h.security.GenerateRandomKey()
	if err != nil {
		log.Printf("Erro ao gerar chave DEK: %v", err)
		http.Error(w, "Erro interno de segurança", http.StatusInternalServerError)
		return
	}

	// 5.2 Criptografar o arquivo localmente com AES-GCM usando a DEK
	encryptedFile, err := h.security.EncryptAES(fileBytes, dek)
	if err != nil {
		log.Printf("Erro na criptografia AES: %v", err)
		http.Error(w, "Erro ao criptografar arquivo", http.StatusInternalServerError)
		return
	}

	// 5.3 Criptografar a DEK usando o Vault Transit (a DEK é pequena, 32 bytes)
	encryptedDEK, err := h.vault.EncryptData(r.Context(), tenantID.String(), dek)
	if err != nil {
		log.Printf("Erro na criptografia Vault (DEK): %v", err)
		http.Error(w, "Falha na segurança do arquivo", http.StatusInternalServerError)
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

	err = h.storage.UploadEncrypted(r.Context(), objectName, reader, int64(len(finalPayload)), header.Header.Get("Content-Type"))
	if err != nil {
		log.Printf("Erro no upload MinIO: %v", err)
		http.Error(w, "Falha ao salvar arquivo no storage", http.StatusInternalServerError)
		return
	}

	// 7. Salvar Metadados no Banco de Dados
	query := `
		INSERT INTO documents (tenant_id, owner_id, sector_id, folder_id, name, extension, size_bytes, minio_key, content_type, is_encrypted)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id`

	var docID uuid.UUID
	err = h.db.Conn.QueryRow(query,
		tenantID, userID, sectorID, folderID, header.Filename, filepath.Ext(header.Filename), header.Size, objectName, header.Header.Get("Content-Type"), true,
	).Scan(&docID)

	if err != nil {
		log.Printf("Erro ao salvar no banco: %v", err)
		http.Error(w, "Erro ao registrar documento", http.StatusInternalServerError)
		return
	}

	// 8. Atualizar Cache de Quota no Redis
	_ = h.redis.UpdateQuotaCache(r.Context(), tenantID.String(), header.Size)

	// Resposta de sucesso
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	fmt.Fprintf(w, `{"message": "Documento enviado com sucesso!", "document_id": "%s"}`, docID.String())
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
			if err := rowsSectors.Scan(&sid, &pt); err == nil {
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
			SELECT ft.root_folder_id, SUM(d.size_bytes) as total_size
			FROM folder_tree ft
			JOIN documents d ON ft.id = d.folder_id
			WHERE d.deleted_at IS NULL
			GROUP BY ft.root_folder_id
		)
		SELECT f.id, f.name, f.parent_id, f.created_at, f.color, f.owner_id, s.name as sector_name, f.sector_id,
			   COALESCE(json_agg(json_build_object('id', dt.id, 'name', dt.name, 'color', dt.color)) FILTER (WHERE dt.id IS NOT NULL), '[]') as tags,
			   COALESCE(fs.total_size, 0) as total_size
		FROM folders f
		LEFT JOIN sectors s ON f.sector_id = s.id
		LEFT JOIN folder_tag_assignments fta ON f.id = fta.folder_id
		LEFT JOIN document_tags dt ON fta.tag_id = dt.id
		LEFT JOIN folder_sizes fs ON f.id = fs.root_folder_id
		WHERE f.tenant_id = $1 AND f.deleted_at IS NULL`

	argsFolders := []interface{}{tenantID}

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
	}
	sectorID := r.URL.Query().Get("sector_id")
	folderID := r.URL.Query().Get("folder_id")
	tagID := r.URL.Query().Get("tag_id")

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
	queryFolders += " GROUP BY f.id, f.name, f.parent_id, f.created_at, f.color, f.owner_id, s.name, fs.total_size ORDER BY f.name ASC"

	rows, err := h.db.Conn.Query(queryFolders, argsFolders...)
	if err != nil {
		log.Printf("Erro ao buscar pastas: %v", err)
		http.Error(w, "Erro ao buscar pastas", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var folders []map[string]interface{}
	for rows.Next() {
		var id, name string
		var parentID, color *string
		var ownerID *int
		var sectorName *string
		var sectorID *uuid.UUID
		var createdAt interface{}
		var tagsJSON []byte
		var totalSize int64
		if err := rows.Scan(&id, &name, &parentID, &createdAt, &color, &ownerID, &sectorName, &sectorID, &tagsJSON, &totalSize); err != nil {
			log.Printf("Erro ao scanear pasta: %v", err)
			continue
		}

		var tags []interface{}
		json.Unmarshal(tagsJSON, &tags)

		canEdit := claims.IsMaster || (ownerID != nil && *ownerID == claims.UserID)
		if !canEdit && sectorID != nil {
			if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
				canEdit = true
			}
		}

		folders = append(folders, map[string]interface{}{
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
			"can_edit":    canEdit,
		})
	}
	if err := rows.Err(); err != nil {
		log.Printf("Erro após iterar pastas: %v", err)
	}

	// Listar Documentos
	queryDocs := `
		SELECT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.owner_id, u.full_name as owner_name, s.name as sector_name, d.sector_id,
			   COALESCE(json_agg(json_build_object('id', dt.id, 'name', dt.name, 'color', dt.color)) FILTER (WHERE dt.id IS NOT NULL), '[]') as tags
		FROM documents d
		LEFT JOIN users u ON d.owner_id = u.id
		LEFT JOIN sectors s ON d.sector_id = s.id
		LEFT JOIN document_tag_assignments dta ON d.id = dta.document_id
		LEFT JOIN document_tags dt ON dta.tag_id = dt.id
		WHERE d.tenant_id = $1 AND d.deleted_at IS NULL`

	argsDocs := []interface{}{tenantID}

	// Filtro de visibilidade por setor para documentos (se não for MASTER)
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
	if sectorID != "" {
		queryDocs += " AND d.sector_id = $" + fmt.Sprint(len(argsDocs)+1)
		argsDocs = append(argsDocs, sectorID)
	}

	if tagID != "" {
		queryDocs += " AND EXISTS (SELECT 1 FROM document_tag_assignments dta2 WHERE dta2.document_id = d.id AND dta2.tag_id = $" + fmt.Sprint(len(argsDocs)+1) + ")"
		argsDocs = append(argsDocs, tagID)
	}

	if folderID != "" {
		queryDocs += " AND d.folder_id = $" + fmt.Sprint(len(argsDocs)+1)
		argsDocs = append(argsDocs, folderID)
	} else if tagID == "" {
		queryDocs += " AND d.folder_id IS NULL"
	}
	queryDocs += " GROUP BY d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.owner_id, u.full_name, s.name ORDER BY d.created_at DESC"

	rowsDocs, err := h.db.Conn.Query(queryDocs, argsDocs...)
	if err != nil {
		log.Printf("Erro ao buscar documentos: %v", err)
		http.Error(w, "Erro ao buscar documentos", http.StatusInternalServerError)
		return
	}
	defer rowsDocs.Close()

	var docs []map[string]interface{}
	for rowsDocs.Next() {
		var id, name, ext, contentType string
		var ownerID *int
		var ownerName, sectorName *string
		var sectorID *uuid.UUID
		var size int64
		var createdAt interface{}
		var tagsJSON []byte
		if err := rowsDocs.Scan(&id, &name, &ext, &size, &contentType, &createdAt, &ownerID, &ownerName, &sectorName, &sectorID, &tagsJSON); err != nil {
			log.Printf("Erro ao scanear documento: %v", err)
			continue
		}

		var tags []interface{}
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

		docs = append(docs, map[string]interface{}{
			"id":           id,
			"name":         name,
			"extension":    ext,
			"size":         size,
			"content_type": contentType,
			"type":         "file",
			"created_at":   createdAt,
			"owner":        owner,
			"sector_name":  sectorName,
			"sector_id":    sectorID,
			"tags":         tags,
			"can_edit":     canEdit,
		})
	}
	if err := rowsDocs.Err(); err != nil {
		log.Printf("Erro após iterar documentos: %v", err)
	}

	// Buscar estatísticas básicas
	var totalFiles int
	var sharedCount int
	var totalViews int
	var maxStorage, usedStorage int64

	h.db.Conn.QueryRow("SELECT COUNT(*) FROM documents WHERE tenant_id = $1", tenantID).Scan(&totalFiles)
	h.db.Conn.QueryRow("SELECT COUNT(DISTINCT document_id) FROM document_links WHERE tenant_id = $1 AND active = TRUE", tenantID).Scan(&sharedCount)
	h.db.Conn.QueryRow("SELECT COALESCE(SUM(view_count), 0) FROM document_links WHERE tenant_id = $1", tenantID).Scan(&totalViews)

	// Buscar quota e uso real (calculando na hora para garantir precisão se o cache falhar)
	h.db.Conn.QueryRow("SELECT COALESCE(SUM(size_bytes), 0) FROM documents WHERE tenant_id = $1", tenantID).Scan(&usedStorage)
	err = h.db.Conn.QueryRow("SELECT max_storage_bytes FROM tenant_quotas WHERE tenant_id = $1", tenantID).Scan(&maxStorage)
	if err != nil {
		// Se não tiver quota definida, assume 10GB padrão
		maxStorage = 10 * 1024 * 1024 * 1024
	}

	response := map[string]interface{}{
		"folders":   folders,
		"documents": docs,
		"stats": map[string]interface{}{
			"total_files":   totalFiles,
			"pending":       0,
			"shared":        sharedCount,
			"views":         totalViews,
			"used_storage":  usedStorage,
			"max_storage":   maxStorage,
			"storage_usage": float64(usedStorage) / float64(maxStorage) * 100,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
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
			if err := rowsSectors.Scan(&sid, &pt); err == nil {
				userPermissions[sid] = pt
				userSectorIDs = append(userSectorIDs, sid)
			}
		}
	} else {
		log.Printf("Erro ao buscar setores do usuário: %v", err)
	}

	// Helper para adicionar filtro de setor
	addSectorFilter := func(query string, args []interface{}) (string, []interface{}) {
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
	var maxStorage, usedStorage int64

	queryTotalFiles := "SELECT COUNT(*) FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL"
	argsTotalFiles := []interface{}{tenantID}
	queryTotalFiles, argsTotalFiles = addSectorFilter(queryTotalFiles, argsTotalFiles)
	h.db.Conn.QueryRow(queryTotalFiles, argsTotalFiles...).Scan(&totalFiles)

	h.db.Conn.QueryRow("SELECT COUNT(DISTINCT document_id) FROM document_links WHERE tenant_id = $1 AND active = TRUE", tenantID).Scan(&sharedCount)
	h.db.Conn.QueryRow("SELECT COALESCE(SUM(view_count), 0) FROM document_links WHERE tenant_id = $1", tenantID).Scan(&totalViews)

	queryUsedStorage := "SELECT COALESCE(SUM(size_bytes), 0) FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL"
	argsUsedStorage := []interface{}{tenantID}
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

	argsMonthly := []interface{}{tenantID}
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

	argsTypes := []interface{}{tenantID}
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
		argsTags := []interface{}{tenantID}
		if len(userSectorIDs) > 0 {
			for _, sid := range userSectorIDs {
				sectorFilter += fmt.Sprintf(" OR d.sector_id = $%d", len(argsTags)+1)
				argsTags = append(argsTags, sid)
			}
		}
		sectorFilter += ")"
		queryTags = strings.Replace(queryTags, "GROUP BY", sectorFilter+" GROUP BY", 1)

		rowsTags, err := h.db.Conn.Query(queryTags, argsTags...)
		if err == nil {
			defer rowsTags.Close()
			for rowsTags.Next() {
				var t TagStat
				rowsTags.Scan(&t.Name, &t.Color, &t.Count)
				topTags = append(topTags, t)
			}
		}
	} else {
		rowsTags, err := h.db.Conn.Query(queryTags, tenantID)
		if err == nil {
			defer rowsTags.Close()
			for rowsTags.Next() {
				var t TagStat
				rowsTags.Scan(&t.Name, &t.Color, &t.Count)
				topTags = append(topTags, t)
			}
		}
	}

	// 5. Documentos Recentes
	queryRecent := `
		SELECT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.owner_id, u.full_name as owner_name, d.sector_id,
			   COALESCE(json_agg(json_build_object('id', dt.id, 'name', dt.name, 'color', dt.color)) FILTER (WHERE dt.id IS NOT NULL), '[]') as tags
		FROM documents d
		LEFT JOIN users u ON d.owner_id = u.id
		LEFT JOIN document_tag_assignments dta ON d.id = dta.document_id
		LEFT JOIN document_tags dt ON dta.tag_id = dt.id
		WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
		GROUP BY d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.owner_id, u.full_name
		ORDER BY d.created_at DESC
		LIMIT 10`

	argsRecent := []interface{}{tenantID}
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

	rowsRecent, err := h.db.Conn.Query(queryRecent, argsRecent...)
	var recentDocs []map[string]interface{}
	if err == nil {
		defer rowsRecent.Close()
		for rowsRecent.Next() {
			var id, name, ext, contentType string
			var ownerID *int
			var ownerName *string
			var size int64
			var createdAt time.Time
			var tagsJSON []byte
			var sectorID *uuid.UUID
			rowsRecent.Scan(&id, &name, &ext, &size, &contentType, &createdAt, &ownerID, &ownerName, &tagsJSON, &sectorID)

			var tags []interface{}
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

			recentDocs = append(recentDocs, map[string]interface{}{
				"id":           id,
				"name":         name,
				"extension":    ext,
				"size":         size,
				"content_type": contentType,
				"created_at":   createdAt,
				"owner":        owner,
				"tags":         tags,
				"type":         "file",
				"sector_id":    sectorID,
				"can_edit":     canEdit,
			})
		}
	}

	// 6. Pastas Recentes
	var recentFolders []map[string]interface{}
	queryRecentFolders := `SELECT id, name, color, created_at, owner_id, sector_id FROM folders WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5`
	argsRecentFolders := []interface{}{tenantID}
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

			recentFolders = append(recentFolders, map[string]interface{}{
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

	response := map[string]interface{}{
		"stats": map[string]interface{}{
			"total_files":   totalFiles,
			"pending":       0,
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *DocumentHandler) Download(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	docID := chi.URLParam(r, "id")

	// 1. Buscar metadados do documento e setor
	var minioKey, contentType, name string
	var isEncrypted bool
	var size int64
	var docSectorID *uuid.UUID
	err := h.db.Conn.QueryRow(`
		SELECT minio_key, content_type, name, is_encrypted, size_bytes, sector_id
		FROM documents 
		WHERE id = $1 AND tenant_id = $2`, docID, tenantID).Scan(&minioKey, &contentType, &name, &isEncrypted, &size, &docSectorID)

	if err != nil {
		http.Error(w, "Documento não encontrado", http.StatusNotFound)
		return
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
				http.Error(w, "Sem acesso a este documento", http.StatusForbidden)
				return
			}
		}
	}

	var confidentialRequired bool
	var confidentialHash string
	var hasConfidentialTag bool
	err = h.db.Conn.QueryRow(`
		SELECT COALESCE(t.confidential_required, false),
		       COALESCE(t.confidential_password_hash, ''),
		       EXISTS (
		         SELECT 1 FROM document_tag_assignments dta
		         JOIN document_tags dt ON dt.id = dta.tag_id
		         WHERE dta.document_id = $1 AND dt.tenant_id = $2 AND LOWER(dt.name) = LOWER('Confidencial')
		       )
		FROM tenants t WHERE t.id = $2`, docID, tenantID).Scan(&confidentialRequired, &confidentialHash, &hasConfidentialTag)
	if err != nil {
		http.Error(w, "Erro ao validar acesso confidencial", http.StatusInternalServerError)
		return
	}
	if confidentialRequired && hasConfidentialTag {
		if confidentialHash == "" {
			http.Error(w, "Senha confidencial não configurada", http.StatusConflict)
			return
		}
		confidentialPassword := r.Header.Get("X-Confidential-Password")
		if confidentialPassword == "" || !h.security.CheckPasswordHash(confidentialPassword, confidentialHash) {
			http.Error(w, "Senha necessária ou incorreta", http.StatusUnauthorized)
			return
		}
	}

	// 2. Baixar do MinIO
	encryptedData, err := h.storage.GetEncrypted(r.Context(), minioKey)
	if err != nil {
		log.Printf("Erro ao baixar do MinIO: %v", err)
		http.Error(w, "Erro ao recuperar arquivo do storage", http.StatusInternalServerError)
		return
	}
	defer encryptedData.Close()

	// 3. Descriptografia em tempo real se necessário
	var finalData []byte
	if isEncrypted {
		plaintext, err := h.decryptDocument(r.Context(), tenantID, encryptedData)
		if err != nil {
			log.Printf("Erro na descriptografia do documento: %v", err)
			http.Error(w, "Falha na segurança ao descriptografar arquivo", http.StatusInternalServerError)
			return
		}
		finalData = plaintext
	} else {
		finalData, _ = io.ReadAll(encryptedData)
	}

	// 4. Enviar arquivo para o navegador
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", name))
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(int64(len(finalData)), 10))
	w.Write(finalData)
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
		http.Error(w, "Requisição inválida", http.StatusBadRequest)
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
		http.Error(w, "Sem permissão de escrita neste setor ou setor não especificado", http.StatusForbidden)
		return
	}

	// Tratar strings vazias como nil para o banco
	var parentID, finalSectorID, color interface{}
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
		http.Error(w, "Erro ao criar pasta", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"message": "Pasta criada", "id": "%s"}`, folderID.String())
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
		http.Error(w, "Documento não encontrado", http.StatusNotFound)
		return
	}

	if !claims.IsMaster && docSectorID != nil {
		// Verificar se o usuário pertence ao setor
		var hasAccess bool
		err = h.db.Conn.QueryRow(`
			SELECT EXISTS(SELECT 1 FROM user_sectors WHERE user_id = $1 AND sector_id = $2)`,
			claims.UserID, docSectorID).Scan(&hasAccess)
		if err != nil || !hasAccess {
			http.Error(w, "Sem acesso a este documento", http.StatusForbidden)
			return
		}
	}

	rows, err := h.db.Conn.Query(`
		SELECT id, page_number, pos_x, pos_y, width, height, content, color, is_private, user_id, font_family, annotation_type
		FROM document_annotations 
		WHERE document_id = $1 AND tenant_id = $2`, docID, tenantID)
	if err != nil {
		http.Error(w, "Erro ao buscar anotações", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var annotations []map[string]interface{}
	for rows.Next() {
		var id, content, color, fontFamily, annotationType string
		var pageNum, userID int
		var x, y, w, h_val float64
		var isPrivate bool
		rows.Scan(&id, &pageNum, &x, &y, &w, &h_val, &content, &color, &isPrivate, &userID, &fontFamily, &annotationType)

		annotations = append(annotations, map[string]interface{}{
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(annotations)
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
			if err := rowsSectors.Scan(&sid, &pt); err == nil {
				userPermissions[sid] = pt
				userSectorIDs = append(userSectorIDs, sid)
			}
		}
	}

	// Parâmetros de busca
	query := r.URL.Query().Get("q")        // Nome do arquivo
	tag := r.URL.Query().Get("tag")        // Tag específica
	metaKey := r.URL.Query().Get("meta_k") // Chave de metadado
	metaVal := r.URL.Query().Get("meta_v") // Valor de metadado
	ocrQuery := r.URL.Query().Get("ocr")   // Texto reconhecido via OCR

	sqlQuery := `
		SELECT DISTINCT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.sector_id
		FROM documents d
		LEFT JOIN document_tag_assignments dta ON d.id = dta.document_id
		LEFT JOIN document_tags dt ON dta.tag_id = dt.id
		LEFT JOIN document_metadata dm ON d.id = dm.document_id
		WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
	`
	args := []interface{}{tenantID}
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
		http.Error(w, "Erro ao realizar busca", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var docs []map[string]interface{}
	for rows.Next() {
		var id, name, ext, contentType string
		var size int64
		var createdAt interface{}
		var sectorID *uuid.UUID
		rows.Scan(&id, &name, &ext, &size, &contentType, &createdAt, &sectorID)

		canEdit := claims.IsMaster
		if !canEdit && sectorID != nil {
			if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
				canEdit = true
			}
		}

		docs = append(docs, map[string]interface{}{
			"id":           id,
			"name":         name,
			"extension":    ext,
			"size":         size,
			"content_type": contentType,
			"created_at":   createdAt,
			"sector_id":    sectorID,
			"can_edit":     canEdit,
			"type":         "file",
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(docs)
}

func (h *DocumentHandler) UpdateOCR(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	docID := chi.URLParam(r, "id")

	var input struct {
		OCRText            *string    `json:"ocr_text"`
		ContractExpiresAt *time.Time `json:"contract_expires_at"`
	}

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "Dados inválidos", http.StatusBadRequest)
		return
	}

	if input.OCRText == nil && input.ContractExpiresAt == nil {
		http.Error(w, "Nenhuma informação de OCR informada", http.StatusBadRequest)
		return
	}

	var sectorID *uuid.UUID
	err := h.db.Conn.QueryRow(`
		SELECT sector_id FROM documents 
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
		docID, tenantID).Scan(&sectorID)
	if err != nil {
		http.Error(w, "Documento não encontrado", http.StatusNotFound)
		return
	}

	if !h.canWrite(r, sectorID) {
		http.Error(w, "Sem permissão para atualizar OCR deste documento", http.StatusForbidden)
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
		http.Error(w, "Erro ao atualizar OCR", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (h *DocumentHandler) ListContractAlerts(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())

	daysParam := r.URL.Query().Get("days")
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
			if err := rowsSectors.Scan(&sid, &pt); err == nil {
				userPermissions[sid] = pt
				userSectorIDs = append(userSectorIDs, sid)
			}
		}
	}

	sqlQuery := `
		SELECT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.contract_expires_at, d.sector_id
		FROM documents d
		WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND d.contract_expires_at IS NOT NULL
		  AND d.contract_expires_at <= $2
	`
	args := []interface{}{tenantID, limitDate}
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

	sqlQuery += " ORDER BY d.contract_expires_at ASC"

	rows, err := h.db.Conn.Query(sqlQuery, args...)
	if err != nil {
		log.Printf("Erro ao buscar alertas de contratos: %v", err)
		http.Error(w, "Erro ao buscar alertas", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var alerts []map[string]interface{}
	for rows.Next() {
		var id, name, ext, contentType string
		var size int64
		var expiresAt time.Time
		var sectorID *uuid.UUID
		rows.Scan(&id, &name, &ext, &size, &contentType, &expiresAt, &sectorID)

		canEdit := claims.IsMaster
		if !canEdit && sectorID != nil {
			if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
				canEdit = true
			}
		}

		alerts = append(alerts, map[string]interface{}{
			"id":                 id,
			"name":               name,
			"extension":          ext,
			"size":               size,
			"content_type":       contentType,
			"contract_expires_at": expiresAt,
			"is_expired":         expiresAt.Before(time.Now()),
			"sector_id":          sectorID,
			"can_edit":           canEdit,
			"type":               "file",
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(alerts)
}

func (h *DocumentHandler) Rename(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	id := chi.URLParam(r, "id")

	var input struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "Dados inválidos", http.StatusBadRequest)
		return
	}

	if input.Name == "" {
		http.Error(w, "O nome não pode ser vazio", http.StatusBadRequest)
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
		http.Error(w, "Documento não encontrado", http.StatusNotFound)
		return
	}

	if !h.canWrite(r, sectorID) {
		http.Error(w, "Sem permissão para renomear este documento", http.StatusForbidden)
		return
	}

	// Atualizar nome
	_, err = h.db.Conn.Exec(`
		UPDATE documents SET name = $1, updated_at = NOW() 
		WHERE id = $2 AND tenant_id = $3`,
		input.Name, id, tenantID)

	if err != nil {
		log.Printf("Erro ao renomear documento: %v", err)
		http.Error(w, "Erro ao renomear documento", http.StatusInternalServerError)
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

	w.WriteHeader(http.StatusOK)
}

func (h *DocumentHandler) RenameFolder(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	id := chi.URLParam(r, "id")

	var input struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "Dados inválidos", http.StatusBadRequest)
		return
	}

	if input.Name == "" {
		http.Error(w, "O nome não pode ser vazio", http.StatusBadRequest)
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
		http.Error(w, "Pasta não encontrada", http.StatusNotFound)
		return
	}

	if !h.canWrite(r, sectorID) {
		http.Error(w, "Sem permissão para renomear esta pasta", http.StatusForbidden)
		return
	}

	// Atualizar nome
	_, err = h.db.Conn.Exec(`
		UPDATE folders SET name = $1, updated_at = NOW() 
		WHERE id = $2 AND tenant_id = $3`,
		input.Name, id, tenantID)

	if err != nil {
		log.Printf("Erro ao renomear pasta: %v", err)
		http.Error(w, "Erro ao renomear pasta", http.StatusInternalServerError)
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

	w.WriteHeader(http.StatusOK)
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
		http.Error(w, "Requisição inválida", http.StatusBadRequest)
		return
	}

	// Validação de permissão de escrita no setor do documento
	var docSectorID *uuid.UUID
	if err := h.db.Conn.QueryRow("SELECT sector_id FROM documents WHERE id = $1 AND tenant_id = $2", docID, tenantID).Scan(&docSectorID); err != nil {
		http.Error(w, "Documento não encontrado", http.StatusNotFound)
		return
	}
	if !h.canWrite(r, docSectorID) {
		http.Error(w, "Sem permissão para criar anotações neste documento", http.StatusForbidden)
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
		http.Error(w, "Erro ao salvar anotação", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	fmt.Fprintf(w, `{"message": "Anotação criada", "id": "%s"}`, annotationID.String())
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
		http.Error(w, "Requisição inválida", http.StatusBadRequest)
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
		http.Error(w, "Anotação não encontrada", http.StatusNotFound)
		return
	}
	if !h.canWrite(r, docSectorID) {
		http.Error(w, "Sem permissão para atualizar anotações neste documento", http.StatusForbidden)
		return
	}

	_, err = h.db.Conn.Exec(`
		UPDATE document_annotations 
		SET content = $1, color = $2, pos_x = $3, pos_y = $4, width = $5, height = $6, font_family = $7, annotation_type = $8, updated_at = CURRENT_TIMESTAMP
		WHERE id = $9 AND tenant_id = $10`,
		req.Content, req.Color, req.PosX, req.PosY, req.Width, req.Height, req.FontFamily, req.AnnotationType, annotationID, tenantID)

	if err != nil {
		log.Printf("Erro ao atualizar anotação: %v", err)
		http.Error(w, "Erro ao atualizar anotação", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
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
		http.Error(w, "Requisição inválida", http.StatusBadRequest)
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
		http.Error(w, "Item não encontrado", http.StatusNotFound)
		return
	}
	if !h.canWrite(r, targetSectorID) {
		http.Error(w, "Sem permissão para compartilhar este item", http.StatusForbidden)
		return
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
		http.Error(w, "Usuário ou Setor deve ser informado", http.StatusBadRequest)
		return
	}

	if err != nil {
		log.Printf("Erro ao compartilhar: %v", err)
		http.Error(w, "Erro ao processar compartilhamento", http.StatusInternalServerError)
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

	w.WriteHeader(http.StatusCreated)
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
		http.Error(w, "Item não encontrado", http.StatusNotFound)
		return
	}

	if !claims.IsMaster && sectorID != nil {
		var hasAccess bool
		err = h.db.Conn.QueryRow(`
			SELECT EXISTS(SELECT 1 FROM user_sectors WHERE user_id = $1 AND sector_id = $2)`,
			claims.UserID, sectorID).Scan(&hasAccess)
		if err != nil || !hasAccess {
			http.Error(w, "Sem acesso a este item", http.StatusForbidden)
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(shares)
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
		http.Error(w, "Compartilhamento não encontrado", http.StatusNotFound)
		return
	}

	// Permite se for MASTER, GESTOR do setor ou OWNER do item
	isOwner := itemOwnerID != nil && *itemOwnerID == claims.UserID
	if !isOwner && !h.canWrite(r, itemSectorID) {
		http.Error(w, "Sem permissão para revogar este compartilhamento", http.StatusForbidden)
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
		http.Error(w, "Erro ao revogar compartilhamento", http.StatusInternalServerError)
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

	w.WriteHeader(http.StatusNoContent)
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
		http.Error(w, "Anotação não encontrada", http.StatusNotFound)
		return
	}
	if !h.canWrite(r, docSectorID) {
		http.Error(w, "Sem permissão para excluir anotações neste documento", http.StatusForbidden)
		return
	}

	_, err = h.db.Conn.Exec(`
		DELETE FROM document_annotations 
		WHERE id = $1 AND tenant_id = $2`, annotationID, tenantID)

	if err != nil {
		http.Error(w, "Erro ao excluir anotação", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
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
		http.Error(w, "Erro ao buscar etiquetas", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var tags []map[string]interface{}
	for rows.Next() {
		var id uuid.UUID
		var name, color string
		if err := rows.Scan(&id, &name, &color); err != nil {
			log.Printf("ListTags: Erro ao scanear tag: %v", err)
			continue
		}
		tags = append(tags, map[string]interface{}{
			"id":    id.String(),
			"name":  name,
			"color": color,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	if tags == nil {
		tags = []map[string]interface{}{}
	}
	json.NewEncoder(w).Encode(tags)
}

func (h *DocumentHandler) CreateTag(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := middleware.GetTenantID(r.Context())
	if !ok {
		log.Printf("CreateTag: Erro ao obter tenantID")
		http.Error(w, "Erro de autenticação", http.StatusUnauthorized)
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
			http.Error(w, "Apenas gestores podem criar etiquetas", http.StatusForbidden)
			return
		}
	}

	var req struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("CreateTag: Erro ao decodificar corpo: %v", err)
		http.Error(w, "Requisição inválida", http.StatusBadRequest)
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
		http.Error(w, fmt.Sprintf("Erro ao criar etiqueta: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("CreateTag: Etiqueta criada/atualizada com sucesso: ID %s", tagID.String())

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
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
		http.Error(w, "Requisição inválida", http.StatusBadRequest)
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
			http.Error(w, "Item não encontrado", http.StatusNotFound)
			return
		}
	}

	// Validação de permissão de escrita
	if !h.canWrite(r, sectorID) {
		http.Error(w, "Sem permissão para gerenciar etiquetas neste item", http.StatusForbidden)
		return
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
		http.Error(w, "Erro ao vincular etiqueta", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
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
			http.Error(w, "Item não encontrado", http.StatusNotFound)
			return
		}
	}

	// Validação de permissão de escrita
	if !h.canWrite(r, sectorID) {
		http.Error(w, "Sem permissão para gerenciar etiquetas neste item", http.StatusForbidden)
		return
	}

	// Tentar remover de ambos (UUIDs são únicos, então não há problema)
	_, err = h.db.Conn.Exec(`
		DELETE FROM document_tag_assignments 
		WHERE document_id = $1 AND tag_id = $2`, targetID, tagID)

	if err != nil {
		http.Error(w, "Erro ao remover etiqueta de documento", http.StatusInternalServerError)
		return
	}

	_, err = h.db.Conn.Exec(`
		DELETE FROM folder_tag_assignments 
		WHERE folder_id = $1 AND tag_id = $2`, targetID, tagID)

	if err != nil {
		http.Error(w, "Erro ao remover etiqueta de pasta", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
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
		http.Error(w, "Requisição inválida", http.StatusBadRequest)
		return
	}

	if req.Password == "" {
		http.Error(w, "A senha é obrigatória para gerar um link público", http.StatusBadRequest)
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
		http.Error(w, "Item não encontrado", http.StatusNotFound)
		return
	}
	if !h.canWrite(r, itemSectorID) {
		http.Error(w, "Sem permissão para gerar link para este item", http.StatusForbidden)
		return
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
		http.Error(w, "Erro ao gerar link", http.StatusInternalServerError)
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

	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"share_url": "/public/view/%s", "expires_at": "%s"}`, accessToken, expiresAt.Format(time.RFC3339))
}

func (h *DocumentHandler) PublicView(w http.ResponseWriter, r *http.Request) {
	accessToken := chi.URLParam(r, "token")
	password := r.URL.Query().Get("p")
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
		       d.minio_key, d.content_type, d.name as doc_name, f.name as folder_name
		FROM document_links dl
		LEFT JOIN documents d ON dl.document_id = d.id
		LEFT JOIN folders f ON dl.folder_id = f.id
		WHERE dl.access_token = $1 AND dl.active = TRUE`

	var docName, folderName *string
	err := h.db.Conn.QueryRow(query, accessToken).Scan(
		&docID, &folderID, &tenantID, &expiresAt, &maxViews, &viewCount, &passwordHash,
		&minioKey, &contentType, &docName, &folderName,
	)

	if err != nil {
		log.Printf("PublicView Error: %v", err)
		http.Error(w, "Link inválido ou expirado", http.StatusNotFound)
		return
	}

	// 2. Verificar Expiração
	if time.Now().After(expiresAt) {
		http.Error(w, "Este link expirou", http.StatusGone)
		return
	}

	// 3. Verificar Limite de Visualizações
	if maxViews != nil && viewCount >= *maxViews {
		http.Error(w, "Limite de visualizações atingido", http.StatusGone)
		return
	}

	// 4. Verificar Senha se existir
	if passwordHash != nil {
		if password == "" || !h.security.CheckPasswordHash(password, *passwordHash) {
			http.Error(w, "Senha necessária ou incorreta", http.StatusUnauthorized)
			return
		}
	}

	// 5. Se o cliente quer JSON ou se for uma pasta sem documento específico solicitado
	isJson := strings.Contains(r.Header.Get("Accept"), "application/json")
	if isJson || (folderID != nil && requestedDocID == "") {
		if folderID != nil && requestedDocID == "" {
			// Se for pasta, lista os documentos da pasta
			rows, err := h.db.Conn.Query(`
				SELECT id, name, extension, size_bytes, content_type, created_at 
				FROM documents 
				WHERE folder_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, folderID, tenantID)
			if err != nil {
				http.Error(w, "Erro ao listar pasta", http.StatusInternalServerError)
				return
			}
			defer rows.Close()

			var docs []map[string]interface{}
			for rows.Next() {
				var d struct {
					ID          uuid.UUID
					Name        string
					Extension   string
					SizeBytes   int64
					ContentType string
					CreatedAt   time.Time
				}
				rows.Scan(&d.ID, &d.Name, &d.Extension, &d.SizeBytes, &d.ContentType, &d.CreatedAt)
				docs = append(docs, map[string]interface{}{
					"id":           d.ID,
					"name":         d.Name,
					"extension":    d.Extension,
					"size_bytes":   d.SizeBytes,
					"content_type": d.ContentType,
					"created_at":   d.CreatedAt,
				})
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"folder_name": folderName,
				"documents":   docs,
			})
			return
		} else if docID != nil {
			// Se for documento e quer JSON, retorna metadados
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"is_document":   true,
				"document_name": docName,
				"content_type":  contentType,
			})
			return
		}
	}

	// 6. Incrementar contador de visualizações
	h.db.Conn.Exec("UPDATE document_links SET view_count = view_count + 1 WHERE access_token = $1", accessToken)

	// 7. Lógica de Download/Visualização
	var finalMinioKey, finalContentType, finalName string

	if docID != nil {
		if minioKey == nil || contentType == nil || docName == nil {
			http.Error(w, "Erro ao recuperar dados do documento", http.StatusInternalServerError)
			return
		}
		finalMinioKey = *minioKey
		finalContentType = *contentType
		finalName = *docName
	} else if folderID != nil && requestedDocID != "" {
		// Download individual de arquivo dentro de uma pasta compartilhada
		err = h.db.Conn.QueryRow(`
			SELECT minio_key, content_type, name 
			FROM documents 
			WHERE id = $1 AND folder_id = $2 AND tenant_id = $3`,
			requestedDocID, folderID, tenantID).Scan(&finalMinioKey, &finalContentType, &finalName)
		if err != nil {
			http.Error(w, "Documento não encontrado nesta pasta", http.StatusNotFound)
			return
		}
	} else {
		http.Error(w, "Nenhum documento especificado", http.StatusBadRequest)
		return
	}

	encryptedData, err := h.storage.GetEncrypted(r.Context(), finalMinioKey)
	if err != nil {
		http.Error(w, "Erro ao recuperar arquivo", http.StatusInternalServerError)
		return
	}
	defer encryptedData.Close()

	plaintext, err := h.decryptDocument(r.Context(), tenantID, encryptedData)
	if err != nil {
		log.Printf("Erro na descriptografia do documento (público): %v", err)
		http.Error(w, "Erro na segurança do documento", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", finalContentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", finalName))
	w.Write(plaintext)

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
		http.Error(w, "Permissão inválida", http.StatusBadRequest)
		return
	}
	var itemSectorID *uuid.UUID
	var err error
	if typ == "sector" {
		err = h.db.Conn.QueryRow(`
			SELECT COALESCE(d.sector_id, f.sector_id) 
			FROM document_sector_shares dss 
			LEFT JOIN documents d ON dss.document_id = d.id 
			LEFT JOIN folders f ON dss.folder_id = f.id 
			WHERE dss.id = $1 AND dss.tenant_id = $2`, shareID, tenantID).Scan(&itemSectorID)
	} else if typ == "user" {
		err = h.db.Conn.QueryRow(`
			SELECT COALESCE(d.sector_id, f.sector_id) 
			FROM document_shares ds 
			LEFT JOIN documents d ON ds.document_id = d.id 
			LEFT JOIN folders f ON ds.folder_id = f.id 
			WHERE ds.id = $1 AND ds.tenant_id = $2`, shareID, tenantID).Scan(&itemSectorID)
	} else {
		http.Error(w, "Tipo inválido", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, "Compartilhamento não encontrado", http.StatusNotFound)
		return
	}
	if !h.canWrite(r, itemSectorID) {
		http.Error(w, "Sem permissão para atualizar este compartilhamento", http.StatusForbidden)
		return
	}
	if typ == "sector" {
		_, err = h.db.Conn.Exec("UPDATE document_sector_shares SET permission_type = $1 WHERE id = $2 AND tenant_id = $3", req.PermissionType, shareID, tenantID)
	} else {
		_, err = h.db.Conn.Exec("UPDATE document_shares SET permission_type = $1 WHERE id = $2 AND tenant_id = $3", req.PermissionType, shareID, tenantID)
	}
	if err != nil {
		http.Error(w, "Erro ao atualizar permissão", http.StatusInternalServerError)
		return
	}
	newVals := fmt.Sprintf(`{"share_id":"%s","permission_type":"%s"}`, shareID, req.PermissionType)
	_, _ = h.db.Conn.Exec(`
		INSERT INTO audit_logs (tenant_id, user_id, action, entity_name, entity_id, new_values, ip_address, user_agent, severity, audit_level)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'info', 'tenancy')`,
		tenantID, claims.UserID, "UPDATE_SHARE_PERMISSION", "SHARE", shareID, newVals, r.RemoteAddr, r.UserAgent())
	w.WriteHeader(http.StatusNoContent)
}
func (h *DocumentHandler) DeleteFolder(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	folderID := chi.URLParam(r, "id")

	// 1. Verificar se a pasta existe e pertence ao tenant
	var id uuid.UUID
	var folderSectorID *uuid.UUID
	err := h.db.Conn.QueryRow("SELECT id, sector_id FROM folders WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL", folderID, tenantID).Scan(&id, &folderSectorID)
	if err != nil {
		http.Error(w, "Pasta não encontrada", http.StatusNotFound)
		return
	}

	// 1.5 Validar permissão de escrita
	if !h.canWrite(r, folderSectorID) {
		http.Error(w, "Sem permissão para excluir esta pasta", http.StatusForbidden)
		return
	}

	// 2. Mover para a lixeira (Soft Delete)
	_, err = h.db.Conn.Exec("UPDATE folders SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2", folderID, tenantID)
	if err != nil {
		log.Printf("Erro ao mover pasta para lixeira: %v", err)
		http.Error(w, "Erro ao excluir pasta", http.StatusInternalServerError)
		return
	}

	// 3. Mover documentos e subpastas recursivamente (opcional, mas bom para consistência)
	// Como a consulta de listagem já filtra por deleted_at IS NULL na pasta pai,
	// os itens dentro dela "desaparecem" da visão normal.

	w.WriteHeader(http.StatusNoContent)
}

func (h *DocumentHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	docID := chi.URLParam(r, "id")

	// 1. Verificar se o documento existe e pertence ao tenant
	var id uuid.UUID
	var docSectorID *uuid.UUID
	err := h.db.Conn.QueryRow("SELECT id, sector_id FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL", docID, tenantID).Scan(&id, &docSectorID)
	if err != nil {
		http.Error(w, "Documento não encontrado", http.StatusNotFound)
		return
	}

	// 1.5 Validar permissão de escrita
	if !h.canWrite(r, docSectorID) {
		http.Error(w, "Sem permissão para excluir este documento", http.StatusForbidden)
		return
	}

	// 2. Mover para a lixeira (Soft Delete)
	_, err = h.db.Conn.Exec("UPDATE documents SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2", docID, tenantID)
	if err != nil {
		log.Printf("Erro ao mover documento para lixeira: %v", err)
		http.Error(w, "Erro ao excluir documento", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
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
			http.Error(w, "Pasta não encontrada", http.StatusNotFound)
			return
		}
		if !h.canWrite(r, folderSectorID) {
			http.Error(w, "Sem permissão para excluir esta pasta definitivamente", http.StatusForbidden)
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
				if err := rows.Scan(&minioKey); err == nil {
					go h.storage.Delete(context.Background(), minioKey)
				}
			}
		}

		_, err = h.db.Conn.Exec("DELETE FROM folders WHERE id = $1 AND tenant_id = $2", id, tenantID)
		if err != nil {
			log.Printf("Erro ao excluir pasta definitivamente: %v", err)
			http.Error(w, "Erro ao excluir pasta definitivamente", http.StatusInternalServerError)
			return
		}
	} else {
		// 1. Buscar metadados para excluir do MinIO e validar permissão
		var minioKey string
		var docSectorID *uuid.UUID
		err := h.db.Conn.QueryRow("SELECT minio_key, sector_id FROM documents WHERE id = $1 AND tenant_id = $2", id, tenantID).Scan(&minioKey, &docSectorID)
		if err != nil {
			http.Error(w, "Documento não encontrado", http.StatusNotFound)
			return
		}
		if !h.canWrite(r, docSectorID) {
			http.Error(w, "Sem permissão para excluir este documento definitivamente", http.StatusForbidden)
			return
		}

		// 2. Excluir do banco
		_, err = h.db.Conn.Exec("DELETE FROM documents WHERE id = $1 AND tenant_id = $2", id, tenantID)
		if err != nil {
			log.Printf("Erro ao excluir do banco: %v", err)
			http.Error(w, "Erro ao excluir registro do documento", http.StatusInternalServerError)
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

	w.WriteHeader(http.StatusNoContent)
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
				if err := rowsSectors.Scan(&sid); err == nil {
					userGestorSectorIDs = append(userGestorSectorIDs, sid)
				}
			}
		}
	}

	// 1. Limpar documentos da lixeira
	queryDocs := "SELECT id, minio_key FROM documents WHERE tenant_id = $1 AND deleted_at IS NOT NULL"
	argsDocs := []interface{}{tenantID}

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
			if err := rowsDocs.Scan(&id, &minioKey); err == nil {
				// Excluir do banco
				_, _ = h.db.Conn.Exec("DELETE FROM documents WHERE id = $1", id)
				// Excluir do MinIO (Async)
				go h.storage.Delete(context.Background(), minioKey)
			}
		}
	}

	// 2. Limpar pastas da lixeira
	queryFolders := "SELECT id FROM folders WHERE tenant_id = $1 AND deleted_at IS NOT NULL"
	argsFolders := []interface{}{tenantID}

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
			if err := rowsFolders.Scan(&id); err == nil {
				// Excluir do banco (recursivo ou ON DELETE CASCADE seria melhor, mas aqui simplificamos)
				_, _ = h.db.Conn.Exec("DELETE FROM folders WHERE id = $1", id)
			}
		}
	}

	w.WriteHeader(http.StatusNoContent)
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
			http.Error(w, "Pasta não encontrada", http.StatusNotFound)
			return
		}
		query = "UPDATE folders SET deleted_at = NULL WHERE id = $1 AND tenant_id = $2"
	} else {
		err := h.db.Conn.QueryRow("SELECT sector_id FROM documents WHERE id = $1 AND tenant_id = $2", id, tenantID).Scan(&itemSectorID)
		if err != nil {
			http.Error(w, "Documento não encontrado", http.StatusNotFound)
			return
		}
		query = "UPDATE documents SET deleted_at = NULL WHERE id = $1 AND tenant_id = $2"
	}

	if !h.canWrite(r, itemSectorID) {
		http.Error(w, "Sem permissão para restaurar este item", http.StatusForbidden)
		return
	}

	result, err := h.db.Conn.Exec(query, id, tenantID)
	if err != nil {
		log.Printf("Erro ao restaurar item: %v", err)
		http.Error(w, "Erro ao restaurar item", http.StatusInternalServerError)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		http.Error(w, "Item não encontrado ou já restaurado", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
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
			if err := rowsSectors.Scan(&sid, &pt); err == nil {
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

	argsFolders := []interface{}{tenantID}
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
		http.Error(w, "Erro ao buscar pastas da lixeira", http.StatusInternalServerError)
		return
	}
	defer rowsFolders.Close()

	var trashItems []map[string]interface{}
	for rowsFolders.Next() {
		var id, name, color string
		var sectorName *string
		var sectorID *uuid.UUID
		var ownerID *int
		var createdAt, deletedAt time.Time
		rowsFolders.Scan(&id, &name, &createdAt, &deletedAt, &color, &sectorName, &sectorID, &ownerID)

		canEdit := claims.IsMaster || (ownerID != nil && *ownerID == claims.UserID)
		if !canEdit && sectorID != nil {
			if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
				canEdit = true
			}
		}

		trashItems = append(trashItems, map[string]interface{}{
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
		SELECT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, d.deleted_at, s.name as sector_name, d.sector_id, d.owner_id
		FROM documents d
		LEFT JOIN sectors s ON d.sector_id = s.id
		WHERE d.tenant_id = $1 AND d.deleted_at IS NOT NULL`

	argsDocs := []interface{}{tenantID}
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
		http.Error(w, "Erro ao buscar documentos da lixeira", http.StatusInternalServerError)
		return
	}
	defer rowsDocs.Close()

	for rowsDocs.Next() {
		var id, name, ext, contentType string
		var sectorName *string
		var sectorID *uuid.UUID
		var ownerID *int
		var size int64
		var createdAt, deletedAt time.Time
		rowsDocs.Scan(&id, &name, &ext, &size, &contentType, &createdAt, &deletedAt, &sectorName, &sectorID, &ownerID)

		canEdit := claims.IsMaster || (ownerID != nil && *ownerID == claims.UserID)
		if !canEdit && sectorID != nil {
			if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
				canEdit = true
			}
		}

		trashItems = append(trashItems, map[string]interface{}{
			"id":           id,
			"name":         name,
			"extension":    ext,
			"size":         size,
			"content_type": contentType,
			"type":         "file",
			"sector_name":  sectorName,
			"sector_id":    sectorID,
			"can_edit":     canEdit,
			"created_at":   createdAt,
			"deleted_at":   deletedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(trashItems)
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
			if err := rowsSectors.Scan(&sid); err == nil {
				sectorIDs = append(sectorIDs, sid)
			}
		}
	}

	// 2. Query para documentos compartilhados diretamente ou via setor
	query := `
		SELECT DISTINCT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, 
		       u.full_name as shared_by, COALESCE(ds.permission_type, dss.permission_type) as permission
		FROM documents d
		LEFT JOIN document_shares ds ON d.id = ds.document_id AND ds.user_id = $1
		LEFT JOIN document_sector_shares dss ON d.id = dss.document_id
		LEFT JOIN users u ON u.id = (SELECT user_id FROM audit_logs WHERE action = 'SHARE' AND entity_id = d.id::text ORDER BY created_at DESC LIMIT 1)
		WHERE d.tenant_id = $2 AND d.deleted_at IS NULL 
		AND (ds.user_id = $1`

	args := []interface{}{userID, tenantID}
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
		http.Error(w, "Erro ao buscar documentos", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var docs []map[string]interface{}
	for rows.Next() {
		var id, name, ext, contentType, permission string
		var sharedBy *string
		var size int64
		var createdAt time.Time
		rows.Scan(&id, &name, &ext, &size, &contentType, &createdAt, &sharedBy, &permission)

		docs = append(docs, map[string]interface{}{
			"id":           id,
			"name":         name,
			"extension":    ext,
			"size":         size,
			"content_type": contentType,
			"created_at":   createdAt,
			"shared_by":    sharedBy,
			"permission":   permission,
			"can_edit":     permission == "WRITE",
			"type":         "document",
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

	argsFolders := []interface{}{userID, tenantID}
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
			rowsF.Scan(&id, &name, &createdAt, &sharedBy, &permission)

			docs = append(docs, map[string]interface{}{
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(docs)
}

func (h *DocumentHandler) ListSharedByMe(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	userID := claims.UserID

	// Documentos que eu compartilhei (via audit_logs de SHARE)
	query := `
		SELECT DISTINCT d.id, d.name, d.extension, d.size_bytes, d.content_type, d.created_at, 'Eu' as shared_by
		FROM documents d
		INNER JOIN audit_logs al ON al.entity_id = d.id::text AND al.action = 'SHARE' AND al.user_id = $1
		WHERE d.tenant_id = $2 AND d.deleted_at IS NULL`

	rows, err := h.db.Conn.Query(query, userID, tenantID)
	if err != nil {
		http.Error(w, "Erro ao buscar documentos", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var docs []map[string]interface{}
	for rows.Next() {
		var id, name, ext, contentType, sharedBy string
		var size int64
		var createdAt time.Time
		rows.Scan(&id, &name, &ext, &size, &contentType, &createdAt, &sharedBy)

		docs = append(docs, map[string]interface{}{
			"id":           id,
			"name":         name,
			"extension":    ext,
			"size":         size,
			"content_type": contentType,
			"created_at":   createdAt,
			"shared_by":    sharedBy,
			"permission":   "OWNER",
			"can_edit":     true,
			"type":         "document",
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
			rowsF.Scan(&id, &name, &createdAt, &sharedBy)

			docs = append(docs, map[string]interface{}{
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
		       COALESCE(d.content_type, 'folder') as content_type
		FROM document_links dl
		LEFT JOIN documents d ON dl.document_id = d.id
		LEFT JOIN folders f ON dl.folder_id = f.id
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
			var size int64
			var createdAt time.Time
			rowsL.Scan(&linkID, &docID, &folderID, &name, &createdAt, &extension, &size, &contentType)

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

			docs = append(docs, map[string]interface{}{
				"id":           actualID, // ID do documento/pasta para o ShareModal funcionar
				"link_id":      linkID,
				"name":         name,
				"extension":    extension,
				"size":         size,
				"content_type": contentType,
				"created_at":   createdAt,
				"shared_by":    "Link Público",
				"permission":   "READ",
				"can_edit":     true, // Dono pode gerenciar o link
				"is_public":    true,
				"type":         itemType,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(docs)
}
