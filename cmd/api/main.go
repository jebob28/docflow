package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"gestao_documentos/internal/api/handlers"
	apiMiddleware "gestao_documentos/internal/api/middleware"
	"gestao_documentos/internal/config"
	"gestao_documentos/internal/database"
	"gestao_documentos/internal/service"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func main() {
	// Carrega configurações
	cfg, errCfg := config.LoadConfig()
	if errCfg != nil {
		log.Fatalf("Erro ao carregar configurações: %v", errCfg)
	}
	isProduction := strings.EqualFold(cfg.AppEnv, "production")
	if isProduction {
		if strings.TrimSpace(os.Getenv("JWT_SECRET")) == "" {
			log.Fatal("JWT_SECRET obrigatório em produção")
		}
		if strings.EqualFold(cfg.DBSSLMode, "disable") || strings.TrimSpace(cfg.DBSSLMode) == "" {
			log.Println("AVISO: POSTGRES_SSLMODE está desabilitado em produção. Certifique-se de que isso é intencional.")
		}
		// Apenas aviso se SSL do Minio não estiver habilitado, para facilitar testes
		if !parseEnvBool(os.Getenv("MINIO_USE_SSL")) {
			log.Println("AVISO: MINIO_USE_SSL não está habilitado em produção. Certifique-se de que isso é intencional.")
		}
	}

	// Cria conexão com o banco de dados
	dbConnString := cfg.GetDBConnString()

	db, err := database.NewDB(dbConnString)
	if err != nil {
		log.Fatalf("Erro ao conectar ao banco de dados: %v", err)
	}
	defer db.Close()

	// Executa migrações
	if err = db.RunMigrations("migrations", cfg.DBName); err != nil {
		log.Fatalf("Erro ao executar migrações: %v", err)
	}

	// Inicializa Serviços
	securityService := service.NewSecurityService()
	vaultService, errV := service.NewVaultService()
	if errV != nil {
		log.Printf("Aviso: Vault não disponível: %v", errV)
	}

	jwtService := service.NewJWTService()

	storageService, errS := service.NewStorageService()
	if errS != nil {
		log.Fatalf("Erro ao inicializar MinIO: %v", errS)
	}

	redisService, errR := service.NewRedisService()
	if errR != nil {
		log.Fatalf("Erro ao inicializar Redis: %v", errR)
	}

	openSearchService := service.NewOpenSearchService()

	// Inicializa Worker de OCR
	ocrService := service.NewOCRService()
	workerService := service.NewWorkerService(db, storageService, openSearchService, ocrService, vaultService, securityService)
	go workerService.Start(context.Background())

	// Configura o Roteador
	r := chi.NewRouter()

	// CORS
	allowedOriginsEnv := os.Getenv("CORS_ALLOWED_ORIGINS")
	allowedOrigins := parseCSV(allowedOriginsEnv)
	if len(allowedOrigins) == 0 {
		allowedOrigins = []string{"http://localhost:5173", "http://localhost:5174", "http://localhost:4173"}
	}
	if isProduction && strings.TrimSpace(allowedOriginsEnv) == "" {
		log.Fatal("CORS_ALLOWED_ORIGINS obrigatório em produção")
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-Tenant-ID", "X-Confidential-Password"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Middlewares básicos
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)       // Segurança: Captura o IP real
	r.Use(middleware.StripSlashes) // Trata barras no final das URLs

	// --- NIST Security Headers ---
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("X-XSS-Protection", "1; mode=block")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
			if isProduction {
				w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; script-src 'none'; object-src 'none';")
			next.ServeHTTP(w, r)
		})
	})

	// Handlers
	tenantHandler := handlers.NewTenantHandler(db, securityService, vaultService, jwtService, redisService)
	documentHandler := handlers.NewDocumentHandler(db, storageService, vaultService, redisService, securityService, openSearchService)
	adminHandler := handlers.NewAdminHandler(db, securityService, jwtService)
	sectorHandler := handlers.NewSectorHandler(db)
	userHandler := handlers.NewUserHandler(db, securityService)
	documentTypeHandler := handlers.NewDocumentTypeHandler(db, storageService)

	// Rotas da API v1
	r.Route("/api/v1", func(r chi.Router) {
		// Rotas Públicas
		r.Group(func(r chi.Router) {
			r.Use(apiMiddleware.RateLimitMiddleware(10, 20))
			r.Post("/register", tenantHandler.RegisterTenant)
		})
		r.Group(func(r chi.Router) {
			r.Use(apiMiddleware.RateLimitMiddleware(5, 10))
			r.Post("/login", tenantHandler.Login)
			r.Post("/admin/login", adminHandler.Login)
		})

		// Painel Admin SaaS (Protegido)
		r.Group(func(r chi.Router) {
			r.Use(apiMiddleware.AuthMiddleware(jwtService, redisService))
			r.Use(apiMiddleware.AdminOnlyMiddleware())

			r.Route("/admin", func(r chi.Router) {
				r.Get("/tenants", adminHandler.ListTenants)
				r.Post("/tenants", adminHandler.CreateTenant)
				r.Put("/tenants/{id}", adminHandler.UpdateTenant)
				r.Patch("/tenants/{id}/status", adminHandler.UpdateTenantStatus)
				r.Patch("/tenants/{id}/quota", adminHandler.UpdateTenantQuota)
				r.Delete("/tenants/{id}", adminHandler.DeleteTenant)

				r.Get("/users", adminHandler.ListUsers)
				r.Post("/users", adminHandler.CreateUser)
				r.Put("/users/{id}", adminHandler.UpdateUser)
				r.Patch("/users/{id}/status", adminHandler.UpdateUserStatus)
				r.Patch("/users/{id}/password", adminHandler.UpdateUserPassword)
				r.Delete("/users/{id}", adminHandler.DeleteUser)

				r.Get("/dashboard/stats", adminHandler.GetDashboardStats)
				r.Get("/audit", adminHandler.GlobalAuditLogs)

				r.Route("/crm", func(r chi.Router) {
					r.Get("/stats", adminHandler.GetCRMStats)
					r.Get("/leads", adminHandler.ListLeads)
					r.Post("/leads", adminHandler.CreateLead)
					r.Put("/leads/{id}", adminHandler.UpdateLead)
					r.Delete("/leads/{id}", adminHandler.DeleteLead)
				})
			})
		})

		// Visualização Pública de Documentos
		r.Group(func(r chi.Router) {
			r.Use(apiMiddleware.RateLimitMiddleware(120, 240))
			r.Get("/public/view/{token}", documentHandler.PublicView)
		})

		// Rotas Protegidas de Tenant
		r.Group(func(r chi.Router) {
			r.Use(apiMiddleware.AuthMiddleware(jwtService, redisService))
			r.Use(apiMiddleware.TenancyMiddleware)
			r.Use(apiMiddleware.NISTAuditMiddleware(db))

			r.Post("/logout", tenantHandler.Logout)
			r.Post("/reset-password", tenantHandler.ResetPassword)
			r.Post("/mfa/setup", tenantHandler.SetupMFA)
			r.Post("/mfa/verify", tenantHandler.VerifyMFA)
			r.Post("/mfa/disable", tenantHandler.DisableMFA)

			// Personalização e Perfil
			r.Get("/customization", apiMiddleware.RBACMiddleware(db, "VIEW_SYSTEM")(http.HandlerFunc(tenantHandler.GetCustomization)).ServeHTTP)
			r.Put("/customization", apiMiddleware.RBACMiddleware(db, "MANAGE_SYSTEM")(http.HandlerFunc(tenantHandler.UpdateCustomization)).ServeHTTP)
			r.Get("/profile", tenantHandler.GetUserProfile)
			r.Put("/profile", tenantHandler.UpdateUserProfile)
			r.Get("/account", apiMiddleware.RBACMiddleware(db, "VIEW_SYSTEM")(http.HandlerFunc(tenantHandler.GetAccountSettings)).ServeHTTP)
			r.Put("/account", apiMiddleware.RBACMiddleware(db, "MANAGE_SYSTEM")(http.HandlerFunc(tenantHandler.UpdateAccountSettings)).ServeHTTP)
			r.Get("/team", tenantHandler.GetTeam)

			r.Route("/documents", func(r chi.Router) {
				r.Post("/upload", apiMiddleware.RBACMiddleware(db, "WRITE")(http.HandlerFunc(documentHandler.Upload)).ServeHTTP)
				r.Get("/", documentHandler.List)
				r.Get("/dashboard", documentHandler.GetDashboardData)
				r.Get("/alerts/contracts", documentHandler.ListContractAlerts)
				r.Get("/trash", documentHandler.ListTrash)
				r.Delete("/trash/empty", apiMiddleware.RBACMiddleware(db, "DELETE")(http.HandlerFunc(documentHandler.EmptyTrash)).ServeHTTP)
				r.Post("/trash/{id}/restore", documentHandler.Restore)
				r.Delete("/trash/{id}", apiMiddleware.RBACMiddleware(db, "DELETE")(http.HandlerFunc(documentHandler.PermanentDelete)).ServeHTTP)
				r.Get("/search", documentHandler.Search)
				r.Get("/{id}/details", documentHandler.GetDocument)
				r.Get("/{id}", documentHandler.Download)
				r.Get("/download/{id}", documentHandler.Download)
				r.Post("/{id}/ocr", apiMiddleware.RBACMiddleware(db, "WRITE")(http.HandlerFunc(documentHandler.UpdateOCR)).ServeHTTP)
				r.Patch("/{id}/rename", apiMiddleware.RBACMiddleware(db, "WRITE")(http.HandlerFunc(documentHandler.Rename)).ServeHTTP)
				r.Delete("/{id}", apiMiddleware.RBACMiddleware(db, "DELETE")(http.HandlerFunc(documentHandler.Delete)).ServeHTTP)
				r.Patch("/{id}/status", apiMiddleware.RBACMiddleware(db, "WRITE")(http.HandlerFunc(documentHandler.UpdateStatus)).ServeHTTP)

				// Versionamento
				r.Post("/{id}/versions", apiMiddleware.RBACMiddleware(db, "WRITE")(http.HandlerFunc(documentHandler.UploadNewVersion)).ServeHTTP)
				r.Get("/{id}/versions", documentHandler.ListVersions)
				r.Post("/{id}/restore", apiMiddleware.RBACMiddleware(db, "WRITE")(http.HandlerFunc(documentHandler.RestoreVersion)).ServeHTTP)

				r.Get("/{id}/annotations", documentHandler.ListAnnotations)
				r.Post("/{id}/annotations", documentHandler.CreateAnnotation)
				r.Put("/annotations/{annotationId}", documentHandler.UpdateAnnotation)
				r.Delete("/annotations/{annotationId}", documentHandler.DeleteAnnotation)

				// Rotas para Etiquetas (Tags)
				r.Get("/tags", documentHandler.ListTags)
				r.Post("/tags", documentHandler.CreateTag)
				r.Post("/{id}/tags", documentHandler.AssignTag)
				r.Delete("/{id}/tags/{tagId}", documentHandler.UnassignTag)

				r.Post("/{id}/share-link", apiMiddleware.RBACMiddleware(db, "SHARE")(http.HandlerFunc(documentHandler.CreateShareLink)).ServeHTTP)
			})

			r.Post("/documents/{id}/share", apiMiddleware.RBACMiddleware(db, "SHARE")(http.HandlerFunc(documentHandler.Share)).ServeHTTP)
			r.Get("/documents/{id}/shares", documentHandler.GetShares)
			r.Patch("/shares/{shareId}", apiMiddleware.RBACMiddleware(db, "SHARE")(http.HandlerFunc(documentHandler.UpdateSharePermission)).ServeHTTP)
			r.Delete("/shares/{shareId}", apiMiddleware.RBACMiddleware(db, "SHARE")(http.HandlerFunc(documentHandler.RevokeShare)).ServeHTTP)
			r.Get("/documents/shared/with-me", documentHandler.ListSharedWithMe)
			r.Get("/documents/shared/by-me", documentHandler.ListSharedByMe)

			r.Post("/folders", apiMiddleware.RBACMiddleware(db, "WRITE")(http.HandlerFunc(documentHandler.CreateFolder)).ServeHTTP)
			r.Patch("/folders/{id}/rename", apiMiddleware.RBACMiddleware(db, "WRITE")(http.HandlerFunc(documentHandler.RenameFolder)).ServeHTTP)
			r.Delete("/folders/{id}", apiMiddleware.RBACMiddleware(db, "DELETE")(http.HandlerFunc(documentHandler.DeleteFolder)).ServeHTTP)
			r.Post("/folders/{id}/tags", documentHandler.AssignTag)
			r.Delete("/folders/{id}/tags/{tagId}", documentHandler.UnassignTag)

			r.Route("/document-types", func(r chi.Router) {
				r.Get("/", documentTypeHandler.List)
				r.Post("/", apiMiddleware.RBACMiddleware(db, "MANAGE_DOCUMENT_TYPES")(http.HandlerFunc(documentTypeHandler.Create)).ServeHTTP)
				r.Put("/{id}", apiMiddleware.RBACMiddleware(db, "MANAGE_DOCUMENT_TYPES")(http.HandlerFunc(documentTypeHandler.Update)).ServeHTTP)
				r.Delete("/{id}", apiMiddleware.RBACMiddleware(db, "MANAGE_DOCUMENT_TYPES")(http.HandlerFunc(documentTypeHandler.Delete)).ServeHTTP)
				r.Post("/retention-worker", apiMiddleware.AdminOnlyMiddleware()(http.HandlerFunc(documentTypeHandler.RunRetentionWorker)).ServeHTTP)
			})

			r.Get("/sectors", sectorHandler.List)
			r.Post("/sectors", apiMiddleware.RBACMiddleware(db, "MANAGE_SECTORS")(http.HandlerFunc(sectorHandler.Create)).ServeHTTP)
			r.Put("/sectors/{id}", apiMiddleware.RBACMiddleware(db, "MANAGE_SECTORS")(http.HandlerFunc(sectorHandler.Update)).ServeHTTP)
			r.Delete("/sectors/{id}", apiMiddleware.RBACMiddleware(db, "MANAGE_SECTORS")(http.HandlerFunc(sectorHandler.Delete)).ServeHTTP)

			r.Route("/users", func(r chi.Router) {
				r.Get("/", userHandler.List)
				r.Post("/", apiMiddleware.RBACMiddleware(db, "MANAGE_USERS")(http.HandlerFunc(userHandler.Create)).ServeHTTP)
				r.Put("/{id}", apiMiddleware.RBACMiddleware(db, "MANAGE_USERS")(http.HandlerFunc(userHandler.Update)).ServeHTTP)
				r.Patch("/{id}/status", apiMiddleware.RBACMiddleware(db, "MANAGE_USERS")(http.HandlerFunc(userHandler.UpdateStatus)).ServeHTTP)
				r.Patch("/{id}/password", apiMiddleware.RBACMiddleware(db, "MANAGE_USERS")(http.HandlerFunc(userHandler.UpdatePassword)).ServeHTTP)
				r.Delete("/{id}", apiMiddleware.RBACMiddleware(db, "MANAGE_USERS")(http.HandlerFunc(userHandler.Delete)).ServeHTTP)
			})
		})
	})

	// Iniciar worker de limpeza em background
	go func() {
		ticker := time.NewTicker(30 * time.Minute)
		for range ticker.C {
			log.Println("Executando limpeza de links expirados...")
			_, e := db.Conn.Exec("UPDATE document_links SET active = FALSE WHERE expires_at < NOW() AND active = TRUE")
			if e != nil {
				log.Printf("Erro ao limpar links: %v", e)
			}
		}
	}()

	// Iniciar worker de retenção automática (Expurgo) em background - Diário
	go func() {
		// Esperar um pouco antes da primeira execução para não sobrecarregar o startup
		time.Sleep(1 * time.Minute)

		// Executar imediatamente no startup (após o sleep)
		log.Println("Executando processamento inicial de retenção e expurgo...")
		count, err := documentTypeHandler.ExecuteRetention(context.Background())
		if err != nil {
			log.Printf("Erro no worker de retenção: %v", err)
		} else {
			log.Printf("Worker de retenção concluído. Arquivos removidos: %d", count)
		}

		ticker := time.NewTicker(24 * time.Hour)
		for range ticker.C {
			log.Println("Executando processamento diário de retenção e expurgo...")
			count, err := documentTypeHandler.ExecuteRetention(context.Background())
			if err != nil {
				log.Printf("Erro no worker de retenção: %v", err)
			} else {
				log.Printf("Worker de retenção concluído. Arquivos removidos: %d", count)
			}
		}
	}()

	// Inicia o Servidor
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}
	addr := ":" + port

	certFile := os.Getenv("SSL_CERT_FILE")
	keyFile := os.Getenv("SSL_KEY_FILE")

	if certFile != "" && keyFile != "" {
		fmt.Printf("Servidor iniciado em https://localhost:%s (MODO PRODUÇÃO/SSL)\n", port)
		if err := http.ListenAndServeTLS(addr, certFile, keyFile, r); err != nil {
			log.Fatalf("Erro ao iniciar servidor HTTPS: %v", err)
		}
	} else {
		fmt.Printf("Servidor iniciado em http://localhost:%s (MODO DESENVOLVIMENTO)\n", port)
		if err := http.ListenAndServe(addr, r); err != nil {
			log.Fatalf("Erro ao iniciar servidor HTTP: %v", err)
		}
	}
}

func parseEnvBool(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

func parseCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	raw := strings.Split(value, ",")
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		trimmed := strings.TrimSpace(item)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
