package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"gestao_documentos/internal/api/middleware"
	"gestao_documentos/internal/database"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type SectorHandler struct {
	db *database.DB
}

func NewSectorHandler(db *database.DB) *SectorHandler {
	return &SectorHandler{db: db}
}

type SectorResponse struct {
	ID             uuid.UUID `json:"id"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	CreatedAt      time.Time `json:"created_at"`
	PermissionType string    `json:"permission_type"`
	CanEdit        bool      `json:"can_edit"`
	CanDelete      bool      `json:"can_delete"`
}

func (h *SectorHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())

	// LOG PARA DEPURAÇÃO
	println("DEBUG: SectorHandler.List - TenantID:", tenantID.String(), "UserID:", claims.UserID)

	query := `
		SELECT s.id, s.name, s.description, s.created_at, us.permission_type
		FROM sectors s
		LEFT JOIN user_sectors us ON s.id = us.sector_id AND us.user_id = $1
		WHERE s.tenant_id = $2
		ORDER BY s.name ASC`

	rows, err := h.db.Conn.Query(query, claims.UserID, tenantID)
	if err != nil {
		http.Error(w, "Erro ao buscar setores", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var sectors []SectorResponse
	for rows.Next() {
		var s SectorResponse
		var desc *string
		var perm *string
		err := rows.Scan(&s.ID, &s.Name, &desc, &s.CreatedAt, &perm)
		if err != nil {
			println("DEBUG: SectorHandler.List - Scan Error:", err.Error())
			continue
		}
		if desc != nil {
			s.Description = *desc
		}
		if perm != nil {
			s.PermissionType = *perm
		} else if claims.IsMaster || claims.Role == "MASTER" || claims.Role == "ADMIN" || claims.Role == "SAAS_ADMIN" {
			s.PermissionType = "GESTOR"
		}

		s.CanEdit = claims.IsMaster || claims.Role == "MASTER" || claims.Role == "ADMIN" || claims.Role == "SAAS_ADMIN" || s.PermissionType == "GESTOR"
		s.CanDelete = claims.IsMaster || claims.Role == "MASTER" || claims.Role == "ADMIN" || claims.Role == "SAAS_ADMIN"
		sectors = append(sectors, s)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sectors":    sectors,
		"can_create": claims.IsMaster || claims.Role == "MASTER" || claims.Role == "ADMIN" || claims.Role == "SAAS_ADMIN",
	})
}

func (h *SectorHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	// RBACMiddleware já valida a permissão WRITE

	var input struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "Payload inválido", http.StatusBadRequest)
		return
	}

	if input.Name == "" {
		http.Error(w, "Nome é obrigatório", http.StatusBadRequest)
		return
	}

	var id uuid.UUID
	err := h.db.Conn.QueryRow(`
		INSERT INTO sectors (tenant_id, name, description)
		VALUES ($1, $2, $3)
		RETURNING id`,
		tenantID, input.Name, input.Description).Scan(&id)

	if err != nil {
		http.Error(w, "Erro ao criar setor ou nome já existe", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      id,
		"message": "Setor criado com sucesso",
	})
}

func (h *SectorHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	sectorID := chi.URLParam(r, "id")

	// Verifica se é MASTER ou GESTOR do setor
	if !claims.IsMaster && claims.Role != "MASTER" && claims.Role != "ADMIN" && claims.Role != "SAAS_ADMIN" {
		var permType string
		err := h.db.Conn.QueryRow(`
			SELECT permission_type 
			FROM user_sectors 
			WHERE user_id = $1 AND sector_id = $2`,
			claims.UserID, sectorID).Scan(&permType)

		if err != nil || permType != "GESTOR" {
			http.Error(w, "Sem permissão para editar este setor", http.StatusForbidden)
			return
		}
	}

	var input struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "Payload inválido", http.StatusBadRequest)
		return
	}

	if input.Name == "" {
		http.Error(w, "Nome é obrigatório", http.StatusBadRequest)
		return
	}

	res, err := h.db.Conn.Exec(`
		UPDATE sectors 
		SET name = $1, description = $2, updated_at = NOW() 
		WHERE id = $3 AND tenant_id = $4`,
		input.Name, input.Description, sectorID, tenantID)

	if err != nil {
		http.Error(w, "Erro ao atualizar setor", http.StatusInternalServerError)
		return
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "Setor não encontrado", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Setor atualizado com sucesso"})
}

func (h *SectorHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	sectorID := chi.URLParam(r, "id")

	// RBACMiddleware já valida a permissão DELETE
	res, err := h.db.Conn.Exec("DELETE FROM sectors WHERE id = $1 AND tenant_id = $2", sectorID, tenantID)
	if err != nil {
		http.Error(w, "Erro ao deletar setor", http.StatusInternalServerError)
		return
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "Setor não encontrado", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
