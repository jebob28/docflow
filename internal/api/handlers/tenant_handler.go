package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"os"
	"time"

	"gestao_documentos/internal/api/middleware"
	"gestao_documentos/internal/api/models"
	"gestao_documentos/internal/database"
	"gestao_documentos/internal/service"

	"github.com/google/uuid"
)

type TenantHandler struct {
	db       *database.DB
	security *service.SecurityService
	vault    *service.VaultService
	jwt      *service.JWTService
	redis    *service.RedisService
}

func NewTenantHandler(db *database.DB, security *service.SecurityService, vault *service.VaultService, jwt *service.JWTService, redis *service.RedisService) *TenantHandler {
	return &TenantHandler{
		db:       db,
		security: security,
		vault:    vault,
		jwt:      jwt,
		redis:    redis,
	}
}

func (h *TenantHandler) Logout(w http.ResponseWriter, r *http.Request) {
	claims, ok := service.GetClaimsFromContext(r.Context())
	if !ok {
		RespondWithError(w, http.StatusUnauthorized, "Não autorizado")
		return
	}

	// Se temos o JTI e o Redis, invalidamos o token
	if claims.ID != "" && h.redis != nil {
		expiration := time.Until(claims.ExpiresAt.Time)
		if expiration > 0 {
			err := h.redis.BlacklistToken(r.Context(), claims.ID, expiration)
			if err != nil {
				log.Printf("Erro ao invalidar token no logout: %v", err)
			}
		}
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "Logout realizado com sucesso"})
}

