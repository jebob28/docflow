package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"gestao_documentos/internal/database"
	"gestao_documentos/internal/service"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

type AdminHandler struct {
	db       *database.DB
	security *service.SecurityService
	jwt      *service.JWTService
}

func NewAdminHandler(db *database.DB, security *service.SecurityService, jwt *service.JWTService) *AdminHandler {
	return &AdminHandler{
		db:       db,
		security: security,
		jwt:      jwt,
	}
}

// AdminLogin autentica administradores do SaaS
func (h *AdminHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Requisição inválida")
		return
	}

	var adminID, fullName, storedHash string
	var isActive bool
	query := "SELECT id, full_name, password_hash, is_active FROM saas_admins WHERE email = $1"
	err := h.db.Conn.QueryRow(query, req.Email).Scan(&adminID, &fullName, &storedHash, &isActive)

	if err != nil || !isActive || !h.security.CheckPasswordHash(req.Password, storedHash) {
		RespondWithError(w, http.StatusUnauthorized, "Credenciais administrativas inválidas")
		return
	}

	// Gera token com claim especial "is_saas_admin"
	token, err := h.jwt.GenerateToken(0, uuid.Nil, req.Email, false, "SAAS_ADMIN") // 0 e uuid.Nil para admin global
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao gerar token")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{
		"token": token,
		"name":  fullName,
		"role":  "SAAS_ADMIN",
	})
}

// --- Gestão de Tenants ---

func (h *AdminHandler) ListTenants(w http.ResponseWriter, r *http.Request) {
	query := `
		SELECT t.id, t.name, t.slug, t.document, t.status, t.created_at, 
		       COALESCE(q.max_storage_bytes, 10737418240) as max_storage,
		       COALESCE(q.used_storage_bytes, 0) as used_storage
		FROM tenants t
		LEFT JOIN tenant_quotas q ON t.id = q.tenant_id
		ORDER BY t.created_at DESC
	`
	rows, err := h.db.Conn.Query(query)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao listar tenants")
		return
	}
	defer rows.Close()

	var tenants []map[string]interface{}
	for rows.Next() {
		var id, name, slug, document, status string
		var createdAt time.Time
		var maxStorage, usedStorage int64
		rows.Scan(&id, &name, &slug, &document, &status, &createdAt, &maxStorage, &usedStorage)
		tenants = append(tenants, map[string]interface{}{
			"id":             id,
			"name":           name,
			"domain":         slug + ".saas.com",
			"cnpj":           document,
			"is_active":      status == "ACTIVE",
			"created_at":     createdAt,
			"max_storage":    maxStorage,
			"used_storage":   usedStorage,
			"max_storage_gb": float64(maxStorage) / (1024 * 1024 * 1024),
		})
	}
	RespondWithJSON(w, http.StatusOK, tenants)
}

