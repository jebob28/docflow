package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gestao_documentos/internal/api/middleware"
	"gestao_documentos/internal/database"
	"gestao_documentos/internal/service"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type ContractHandler struct {
	db       *database.DB
	storage  *service.StorageService
	vault    *service.VaultService
	redis    *service.RedisService
	security *service.SecurityService
	os       *service.OpenSearchService
}

func NewContractHandler(db *database.DB, storage *service.StorageService, vault *service.VaultService, redis *service.RedisService, security *service.SecurityService, osService *service.OpenSearchService) *ContractHandler {
	return &ContractHandler{db: db, storage: storage, vault: vault, redis: redis, security: security, os: osService}
}

var contractStatusAllowed = map[string]bool{
	"DRAFT":      true,
	"IN_REVIEW":  true,
	"ACTIVE":     true,
	"SUSPENDED":  true,
	"EXPIRED":    true,
	"TERMINATED": true,
	"REJECTED":   true,
}

var contractTemplateSanitizers = []*regexp.Regexp{
	regexp.MustCompile(`(?is)<script\b[^>]*>.*?</script>`),
	regexp.MustCompile(`(?is)<iframe\b[^>]*>.*?</iframe>`),
	regexp.MustCompile(`(?is)<object\b[^>]*>.*?</object>`),
	regexp.MustCompile(`(?is)<embed\b[^>]*>.*?</embed>`),
	regexp.MustCompile(`(?is)<base\b[^>]*>`),
	regexp.MustCompile(`(?is)<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>`),
	regexp.MustCompile(`(?is)<link\b[^>]*>`),
	regexp.MustCompile(`(?i)\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)`),
	regexp.MustCompile(`(?i)\s(?:href|src|xlink:href)\s*=\s*"\s*(?:javascript:|data:text/html|file:)[^"]*"`),
	regexp.MustCompile(`(?i)\s(?:href|src|xlink:href)\s*=\s*'\s*(?:javascript:|data:text/html|file:)[^']*'`),
	regexp.MustCompile(`(?i)\s(?:href|src|xlink:href)\s*=\s*(?:javascript:|data:text/html|file:)[^\s>]*`),
}

func sanitizeTemplateHTML(html string) string {
	sanitized := html
	for _, pattern := range contractTemplateSanitizers {
		sanitized = pattern.ReplaceAllString(sanitized, "")
	}
	return sanitized
}

func (h *ContractHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())

	userPermissions := make(map[uuid.UUID]string)
	var userSectorIDs []uuid.UUID
	var gestorSectorIDs []uuid.UUID
	rowsSectors, err := h.db.Conn.Query("SELECT sector_id, permission_type FROM user_sectors WHERE user_id = $1", claims.UserID)
	if err == nil {
		defer rowsSectors.Close()
		for rowsSectors.Next() {
			var sid uuid.UUID
			var pt string
			if e := rowsSectors.Scan(&sid, &pt); e == nil {
				userPermissions[sid] = pt
				userSectorIDs = append(userSectorIDs, sid)
				if pt == "GESTOR" {
					gestorSectorIDs = append(gestorSectorIDs, sid)
				}
			}
		}
	}

	statusFilter := r.URL.Query().Get("status")
	sectorFilter := strings.TrimSpace(r.URL.Query().Get("sector_id"))
	search := strings.TrimSpace(r.URL.Query().Get("q"))

	query := `
		SELECT c.id, c.title, c.description, c.counterparty_name, c.status,
		       c.start_date, c.end_date, c.value_amount, c.currency,
		       c.created_at, c.updated_at, c.owner_id, u.full_name,
		       c.sector_id, s.name, c.document_id, c.workflow_id,
		       c.folder_id,
		       c.auto_renew, c.renewal_notice_days, c.renewal_period_months, c.renewed_until,
		       c.is_confidential,
		       CASE WHEN c.status = 'SIGNED' THEN c.document_id ELSE NULL END as signed_document_id
		FROM contracts c
		LEFT JOIN users u ON c.owner_id = u.id
		LEFT JOIN sectors s ON c.sector_id = s.id
		WHERE c.tenant_id = $1`

	args := []any{tenantID}

	if !claims.IsMaster {
		// Acesso padrão: dono ou membro do setor
		query += " AND (c.owner_id = $" + strconv.Itoa(len(args)+1)
		args = append(args, claims.UserID)

		if len(userSectorIDs) > 0 {
			query += " OR c.sector_id IS NULL OR c.sector_id IN ("
			for i, sid := range userSectorIDs {
				if i > 0 {
					query += ","
				}
				query += "$" + strconv.Itoa(len(args)+1)
				args = append(args, sid)
			}
			query += ")"
		} else {
			query += " OR c.sector_id IS NULL"
		}
		query += ")"

		// Filtro de confidencialidade: se confidencial, apenas dono ou gestor
		query += " AND (NOT c.is_confidential OR c.owner_id = $" + strconv.Itoa(len(args)+1)
		args = append(args, claims.UserID)

		if len(gestorSectorIDs) > 0 {
			query += " OR c.sector_id IN ("
			for i, sid := range gestorSectorIDs {
				if i > 0 {
					query += ","
				}
				query += "$" + strconv.Itoa(len(args)+1)
				args = append(args, sid)
			}
			query += ")"
		}
		query += ")"
	}

	if statusFilter != "" {
		query += " AND c.status = $" + strconv.Itoa(len(args)+1)
		args = append(args, statusFilter)
	}

	if sectorFilter != "" {
		if sectorFilter == "none" {
			query += " AND c.sector_id IS NULL"
		} else {
			query += " AND c.sector_id = $" + strconv.Itoa(len(args)+1)
			args = append(args, sectorFilter)
		}
	}

	if search != "" {
		query += " AND (LOWER(c.title) LIKE $" + strconv.Itoa(len(args)+1) + " OR LOWER(c.counterparty_name) LIKE $" + strconv.Itoa(len(args)+1) + ")"
		args = append(args, "%"+strings.ToLower(search)+"%")
	}

	query += " ORDER BY c.created_at DESC"

	rows, err := h.db.Conn.Query(query, args...)
	if err != nil {
		log.Printf("Erro ao listar contratos: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao buscar contratos")
		return
	}
	defer rows.Close()

	var contracts []map[string]any
	now := time.Now()
	for rows.Next() {
		var id uuid.UUID
		var title string
		var description, counterpartyName *string
		var status string
		var startDate, endDate *time.Time
		var valueAmount *float64
		var currency *string
		var createdAt, updatedAt time.Time
		var ownerID *int
		var ownerName *string
		var sectorID *uuid.UUID
		var sectorName *string
		var documentID, workflowID, signedDocumentID, folderID *uuid.UUID
		var autoRenew *bool
		var renewalNoticeDays, renewalPeriodMonths *int
		var renewedUntil *time.Time
		var isConfidential bool

		if err := rows.Scan(
			&id, &title, &description, &counterpartyName, &status,
			&startDate, &endDate, &valueAmount, &currency,
			&createdAt, &updatedAt, &ownerID, &ownerName,
			&sectorID, &sectorName, &documentID, &workflowID,
			&folderID,
			&autoRenew, &renewalNoticeDays, &renewalPeriodMonths, &renewedUntil,
			&isConfidential, &signedDocumentID,
		); err != nil {
			log.Printf("Erro ao scanear contrato: %v", err)
			continue
		}

		canEdit := claims.IsMaster || (ownerID != nil && *ownerID == claims.UserID)
		if !canEdit && sectorID != nil {
			if perm, ok := userPermissions[*sectorID]; ok && perm == "GESTOR" {
				canEdit = true
			}
		}

		isExpired := false
		if endDate != nil {
			isExpired = endDate.Before(now)
		}

		contracts = append(contracts, map[string]any{
			"id":                    id,
			"title":                 title,
			"description":           description,
			"counterparty_name":     counterpartyName,
			"status":                status,
			"start_date":            startDate,
			"end_date":              endDate,
			"value_amount":          valueAmount,
			"currency":              currency,
			"created_at":            createdAt,
			"updated_at":            updatedAt,
			"owner_id":              ownerID,
			"owner_name":            ownerName,
			"sector_id":             sectorID,
			"sector_name":           sectorName,
			"document_id":           documentID,
			"folder_id":             folderID,
			"signed_document_id":    signedDocumentID,
			"can_edit":              canEdit,
			"is_expired":            isExpired,
			"workflow_id":           workflowID,
			"auto_renew":            autoRenew,
			"renewal_notice_days":   renewalNoticeDays,
			"renewal_period_months": renewalPeriodMonths,
			"renewed_until":         renewedUntil,
			"is_confidential":       isConfidential,
		})
	}

	if contracts == nil {
		contracts = []map[string]any{}
	}

	RespondWithJSON(w, http.StatusOK, contracts)
}

