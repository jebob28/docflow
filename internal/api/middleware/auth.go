package middleware

import (
	"context"
	"fmt"
	"gestao_documentos/internal/database"
	"gestao_documentos/internal/service"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

const ClaimsKey contextKey = "claims"

func AuthMiddleware(jwtService *service.JWTService, redisService *service.RedisService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, "Token de autorização ausente", http.StatusUnauthorized)
				return
			}

			parts := strings.Split(authHeader, " ")
			if len(parts) != 2 || parts[0] != "Bearer" {
				http.Error(w, "Formato de token inválido", http.StatusUnauthorized)
				return
			}

			claims, err := jwtService.ValidateToken(parts[1])
			if err != nil {
				http.Error(w, "Token inválido ou expirado", http.StatusUnauthorized)
				return
			}

			// Verifica se o token está na lista negra (revogado)
			if redisService != nil && claims.ID != "" {
				revoked, err := redisService.IsTokenBlacklisted(r.Context(), claims.ID)
				if err != nil {
					fmt.Printf("Erro ao verificar lista negra de tokens: %v\n", err)
				} else if revoked {
					http.Error(w, "Sessão encerrada. Por favor, faça login novamente.", http.StatusUnauthorized)
					return
				}
			}

			// Adiciona as claims ao contexto
			ctx := context.WithValue(r.Context(), ClaimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RBACMiddleware verifica se o usuário tem a permissão necessária
func RBACMiddleware(db *database.DB, permission string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := GetClaims(r.Context())
			if !ok {
				http.Error(w, "Não autorizado", http.StatusUnauthorized)
				return
			}

			// Usuários MASTER têm acesso total ao seu Tenant
			if claims.IsMaster {
				next.ServeHTTP(w, r)
				return
			}

			// Verifica permissão no banco para usuários comuns
			var hasPermission bool
			query := `
				SELECT EXISTS (
					SELECT 1 FROM users u
					JOIN role_permissions rp ON u.role_id = rp.role_id
					JOIN permissions p ON rp.permission_id = p.id
					WHERE u.id = $1 AND p.name = $2
				)`

			err := db.Conn.QueryRow(query, claims.UserID, permission).Scan(&hasPermission)
			if err != nil {
				http.Error(w, "Erro ao verificar permissões", http.StatusInternalServerError)
				return
			}

			if !hasPermission {
				// Log detalhado para depuração
				fmt.Printf("RBAC: Usuário %d (Tenant: %s) tentando %s - Negado (IsMaster: %v)\n",
					claims.UserID, claims.TenantID, permission, claims.IsMaster)
				http.Error(w, fmt.Sprintf("Acesso negado: permissão %s insuficiente", permission), http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func AdminOnlyMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := GetClaims(r.Context())
			if !ok || claims.Role != "SAAS_ADMIN" {
				http.Error(w, "Não autorizado", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

type rateLimiterStore struct {
	mu          sync.Mutex
	visitors    map[string]*rate.Limiter
	lastSeen    map[string]time.Time
	limit       rate.Limit
	burst       int
	lastCleanup time.Time
}

func newRateLimiterStore(limit rate.Limit, burst int) *rateLimiterStore {
	return &rateLimiterStore{
		visitors:    make(map[string]*rate.Limiter),
		lastSeen:    make(map[string]time.Time),
		limit:       limit,
		burst:       burst,
		lastCleanup: time.Now(),
	}
}

func (s *rateLimiterStore) getLimiter(ip string) *rate.Limiter {
	s.mu.Lock()
	defer s.mu.Unlock()

	if limiter, ok := s.visitors[ip]; ok {
		s.lastSeen[ip] = time.Now()
		s.cleanupIfNeeded()
		return limiter
	}

	limiter := rate.NewLimiter(s.limit, s.burst)
	s.visitors[ip] = limiter
	s.lastSeen[ip] = time.Now()
	s.cleanupIfNeeded()
	return limiter
}

func (s *rateLimiterStore) cleanupIfNeeded() {
	if time.Since(s.lastCleanup) < 10*time.Minute {
		return
	}
	for ip, seen := range s.lastSeen {
		if time.Since(seen) > 30*time.Minute {
			delete(s.lastSeen, ip)
			delete(s.visitors, ip)
		}
	}
	s.lastCleanup = time.Now()
}

func RateLimitMiddleware(requestsPerMinute int, burst int) func(http.Handler) http.Handler {
	if requestsPerMinute <= 0 {
		return func(next http.Handler) http.Handler { return next }
	}
	limit := rate.Every(time.Minute / time.Duration(requestsPerMinute))
	store := newRateLimiterStore(limit, burst)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := r.RemoteAddr
			if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
				ip = host
			}
			limiter := store.getLimiter(ip)
			if !limiter.Allow() {
				http.Error(w, "Limite de requisições excedido", http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func GetClaims(ctx context.Context) (*service.Claims, bool) {
	claims, ok := ctx.Value(ClaimsKey).(*service.Claims)
	return claims, ok
}