func (h *AdminHandler) UpdateTenantQuota(w http.ResponseWriter, r *http.Request) {
	tenantID := chi.URLParam(r, "id")
	var req struct {
		MaxStorageGB float64 `json:"max_storage_gb"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	if req.MaxStorageGB <= 0 {
		RespondWithError(w, http.StatusBadRequest, "Capacidade deve ser maior que zero")
		return
	}

	maxStorageBytes := int64(req.MaxStorageGB * 1024 * 1024 * 1024)

	// Upsert na tabela tenant_quotas
	query := `
		INSERT INTO tenant_quotas (tenant_id, max_storage_bytes) 
		VALUES ($1, $2)
		ON CONFLICT (tenant_id) DO UPDATE SET max_storage_bytes = $2
	`
	_, err := h.db.Conn.Exec(query, tenantID, maxStorageBytes)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar quota do tenant")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Quota atualizada com sucesso"})
}

func (h *AdminHandler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	var req struct {
		FullName string `json:"full_name"`
		Email    string `json:"email"`
		Role     string `json:"role"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	// Busca ID da role
	var roleID int
	err := h.db.Conn.QueryRow("SELECT id FROM roles WHERE name = $1", req.Role).Scan(&roleID)
	if err != nil {
		h.db.Conn.QueryRow("SELECT id FROM roles WHERE name = 'USER'").Scan(&roleID)
	}

	query := `
		UPDATE users 
		SET full_name = $1, email = $2, role_id = $3, updated_at = NOW()
		WHERE id = $4
	`
	res, err := h.db.Conn.Exec(query, req.FullName, req.Email, roleID, userID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar usuário")
		return
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		RespondWithError(w, http.StatusNotFound, "Usuário não encontrado")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Usuário atualizado com sucesso"})
}

func (h *AdminHandler) DeleteTenant(w http.ResponseWriter, r *http.Request) {
	tenantID := chi.URLParam(r, "id")

	// Primeiro deleta as quotas associadas
	h.db.Conn.Exec("DELETE FROM tenant_quotas WHERE tenant_id = $1", tenantID)

	res, err := h.db.Conn.Exec("DELETE FROM tenants WHERE id = $1", tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao deletar tenant. Verifique se existem usuários ou documentos vinculados.")
		return
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		RespondWithError(w, http.StatusNotFound, "Tenant não encontrado")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *AdminHandler) UpdateTenant(w http.ResponseWriter, r *http.Request) {
	tenantID := chi.URLParam(r, "id")
	var req struct {
		Name     string `json:"name"`
		Slug     string `json:"slug"`
		Document string `json:"document"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	query := `
		UPDATE tenants 
		SET name = $1, slug = $2, cnpj = $3, updated_at = NOW()
		WHERE id = $4
	`
	res, err := h.db.Conn.Exec(query, req.Name, req.Slug, req.Document, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar empresa")
		return
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		RespondWithError(w, http.StatusNotFound, "Empresa não encontrada")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Empresa atualizada com sucesso"})
}

func (h *AdminHandler) CreateTenant(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string `json:"name"`
		Slug     string `json:"slug"`
		Document string `json:"document"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.Slug = strings.ToLower(strings.TrimSpace(req.Slug))
	req.Document = strings.TrimSpace(req.Document)

	if req.Name == "" || req.Slug == "" || req.Document == "" {
		RespondWithError(w, http.StatusBadRequest, "Campos obrigatórios ausentes")
		return
	}

	var exists bool
	err := h.db.Conn.QueryRow("SELECT EXISTS (SELECT 1 FROM tenants WHERE slug = $1 OR document = $2)", req.Slug, req.Document).Scan(&exists)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao validar dados do tenant")
		return
	}
	if exists {
		RespondWithError(w, http.StatusConflict, "Slug ou CNPJ já cadastrado")
		return
	}

	query := `INSERT INTO tenants (name, slug, document, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`
	var tenantID string
	err = h.db.Conn.QueryRow(query, req.Name, req.Slug, req.Document).Scan(&tenantID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			RespondWithError(w, http.StatusConflict, "Slug ou CNPJ já cadastrado")
			return
		}
		RespondWithError(w, http.StatusInternalServerError, "Erro ao criar tenant")
		return
	}

	_, err = h.db.Conn.Exec("INSERT INTO tenant_quotas (tenant_id, max_storage_bytes) VALUES ($1, 10737418240)", tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao configurar quota do tenant")
		return
	}

	_, err = h.db.Conn.Exec(`INSERT INTO document_tags (tenant_id, name, color) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, name) DO NOTHING`,
		tenantID, "Confidencial", "#dc2626",
	)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao configurar etiqueta padrão")
		return
	}

	RespondWithJSON(w, http.StatusCreated, map[string]string{"id": tenantID})
}

func (h *AdminHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	query := `
		SELECT u.id, u.full_name, u.email, u.is_active, t.name as tenant_name, u.created_at 
		FROM users u 
		LEFT JOIN tenants t ON u.tenant_id = t.id 
		ORDER BY u.created_at DESC
	`
	rows, err := h.db.Conn.Query(query)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao listar usuários")
		return
	}
	defer rows.Close()

	var users []map[string]interface{}
	for rows.Next() {
		var id, name, email, tenantName string
		var isActive bool
		var createdAt time.Time
		rows.Scan(&id, &name, &email, &isActive, &tenantName, &createdAt)
		users = append(users, map[string]interface{}{
			"id":          id,
			"name":        name,
			"email":       email,
			"is_active":   isActive,
			"tenant_name": tenantName,
			"created_at":  createdAt,
		})
	}
	RespondWithJSON(w, http.StatusOK, users)
}

func (h *AdminHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		FullName string    `json:"full_name"`
		Email    string    `json:"email"`
		Password string    `json:"password"`
		TenantID uuid.UUID `json:"tenant_id"`
		Role     string    `json:"role"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}
	if req.Password == "" {
		RespondWithError(w, http.StatusBadRequest, "Senha não pode ser vazia")
		return
	}
	if err := h.security.ValidatePasswordStrength(req.Password); err != nil {
		RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Hash da senha
	hashedPassword, err := h.security.HashPassword(req.Password)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao processar senha")
		return
	}

	// Busca ID da role
	var roleID int
	err = h.db.Conn.QueryRow("SELECT id FROM roles WHERE name = $1", req.Role).Scan(&roleID)
	if err != nil {
		// Se não achar a role, usa USER como default
		h.db.Conn.QueryRow("SELECT id FROM roles WHERE name = 'USER'").Scan(&roleID)
	}

	query := `
		INSERT INTO users (full_name, email, password_hash, tenant_id, role_id, is_active)
		VALUES ($1, $2, $3, $4, $5, true) RETURNING id
	`
	var userID int
	err = h.db.Conn.QueryRow(query, req.FullName, req.Email, hashedPassword, req.TenantID, roleID).Scan(&userID)
	if err != nil {
		RespondWithError(w, http.StatusConflict, "Erro ao criar usuário (e-mail já existe?)")
		return
	}

	// Atualiza contador de usuários na quota
	h.db.Conn.Exec("UPDATE tenant_quotas SET current_users = current_users + 1 WHERE tenant_id = $1", req.TenantID)

	RespondWithJSON(w, http.StatusCreated, map[string]interface{}{"id": userID})
}

func (h *AdminHandler) UpdateUserStatus(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	var req struct {
		IsActive bool `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	_, err := h.db.Conn.Exec("UPDATE users SET is_active = $1 WHERE id = $2", req.IsActive, userID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar status do usuário")
		return
	}
	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Status atualizado"})
}