func (h *ContractHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	contractID := chi.URLParam(r, "id")

	var sectorID *uuid.UUID
	var ownerID *int
	err := h.db.Conn.QueryRow(`
		SELECT sector_id, owner_id 
		FROM contracts 
		WHERE id = $1 AND tenant_id = $2`, contractID, tenantID).Scan(&sectorID, &ownerID)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Contrato não encontrado")
		return
	}

	if !claims.IsMaster {
		hasAccess := ownerID != nil && *ownerID == claims.UserID
		if !hasAccess {
			if sectorID != nil {
				var exists bool
				h.db.Conn.QueryRow(`
					SELECT EXISTS(
						SELECT 1 FROM user_sectors WHERE user_id = $1 AND sector_id = $2
					)`, claims.UserID, sectorID).Scan(&exists)
				hasAccess = exists
			}
		}
		if !hasAccess {
			RespondWithError(w, http.StatusForbidden, "Sem acesso a este contrato")
			return
		}

		// Validação de confidencialidade
		var isConfidential bool
		h.db.Conn.QueryRow(`SELECT is_confidential FROM contracts WHERE id = $1`, contractID).Scan(&isConfidential)
		if isConfidential && (ownerID == nil || *ownerID != claims.UserID) {
			var isGestor bool
			h.db.Conn.QueryRow(`
				SELECT EXISTS(
					SELECT 1 FROM user_sectors 
					WHERE user_id = $1 AND sector_id = $2 AND permission_type = 'GESTOR'
				)`, claims.UserID, sectorID).Scan(&isGestor)
			if !isGestor {
				RespondWithError(w, http.StatusForbidden, "Este é um contrato confidencial e você não tem permissão de gestor")
				return
			}
		}
	}

	var result struct {
		ID                  uuid.UUID  `json:"id"`
		Title               string     `json:"title"`
		Description         *string    `json:"description"`
		CounterpartyName    *string    `json:"counterparty_name"`
		Status              string     `json:"status"`
		StartDate           *time.Time `json:"start_date"`
		EndDate             *time.Time `json:"end_date"`
		ValueAmount         *float64   `json:"value_amount"`
		Currency            *string    `json:"currency"`
		CreatedAt           time.Time  `json:"created_at"`
		UpdatedAt           time.Time  `json:"updated_at"`
		OwnerID             *int       `json:"owner_id"`
		OwnerName           *string    `json:"owner_name"`
		SectorID            *uuid.UUID `json:"sector_id"`
		SectorName          *string    `json:"sector_name"`
		DocumentID          *uuid.UUID `json:"document_id"`
		WorkflowID          *uuid.UUID `json:"workflow_id"`
		AutoRenew           *bool      `json:"auto_renew"`
		RenewalNoticeDays   *int       `json:"renewal_notice_days"`
		RenewalPeriodMonths *int       `json:"renewal_period_months"`
		RenewedUntil        *time.Time `json:"renewed_until"`
		FolderID            *uuid.UUID `json:"folder_id"`
		IsConfidential      bool       `json:"is_confidential"`
		SignedDocumentID    *uuid.UUID `json:"signed_document_id"`
	}

	err = h.db.Conn.QueryRow(`
		SELECT c.id, c.title, c.description, c.counterparty_name, c.status,
		       c.start_date, c.end_date, c.value_amount, c.currency,
		       c.created_at, c.updated_at, c.owner_id, u.full_name,
		       c.sector_id, s.name, c.document_id, c.workflow_id,
		       c.folder_id,
		       c.auto_renew, c.renewal_notice_days, c.renewal_period_months, c.renewed_until,
		       c.is_confidential,
		       CASE WHEN c.status = 'SIGNED' THEN c.document_id ELSE NULL END as signed_document_id
		FROM contracts c
		LEFT JOIN users u ON c.owner_id = u.id
		LEFT JOIN sectors s ON c.sector_id = s.id
		WHERE c.id = $1 AND c.tenant_id = $2`, contractID, tenantID).Scan(
		&result.ID, &result.Title, &result.Description, &result.CounterpartyName, &result.Status,
		&result.StartDate, &result.EndDate, &result.ValueAmount, &result.Currency,
		&result.CreatedAt, &result.UpdatedAt, &result.OwnerID, &result.OwnerName,
		&result.SectorID, &result.SectorName, &result.DocumentID, &result.WorkflowID,
		&result.FolderID,
		&result.AutoRenew, &result.RenewalNoticeDays, &result.RenewalPeriodMonths, &result.RenewedUntil,
		&result.IsConfidential, &result.SignedDocumentID,
	)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Contrato não encontrado")
		return
	}

	RespondWithJSON(w, http.StatusOK, result)
}

