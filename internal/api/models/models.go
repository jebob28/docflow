package models

import (
	"time"

	"github.com/google/uuid"
)

type Tenant struct {
	ID                          uuid.UUID `json:"id"`
	Name                        string    `json:"name"`
	Slug                        string    `json:"slug"`
	Document                    string    `json:"document"`
	StorageLimitGB              int       `json:"storage_limit_gb"`
	ContractValue               float64   `json:"contract_value"`
	PlanType                    string    `json:"plan_type"`
	DataProtectionOfficerName   string    `json:"dpo_name"`
	DataProtectionOfficerEmail  string    `json:"dpo_email"`
	PrivacyPolicyAccepted       bool      `json:"privacy_policy_accepted"`
	PrivacyPolicyAcceptedAt     *time.Time `json:"privacy_policy_accepted_at"`
	Active                      bool      `json:"active"`
	CreatedAt                   time.Time `json:"created_at"`
	UpdatedAt                   time.Time `json:"updated_at"`
}

type User struct {
	ID           int       `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	IsMaster     bool      `json:"is_master"`
	Active       bool      `json:"active"`
	TenantID     uuid.UUID `json:"tenant_id"`
	RoleID       int       `json:"role_id"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type RegisterTenantRequest struct {
	TenantName     string  `json:"tenant_name"`
	Slug           string  `json:"slug"`
	Document       string  `json:"document"`
	PlanType       string  `json:"plan_type"`
	StorageLimitGB int     `json:"storage_limit_gb"`
	ContractValue  float64 `json:"contract_value"`
	
	MasterUsername string `json:"master_username"`
	MasterEmail    string `json:"master_email"`
	MasterPassword string `json:"master_password"`
}
