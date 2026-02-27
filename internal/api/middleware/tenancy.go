package middleware

import (
	"context"
	"net/http"

	"github.com/google/uuid"
)

type contextKey string

const TenantIDKey contextKey = "tenant_id"
const UserIDKey contextKey = "user_id"
const RoleKey contextKey = "user_role"

// TenancyMiddleware extrai o TenantID do Token JWT (AuthMiddleware deve rodar antes)
func TenancyMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Tenta pegar das claims do JWT primeiro
		if claims, ok := GetClaims(r.Context()); ok {
			ctx := context.WithValue(r.Context(), TenantIDKey, claims.TenantID)
			ctx = context.WithValue(ctx, UserIDKey, claims.UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		// Fallback para header (útil para desenvolvimento ou APIs específicas)
		tenantIDStr := r.Header.Get("X-Tenant-ID")
		if tenantIDStr == "" {
			http.Error(w, "Tenant ID ausente (Token ou Header)", http.StatusUnauthorized)
			return
		}

		tenantID, err := uuid.Parse(tenantIDStr)
		if err != nil {
			http.Error(w, "Tenant ID inválido", http.StatusBadRequest)
			return
		}

		ctx := context.WithValue(r.Context(), TenantIDKey, tenantID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetTenantID recupera o tenant_id do contexto de forma segura
func GetTenantID(ctx context.Context) (uuid.UUID, bool) {
	tenantID, ok := ctx.Value(TenantIDKey).(uuid.UUID)
	return tenantID, ok
}