func (h *AdminHandler) UpdateUserPassword(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	if req.Password == "" {
		RespondWithError(w, http.StatusBadRequest, "Senha não pode ser vazia")
		return
	}
	if err := h.security.ValidatePasswordStrength(req.Password); err != nil {
		RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Hash da nova senha
	hashedPassword, err := h.security.HashPassword(req.Password)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao processar senha")
		return
	}

	// Atualiza no banco
	_, err = h.db.Conn.Exec("UPDATE users SET password_hash = $1 WHERE id = $2", hashedPassword, userID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao redefinir senha do usuário")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Senha atualizada"})
}

func (h *AdminHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")

	res, err := h.db.Conn.Exec("DELETE FROM users WHERE id = $1", userID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao deletar usuário")
		return
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		RespondWithError(w, http.StatusNotFound, "Usuário não encontrado")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *AdminHandler) UpdateTenantStatus(w http.ResponseWriter, r *http.Request) {
	tenantID := chi.URLParam(r, "id")
	var req struct {
		IsActive bool `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	status := "INACTIVE"
	if req.IsActive {
		status = "ACTIVE"
	}

	_, err := h.db.Conn.Exec("UPDATE tenants SET status = $1 WHERE id = $2", status, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar status")
		return
	}
	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Status atualizado"})
}

func (h *AdminHandler) GetDashboardStats(w http.ResponseWriter, r *http.Request) {
	var totalTenants int
	h.db.Conn.QueryRow("SELECT COUNT(*) FROM tenants").Scan(&totalTenants)

	var activeLeads int
	h.db.Conn.QueryRow("SELECT COUNT(*) FROM crm_leads WHERE status != 'LOST'").Scan(&activeLeads)

	var totalBytes int64
	// Soma o uso de todos os tenants da tabela tenant_quotas
	h.db.Conn.QueryRow("SELECT COALESCE(SUM(used_storage_bytes), 0) FROM tenant_quotas").Scan(&totalBytes)

	// Formata para GB ou TB
	totalStorage := formatBytes(totalBytes)

	RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"total_tenants": totalTenants,
		"active_leads":  activeLeads,
		"total_storage": totalStorage,
	})
}

func formatBytes(b int64) string {
	if b == 0 {
		return "0 GB"
	}
	const unit = 1024
	if b < unit*unit*unit {
		// Menos de 1 GB, mostra em MB
		mb := float64(b) / float64(unit*unit)
		if mb < 0.1 {
			return "0 GB"
		}
		return fmt.Sprintf("%.1f MB", mb)
	}

	gb := float64(b) / float64(unit*unit*unit)
	if gb < 1000 {
		return fmt.Sprintf("%.1f GB", gb)
	}

	tb := gb / 1024
	return fmt.Sprintf("%.1f TB", tb)
}

// --- Auditoria Global ---

func (h *AdminHandler) GlobalAuditLogs(w http.ResponseWriter, r *http.Request) {
	// Auditoria que vê ações sem expor dados sensíveis de cada tenant
	query := `
		SELECT a.id, COALESCE(t.name, 'Sistema') as tenant_name, a.action, a.entity_name, a.severity, a.created_at
		FROM audit_logs a
		LEFT JOIN tenants t ON a.tenant_id = t.id
		ORDER BY a.created_at DESC LIMIT 100
	`
	rows, err := h.db.Conn.Query(query)
	if err != nil {
		http.Error(w, "Erro ao buscar logs", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var logs []map[string]interface{}
	for rows.Next() {
		var id string
		var tenantName, action, entityName, severity string
		var createdAt time.Time
		rows.Scan(&id, &tenantName, &action, &entityName, &severity, &createdAt)
		logs = append(logs, map[string]interface{}{
			"id":          id,
			"tenant_name": tenantName,
			"action":      action,
			"entity":      entityName,
			"severity":    severity,
			"created_at":  createdAt,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(logs)
}

// --- CRM / Leads ---

func (h *AdminHandler) GetCRMStats(w http.ResponseWriter, r *http.Request) {
	var newLeads, inProposal int
	var monthlySales float64

	// Novos leads (últimos 7 dias)
	h.db.Conn.QueryRow("SELECT COUNT(*) FROM crm_leads WHERE created_at > NOW() - INTERVAL '7 days'").Scan(&newLeads)

	// Em proposta
	h.db.Conn.QueryRow("SELECT COUNT(*) FROM crm_leads WHERE status = 'PROPOSAL'").Scan(&inProposal)

	// Vendas mês (status WON)
	h.db.Conn.QueryRow("SELECT COALESCE(SUM(estimated_value), 0) FROM crm_leads WHERE status = 'WON' AND created_at > date_trunc('month', now())").Scan(&monthlySales)

	// Taxa de conversão (exemplo simplificado)
	var totalLeads int
	h.db.Conn.QueryRow("SELECT COUNT(*) FROM crm_leads").Scan(&totalLeads)
	var wonLeads int
	h.db.Conn.QueryRow("SELECT COUNT(*) FROM crm_leads WHERE status = 'WON'").Scan(&wonLeads)

	conversionRate := 0.0
	if totalLeads > 0 {
		conversionRate = float64(wonLeads) / float64(totalLeads) * 100
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"new_leads":       newLeads,
		"in_proposal":     inProposal,
		"conversion_rate": int(conversionRate),
		"monthly_sales":   monthlySales,
	})
}

// --- Gestão de Leads CRM ---

func (h *AdminHandler) CreateLead(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CompanyName    string  `json:"company_name"`
		ContactName    string  `json:"contact_name"`
		Email          string  `json:"email"`
		Phone          string  `json:"phone"`
		EstimatedValue float64 `json:"estimated_value"`
		Source         string  `json:"source"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Dados inválidos", http.StatusBadRequest)
		return
	}

	query := `
		INSERT INTO crm_leads (company_name, contact_name, email, phone, estimated_value, source)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
	`
	var leadID string
	err := h.db.Conn.QueryRow(query, req.CompanyName, req.ContactName, req.Email, req.Phone, req.EstimatedValue, req.Source).Scan(&leadID)
	if err != nil {
		http.Error(w, "Erro ao criar lead", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": leadID})
}

func (h *AdminHandler) ListLeads(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Conn.Query("SELECT id, company_name, contact_name, email, status, estimated_value, created_at FROM crm_leads ORDER BY created_at DESC")
	if err != nil {
		http.Error(w, "Erro ao listar leads", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var leads []map[string]interface{}
	for rows.Next() {
		var id, company, contact, email, status string
		var value float64
		var createdAt time.Time
		rows.Scan(&id, &company, &contact, &email, &status, &value, &createdAt)
		leads = append(leads, map[string]interface{}{
			"id":              id,
			"company_name":    company,
			"contact_name":    contact,
			"email":           email,
			"status":          status,
			"estimated_value": value,
			"created_at":      createdAt,
		})
	}
	json.NewEncoder(w).Encode(leads)
}

func (h *AdminHandler) UpdateLead(w http.ResponseWriter, r *http.Request) {
	leadID := chi.URLParam(r, "id")
	var req struct {
		CompanyName    string  `json:"company_name"`
		ContactName    string  `json:"contact_name"`
		Email          string  `json:"email"`
		Phone          string  `json:"phone"`
		Status         string  `json:"status"`
		EstimatedValue float64 `json:"estimated_value"`
		Source         string  `json:"source"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Dados inválidos", http.StatusBadRequest)
		return
	}

	query := `
		UPDATE crm_leads 
		SET company_name = $1, contact_name = $2, email = $3, phone = $4, status = $5, estimated_value = $6, source = $7, updated_at = NOW()
		WHERE id = $8
	`
	res, err := h.db.Conn.Exec(query, req.CompanyName, req.ContactName, req.Email, req.Phone, req.Status, req.EstimatedValue, req.Source, leadID)
	if err != nil {
		http.Error(w, "Erro ao atualizar lead", http.StatusInternalServerError)
		return
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "Lead não encontrado", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Lead atualizado com sucesso"})
}

func (h *AdminHandler) DeleteLead(w http.ResponseWriter, r *http.Request) {
	leadID := chi.URLParam(r, "id")

	res, err := h.db.Conn.Exec("DELETE FROM crm_leads WHERE id = $1", leadID)
	if err != nil {
		http.Error(w, "Erro ao deletar lead", http.StatusInternalServerError)
		return
	}

	rows, _ := res.RowsAffected()
	if rows == 0 {
		http.Error(w, "Lead não encontrado", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
