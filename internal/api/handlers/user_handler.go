package handlers

import (
	"encoding/json"
	"gestao_documentos/internal/api/middleware"
	"gestao_documentos/internal/database"
	"gestao_documentos/internal/service"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type UserHandler struct {
	db       *database.DB
	security *service.SecurityService
}

func NewUserHandler(db *database.DB, security *service.SecurityService) *UserHandler {
	return &UserHandler{
		db:       db,
		security: security,
	}
}

type UserSectorInfo struct {
	SectorID       uuid.UUID `json:"sector_id"`
	SectorName     string    `json:"sector_name"`
	PermissionType string    `json:"permission_type"`
}

type UserListItem struct {
	ID        int              `json:"id"`
	FullName  string           `json:"full_name"`
	Email     string           `json:"email"`
	RoleName  string           `json:"role_name"`
	Sectors   []UserSectorInfo `json:"sectors"`
	IsActive  bool             `json:"is_active"`
	CreatedAt time.Time        `json:"created_at"`
}

func (h *UserHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())

	// Primeiro busca todos os usuários
	query := `
		SELECT u.id, u.full_name, u.email, r.name as role_name, 
		       u.is_active, u.created_at
		FROM users u
		JOIN roles r ON u.role_id = r.id
		WHERE u.tenant_id = $1
		ORDER BY u.full_name ASC
	`
	rows, err := h.db.Conn.Query(query, tenantID)
	if err != nil {
		http.Error(w, "Erro ao listar usuários", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var users []UserListItem
	userIDs := []int{}

	for rows.Next() {
		var u UserListItem
		err := rows.Scan(&u.ID, &u.FullName, &u.Email, &u.RoleName, &u.IsActive, &u.CreatedAt)
		if err != nil {
			continue
		}
		u.Sectors = []UserSectorInfo{}
		users = append(users, u)
		userIDs = append(userIDs, u.ID)
	}

	if len(userIDs) > 0 {
		// Agora busca os setores vinculados para esses usuários
		sectorsQuery := `
			SELECT us.user_id, us.sector_id, s.name, us.permission_type
			FROM user_sectors us
			JOIN sectors s ON us.sector_id = s.id
			WHERE us.user_id = ANY($1)
		`
		sectorRows, err := h.db.Conn.Query(sectorsQuery, userIDs)
		if err == nil {
			defer sectorRows.Close()
			for sectorRows.Next() {
				var userID int
				var sInfo UserSectorInfo
				if err := sectorRows.Scan(&userID, &sInfo.SectorID, &sInfo.SectorName, &sInfo.PermissionType); err == nil {
					for i := range users {
						if users[i].ID == userID {
							users[i].Sectors = append(users[i].Sectors, sInfo)
							break
						}
					}
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())

	var req struct {
		FullName string `json:"full_name"`
		Email    string `json:"email"`
		Password string `json:"password"`
		RoleName string `json:"role_name"`
		Sectors  []struct {
			SectorID       uuid.UUID `json:"sector_id"`
			PermissionType string    `json:"permission_type"`
		} `json:"sectors"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Dados inválidos", http.StatusBadRequest)
		return
	}
	if req.Password == "" {
		http.Error(w, "Senha não pode ser vazia", http.StatusBadRequest)
		return
	}
	if err := h.security.ValidatePasswordStrength(req.Password); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Inicia transação
	tx, err := h.db.Conn.Begin()
	if err != nil {
		http.Error(w, "Erro ao iniciar transação", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Hash da senha
	hashedPassword, err := h.security.HashPassword(req.Password)
	if err != nil {
		http.Error(w, "Erro ao processar senha", http.StatusInternalServerError)
		return
	}

	// Busca ID da role
	var roleID int
	err = tx.QueryRow("SELECT id FROM roles WHERE name = $1", req.RoleName).Scan(&roleID)
	if err != nil {
		tx.QueryRow("SELECT id FROM roles WHERE name = 'USER'").Scan(&roleID)
	}

	query := `
		INSERT INTO users (full_name, email, password_hash, tenant_id, role_id, is_active)
		VALUES ($1, $2, $3, $4, $5, true) RETURNING id
	`
	var userID int
	err = tx.QueryRow(query, req.FullName, req.Email, hashedPassword, tenantID, roleID).Scan(&userID)
	if err != nil {
		http.Error(w, "Erro ao criar usuário (e-mail já existe?)", http.StatusConflict)
		return
	}

	// Insere setores vinculados
	for _, s := range req.Sectors {
		_, err = tx.Exec(`
			INSERT INTO user_sectors (user_id, sector_id, permission_type)
			VALUES ($1, $2, $3)`,
			userID, s.SectorID, s.PermissionType)
		if err != nil {
			http.Error(w, "Erro ao vincular setores", http.StatusInternalServerError)
			return
		}
	}

	// Atualiza contador de usuários na quota
	tx.Exec("UPDATE tenant_quotas SET current_users = current_users + 1 WHERE tenant_id = $1", tenantID)

	if err := tx.Commit(); err != nil {
		http.Error(w, "Erro ao finalizar criação", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"id": userID})
}

func (h *UserHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	userID := chi.URLParam(r, "id")

	var req struct {
		FullName string `json:"full_name"`
		Email    string `json:"email"`
		RoleName string `json:"role_name"`
		Sectors  []struct {
			SectorID       uuid.UUID `json:"sector_id"`
			PermissionType string    `json:"permission_type"`
		} `json:"sectors"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Dados inválidos", http.StatusBadRequest)
		return
	}

	// Inicia transação
	tx, err := h.db.Conn.Begin()
	if err != nil {
		http.Error(w, "Erro ao iniciar transação", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Busca ID da role
	var roleID int
	err = tx.QueryRow("SELECT id FROM roles WHERE name = $1", req.RoleName).Scan(&roleID)
	if err != nil {
		tx.QueryRow("SELECT id FROM roles WHERE name = 'USER'").Scan(&roleID)
	}

	query := `
		UPDATE users 
		SET full_name = $1, email = $2, role_id = $3, updated_at = NOW()
		WHERE id = $4 AND tenant_id = $5
	`
	res, err := tx.Exec(query, req.FullName, req.Email, roleID, userID, tenantID)
	if err != nil {
		http.Error(w, "Erro ao atualizar usuário", http.StatusInternalServerError)
		return
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "Usuário não encontrado", http.StatusNotFound)
		return
	}

	// Atualiza setores vinculados
	// Primeiro remove todos os vínculos atuais
	_, err = tx.Exec("DELETE FROM user_sectors WHERE user_id = $1", userID)
	if err != nil {
		http.Error(w, "Erro ao atualizar setores", http.StatusInternalServerError)
		return
	}

	// Insere os novos vínculos
	for _, s := range req.Sectors {
		_, err = tx.Exec(`
			INSERT INTO user_sectors (user_id, sector_id, permission_type)
			VALUES ($1, $2, $3)`,
			userID, s.SectorID, s.PermissionType)
		if err != nil {
			http.Error(w, "Erro ao vincular setores", http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "Erro ao finalizar atualização", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Usuário atualizado com sucesso"})
}

func (h *UserHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	userID := chi.URLParam(r, "id")

	var req struct {
		IsActive bool `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Dados inválidos", http.StatusBadRequest)
		return
	}

	_, err := h.db.Conn.Exec("UPDATE users SET is_active = $1 WHERE id = $2 AND tenant_id = $3", req.IsActive, userID, tenantID)
	if err != nil {
		http.Error(w, "Erro ao atualizar status do usuário", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (h *UserHandler) UpdatePassword(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	userID := chi.URLParam(r, "id")

	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Dados inválidos", http.StatusBadRequest)
		return
	}

	if req.Password == "" {
		http.Error(w, "Senha não pode ser vazia", http.StatusBadRequest)
		return
	}
	if err := h.security.ValidatePasswordStrength(req.Password); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	hashedPassword, err := h.security.HashPassword(req.Password)
	if err != nil {
		http.Error(w, "Erro ao processar senha", http.StatusInternalServerError)
		return
	}

	_, err = h.db.Conn.Exec("UPDATE users SET password_hash = $1 WHERE id = $2 AND tenant_id = $3", hashedPassword, userID, tenantID)
	if err != nil {
		http.Error(w, "Erro ao redefinir senha do usuário", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (h *UserHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	userID := chi.URLParam(r, "id")

	res, err := h.db.Conn.Exec("DELETE FROM users WHERE id = $1 AND tenant_id = $2", userID, tenantID)
	if err != nil {
		http.Error(w, "Erro ao deletar usuário", http.StatusInternalServerError)
		return
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "Usuário não encontrado", http.StatusNotFound)
		return
	}

	// Atualiza contador de usuários na quota
	h.db.Conn.Exec("UPDATE tenant_quotas SET current_users = current_users - 1 WHERE tenant_id = $1", tenantID)

	w.WriteHeader(http.StatusNoContent)
}