func (h *TenantHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		TOTPCode string `json:"totp_code"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Requisição inválida")
		return
	}

	var userID int
	var tenantID uuid.UUID
	var hashedPassword, email, fullName, roleName string
	var isMaster bool
	var mfaEnabled bool
	var mfaSecret string

	query := `
		SELECT u.id, u.tenant_id, u.password_hash, u.email, u.is_master, u.full_name, r.name as role_name, 
		       COALESCE(u.mfa_enabled, false), COALESCE(u.mfa_secret, '')
		FROM users u 
		LEFT JOIN roles r ON u.role_id = r.id
		WHERE u.email = $1`
	err := h.db.Conn.QueryRow(query, req.Email).Scan(&userID, &tenantID, &hashedPassword, &email, &isMaster, &fullName, &roleName, &mfaEnabled, &mfaSecret)

	if err != nil {
		RespondWithError(w, http.StatusUnauthorized, "Usuário ou senha inválidos")
		return
	}

	// Verifica a senha
	if !h.security.CheckPasswordHash(req.Password, hashedPassword) {
		RespondWithError(w, http.StatusUnauthorized, "Usuário ou senha inválidos")
		return
	}
	if mfaEnabled {
		if req.TOTPCode == "" {
			RespondWithError(w, http.StatusUnauthorized, "Código MFA obrigatório")
			return
		}
		if mfaSecret == "" || !h.security.ValidateTOTP(mfaSecret, req.TOTPCode) {
			RespondWithError(w, http.StatusUnauthorized, "Código MFA inválido")
			return
		}
	}

	// Gera o Token JWT
	token, err := h.jwt.GenerateToken(userID, tenantID, email, isMaster, roleName)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao gerar token de acesso")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"token": token,
		"user": map[string]string{
			"name": fullName,
			"role": roleName,
		},
	})
}

func (h *TenantHandler) SetupMFA(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		RespondWithError(w, http.StatusUnauthorized, "Usuário não identificado")
		return
	}
	userID := claims.UserID

	secret, err := h.security.GenerateTOTPSecret()
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao gerar segredo MFA")
		return
	}
	issuer := os.Getenv("MFA_ISSUER")
	if issuer == "" {
		issuer = "GestaoDocumentos"
	}
	label := url.PathEscape(issuer + ":" + claims.Email)
	params := url.Values{}
	params.Set("secret", secret)
	params.Set("issuer", issuer)
	params.Set("digits", "6")
	params.Set("period", "30")
	otpauthURL := "otpauth://totp/" + label + "?" + params.Encode()

	_, err = h.db.Conn.Exec(`
		UPDATE users 
		SET mfa_secret = $1, mfa_enabled = FALSE, mfa_verified_at = NULL,
		    security_settings = jsonb_set(COALESCE(security_settings, '{}'::jsonb), '{two_factor}', to_jsonb(false), true),
		    updated_at = NOW()
		WHERE id = $2`, secret, userID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao salvar MFA")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{
		"secret":      secret,
		"otpauth_url": otpauthURL,
	})
}

func (h *TenantHandler) VerifyMFA(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		RespondWithError(w, http.StatusUnauthorized, "Usuário não identificado")
		return
	}
	userID := claims.UserID

	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}
	var secret string
	err := h.db.Conn.QueryRow("SELECT COALESCE(mfa_secret, '') FROM users WHERE id = $1", userID).Scan(&secret)
	if err != nil || secret == "" {
		RespondWithError(w, http.StatusBadRequest, "MFA não configurado")
		return
	}
	if !h.security.ValidateTOTP(secret, req.Code) {
		RespondWithError(w, http.StatusUnauthorized, "Código MFA inválido")
		return
	}

	_, err = h.db.Conn.Exec(`
		UPDATE users 
		SET mfa_enabled = TRUE, mfa_verified_at = NOW(),
		    security_settings = jsonb_set(COALESCE(security_settings, '{}'::jsonb), '{two_factor}', to_jsonb(true), true),
		    updated_at = NOW()
		WHERE id = $1`, userID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao ativar MFA")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "MFA ativado com sucesso"})
}

func (h *TenantHandler) DisableMFA(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		RespondWithError(w, http.StatusUnauthorized, "Usuário não identificado")
		return
	}
	userID := claims.UserID

	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	var secret string
	var enabled bool
	err := h.db.Conn.QueryRow("SELECT COALESCE(mfa_secret, ''), COALESCE(mfa_enabled, false) FROM users WHERE id = $1", userID).Scan(&secret, &enabled)
	if err != nil || !enabled || secret == "" {
		RespondWithError(w, http.StatusBadRequest, "MFA não está ativo")
		return
	}
	if !h.security.ValidateTOTP(secret, req.Code) {
		RespondWithError(w, http.StatusUnauthorized, "Código MFA inválido")
		return
	}

	_, err = h.db.Conn.Exec(`
		UPDATE users 
		SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_verified_at = NULL,
		    security_settings = jsonb_set(COALESCE(security_settings, '{}'::jsonb), '{two_factor}', to_jsonb(false), true),
		    updated_at = NOW()
		WHERE id = $1`, userID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao desativar MFA")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]string{"message": "MFA desativado com sucesso"})
}

func (h *TenantHandler) RegisterTenant(w http.ResponseWriter, r *http.Request) {
	var req models.RegisterTenantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Requisição inválida", http.StatusBadRequest)
		return
	}

	// Validação simples (pode ser expandida)
	if req.TenantName == "" || req.MasterEmail == "" || req.MasterPassword == "" {
		http.Error(w, "Campos obrigatórios ausentes", http.StatusBadRequest)
		return
	}
	if err := h.security.ValidatePasswordStrength(req.MasterPassword); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Inicia uma transação para garantir consistência
	tx, err := h.db.Conn.Begin()
	if err != nil {
		log.Printf("Erro ao iniciar transação: %v", err)
		http.Error(w, "Erro interno do servidor", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// 1. Criar o Tenant
	tenantID := uuid.New()
	queryTenant := `
		INSERT INTO tenants (id, name, slug, document, storage_limit_gb, contract_value, plan_type)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id`

	err = tx.QueryRow(queryTenant,
		tenantID, req.TenantName, req.Slug, req.Document, req.StorageLimitGB, req.ContractValue, req.PlanType,
	).Scan(&tenantID)

	if err != nil {
		log.Printf("Erro ao criar tenant: %v", err)
		http.Error(w, "Erro ao criar tenant (verifique se os dados são únicos)", http.StatusConflict)
		return
	}

	// 2. Hash da senha do Master usando o SecurityService
	hashedPassword, err := h.security.HashPassword(req.MasterPassword)
	if err != nil {
		log.Printf("Erro ao processar senha: %v", err)
		http.Error(w, "Erro interno ao processar senha", http.StatusInternalServerError)
		return
	}

	// 3. Buscar o ID da role MASTER
	var masterRoleID int
	err = tx.QueryRow("SELECT id FROM roles WHERE name = 'MASTER'").Scan(&masterRoleID)
	if err != nil {
		log.Printf("Erro ao buscar role master: %v", err)
		http.Error(w, "Configuração do sistema inválida (role master não encontrada)", http.StatusInternalServerError)
		return
	}

	// 4. Criar o Usuário Master vinculado ao Tenant
	queryUser := `
		INSERT INTO users (full_name, email, password_hash, is_master, tenant_id, role_id)
		VALUES ($1, $2, $3, $4, $5, $6)`

	_, err = tx.Exec(queryUser,
		req.MasterUsername, req.MasterEmail, hashedPassword, true, tenantID, masterRoleID,
	)

	if err != nil {
		log.Printf("Erro ao criar usuário master: %v", err)
		http.Error(w, "Erro ao criar usuário master (verifique se o e-mail já existe)", http.StatusConflict)
		return
	}

	// 5. Criar chave do Tenant no Vault
	if h.vault != nil {
		if err := h.vault.CreateTenantKey(r.Context(), tenantID.String()); err != nil {
			log.Printf("Erro ao criar chave no vault: %v", err)
			http.Error(w, "Erro interno ao configurar segurança do tenant", http.StatusInternalServerError)
			return
		}
	}

	_, err = tx.Exec(`INSERT INTO document_tags (tenant_id, name, color) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, name) DO NOTHING`,
		tenantID, "Confidencial", "#dc2626",
	)
	if err != nil {
		log.Printf("Erro ao criar etiqueta confidencial: %v", err)
		http.Error(w, "Erro ao configurar etiqueta padrão", http.StatusInternalServerError)
		return
	}

	// 6. Commit da transação
	if err := tx.Commit(); err != nil {
		log.Printf("Erro ao salvar dados: %v", err)
		http.Error(w, "Erro ao salvar dados", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"message":   "Tenant e usuário master criados com sucesso!",
		"tenant_id": tenantID.String(),
	})
}

func (h *TenantHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		NewPassword string `json:"new_password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Requisição inválida", http.StatusBadRequest)
		return
	}

	// 1. Obter ID do usuário do contexto (Preenchido pelo middleware Auth)
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		http.Error(w, "Não autorizado", http.StatusUnauthorized)
		return
	}
	userID := claims.UserID

	// 2. Hash da nova senha
	if err := h.security.ValidatePasswordStrength(req.NewPassword); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	hashedPassword, err := h.security.HashPassword(req.NewPassword)
	if err != nil {
		http.Error(w, "Erro ao processar senha", http.StatusInternalServerError)
		return
	}

	// 3. Atualizar no banco
	_, err = h.db.Conn.Exec("UPDATE users SET password_hash = $1 WHERE id = $2", hashedPassword, userID)
	if err != nil {
		http.Error(w, "Erro ao atualizar senha", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Senha atualizada com sucesso"})
}

type CustomizationResponse struct {
	PrimaryColor      string `json:"primary_color"`
	SecondaryColor    string `json:"secondary_color"`
	SidebarColor      string `json:"sidebar_color"`
	SidebarTextColor  string `json:"sidebar_text_color"`
	SidebarIconColor  string `json:"sidebar_icon_color"`
	SidebarFontWeight string `json:"sidebar_font_weight"`
	LogoURL           string `json:"logo_url"`
	CustomSettings    string `json:"custom_settings"` // JSONB string
}

func (h *TenantHandler) GetCustomization(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := middleware.GetTenantID(r.Context())
	if !ok {
		http.Error(w, "Tenant não identificado", http.StatusUnauthorized)
		return
	}

	var res CustomizationResponse
	query := `SELECT primary_color, secondary_color, sidebar_color, sidebar_text_color, sidebar_icon_color, sidebar_font_weight, COALESCE(logo_url, ''), custom_settings::text 
	          FROM tenants WHERE id = $1`
	err := h.db.Conn.QueryRow(query, tenantID).Scan(&res.PrimaryColor, &res.SecondaryColor, &res.SidebarColor, &res.SidebarTextColor, &res.SidebarIconColor, &res.SidebarFontWeight, &res.LogoURL, &res.CustomSettings)
	if err != nil {
		http.Error(w, "Erro ao buscar personalização", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func (h *TenantHandler) UpdateCustomization(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := middleware.GetTenantID(r.Context())
	if !ok {
		http.Error(w, "Tenant não identificado", http.StatusUnauthorized)
		return
	}

	var req CustomizationResponse
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Dados inválidos", http.StatusBadRequest)
		return
	}

	query := `UPDATE tenants 
	          SET primary_color = $1, secondary_color = $2, sidebar_color = $3, sidebar_text_color = $4, sidebar_icon_color = $5, sidebar_font_weight = $6, logo_url = $7, custom_settings = $8::jsonb, updated_at = NOW() 
	          WHERE id = $9`
	_, err := h.db.Conn.Exec(query, req.PrimaryColor, req.SecondaryColor, req.SidebarColor, req.SidebarTextColor, req.SidebarIconColor, req.SidebarFontWeight, req.LogoURL, req.CustomSettings, tenantID)
	if err != nil {
		http.Error(w, "Erro ao atualizar personalização", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Personalização atualizada com sucesso"})
}

func (h *TenantHandler) GetUserProfile(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		http.Error(w, "Usuário não identificado", http.StatusUnauthorized)
		return
	}
	userID := claims.UserID

	var res struct {
		FullName             string `json:"full_name"`
		Email                string `json:"email"`
		Role                 string `json:"role"`
		AvatarURL            string `json:"avatar_url"`
		JobTitle             string `json:"job_title"`
		Bio                  string `json:"bio"`
		NotificationSettings string `json:"notification_settings"`
		SecuritySettings     string `json:"security_settings"`
	}

	query := `SELECT u.full_name, u.email, r.name as role, COALESCE(u.avatar_url, ''), COALESCE(u.job_title, ''), 
	          COALESCE(u.bio, ''), u.notification_settings::text, 
	          jsonb_set(COALESCE(u.security_settings, '{}'::jsonb), '{two_factor}', to_jsonb(COALESCE(u.mfa_enabled, false)), true)::text 
	          FROM users u
	          JOIN roles r ON u.role_id = r.id
	          WHERE u.id = $1`
	err := h.db.Conn.QueryRow(query, userID).Scan(
		&res.FullName, &res.Email, &res.Role, &res.AvatarURL, &res.JobTitle,
		&res.Bio, &res.NotificationSettings, &res.SecuritySettings,
	)
	if err != nil {
		http.Error(w, "Erro ao buscar perfil", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func (h *TenantHandler) UpdateUserProfile(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		http.Error(w, "Usuário não identificado", http.StatusUnauthorized)
		return
	}
	userID := claims.UserID

	var req struct {
		FullName             string `json:"full_name"`
		AvatarURL            string `json:"avatar_url"`
		JobTitle             string `json:"job_title"`
		Bio                  string `json:"bio"`
		NotificationSettings string `json:"notification_settings"`
		SecuritySettings     string `json:"security_settings"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Dados inválidos", http.StatusBadRequest)
		return
	}

	query := `UPDATE users 
	          SET full_name = $1, avatar_url = $2, job_title = $3, bio = $4, 
	              notification_settings = $5::jsonb, 
	              security_settings = jsonb_set($6::jsonb, '{two_factor}', to_jsonb((SELECT COALESCE(mfa_enabled, false) FROM users WHERE id = $7)), true), 
	              updated_at = NOW() 
	          WHERE id = $7`
	_, err := h.db.Conn.Exec(query,
		req.FullName, req.AvatarURL, req.JobTitle, req.Bio,
		req.NotificationSettings, req.SecuritySettings, userID,
	)
	if err != nil {
		http.Error(w, "Erro ao atualizar perfil", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Perfil atualizado com sucesso"})
}

type AccountSettingsResponse struct {
	Name                            string `json:"name"`
	CorporateEmail                  string `json:"corporate_email"`
	Phone                           string `json:"phone"`
	Address                         string `json:"address"`
	AccountSettings                 string `json:"account_settings"`
	ConfidentialRequired            bool   `json:"confidential_required"`
	ConfidentialPasswordConfigured bool   `json:"confidential_password_configured"`
	WatermarkText                   string `json:"watermark_text"`
	WatermarkSize                   int    `json:"watermark_size"`
	WatermarkOffsetY                int    `json:"watermark_offset_y"`
	WatermarkRotation               int    `json:"watermark_rotation"`
	WatermarkOpacity                int    `json:"watermark_opacity"`
}

type AccountSettingsUpdateRequest struct {
	Name                 string `json:"name"`
	CorporateEmail       string `json:"corporate_email"`
	Phone                string `json:"phone"`
	Address              string `json:"address"`
	AccountSettings      string `json:"account_settings"`
	ConfidentialRequired *bool  `json:"confidential_required"`
	ConfidentialPassword string `json:"confidential_password"`
	WatermarkText        string `json:"watermark_text"`
	WatermarkSize        *int   `json:"watermark_size"`
	WatermarkOffsetY     *int   `json:"watermark_offset_y"`
	WatermarkRotation    *int   `json:"watermark_rotation"`
	WatermarkOpacity     *int   `json:"watermark_opacity"`
}

func (h *TenantHandler) GetAccountSettings(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := middleware.GetTenantID(r.Context())
	if !ok {
		http.Error(w, "Tenant não identificado", http.StatusUnauthorized)
		return
	}

	var res AccountSettingsResponse
	query := `SELECT name, COALESCE(corporate_email, ''), COALESCE(phone, ''), 
	          COALESCE(address, ''), account_settings::text, 
	          COALESCE(confidential_required, false),
	          (COALESCE(confidential_password_hash, '') <> ''),
	          COALESCE(watermark_text, 'CONFIDENCIAL'),
	          COALESCE(watermark_size, 80),
	          COALESCE(watermark_offset_y, 0),
	          COALESCE(watermark_rotation, 45),
	          COALESCE(watermark_opacity, 20)
	          FROM tenants WHERE id = $1` 
	err := h.db.Conn.QueryRow(query, tenantID).Scan(
		&res.Name, &res.CorporateEmail, &res.Phone, &res.Address, &res.AccountSettings,
		&res.ConfidentialRequired, &res.ConfidentialPasswordConfigured,
		&res.WatermarkText, &res.WatermarkSize, &res.WatermarkOffsetY, &res.WatermarkRotation, &res.WatermarkOpacity,
	)
	if err != nil {
		http.Error(w, "Erro ao buscar configurações da conta", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func (h *TenantHandler) UpdateAccountSettings(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := middleware.GetTenantID(r.Context())
	if !ok {
		http.Error(w, "Tenant não identificado", http.StatusUnauthorized)
		return
	}

	var req AccountSettingsUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Dados inválidos", http.StatusBadRequest)
		return
	}

	if req.WatermarkSize != nil {
		log.Printf("[SETTINGS_DEBUG] Atualizando marca d'água: Texto='%s', Tamanho=%d", req.WatermarkText, *req.WatermarkSize)
	}

	query := `UPDATE tenants 
	          SET name = COALESCE($1, name), 
	              corporate_email = COALESCE($2, corporate_email), 
	              phone = COALESCE($3, phone), 
	              address = COALESCE($4, address), 
	              account_settings = COALESCE($5, account_settings),
	              confidential_required = COALESCE($6, confidential_required),
	              watermark_text = COALESCE($7, watermark_text),
	              watermark_size = COALESCE($8, watermark_size),
	              watermark_offset_y = COALESCE($9, watermark_offset_y),
	              watermark_rotation = COALESCE($10, watermark_rotation),
	              watermark_opacity = COALESCE($11, watermark_opacity),
	              updated_at = NOW() 
	          WHERE id = $12`
	res_db, err := h.db.Conn.Exec(query,
		req.Name, req.CorporateEmail, req.Phone, req.Address, req.AccountSettings, 
		req.ConfidentialRequired, req.WatermarkText, req.WatermarkSize, req.WatermarkOffsetY, req.WatermarkRotation, req.WatermarkOpacity, tenantID,
	)
	if err != nil {
		http.Error(w, "Erro ao atualizar conta", http.StatusInternalServerError)
		return
	}
	rows, _ := res_db.RowsAffected()
	log.Printf("[SETTINGS_DEBUG] Update finalizado. Linhas afetadas: %d", rows)

	if req.ConfidentialPassword != "" {
		hashedPassword, err := h.security.HashPassword(req.ConfidentialPassword)
		if err != nil {
			http.Error(w, "Erro ao processar senha confidencial", http.StatusInternalServerError)
			return
		}
		_, err = h.db.Conn.Exec(`UPDATE tenants SET confidential_password_hash = $1, updated_at = NOW() WHERE id = $2`, hashedPassword, tenantID)
		if err != nil {
			http.Error(w, "Erro ao atualizar senha confidencial", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Conta atualizada com sucesso"})
}

func (h *TenantHandler) GetTeam(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := middleware.GetTenantID(r.Context())
	if !ok {
		http.Error(w, "Tenant não identificado", http.StatusUnauthorized)
		return
	}

	type TeamMember struct {
		ID       int    `json:"id"`
		FullName string `json:"full_name"`
		Email    string `json:"email"`
		Role     string `json:"role"`
		Avatar   string `json:"avatar_url"`
		JobTitle string `json:"job_title"`
	}

	query := `
		SELECT u.id, u.full_name, u.email, r.name as role, COALESCE(u.avatar_url, ''), COALESCE(u.job_title, '')
		FROM users u
		LEFT JOIN roles r ON u.role_id = r.id
		WHERE u.tenant_id = $1
		ORDER BY u.full_name ASC`

	rows, err := h.db.Conn.Query(query, tenantID)
	if err != nil {
		http.Error(w, "Erro ao buscar equipe", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var team []TeamMember
	for rows.Next() {
		var m TeamMember
		if err := rows.Scan(&m.ID, &m.FullName, &m.Email, &m.Role, &m.Avatar, &m.JobTitle); err != nil {
			continue
		}
		team = append(team, m)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(team)
}