func (h *ContractHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())

	var input struct {
		Title               string     `json:"title"`
		Description         *string    `json:"description"`
		CounterpartyName    *string    `json:"counterparty_name"`
		Status              *string    `json:"status"`
		StartDate           *JSONTime  `json:"start_date"`
		EndDate             *JSONTime  `json:"end_date"`
		ValueAmount         *float64   `json:"value_amount"`
		Currency            *string    `json:"currency"`
		SectorID            *uuid.UUID `json:"sector_id"`
		DocumentID          *uuid.UUID `json:"document_id"`
		WorkflowID          *uuid.UUID `json:"workflow_id"`
		AutoRenew           *bool      `json:"auto_renew"`
		RenewalNoticeDays   *int       `json:"renewal_notice_days"`
		RenewalPeriodMonths *int       `json:"renewal_period_months"`
		RenewedUntil        *JSONTime  `json:"renewed_until"`
		FolderID            *uuid.UUID `json:"folder_id"`
		NewFolderName       string     `json:"new_folder_name"`
		IsConfidential      bool       `json:"is_confidential"`
	}

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	if strings.TrimSpace(input.Title) == "" {
		RespondWithError(w, http.StatusBadRequest, "Título é obrigatório")
		return
	}

	status := "DRAFT"
	if input.Status != nil && *input.Status != "" {
		status = *input.Status
	}
	if !contractStatusAllowed[status] {
		RespondWithError(w, http.StatusBadRequest, "Status inválido")
		return
	}

	// Se houver nome de nova pasta, cria-a primeiro
	if input.NewFolderName != "" && input.SectorID != nil {
		var newID uuid.UUID
		err := h.db.Conn.QueryRow(`
			INSERT INTO folders (tenant_id, owner_id, name, sector_id)
			VALUES ($1, $2, $3, $4)
			RETURNING id`, tenantID, claims.UserID, input.NewFolderName, input.SectorID).Scan(&newID)
		if err == nil {
			input.FolderID = &newID
		}
	}

	var id uuid.UUID
	err := h.db.Conn.QueryRow(`
		INSERT INTO contracts (
			tenant_id, owner_id, sector_id, document_id, title, description,
			counterparty_name, status, start_date, end_date, value_amount, currency,
			workflow_id, auto_renew, renewal_notice_days, renewal_period_months, renewed_until,
			folder_id, is_confidential
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, 'BRL'), $13, COALESCE($14, false), COALESCE($15, 30), COALESCE($16, 12), $17, $18, $19)
		RETURNING id`,
		tenantID, claims.UserID, input.SectorID, input.DocumentID, input.Title, input.Description,
		input.CounterpartyName, status, input.StartDate, input.EndDate, input.ValueAmount, input.Currency,
		input.WorkflowID, input.AutoRenew, input.RenewalNoticeDays, input.RenewalPeriodMonths, input.RenewedUntil,
		input.FolderID, input.IsConfidential,
	).Scan(&id)
	if err != nil {
		log.Printf("Erro ao criar contrato: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao criar contrato")
		return
	}

	// Sincroniza documento vinculado se existir
	if input.DocumentID != nil {
		if input.SectorID != nil || input.FolderID != nil {
			if input.SectorID != nil && input.FolderID != nil {
				_, _ = h.db.Conn.Exec(`UPDATE documents SET sector_id = $1, folder_id = $2, is_confidential = $3, updated_at = NOW() WHERE id = $4 AND tenant_id = $5`, input.SectorID, input.FolderID, input.IsConfidential, input.DocumentID, tenantID)
			} else if input.SectorID != nil {
				_, _ = h.db.Conn.Exec(`UPDATE documents SET sector_id = $1, is_confidential = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`, input.SectorID, input.IsConfidential, input.DocumentID, tenantID)
			} else if input.FolderID != nil {
				_, _ = h.db.Conn.Exec(`UPDATE documents SET folder_id = $1, is_confidential = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`, input.FolderID, input.IsConfidential, input.DocumentID, tenantID)
			}
		} else {
			// Apenas confidencialidade
			_, _ = h.db.Conn.Exec(`UPDATE documents SET is_confidential = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`, input.IsConfidential, input.DocumentID, tenantID)
		}

		// Adiciona tag de confidencial se necessário
		if input.IsConfidential {
			var tagID uuid.UUID
			err := h.db.Conn.QueryRow(`SELECT id FROM tags WHERE tenant_id = $1 AND name = 'Confidencial'`, tenantID).Scan(&tagID)
			if err == nil {
				_, _ = h.db.Conn.Exec(`INSERT INTO document_tag_assignments (document_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, input.DocumentID, tagID)
			}
		}
	}

	if input.DocumentID != nil {
		var effectiveDate *time.Time
		if input.RenewedUntil != nil && !input.RenewedUntil.Time.IsZero() {
			effectiveDate = &input.RenewedUntil.Time
		} else if input.EndDate != nil && !input.EndDate.Time.IsZero() {
			effectiveDate = &input.EndDate.Time
		}
		if effectiveDate != nil {
			_, _ = h.db.Conn.Exec(`UPDATE documents SET contract_expires_at = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`, effectiveDate, input.DocumentID, tenantID)
		}
	}

	RespondWithJSON(w, http.StatusCreated, map[string]any{
		"id":      id,
		"message": "Contrato criado com sucesso",
	})
}

func (h *ContractHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	contractID := chi.URLParam(r, "id")

	var existingSectorID *uuid.UUID
	var existingOwnerID *int
	err := h.db.Conn.QueryRow(`
		SELECT sector_id, owner_id 
		FROM contracts 
		WHERE id = $1 AND tenant_id = $2`, contractID, tenantID).Scan(&existingSectorID, &existingOwnerID)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Contrato não encontrado")
		return
	}

	if !claims.IsMaster {
		canEdit := existingOwnerID != nil && *existingOwnerID == claims.UserID
		if !canEdit && existingSectorID != nil {
			var isGestor bool
			h.db.Conn.QueryRow(`
				SELECT EXISTS(
					SELECT 1 FROM user_sectors 
					WHERE user_id = $1 AND sector_id = $2 AND permission_type = 'GESTOR'
				)`, claims.UserID, existingSectorID).Scan(&isGestor)
			canEdit = isGestor
		}
		if !canEdit {
			RespondWithError(w, http.StatusForbidden, "Sem permissão para atualizar este contrato")
			return
		}
	}

	var input struct {
		Title               *string    `json:"title"`
		Description         *string    `json:"description"`
		CounterpartyName    *string    `json:"counterparty_name"`
		Status              *string    `json:"status"`
		StartDate           *JSONTime  `json:"start_date"`
		EndDate             *JSONTime  `json:"end_date"`
		ValueAmount         *float64   `json:"value_amount"`
		Currency            *string    `json:"currency"`
		SectorID            *uuid.UUID `json:"sector_id"`
		DocumentID          *uuid.UUID `json:"document_id"`
		WorkflowID          *uuid.UUID `json:"workflow_id"`
		AutoRenew           *bool      `json:"auto_renew"`
		RenewalNoticeDays   *int       `json:"renewal_notice_days"`
		RenewalPeriodMonths *int       `json:"renewal_period_months"`
		RenewedUntil        *JSONTime  `json:"renewed_until"`
		FolderID            *uuid.UUID `json:"folder_id"`
		NewFolderName       string     `json:"new_folder_name"`
		IsConfidential      *bool      `json:"is_confidential"`
	}

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	if input.Status != nil && !contractStatusAllowed[*input.Status] {
		RespondWithError(w, http.StatusBadRequest, "Status inválido")
		return
	}

	// Se houver nome de nova pasta, cria-a primeiro
	if input.NewFolderName != "" && (input.SectorID != nil || existingSectorID != nil) {
		sectorID := input.SectorID
		if sectorID == nil {
			sectorID = existingSectorID
		}
		var newID uuid.UUID
		err := h.db.Conn.QueryRow(`
			INSERT INTO folders (tenant_id, owner_id, name, sector_id)
			VALUES ($1, $2, $3, $4)
			RETURNING id`, tenantID, claims.UserID, input.NewFolderName, sectorID).Scan(&newID)
		if err == nil {
			input.FolderID = &newID
		}
	}

	setParts := []string{}
	args := []any{}

	if input.Title != nil {
		setParts = append(setParts, "title = $"+strconv.Itoa(len(args)+1))
		args = append(args, *input.Title)
	}
	if input.Description != nil {
		setParts = append(setParts, "description = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.Description)
	}
	if input.CounterpartyName != nil {
		setParts = append(setParts, "counterparty_name = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.CounterpartyName)
	}
	if input.Status != nil {
		setParts = append(setParts, "status = $"+strconv.Itoa(len(args)+1))
		args = append(args, *input.Status)
	}
	if input.StartDate != nil {
		setParts = append(setParts, "start_date = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.StartDate)
	}
	if input.EndDate != nil {
		setParts = append(setParts, "end_date = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.EndDate)
	}
	if input.ValueAmount != nil {
		setParts = append(setParts, "value_amount = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.ValueAmount)
	}
	if input.Currency != nil {
		setParts = append(setParts, "currency = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.Currency)
	}
	if input.SectorID != nil {
		setParts = append(setParts, "sector_id = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.SectorID)
	}
	if input.DocumentID != nil {
		setParts = append(setParts, "document_id = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.DocumentID)
	}
	if input.WorkflowID != nil {
		setParts = append(setParts, "workflow_id = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.WorkflowID)
	}
	if input.AutoRenew != nil {
		setParts = append(setParts, "auto_renew = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.AutoRenew)
	}
	if input.RenewalNoticeDays != nil {
		setParts = append(setParts, "renewal_notice_days = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.RenewalNoticeDays)
	}
	if input.RenewalPeriodMonths != nil {
		setParts = append(setParts, "renewal_period_months = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.RenewalPeriodMonths)
	}
	if input.RenewedUntil != nil {
		setParts = append(setParts, "renewed_until = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.RenewedUntil)
	}
	if input.FolderID != nil {
		setParts = append(setParts, "folder_id = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.FolderID)
	}
	if input.IsConfidential != nil {
		setParts = append(setParts, "is_confidential = $"+strconv.Itoa(len(args)+1))
		args = append(args, *input.IsConfidential)
	}

	if len(setParts) == 0 {
		RespondWithError(w, http.StatusBadRequest, "Nenhum campo para atualizar")
		return
	}

	setParts = append(setParts, "updated_at = NOW()")
	args = append(args, contractID, tenantID)

	query := "UPDATE contracts SET " + strings.Join(setParts, ", ") + " WHERE id = $" + strconv.Itoa(len(args)-1) + " AND tenant_id = $" + strconv.Itoa(len(args))
	_, err = h.db.Conn.Exec(query, args...)
	if err != nil {
		log.Printf("Erro ao atualizar contrato: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar contrato")
		return
	}

	// Se o setor, pasta ou confidencialidade mudou, atualiza o documento vinculado se existir
	if input.SectorID != nil || input.FolderID != nil || input.IsConfidential != nil {
		var docID *uuid.UUID
		err = h.db.Conn.QueryRow(`SELECT document_id FROM contracts WHERE id = $1 AND tenant_id = $2`, contractID, tenantID).Scan(&docID)
		if err == nil && docID != nil {
			// Prepara atualização do documento
			docUpdateParts := []string{"updated_at = NOW()"}
			docArgs := []any{docID, tenantID}

			if input.SectorID != nil {
				docUpdateParts = append(docUpdateParts, "sector_id = $"+strconv.Itoa(len(docArgs)+1))
				docArgs = append(docArgs, input.SectorID)
			}
			if input.FolderID != nil {
				docUpdateParts = append(docUpdateParts, "folder_id = $"+strconv.Itoa(len(docArgs)+1))
				docArgs = append(docArgs, input.FolderID)
			}
			if input.IsConfidential != nil {
				docUpdateParts = append(docUpdateParts, "is_confidential = $"+strconv.Itoa(len(docArgs)+1))
				docArgs = append(docArgs, *input.IsConfidential)
			}

			docQuery := "UPDATE documents SET " + strings.Join(docUpdateParts, ", ") + " WHERE id = $1 AND tenant_id = $2"
			_, _ = h.db.Conn.Exec(docQuery, docArgs...)

			// Gerencia tag de confidencial se necessário
			if input.IsConfidential != nil {
				var tagID uuid.UUID
				err := h.db.Conn.QueryRow(`SELECT id FROM tags WHERE tenant_id = $1 AND name = 'Confidencial'`, tenantID).Scan(&tagID)
				if err == nil {
					if *input.IsConfidential {
						_, _ = h.db.Conn.Exec(`INSERT INTO document_tag_assignments (document_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, docID, tagID)
					} else {
						_, _ = h.db.Conn.Exec(`DELETE FROM document_tag_assignments WHERE document_id = $1 AND tag_id = $2`, docID, tagID)
					}
				}
			}

			// Atualiza OpenSearch se necessário
			if h.os != nil {
				var name, extension string
				var sectorID, folderID *uuid.UUID
				err = h.db.Conn.QueryRow(`SELECT name, extension, sector_id, folder_id FROM documents WHERE id = $1 AND tenant_id = $2`, docID, tenantID).Scan(&name, &extension, &sectorID, &folderID)
				if err == nil {
					go h.os.IndexDocument(context.Background(), service.DocumentIndex{
						ID:        docID.String(),
						TenantID:  tenantID,
						Name:      name,
						Extension: extension,
						SectorID:  sectorID,
						FolderID:  folderID,
						UpdatedAt: time.Now().Format(time.RFC3339),
					})
				}
			}
		}
	}

	if input.EndDate != nil || input.RenewedUntil != nil || input.DocumentID != nil {
		var docID *uuid.UUID
		var endDate *time.Time
		var renewedUntil *time.Time
		err = h.db.Conn.QueryRow(`SELECT document_id, end_date, renewed_until FROM contracts WHERE id = $1 AND tenant_id = $2`, contractID, tenantID).Scan(&docID, &endDate, &renewedUntil)
		if err == nil && docID != nil {
			effectiveDate := renewedUntil
			if effectiveDate == nil {
				effectiveDate = endDate
			}
			if effectiveDate != nil {
				_, _ = h.db.Conn.Exec(`UPDATE documents SET contract_expires_at = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`, effectiveDate, docID, tenantID)
			} else {
				_, _ = h.db.Conn.Exec(`UPDATE documents SET contract_expires_at = NULL, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, docID, tenantID)
			}
		}
	}

	RespondWithJSON(w, http.StatusOK, map[string]any{
		"message": "Contrato atualizado com sucesso",
	})
}

func (h *ContractHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	contractID := chi.URLParam(r, "id")

	var existingSectorID *uuid.UUID
	var existingOwnerID *int
	err := h.db.Conn.QueryRow(`
		SELECT sector_id, owner_id 
		FROM contracts 
		WHERE id = $1 AND tenant_id = $2`, contractID, tenantID).Scan(&existingSectorID, &existingOwnerID)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Contrato não encontrado")
		return
	}

	if !claims.IsMaster {
		canEdit := existingOwnerID != nil && *existingOwnerID == claims.UserID
		if !canEdit && existingSectorID != nil {
			var isGestor bool
			h.db.Conn.QueryRow(`
				SELECT EXISTS(
					SELECT 1 FROM user_sectors 
					WHERE user_id = $1 AND sector_id = $2 AND permission_type = 'GESTOR'
				)`, claims.UserID, existingSectorID).Scan(&isGestor)
			canEdit = isGestor
		}
		if !canEdit {
			RespondWithError(w, http.StatusForbidden, "Sem permissão para excluir este contrato")
			return
		}
	}

	_, err = h.db.Conn.Exec("DELETE FROM contracts WHERE id = $1 AND tenant_id = $2", contractID, tenantID)
	if err != nil {
		log.Printf("Erro ao excluir contrato: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao excluir contrato")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]any{
		"message": "Contrato excluído com sucesso",
	})
}

func (h *ContractHandler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	rows, err := h.db.Conn.Query(`
		SELECT id, name, html_content, is_active, created_at, updated_at
		FROM contract_templates
		WHERE tenant_id = $1
		ORDER BY created_at DESC`, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao listar templates")
		return
	}
	defer rows.Close()

	var templates []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var name string
		var html string
		var isActive bool
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &name, &html, &isActive, &createdAt, &updatedAt); err != nil {
			continue
		}
		templates = append(templates, map[string]any{
			"id":           id,
			"name":         name,
			"html_content": html,
			"is_active":    isActive,
			"created_at":   createdAt,
			"updated_at":   updatedAt,
		})
	}

	if templates == nil {
		templates = []map[string]any{}
	}

	RespondWithJSON(w, http.StatusOK, templates)
}

func (h *ContractHandler) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())

	var input struct {
		Name     string `json:"name"`
		HTML     string `json:"html_content"`
		IsActive *bool  `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}
	if strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.HTML) == "" {
		RespondWithError(w, http.StatusBadRequest, "Nome e HTML são obrigatórios")
		return
	}
	sanitizedHTML := sanitizeTemplateHTML(input.HTML)
	if strings.TrimSpace(sanitizedHTML) == "" {
		RespondWithError(w, http.StatusBadRequest, "HTML inválido para template")
		return
	}

	isActive := true
	if input.IsActive != nil {
		isActive = *input.IsActive
	}

	var id uuid.UUID
	err := h.db.Conn.QueryRow(`
		INSERT INTO contract_templates (tenant_id, name, html_content, is_active, created_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id`,
		tenantID, input.Name, sanitizedHTML, isActive, claims.UserID,
	).Scan(&id)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao criar template")
		return
	}

	RespondWithJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (h *ContractHandler) UpdateTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	templateID := chi.URLParam(r, "templateId")

	var input struct {
		Name     *string `json:"name"`
		HTML     *string `json:"html_content"`
		IsActive *bool   `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	setParts := []string{}
	args := []any{}
	if input.Name != nil {
		setParts = append(setParts, "name = $"+strconv.Itoa(len(args)+1))
		args = append(args, strings.TrimSpace(*input.Name))
	}
	if input.HTML != nil {
		sanitizedHTML := sanitizeTemplateHTML(*input.HTML)
		if strings.TrimSpace(sanitizedHTML) == "" {
			RespondWithError(w, http.StatusBadRequest, "HTML inválido para template")
			return
		}
		setParts = append(setParts, "html_content = $"+strconv.Itoa(len(args)+1))
		args = append(args, sanitizedHTML)
	}
	if input.IsActive != nil {
		setParts = append(setParts, "is_active = $"+strconv.Itoa(len(args)+1))
		args = append(args, *input.IsActive)
	}

	if len(setParts) == 0 {
		RespondWithError(w, http.StatusBadRequest, "Nenhum campo para atualizar")
		return
	}

	setParts = append(setParts, "updated_at = NOW()")
	args = append(args, templateID, tenantID)
	query := "UPDATE contract_templates SET " + strings.Join(setParts, ", ") + " WHERE id = $" + strconv.Itoa(len(args)-1) + " AND tenant_id = $" + strconv.Itoa(len(args))
	res, err := h.db.Conn.Exec(query, args...)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar template")
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		RespondWithError(w, http.StatusNotFound, "Template não encontrado")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Template atualizado com sucesso"})
}

func (h *ContractHandler) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	templateID := chi.URLParam(r, "templateId")
	res, err := h.db.Conn.Exec(`DELETE FROM contract_templates WHERE id = $1 AND tenant_id = $2`, templateID, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao excluir template")
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		RespondWithError(w, http.StatusNotFound, "Template não encontrado")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Template excluído com sucesso"})
}

func (h *ContractHandler) GenerateFromTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	contractID := chi.URLParam(r, "id")
	templateID := chi.URLParam(r, "templateId")

	hasAccess, err := h.hasContractAccess(r.Context(), tenantID, claims.UserID, claims.IsMaster, contractID)
	if err != nil || !hasAccess {
		RespondWithError(w, http.StatusForbidden, "Sem acesso ao contrato")
		return
	}

	var input struct {
		DocumentName      *string    `json:"document_name"`
		SectorID          *uuid.UUID `json:"sector_id"`
		DocumentTypeID    *uuid.UUID `json:"document_type_id"`
		ContractExpiresAt *JSONTime  `json:"contract_expires_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	var templateHTML string
	err = h.db.Conn.QueryRow(`
		SELECT html_content 
		FROM contract_templates 
		WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE`, templateID, tenantID).Scan(&templateHTML)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Template não encontrado")
		return
	}

	contractData, err := h.getContractData(r.Context(), tenantID, contractID)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Contrato não encontrado")
		return
	}

	rendered := renderTemplate(sanitizeTemplateHTML(templateHTML), contractData)
	pdfBytes, err := h.htmlToPDF(r.Context(), rendered)
	if err != nil {
		log.Printf("[GenerateFromTemplate] Erro ao gerar PDF: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao gerar PDF")
		return
	}

	name := "contrato.pdf"
	if input.DocumentName != nil && strings.TrimSpace(*input.DocumentName) != "" {
		name = strings.TrimSpace(*input.DocumentName)
		if !strings.HasSuffix(strings.ToLower(name), ".pdf") {
			name += ".pdf"
		}
	}
	var expiresAt *time.Time
	if input.ContractExpiresAt != nil {
		expiresAt = &input.ContractExpiresAt.Time
	}
	docID, err := h.storeDocument(r.Context(), tenantID, claims.UserID, input.SectorID, nil, "", false, name, "application/pdf", pdfBytes, input.DocumentTypeID, expiresAt)
	if err != nil {
		log.Printf("[GenerateFromTemplate] Erro ao registrar documento: %v", err)
		RespondWithError(w, http.StatusInternalServerError, "Erro ao registrar documento gerado")
		return
	}

	_, _ = h.db.Conn.Exec(`UPDATE contracts SET document_id = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`, docID, contractID, tenantID)

	var versionNumber int
	_ = h.db.Conn.QueryRow(`SELECT COALESCE(MAX(version_number), 0) FROM contract_template_versions WHERE contract_id = $1 AND tenant_id = $2`, contractID, tenantID).Scan(&versionNumber)
	versionNumber++
	_, _ = h.db.Conn.Exec(`
		INSERT INTO contract_template_versions (tenant_id, contract_id, template_id, document_id, version_number, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		tenantID, contractID, templateID, docID, versionNumber, claims.UserID)

	RespondWithJSON(w, http.StatusOK, map[string]any{"document_id": docID})
}

func (h *ContractHandler) ListWorkflows(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	rows, err := h.db.Conn.Query(`
		SELECT id, name, contract_type, is_active, created_at, updated_at
		FROM contract_workflows
		WHERE tenant_id = $1
		ORDER BY created_at DESC`, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao listar workflows")
		return
	}
	defer rows.Close()

	type workflow struct {
		ID           uuid.UUID        `json:"id"`
		Name         string           `json:"name"`
		ContractType *string          `json:"contract_type"`
		IsActive     bool             `json:"is_active"`
		CreatedAt    time.Time        `json:"created_at"`
		UpdatedAt    time.Time        `json:"updated_at"`
		Steps        []map[string]any `json:"steps"`
	}

	var workflows []workflow
	for rows.Next() {
		var wflow workflow
		if err := rows.Scan(&wflow.ID, &wflow.Name, &wflow.ContractType, &wflow.IsActive, &wflow.CreatedAt, &wflow.UpdatedAt); err != nil {
			continue
		}
		wflow.Steps = []map[string]any{}
		workflows = append(workflows, wflow)
	}

	for i := range workflows {
		stepRows, err := h.db.Conn.Query(`
			SELECT id, step_order, approver_user_id, approver_role, sector_id, is_parallel, created_at
			FROM contract_workflow_steps
			WHERE workflow_id = $1
			ORDER BY step_order ASC`, workflows[i].ID)
		if err != nil {
			continue
		}
		for stepRows.Next() {
			var id uuid.UUID
			var stepOrder int
			var approverUserID *int
			var approverRole *string
			var sectorID *uuid.UUID
			var isParallel bool
			var createdAt time.Time
			if err := stepRows.Scan(&id, &stepOrder, &approverUserID, &approverRole, &sectorID, &isParallel, &createdAt); err == nil {
				workflows[i].Steps = append(workflows[i].Steps, map[string]any{
					"id":               id,
					"step_order":       stepOrder,
					"approver_user_id": approverUserID,
					"approver_role":    approverRole,
					"sector_id":        sectorID,
					"is_parallel":      isParallel,
					"created_at":       createdAt,
				})
			}
		}
		stepRows.Close()
	}

	RespondWithJSON(w, http.StatusOK, workflows)
}

func (h *ContractHandler) CreateWorkflow(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())

	var input struct {
		Name         string  `json:"name"`
		ContractType *string `json:"contract_type"`
		IsActive     *bool   `json:"is_active"`
		Steps        []struct {
			StepOrder      int        `json:"step_order"`
			ApproverUserID *int       `json:"approver_user_id"`
			ApproverRole   *string    `json:"approver_role"`
			SectorID       *uuid.UUID `json:"sector_id"`
			IsParallel     *bool      `json:"is_parallel"`
		} `json:"steps"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}
	if strings.TrimSpace(input.Name) == "" {
		RespondWithError(w, http.StatusBadRequest, "Nome é obrigatório")
		return
	}

	isActive := true
	if input.IsActive != nil {
		isActive = *input.IsActive
	}

	tx, err := h.db.Conn.Begin()
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao criar workflow")
		return
	}
	defer tx.Rollback()

	var workflowID uuid.UUID
	err = tx.QueryRow(`
		INSERT INTO contract_workflows (tenant_id, name, contract_type, is_active, created_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id`, tenantID, input.Name, input.ContractType, isActive, claims.UserID).Scan(&workflowID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao criar workflow")
		return
	}

	for _, step := range input.Steps {
		isParallel := false
		if step.IsParallel != nil {
			isParallel = *step.IsParallel
		}
		_, err := tx.Exec(`
			INSERT INTO contract_workflow_steps (workflow_id, step_order, approver_user_id, approver_role, sector_id, is_parallel)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			workflowID, step.StepOrder, step.ApproverUserID, step.ApproverRole, step.SectorID, isParallel)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "Erro ao criar etapas do workflow")
			return
		}
	}

	if err := tx.Commit(); err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao salvar workflow")
		return
	}

	RespondWithJSON(w, http.StatusCreated, map[string]any{"id": workflowID})
}

func (h *ContractHandler) UpdateWorkflow(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	workflowID := chi.URLParam(r, "workflowId")

	var input struct {
		Name         *string `json:"name"`
		ContractType *string `json:"contract_type"`
		IsActive     *bool   `json:"is_active"`
		Steps        []struct {
			StepOrder      int        `json:"step_order"`
			ApproverUserID *int       `json:"approver_user_id"`
			ApproverRole   *string    `json:"approver_role"`
			SectorID       *uuid.UUID `json:"sector_id"`
			IsParallel     *bool      `json:"is_parallel"`
		} `json:"steps"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	tx, err := h.db.Conn.Begin()
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar workflow")
		return
	}
	defer tx.Rollback()

	setParts := []string{}
	args := []any{}
	if input.Name != nil {
		setParts = append(setParts, "name = $"+strconv.Itoa(len(args)+1))
		args = append(args, strings.TrimSpace(*input.Name))
	}
	if input.ContractType != nil {
		setParts = append(setParts, "contract_type = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.ContractType)
	}
	if input.IsActive != nil {
		setParts = append(setParts, "is_active = $"+strconv.Itoa(len(args)+1))
		args = append(args, *input.IsActive)
	}
	if len(setParts) > 0 {
		setParts = append(setParts, "updated_at = NOW()")
		args = append(args, workflowID, tenantID)
		query := "UPDATE contract_workflows SET " + strings.Join(setParts, ", ") + " WHERE id = $" + strconv.Itoa(len(args)-1) + " AND tenant_id = $" + strconv.Itoa(len(args))
		res, err := tx.Exec(query, args...)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar workflow")
			return
		}
		rows, _ := res.RowsAffected()
		if rows == 0 {
			RespondWithError(w, http.StatusNotFound, "Workflow não encontrado")
			return
		}
	}

	if input.Steps != nil {
		_, err = tx.Exec(`DELETE FROM contract_workflow_steps WHERE workflow_id = $1`, workflowID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar etapas do workflow")
			return
		}
		for _, step := range input.Steps {
			isParallel := false
			if step.IsParallel != nil {
				isParallel = *step.IsParallel
			}
			_, err := tx.Exec(`
				INSERT INTO contract_workflow_steps (workflow_id, step_order, approver_user_id, approver_role, sector_id, is_parallel)
				VALUES ($1, $2, $3, $4, $5, $6)`,
				workflowID, step.StepOrder, step.ApproverUserID, step.ApproverRole, step.SectorID, isParallel)
			if err != nil {
				RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar etapas do workflow")
				return
			}
		}
	}

	if err := tx.Commit(); err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao salvar workflow")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Workflow atualizado com sucesso"})
}

