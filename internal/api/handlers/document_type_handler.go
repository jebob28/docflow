package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"gestao_documentos/internal/api/middleware"
	"gestao_documentos/internal/database"
	"gestao_documentos/internal/service"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type DocumentTypeHandler struct {
	db      *database.DB
	storage *service.StorageService
}

func NewDocumentTypeHandler(db *database.DB, storage *service.StorageService) *DocumentTypeHandler {
	return &DocumentTypeHandler{
		db:      db,
		storage: storage,
	}
}

func (h *DocumentTypeHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())

	rows, err := h.db.Conn.Query(`
		SELECT id, name, retention_years, final_destination, created_at 
		FROM document_types 
		WHERE tenant_id = $1 
		ORDER BY name ASC`, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao buscar tipos de documento")
		return
	}
	defer rows.Close()

	var types []map[string]interface{}
	for rows.Next() {
		var id uuid.UUID
		var name, finalDestination string
		var retentionYears int
		var createdAt time.Time
		rows.Scan(&id, &name, &retentionYears, &finalDestination, &createdAt)
		types = append(types, map[string]interface{}{
			"id":                id,
			"name":              name,
			"retention_years":   retentionYears,
			"final_destination": finalDestination,
			"created_at":        createdAt,
		})
	}

	RespondWithJSON(w, http.StatusOK, types)
}

func (h *DocumentTypeHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())

	var input struct {
		Name             string `json:"name"`
		RetentionYears   int    `json:"retention_years"`
		FinalDestination string `json:"final_destination"`
	}

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	if input.RetentionYears <= 0 {
		input.RetentionYears = 5 // Default
	}
	if input.FinalDestination == "" {
		input.FinalDestination = "EXPURGO"
	}

	var id uuid.UUID
	err := h.db.Conn.QueryRow(`
		INSERT INTO document_types (tenant_id, name, retention_years, final_destination)
		VALUES ($1, $2, $3, $4)
		RETURNING id`,
		tenantID, input.Name, input.RetentionYears, input.FinalDestination).Scan(&id)

	if err != nil {
		log.Printf("Erro ao criar tipo de documento: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao criar tipo de documento")
		return
	}

	RespondWithJSON(w, http.StatusCreated, map[string]interface{}{"id": id})
}

func (h *DocumentTypeHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	id := chi.URLParam(r, "id")

	// Verificar se há documentos usando este tipo
	var count int
	h.db.Conn.QueryRow("SELECT COUNT(*) FROM documents WHERE document_type_id = $1 AND tenant_id = $2", id, tenantID).Scan(&count)
	if count > 0 {
		RespondWithError(w, http.StatusConflict, "Não é possível excluir um tipo de documento que está em uso")
		return
	}

	_, err := h.db.Conn.Exec("DELETE FROM document_types WHERE id = $1 AND tenant_id = $2", id, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao excluir tipo de documento")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *DocumentTypeHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	id := chi.URLParam(r, "id")

	var input struct {
		Name             string `json:"name"`
		RetentionYears   int    `json:"retention_years"`
		FinalDestination string `json:"final_destination"`
	}

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	if input.RetentionYears <= 0 {
		input.RetentionYears = 5
	}
	if input.FinalDestination == "" {
		input.FinalDestination = "EXPURGO"
	}

	_, err := h.db.Conn.Exec(`
		UPDATE document_types 
		SET name = $1, retention_years = $2, final_destination = $3
		WHERE id = $4 AND tenant_id = $5`,
		input.Name, input.RetentionYears, input.FinalDestination, id, tenantID)

	if err != nil {
		log.Printf("Erro ao atualizar tipo de documento: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar tipo de documento")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Tipo de documento atualizado com sucesso"})
}

func (h *DocumentTypeHandler) ExecuteRetention(ctx context.Context) (int64, error) {
	// 1. Marcar como 'EXPIRED' documentos que passaram da data de retenção
	_, err := h.db.Conn.ExecContext(ctx, `
		UPDATE documents 
		SET status = 'EXPIRED' 
		WHERE status = 'ACTIVE' 
		AND retention_date IS NOT NULL 
		AND retention_date < NOW()`)

	if err != nil {
		log.Printf("Erro ao marcar documentos expirados: %v", err)
	}

	// 2. Buscar documentos para expurgo (Descarte definitivo)
	rows, err := h.db.Conn.QueryContext(ctx, `
		SELECT d.id, d.tenant_id, d.minio_key 
		FROM documents d
		JOIN document_types dt ON d.document_type_id = dt.id
		WHERE d.status = 'EXPIRED' 
		AND dt.final_destination = 'EXPURGO'`)

	if err != nil {
		log.Printf("Erro ao buscar documentos para expurgo: %v", err)
		return 0, err
	}
	defer rows.Close()

	var deletedCount int64
	for rows.Next() {
		var id, tenantID uuid.UUID
		var minioKey string
		if err := rows.Scan(&id, &tenantID, &minioKey); err != nil {
			continue
		}

		// Remover do MinIO
		if err := h.storage.Delete(ctx, minioKey); err != nil {
			log.Printf("Erro ao deletar arquivo %s do MinIO: %v", minioKey, err)
		}

		// Remover do Banco (Cascade deve cuidar das versões)
		_, err := h.db.Conn.ExecContext(ctx, "DELETE FROM documents WHERE id = $1 AND tenant_id = $2", id, tenantID)
		if err == nil {
			deletedCount++
		}
	}
	return deletedCount, nil
}

func (h *DocumentTypeHandler) RunRetentionWorker(w http.ResponseWriter, r *http.Request) {
	deletedCount, err := h.ExecuteRetention(r.Context())
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao processar expurgo")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"message":       "Processamento de retenção e descarte concluído",
		"deleted_count": deletedCount,
	})
}
