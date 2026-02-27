package middleware

import (
	"fmt"
	"gestao_documentos/internal/database"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// NISTAuditMiddleware registra cada acesso a dados sensíveis conforme NIST SP 800-53
func NISTAuditMiddleware(db *database.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			startTime := time.Now()

			// Deixa a requisição seguir
			next.ServeHTTP(w, r)

			// Após a requisição, registramos o log de forma assíncrona para não travar o usuário
			go func() {
				claims, hasClaims := GetClaims(r.Context())
				tenantID, hasTenant := GetTenantID(r.Context())

				if !hasClaims || !hasTenant {
					return
				}

				action := fmt.Sprintf("%s %s", r.Method, r.URL.Path)
				ip := r.RemoteAddr
				userAgent := r.UserAgent()
				duration := time.Since(startTime)

				query := `
					INSERT INTO audit_logs (
						tenant_id, user_id, action, entity_name, entity_id, 
						ip_address, user_agent, severity, audit_level
					) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

				_, err := db.Conn.Exec(query,
					tenantID,
					claims.UserID,
					action,
					"API_ACCESS",
					uuid.Nil.String(), // Garantir que seja string para VARCHAR(50)
					ip,
					userAgent,
					"info",
					"tenancy",
				)

				if err != nil {
					fmt.Printf("Erro ao gravar log NIST: %v\n", err)
				}
				_ = duration // Pode ser usado para monitorar performance/DoS
			}()
		})
	}
}