func (h *ContractHandler) DeleteWorkflow(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	workflowID := chi.URLParam(r, "workflowId")
	res, err := h.db.Conn.Exec(`DELETE FROM contract_workflows WHERE id = $1 AND tenant_id = $2`, workflowID, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao excluir workflow")
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		RespondWithError(w, http.StatusNotFound, "Workflow não encontrado")
		return
	}
	RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Workflow excluído com sucesso"})
}

func (h *ContractHandler) AssignWorkflow(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	contractID := chi.URLParam(r, "id")

	var input struct {
		WorkflowID *uuid.UUID `json:"workflow_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}
	if input.WorkflowID == nil {
		RespondWithError(w, http.StatusBadRequest, "Workflow é obrigatório")
		return
	}
	res, err := h.db.Conn.Exec(`UPDATE contracts SET workflow_id = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`, input.WorkflowID, contractID, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao vincular workflow")
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		RespondWithError(w, http.StatusNotFound, "Contrato não encontrado")
		return
	}
	RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Workflow vinculado ao contrato"})
}

func (h *ContractHandler) StartWorkflow(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	contractID := chi.URLParam(r, "id")

	hasAccess, err := h.hasContractAccess(r.Context(), tenantID, claims.UserID, claims.IsMaster, contractID)
	if err != nil || !hasAccess {
		RespondWithError(w, http.StatusForbidden, "Sem acesso ao contrato")
		return
	}

	var workflowID uuid.UUID
	err = h.db.Conn.QueryRow(`SELECT workflow_id FROM contracts WHERE id = $1 AND tenant_id = $2`, contractID, tenantID).Scan(&workflowID)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Workflow não configurado")
		return
	}

	stepsRows, err := h.db.Conn.Query(`
		SELECT id, step_order, approver_user_id, approver_role, sector_id, is_parallel
		FROM contract_workflow_steps
		WHERE workflow_id = $1
		ORDER BY step_order ASC`, workflowID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao carregar etapas do workflow")
		return
	}
	defer stepsRows.Close()

	tx, err := h.db.Conn.Begin()
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao iniciar workflow")
		return
	}
	defer tx.Rollback()

	for stepsRows.Next() {
		var stepID uuid.UUID
		var stepOrder int
		var approverUserID *int
		var approverRole *string
		var sectorID *uuid.UUID
		var isParallel bool
		if err := stepsRows.Scan(&stepID, &stepOrder, &approverUserID, &approverRole, &sectorID, &isParallel); err != nil {
			continue
		}

		approverIDs, err := h.resolveApprovers(r.Context(), tenantID, approverUserID, approverRole, sectorID)
		if err != nil || len(approverIDs) == 0 {
			continue
		}

		for _, approverID := range approverIDs {
			_, err := tx.Exec(`
				INSERT INTO contract_approvals (tenant_id, contract_id, step_id, approver_user_id, status)
				VALUES ($1, $2, $3, $4, 'PENDING')`,
				tenantID, contractID, stepID, approverID)
			if err != nil {
				RespondWithError(w, http.StatusInternalServerError, "Erro ao criar aprovações")
				return
			}
			_, _ = tx.Exec(`
				INSERT INTO notifications (tenant_id, user_id, title, message, link)
				VALUES ($1, $2, $3, $4, $5)`,
				tenantID, approverID, "Aprovação de contrato", "Há um contrato aguardando sua aprovação.", "/contracts")
		}
	}

	_, err = tx.Exec(`UPDATE contracts SET status = 'IN_REVIEW', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, contractID, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar contrato")
		return
	}

	if err := tx.Commit(); err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao iniciar workflow")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Workflow iniciado"})
}

func (h *ContractHandler) ListApprovals(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	contractID := chi.URLParam(r, "id")
	rows, err := h.db.Conn.Query(`
		SELECT ca.id, ca.step_id, ca.approver_user_id, u.full_name, ca.status, ca.comments, ca.decided_at, ca.created_at
		FROM contract_approvals ca
		LEFT JOIN users u ON u.id = ca.approver_user_id
		WHERE ca.contract_id = $1 AND ca.tenant_id = $2
		ORDER BY ca.created_at ASC`, contractID, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao listar aprovações")
		return
	}
	defer rows.Close()

	var approvals []map[string]any
	for rows.Next() {
		var id, stepID uuid.UUID
		var approverUserID *int
		var approverName *string
		var status string
		var comments *string
		var decidedAt *time.Time
		var createdAt time.Time
		if err := rows.Scan(&id, &stepID, &approverUserID, &approverName, &status, &comments, &decidedAt, &createdAt); err == nil {
			approvals = append(approvals, map[string]any{
				"id":               id,
				"step_id":          stepID,
				"approver_user_id": approverUserID,
				"approver_name":    approverName,
				"status":           status,
				"comments":         comments,
				"decided_at":       decidedAt,
				"created_at":       createdAt,
			})
		}
	}
	if approvals == nil {
		approvals = []map[string]any{}
	}
	RespondWithJSON(w, http.StatusOK, approvals)
}

func (h *ContractHandler) ListPendingApprovals(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	rows, err := h.db.Conn.Query(`
		SELECT ca.id, ca.contract_id, c.title, c.status, cws.step_order, ca.created_at
		FROM contract_approvals ca
		JOIN contracts c ON c.id = ca.contract_id
		JOIN contract_workflow_steps cws ON cws.id = ca.step_id
		WHERE ca.tenant_id = $1 AND ca.approver_user_id = $2 AND ca.status = 'PENDING'
		ORDER BY ca.created_at ASC`, tenantID, claims.UserID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao listar aprovações pendentes")
		return
	}
	defer rows.Close()

	var approvals []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var contractID uuid.UUID
		var title string
		var contractStatus string
		var stepOrder int
		var createdAt time.Time
		if err := rows.Scan(&id, &contractID, &title, &contractStatus, &stepOrder, &createdAt); err == nil {
			approvals = append(approvals, map[string]any{
				"id":              id,
				"contract_id":     contractID,
				"contract_title":  title,
				"contract_status": contractStatus,
				"step_order":      stepOrder,
				"created_at":      createdAt,
			})
		}
	}
	if approvals == nil {
		approvals = []map[string]any{}
	}
	RespondWithJSON(w, http.StatusOK, approvals)
}

func (h *ContractHandler) DecideApproval(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	contractID := chi.URLParam(r, "id")
	approvalID := chi.URLParam(r, "approvalId")

	var input struct {
		Status   string  `json:"status"`
		Comments *string `json:"comments"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	status := strings.ToUpper(strings.TrimSpace(input.Status))
	if status != "APPROVED" && status != "REJECTED" {
		RespondWithError(w, http.StatusBadRequest, "Status inválido")
		return
	}

	var approverID *int
	var stepID uuid.UUID
	err := h.db.Conn.QueryRow(`
		SELECT approver_user_id, step_id 
		FROM contract_approvals 
		WHERE id = $1 AND contract_id = $2 AND tenant_id = $3`, approvalID, contractID, tenantID).Scan(&approverID, &stepID)
	if err != nil || approverID == nil || *approverID != claims.UserID {
		RespondWithError(w, http.StatusForbidden, "Sem permissão para aprovar")
		return
	}

	_, err = h.db.Conn.Exec(`
		UPDATE contract_approvals 
		SET status = $1, comments = $2, decided_at = NOW()
		WHERE id = $3 AND tenant_id = $4`, status, input.Comments, approvalID, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar aprovação")
		return
	}

	stepOrder, isParallel, err := h.getStepInfo(r.Context(), stepID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao validar workflow")
		return
	}

	if status == "REJECTED" {
		_, _ = h.db.Conn.Exec(`UPDATE contracts SET status = 'REJECTED', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, contractID, tenantID)
		h.notifyContractOwner(r.Context(), tenantID, contractID, "Contrato rejeitado", "O contrato foi rejeitado no workflow.", "/contracts")
		RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Contrato rejeitado"})
		return
	}

	if isParallel {
		var pendingCount int
		_ = h.db.Conn.QueryRow(`
			SELECT COUNT(*) 
			FROM contract_approvals ca
			JOIN contract_workflow_steps cws ON cws.id = ca.step_id
			WHERE ca.contract_id = $1 AND ca.tenant_id = $2 AND cws.step_order = $3 AND ca.status = 'PENDING'`,
			contractID, tenantID, stepOrder).Scan(&pendingCount)
		if pendingCount > 0 {
			RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Aprovação registrada"})
			return
		}
	} else {
		var pendingEarlier int
		_ = h.db.Conn.QueryRow(`
			SELECT COUNT(*)
			FROM contract_approvals ca
			JOIN contract_workflow_steps cws ON cws.id = ca.step_id
			WHERE ca.contract_id = $1 AND ca.tenant_id = $2 AND cws.step_order < $3 AND ca.status != 'APPROVED'`,
			contractID, tenantID, stepOrder).Scan(&pendingEarlier)
		if pendingEarlier > 0 {
			RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Aprovação registrada"})
			return
		}
	}

	var remaining int
	_ = h.db.Conn.QueryRow(`
		SELECT COUNT(*) FROM contract_approvals ca
		WHERE ca.contract_id = $1 AND ca.tenant_id = $2 AND ca.status = 'PENDING'`, contractID, tenantID).Scan(&remaining)
	if remaining == 0 {
		_, _ = h.db.Conn.Exec(`UPDATE contracts SET status = 'ACTIVE', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, contractID, tenantID)
		h.notifyContractOwner(r.Context(), tenantID, contractID, "Contrato aprovado", "O contrato foi aprovado no workflow.", "/contracts")
	}

	RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Aprovação registrada"})
}

func (h *ContractHandler) ListObligations(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	contractID := chi.URLParam(r, "id")
	rows, err := h.db.Conn.Query(`
		SELECT id, title, description, obligation_type, due_date, status, amount, currency, reminder_days, completed_at, created_at, updated_at
		FROM contract_obligations
		WHERE contract_id = $1 AND tenant_id = $2
		ORDER BY due_date ASC NULLS LAST`, contractID, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao listar obrigações")
		return
	}
	defer rows.Close()

	var obligations []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var title string
		var description *string
		var obligationType string
		var dueDate *time.Time
		var status string
		var amount *float64
		var currency *string
		var reminderDays *int
		var completedAt *time.Time
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &title, &description, &obligationType, &dueDate, &status, &amount, &currency, &reminderDays, &completedAt, &createdAt, &updatedAt); err == nil {
			obligations = append(obligations, map[string]any{
				"id":              id,
				"title":           title,
				"description":     description,
				"obligation_type": obligationType,
				"due_date":        dueDate,
				"status":          status,
				"amount":          amount,
				"currency":        currency,
				"reminder_days":   reminderDays,
				"completed_at":    completedAt,
				"created_at":      createdAt,
				"updated_at":      updatedAt,
			})
		}
	}
	if obligations == nil {
		obligations = []map[string]any{}
	}
	RespondWithJSON(w, http.StatusOK, obligations)
}

func (h *ContractHandler) CreateObligation(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	contractID := chi.URLParam(r, "id")
	var input struct {
		Title          string    `json:"title"`
		Description    *string   `json:"description"`
		ObligationType *string   `json:"obligation_type"`
		DueDate        *JSONTime `json:"due_date"`
		Status         *string   `json:"status"`
		Amount         *float64  `json:"amount"`
		Currency       *string   `json:"currency"`
		ReminderDays   *int      `json:"reminder_days"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}
	if strings.TrimSpace(input.Title) == "" {
		RespondWithError(w, http.StatusBadRequest, "Título é obrigatório")
		return
	}
	status := "PENDING"
	if input.Status != nil && *input.Status != "" {
		status = *input.Status
	}
	obligationType := "GENERAL"
	if input.ObligationType != nil && *input.ObligationType != "" {
		obligationType = *input.ObligationType
	}
	var id uuid.UUID
	err := h.db.Conn.QueryRow(`
		INSERT INTO contract_obligations (tenant_id, contract_id, title, description, obligation_type, due_date, status, amount, currency, reminder_days, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'BRL'), COALESCE($10, 15), $11)
		RETURNING id`, tenantID, contractID, input.Title, input.Description, obligationType, input.DueDate, status, input.Amount, input.Currency, input.ReminderDays, claims.UserID).Scan(&id)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao criar obrigação")
		return
	}
	RespondWithJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (h *ContractHandler) UpdateObligation(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	contractID := chi.URLParam(r, "id")
	obligationID := chi.URLParam(r, "obligationId")
	var input struct {
		Title          *string   `json:"title"`
		Description    *string   `json:"description"`
		ObligationType *string   `json:"obligation_type"`
		DueDate        *JSONTime `json:"due_date"`
		Status         *string   `json:"status"`
		Amount         *float64  `json:"amount"`
		Currency       *string   `json:"currency"`
		ReminderDays   *int      `json:"reminder_days"`
		CompletedAt    *JSONTime `json:"completed_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}
	setParts := []string{}
	args := []any{}
	if input.Title != nil {
		setParts = append(setParts, "title = $"+strconv.Itoa(len(args)+1))
		args = append(args, *input.Title)
	}
	if input.Description != nil {
		setParts = append(setParts, "description = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.Description)
	}
	if input.ObligationType != nil {
		setParts = append(setParts, "obligation_type = $"+strconv.Itoa(len(args)+1))
		args = append(args, *input.ObligationType)
	}
	if input.DueDate != nil {
		setParts = append(setParts, "due_date = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.DueDate)
	}
	if input.Status != nil {
		setParts = append(setParts, "status = $"+strconv.Itoa(len(args)+1))
		args = append(args, *input.Status)
	}
	if input.Amount != nil {
		setParts = append(setParts, "amount = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.Amount)
	}
	if input.Currency != nil {
		setParts = append(setParts, "currency = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.Currency)
	}
	if input.ReminderDays != nil {
		setParts = append(setParts, "reminder_days = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.ReminderDays)
	}
	if input.CompletedAt != nil {
		setParts = append(setParts, "completed_at = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.CompletedAt)
	}
	if len(setParts) == 0 {
		RespondWithError(w, http.StatusBadRequest, "Nenhum campo para atualizar")
		return
	}
	setParts = append(setParts, "updated_at = NOW()")
	args = append(args, obligationID, contractID, tenantID)
	query := "UPDATE contract_obligations SET " + strings.Join(setParts, ", ") + " WHERE id = $" + strconv.Itoa(len(args)-2) + " AND contract_id = $" + strconv.Itoa(len(args)-1) + " AND tenant_id = $" + strconv.Itoa(len(args))
	res, err := h.db.Conn.Exec(query, args...)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar obrigação")
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		RespondWithError(w, http.StatusNotFound, "Obrigação não encontrada")
		return
	}
	RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Obrigação atualizada"})
}

func (h *ContractHandler) DeleteObligation(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	contractID := chi.URLParam(r, "id")
	obligationID := chi.URLParam(r, "obligationId")
	res, err := h.db.Conn.Exec(`DELETE FROM contract_obligations WHERE id = $1 AND contract_id = $2 AND tenant_id = $3`, obligationID, contractID, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao excluir obrigação")
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		RespondWithError(w, http.StatusNotFound, "Obrigação não encontrada")
		return
	}
	RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Obrigação excluída"})
}

func (h *ContractHandler) ListObligationAlerts(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	daysParam := r.URL.Query().Get("days")
	days := 0
	if daysParam != "" {
		if parsed, err := strconv.Atoi(daysParam); err == nil && parsed >= 0 {
			days = parsed
		}
	}
	limitDate := time.Now().AddDate(0, 0, days)
	rows, err := h.db.Conn.Query(`
		SELECT o.id, o.contract_id, o.title, o.due_date, o.status, o.amount, o.currency
		FROM contract_obligations o
		WHERE o.tenant_id = $1 AND o.due_date IS NOT NULL AND o.due_date <= $2 AND o.status != 'COMPLETED'
		ORDER BY o.due_date ASC`, tenantID, limitDate)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao listar alertas de obrigações")
		return
	}
	defer rows.Close()

	var alerts []map[string]any
	for rows.Next() {
		var id, contractID uuid.UUID
		var title string
		var dueDate *time.Time
		var status string
		var amount *float64
		var currency *string
		if err := rows.Scan(&id, &contractID, &title, &dueDate, &status, &amount, &currency); err == nil {
			alerts = append(alerts, map[string]any{
				"id":          id,
				"contract_id": contractID,
				"title":       title,
				"due_date":    dueDate,
				"status":      status,
				"amount":      amount,
				"currency":    currency,
			})
		}
	}
	if alerts == nil {
		alerts = []map[string]any{}
	}
	RespondWithJSON(w, http.StatusOK, alerts)
}

func (h *ContractHandler) ListSignatures(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	contractID := chi.URLParam(r, "id")
	rows, err := h.db.Conn.Query(`
		SELECT id, provider, signer_name, signer_email, external_id, signing_url, status, signed_at, signed_hash, document_id, created_at, updated_at
		FROM contract_signatures
		WHERE contract_id = $1 AND tenant_id = $2
		ORDER BY created_at DESC`, contractID, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao listar assinaturas")
		return
	}
	defer rows.Close()

	var signatures []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var provider string
		var signerName, signerEmail, externalID, signingURL *string
		var status string
		var signedAt *time.Time
		var signedHash *string
		var documentID *uuid.UUID
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &provider, &signerName, &signerEmail, &externalID, &signingURL, &status, &signedAt, &signedHash, &documentID, &createdAt, &updatedAt); err == nil {
			signatures = append(signatures, map[string]any{
				"id":           id,
				"provider":     provider,
				"signer_name":  signerName,
				"signer_email": signerEmail,
				"external_id":  externalID,
				"signing_url":  signingURL,
				"status":       status,
				"signed_at":    signedAt,
				"signed_hash":  signedHash,
				"document_id":  documentID,
				"created_at":   createdAt,
				"updated_at":   updatedAt,
			})
		}
	}
	if signatures == nil {
		signatures = []map[string]any{}
	}
	RespondWithJSON(w, http.StatusOK, signatures)
}

func (h *ContractHandler) CreateSignature(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	contractID := chi.URLParam(r, "id")
	var input struct {
		Provider    string     `json:"provider"`
		SignerName  *string    `json:"signer_name"`
		SignerEmail *string    `json:"signer_email"`
		ExternalID  *string    `json:"external_id"`
		SigningURL  *string    `json:"signing_url"`
		DocumentID  *uuid.UUID `json:"document_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}
	if strings.TrimSpace(input.Provider) == "" {
		RespondWithError(w, http.StatusBadRequest, "Fornecedor é obrigatório")
		return
	}
	var id uuid.UUID
	err := h.db.Conn.QueryRow(`
		INSERT INTO contract_signatures (tenant_id, contract_id, provider, signer_name, signer_email, external_id, signing_url, status, document_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8)
		RETURNING id`, tenantID, contractID, input.Provider, input.SignerName, input.SignerEmail, input.ExternalID, input.SigningURL, input.DocumentID).Scan(&id)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao criar assinatura")
		return
	}
	RespondWithJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (h *ContractHandler) UpdateSignature(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	contractID := chi.URLParam(r, "id")
	signatureID := chi.URLParam(r, "signatureId")
	var input struct {
		Status     *string    `json:"status"`
		SignedAt   *JSONTime  `json:"signed_at"`
		DocumentID *uuid.UUID `json:"document_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		RespondWithError(w, http.StatusBadRequest, "Dados inválidos")
		return
	}

	var signedHash *string
	if input.DocumentID != nil {
		data, err := h.fetchDocumentBytes(r.Context(), tenantID, *input.DocumentID)
		if err == nil {
			hash := sha256.Sum256(data)
			hashStr := hex.EncodeToString(hash[:])
			signedHash = &hashStr
		}
	}

	setParts := []string{}
	args := []any{}
	if input.Status != nil {
		setParts = append(setParts, "status = $"+strconv.Itoa(len(args)+1))
		args = append(args, strings.ToUpper(*input.Status))
	}
	if input.SignedAt != nil {
		setParts = append(setParts, "signed_at = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.SignedAt)
	}
	if signedHash != nil {
		setParts = append(setParts, "signed_hash = $"+strconv.Itoa(len(args)+1))
		args = append(args, signedHash)
	}
	if input.DocumentID != nil {
		setParts = append(setParts, "document_id = $"+strconv.Itoa(len(args)+1))
		args = append(args, input.DocumentID)
	}
	if len(setParts) == 0 {
		RespondWithError(w, http.StatusBadRequest, "Nenhum campo para atualizar")
		return
	}
	setParts = append(setParts, "updated_at = NOW()")
	args = append(args, signatureID, contractID, tenantID)
	query := "UPDATE contract_signatures SET " + strings.Join(setParts, ", ") + " WHERE id = $" + strconv.Itoa(len(args)-2) + " AND contract_id = $" + strconv.Itoa(len(args)-1) + " AND tenant_id = $" + strconv.Itoa(len(args))
	res, err := h.db.Conn.Exec(query, args...)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar assinatura")
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		RespondWithError(w, http.StatusNotFound, "Assinatura não encontrada")
		return
	}
	if input.Status != nil && strings.ToUpper(*input.Status) == "SIGNED" {
		h.notifyContractOwner(r.Context(), tenantID, contractID, "Contrato assinado", "Uma assinatura foi concluída.", "/contracts")
	}
	RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Assinatura atualizada"})
}

func (h *ContractHandler) UploadSignedContract(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	contractID := chi.URLParam(r, "id")

	// 1. Verificar acesso
	hasAccess, err := h.hasContractAccess(r.Context(), tenantID, claims.UserID, claims.IsMaster, contractID)
	if err != nil || !hasAccess {
		RespondWithError(w, http.StatusForbidden, "Sem acesso ao contrato")
		return
	}

	// 2. Parse do multipart form
	if err := r.ParseMultipartForm(20 << 20); err != nil { // 20MB max
		RespondWithError(w, http.StatusBadRequest, "Erro ao processar arquivo")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		RespondWithError(w, http.StatusBadRequest, "Arquivo não enviado")
		return
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao ler arquivo")
		return
	}

	// 3. Obter metadados opcionais
	signatureID := r.FormValue("signature_id")
	sectorIDStr := r.FormValue("sector_id")
	folderIDStr := r.FormValue("folder_id")
	newFolderName := r.FormValue("new_folder_name")
	isConfidentialStr := r.FormValue("is_confidential")
	documentTypeIDStr := r.FormValue("document_type_id")
	expiresAtStr := r.FormValue("expires_at")

	var sectorID *uuid.UUID
	if sectorIDStr != "" {
		if id, err := uuid.Parse(sectorIDStr); err == nil {
			sectorID = &id
		}
	}
	var folderID *uuid.UUID
	if folderIDStr != "" && folderIDStr != "root" {
		if id, err := uuid.Parse(folderIDStr); err == nil {
			folderID = &id
		}
	}
	isConfidential := isConfidentialStr == "true"

	var documentTypeID *uuid.UUID
	if documentTypeIDStr != "" {
		if id, err := uuid.Parse(documentTypeIDStr); err == nil {
			documentTypeID = &id
		}
	}
	var expiresAt *time.Time
	if expiresAtStr != "" {
		if t, err := time.Parse(time.RFC3339, expiresAtStr); err == nil {
			expiresAt = &t
		}
	}

	// 4. Salvar e criptografar o documento
	contentType := http.DetectContentType(fileBytes)
	safeName := sanitizeFilename(header.Filename)

	docID, err := h.storeDocument(r.Context(), tenantID, claims.UserID, sectorID, folderID, newFolderName, isConfidential, safeName, contentType, fileBytes, documentTypeID, expiresAt)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao salvar arquivo criptografado")
		return
	}

	// 5. Vincular ao contrato e atualizar status
	tx, err := h.db.Conn.BeginTx(r.Context(), nil)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao iniciar transação")
		return
	}
	defer tx.Rollback()

	// Atualizar contrato
	_, err = tx.Exec(`UPDATE contracts SET document_id = $1, status = 'SIGNED', updated_at = NOW() WHERE id = $2 AND tenant_id = $3`, docID, contractID, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar contrato")
		return
	}

	// Se houver signatureID, atualizar a assinatura correspondente
	if signatureID != "" {
		hash := sha256.Sum256(fileBytes)
		hashStr := hex.EncodeToString(hash[:])
		_, err = tx.Exec(`
			UPDATE contract_signatures 
			SET document_id = $1, status = 'SIGNED', signed_at = NOW(), signed_hash = $2, updated_at = NOW() 
			WHERE id = $3 AND contract_id = $4 AND tenant_id = $5`,
			docID, hashStr, signatureID, contractID, tenantID)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar assinatura")
			return
		}
	}

	if err := tx.Commit(); err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao finalizar transação")
		return
	}

	RespondWithJSON(w, http.StatusOK, map[string]any{
		"message":     "Contrato assinado enviado com sucesso",
		"document_id": docID,
	})
}

func (h *ContractHandler) ListNotifications(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	rows, err := h.db.Conn.Query(`
		SELECT id, title, message, link, read_at, created_at
		FROM notifications
		WHERE tenant_id = $1 AND user_id = $2
		ORDER BY created_at DESC
		LIMIT 50`, tenantID, claims.UserID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao listar notificações")
		return
	}
	defer rows.Close()

	var items []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var title string
		var message *string
		var link *string
		var readAt *time.Time
		var createdAt time.Time
		if err := rows.Scan(&id, &title, &message, &link, &readAt, &createdAt); err == nil {
			items = append(items, map[string]any{
				"id":         id,
				"title":      title,
				"message":    message,
				"link":       link,
				"read_at":    readAt,
				"created_at": createdAt,
			})
		}
	}
	if items == nil {
		items = []map[string]any{}
	}
	RespondWithJSON(w, http.StatusOK, items)
}

func (h *ContractHandler) MarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	claims, _ := middleware.GetClaims(r.Context())
	notificationID := chi.URLParam(r, "notificationId")
	res, err := h.db.Conn.Exec(`
		UPDATE notifications SET read_at = NOW()
		WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND read_at IS NULL`,
		notificationID, tenantID, claims.UserID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao atualizar notificação")
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		RespondWithError(w, http.StatusNotFound, "Notificação não encontrada")
		return
	}
	RespondWithJSON(w, http.StatusOK, map[string]any{"message": "Notificação atualizada"})
}

func (h *ContractHandler) Analytics(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())

	var totalContracts int
	_ = h.db.Conn.QueryRow(`SELECT COUNT(*) FROM contracts WHERE tenant_id = $1`, tenantID).Scan(&totalContracts)

	statusRows, err := h.db.Conn.Query(`SELECT status, COUNT(*) FROM contracts WHERE tenant_id = $1 GROUP BY status`, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao carregar analytics")
		return
	}
	defer statusRows.Close()
	statusCounts := map[string]int{}
	for statusRows.Next() {
		var status string
		var count int
		if err := statusRows.Scan(&status, &count); err == nil {
			statusCounts[status] = count
		}
	}

	var obligationsPending int
	var obligationsOverdue int
	_ = h.db.Conn.QueryRow(`
		SELECT COUNT(*) FROM contract_obligations
		WHERE tenant_id = $1 AND status != 'COMPLETED'`, tenantID).Scan(&obligationsPending)
	_ = h.db.Conn.QueryRow(`
		SELECT COUNT(*) FROM contract_obligations
		WHERE tenant_id = $1 AND status != 'COMPLETED' AND due_date IS NOT NULL AND due_date < NOW()`, tenantID).Scan(&obligationsOverdue)

	var approvalsPending int
	_ = h.db.Conn.QueryRow(`
		SELECT COUNT(*) FROM contract_approvals WHERE tenant_id = $1 AND status = 'PENDING'`, tenantID).Scan(&approvalsPending)

	var signaturesPending int
	_ = h.db.Conn.QueryRow(`
		SELECT COUNT(*) FROM contract_signatures WHERE tenant_id = $1 AND status = 'PENDING'`, tenantID).Scan(&signaturesPending)

	var renewalsDue int
	_ = h.db.Conn.QueryRow(`
		SELECT COUNT(*) FROM contracts
		WHERE tenant_id = $1 AND auto_renew = TRUE AND end_date IS NOT NULL AND end_date <= NOW() + (renewal_notice_days || ' days')::interval`, tenantID).Scan(&renewalsDue)

	var avgApprovalHours *float64
	_ = h.db.Conn.QueryRow(`
		SELECT AVG(EXTRACT(EPOCH FROM (decided_at - created_at)) / 3600.0)
		FROM contract_approvals
		WHERE tenant_id = $1 AND status = 'APPROVED' AND decided_at IS NOT NULL`, tenantID).Scan(&avgApprovalHours)

	RespondWithJSON(w, http.StatusOK, map[string]any{
		"total_contracts":     totalContracts,
		"status_counts":       statusCounts,
		"obligations_pending": obligationsPending,
		"obligations_overdue": obligationsOverdue,
		"approvals_pending":   approvalsPending,
		"signatures_pending":  signaturesPending,
		"renewals_due":        renewalsDue,
		"avg_approval_hours":  avgApprovalHours,
	})
}

func (h *ContractHandler) AnalyticsExport(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := middleware.GetTenantID(r.Context())
	rows, err := h.db.Conn.Query(`
		SELECT id, title, status, start_date, end_date, value_amount, currency, auto_renew, renewal_notice_days, renewal_period_months, renewed_until
		FROM contracts
		WHERE tenant_id = $1
		ORDER BY created_at DESC`, tenantID)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Erro ao exportar analytics")
		return
	}
	defer rows.Close()

	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	_ = writer.Write([]string{"id", "title", "status", "start_date", "end_date", "value_amount", "currency", "auto_renew", "renewal_notice_days", "renewal_period_months", "renewed_until"})

	for rows.Next() {
		var id uuid.UUID
		var title, status string
		var startDate, endDate, renewedUntil *time.Time
		var valueAmount *float64
		var currency *string
		var autoRenew *bool
		var renewalNoticeDays *int
		var renewalPeriodMonths *int
		if err := rows.Scan(&id, &title, &status, &startDate, &endDate, &valueAmount, &currency, &autoRenew, &renewalNoticeDays, &renewalPeriodMonths, &renewedUntil); err == nil {
			record := []string{
				id.String(),
				title,
				status,
				formatDateCSV(startDate),
				formatDateCSV(endDate),
				formatFloatCSV(valueAmount),
				formatStringCSV(currency),
				formatBoolCSV(autoRenew),
				formatIntCSV(renewalNoticeDays),
				formatIntCSV(renewalPeriodMonths),
				formatDateCSV(renewedUntil),
			}
			_ = writer.Write(record)
		}
	}
	writer.Flush()

	w.Header().Set("Content-Disposition", "attachment; filename=\"contract_analytics.csv\"")
	w.Header().Set("Content-Type", "text/csv")
	w.Write(buffer.Bytes())
}

func (h *ContractHandler) storeDocument(ctx context.Context, tenantID uuid.UUID, userID int, sectorID *uuid.UUID, folderID *uuid.UUID, newFolderName string, isConfidential bool, name string, contentType string, data []byte, documentTypeID *uuid.UUID, contractExpiresAt *time.Time) (uuid.UUID, error) {
	safeName := filepath.Base(name)
	if safeName == "" {
		safeName = "contrato.pdf"
	}

	// Se houver nome de nova pasta, cria-a primeiro
	if newFolderName != "" && sectorID != nil {
		var newID uuid.UUID
		err := h.db.Conn.QueryRow(`
			INSERT INTO folders (tenant_id, owner_id, name, sector_id)
			VALUES ($1, $2, $3, $4)
			RETURNING id`, tenantID, userID, newFolderName, sectorID).Scan(&newID)
		if err == nil {
			folderID = &newID
		}
	}

	dek, err := h.security.GenerateRandomKey()
	if err != nil {
		return uuid.Nil, err
	}
	encryptedFile, err := h.security.EncryptAES(data, dek)
	if err != nil {
		return uuid.Nil, err
	}
	encryptedDEK, err := h.vault.EncryptData(ctx, tenantID.String(), dek)
	if err != nil {
		return uuid.Nil, err
	}
	dekLen := uint32(len(encryptedDEK))
	payload := new(bytes.Buffer)
	_ = binary.Write(payload, binary.BigEndian, dekLen)
	payload.WriteString(encryptedDEK)
	payload.Write(encryptedFile)

	objectName := fmt.Sprintf("%s/%s.enc", tenantID.String(), uuid.New().String())
	finalPayload := payload.Bytes()
	reader := bytes.NewReader(finalPayload)
	if err := h.storage.UploadEncrypted(ctx, objectName, reader, int64(len(finalPayload)), contentType); err != nil {
		return uuid.Nil, err
	}

	isSafe, scanResult, scanErr := h.security.ScanFileHash(data)
	status := "QUARANTINE"
	if scanErr == nil && !isSafe {
		status = "INFECTED"
	} else if scanErr == nil && scanResult == "SAFE" {
		status = "ACTIVE"
	}

	var docID uuid.UUID
	err = h.db.Conn.QueryRow(`
		INSERT INTO documents (tenant_id, owner_id, sector_id, folder_id, document_type_id, retention_date, name, extension, size_bytes, minio_key, content_type, is_encrypted, current_version, status, contract_expires_at)
		VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, true, 1, $11, $12)
		RETURNING id`, tenantID, userID, sectorID, folderID, documentTypeID, safeName, filepath.Ext(safeName), int64(len(data)), objectName, contentType, status, contractExpiresAt).Scan(&docID)
	if err != nil {
		return uuid.Nil, err
	}

	// Se for confidencial, adiciona a tag
	if isConfidential {
		var tagID uuid.UUID
		err = h.db.Conn.QueryRow(`SELECT id FROM document_tags WHERE tenant_id = $1 AND LOWER(name) = 'confidencial'`, tenantID).Scan(&tagID)
		if err != nil {
			// Se a tag não existir, cria-a
			err = h.db.Conn.QueryRow(`
				INSERT INTO document_tags (tenant_id, name, color)
				VALUES ($1, 'Confidencial', '#ef4444')
				RETURNING id`, tenantID).Scan(&tagID)
		}
		if err == nil {
			_, _ = h.db.Conn.Exec(`INSERT INTO document_tag_assignments (document_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, docID, tagID)
		}
	}

	_, _ = h.db.Conn.Exec(`
		INSERT INTO document_versions (document_id, tenant_id, version_number, minio_key, size_bytes, created_by, change_summary)
		VALUES ($1, $2, 1, $3, $4, $5, 'Geração automática de contrato')`, docID, tenantID, objectName, int64(len(data)), userID)
	_ = h.redis.UpdateQuotaCache(ctx, tenantID.String(), int64(len(data)))
	if h.os != nil {
		go func() {
			_ = h.os.IndexDocument(context.Background(), service.DocumentIndex{
				ID:        docID.String(),
				TenantID:  tenantID,
				Name:      safeName,
				OCRText:   "",
				Extension: filepath.Ext(safeName),
				SectorID:  sectorID,
				FolderID:  folderID,
				UpdatedAt: time.Now().Format(time.RFC3339),
			})
		}()
	}
	return docID, nil
}

func (h *ContractHandler) htmlToPDF(ctx context.Context, html string) ([]byte, error) {
	tempDir := os.TempDir()
	inputPath := filepath.Join(tempDir, fmt.Sprintf("contract_%d.html", time.Now().UnixNano()))
	outputPath := filepath.Join(tempDir, fmt.Sprintf("contract_%d.pdf", time.Now().UnixNano()))
	if err := os.WriteFile(inputPath, []byte(sanitizeTemplateHTML(html)), 0644); err != nil {
		return nil, err
	}
	defer os.Remove(inputPath)
	defer os.Remove(outputPath)

	if _, err := exec.LookPath("wkhtmltopdf"); err == nil {
		cmd := exec.CommandContext(ctx, "wkhtmltopdf", "--encoding", "utf-8", inputPath, outputPath)
		if output, err := cmd.CombinedOutput(); err != nil {
			return nil, fmt.Errorf("wkhtmltopdf falhou: %s", string(output))
		}
		return os.ReadFile(outputPath)
	}

	if _, err := exec.LookPath("chromium"); err == nil {
		cmd := exec.CommandContext(ctx, "chromium", "--headless", "--disable-gpu", "--no-sandbox", "--print-to-pdf="+outputPath, inputPath)
		if output, err := cmd.CombinedOutput(); err != nil {
			return nil, fmt.Errorf("chromium falhou: %s", string(output))
		}
		return os.ReadFile(outputPath)
	}

	if _, err := exec.LookPath("google-chrome"); err == nil {
		cmd := exec.CommandContext(ctx, "google-chrome", "--headless", "--disable-gpu", "--no-sandbox", "--print-to-pdf="+outputPath, inputPath)
		if output, err := cmd.CombinedOutput(); err != nil {
			return nil, fmt.Errorf("chrome falhou: %s", string(output))
		}
		return os.ReadFile(outputPath)
	}

	// macOS default Chrome path
	macChrome := "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
	if _, err := os.Stat(macChrome); err == nil {
		cmd := exec.CommandContext(ctx, macChrome, "--headless", "--disable-gpu", "--no-sandbox", "--print-to-pdf="+outputPath, inputPath)
		if output, err := cmd.CombinedOutput(); err != nil {
			return nil, fmt.Errorf("chrome (macOS) falhou: %s", string(output))
		}
		return os.ReadFile(outputPath)
	}

	return nil, fmt.Errorf("nenhuma ferramenta de conversão HTML para PDF encontrada")
}

func renderTemplate(html string, data map[string]string) string {
	rendered := html
	for key, value := range data {
		rendered = strings.ReplaceAll(rendered, "{{"+key+"}}", value)
	}
	return rendered
}

func (h *ContractHandler) getContractData(ctx context.Context, tenantID uuid.UUID, contractID string) (map[string]string, error) {
	var title string
	var description, counterpartyName *string
	var status string
	var startDate, endDate *time.Time
	var valueAmount *float64
	var currency *string
	var ownerName *string
	err := h.db.Conn.QueryRow(`
		SELECT c.title, c.description, c.counterparty_name, c.status, c.start_date, c.end_date, c.value_amount, c.currency, u.full_name
		FROM contracts c
		LEFT JOIN users u ON c.owner_id = u.id
		WHERE c.id = $1 AND c.tenant_id = $2`, contractID, tenantID).Scan(&title, &description, &counterpartyName, &status, &startDate, &endDate, &valueAmount, &currency, &ownerName)
	if err != nil {
		return nil, err
	}

	data := map[string]string{
		"title":             title,
		"description":       safeString(description),
		"counterparty_name": safeString(counterpartyName),
		"status":            status,
		"start_date":        formatDateValue(startDate),
		"end_date":          formatDateValue(endDate),
		"value_amount":      formatFloatValue(valueAmount),
		"currency":          safeString(currency),
		"owner_name":        safeString(ownerName),
	}
	return data, nil
}

func (h *ContractHandler) fetchDocumentBytes(ctx context.Context, tenantID uuid.UUID, documentID uuid.UUID) ([]byte, error) {
	var minioKey string
	var isEncrypted bool
	err := h.db.Conn.QueryRow(`
		SELECT minio_key, is_encrypted
		FROM documents
		WHERE id = $1 AND tenant_id = $2`, documentID, tenantID).Scan(&minioKey, &isEncrypted)
	if err != nil {
		return nil, err
	}

	reader, err := h.storage.GetEncrypted(ctx, minioKey)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	payload, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if !isEncrypted {
		return payload, nil
	}

	if len(payload) < 4 {
		return payload, nil
	}
	dekLen := binary.BigEndian.Uint32(payload[:4])
	if len(payload) < int(4+dekLen) {
		return payload, nil
	}
	encryptedDEK := string(payload[4 : 4+dekLen])
	encryptedFile := payload[4+dekLen:]
	dek, err := h.vault.DecryptData(ctx, tenantID.String(), encryptedDEK)
	if err != nil {
		return nil, err
	}
	return h.security.DecryptAES(encryptedFile, dek)
}

func (h *ContractHandler) resolveApprovers(ctx context.Context, tenantID uuid.UUID, approverUserID *int, approverRole *string, sectorID *uuid.UUID) ([]int, error) {
	if approverUserID != nil {
		return []int{*approverUserID}, nil
	}
	if approverRole == nil {
		return []int{}, nil
	}
	role := strings.ToUpper(strings.TrimSpace(*approverRole))
	if role == "GESTOR" && sectorID != nil {
		rows, err := h.db.Conn.Query(`
			SELECT user_id FROM user_sectors WHERE sector_id = $1 AND permission_type = 'GESTOR'`, sectorID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var ids []int
		for rows.Next() {
			var id int
			if err := rows.Scan(&id); err == nil {
				ids = append(ids, id)
			}
		}
		return ids, nil
	}

	rows, err := h.db.Conn.Query(`
		SELECT u.id FROM users u
		JOIN roles r ON u.role_id = r.id
		WHERE u.tenant_id = $1 AND UPPER(r.name) = $2`, tenantID, role)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func (h *ContractHandler) getStepInfo(ctx context.Context, stepID uuid.UUID) (int, bool, error) {
	var stepOrder int
	var isParallel bool
	err := h.db.Conn.QueryRow(`SELECT step_order, is_parallel FROM contract_workflow_steps WHERE id = $1`, stepID).Scan(&stepOrder, &isParallel)
	return stepOrder, isParallel, err
}

func (h *ContractHandler) notifyContractOwner(ctx context.Context, tenantID uuid.UUID, contractID string, title string, message string, link string) {
	var ownerID *int
	_ = h.db.Conn.QueryRow(`SELECT owner_id FROM contracts WHERE id = $1 AND tenant_id = $2`, contractID, tenantID).Scan(&ownerID)
	if ownerID == nil {
		return
	}
	_, _ = h.db.Conn.Exec(`INSERT INTO notifications (tenant_id, user_id, title, message, link) VALUES ($1, $2, $3, $4, $5)`, tenantID, *ownerID, title, message, link)
}

func (h *ContractHandler) hasContractAccess(ctx context.Context, tenantID uuid.UUID, userID int, isMaster bool, contractID string) (bool, error) {
	if isMaster {
		return true, nil
	}
	var sectorID *uuid.UUID
	var ownerID *int
	err := h.db.Conn.QueryRow(`SELECT sector_id, owner_id FROM contracts WHERE id = $1 AND tenant_id = $2`, contractID, tenantID).Scan(&sectorID, &ownerID)
	if err != nil {
		return false, err
	}
	if ownerID != nil && *ownerID == userID {
		return true, nil
	}
	if sectorID != nil {
		var exists bool
		err = h.db.Conn.QueryRow(`SELECT EXISTS(SELECT 1 FROM user_sectors WHERE user_id = $1 AND sector_id = $2)`, userID, sectorID).Scan(&exists)
		return exists, err
	}
	return false, nil
}

func safeString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func formatDateValue(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.Format("2006-01-02")
}

func formatFloatValue(value *float64) string {
	if value == nil {
		return ""
	}
	return fmt.Sprintf("%.2f", *value)
}

func formatDateCSV(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.Format("2006-01-02")
}

func formatFloatCSV(value *float64) string {
	if value == nil {
		return ""
	}
	return fmt.Sprintf("%.2f", *value)
}

func formatStringCSV(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func formatBoolCSV(value *bool) string {
	if value == nil {
		return ""
	}
	if *value {
		return "true"
	}
	return "false"
}

func formatIntCSV(value *int) string {
	if value == nil {
		return ""
	}
	return strconv.Itoa(*value)
}
