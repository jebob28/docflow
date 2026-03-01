package main

import (
	"context"
	"log"
	"time"

	"gestao_documentos/internal/config"
	"gestao_documentos/internal/database"
	"gestao_documentos/internal/service"
)

func main() {
	// Carrega configurações
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Erro ao carregar configurações: %v", err)
	}

	// Banco de Dados
	db, err := database.NewDB(cfg.GetDBConnString())
	if err != nil {
		log.Fatalf("Erro ao conectar ao banco de dados: %v", err)
	}
	defer db.Close()

	// Inicializa Serviços Necessários para o Worker
	securityService := service.NewSecurityService()
	vaultService, err := service.NewVaultService()
	if err != nil {
		log.Fatalf("Erro ao inicializar Vault: %v", err)
	}

	storageService, err := service.NewStorageService()
	if err != nil {
		log.Fatalf("Erro ao inicializar MinIO: %v", err)
	}

	openSearchService := service.NewOpenSearchService()
	ocrService := service.NewOCRService()

	// Worker
	worker := service.NewWorkerService(db, storageService, openSearchService, ocrService, vaultService, securityService)

	log.Println("Iniciando processamento manual de OCR...")
	
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	worker.ProcessPendingDocuments(ctx)
	
	log.Println("Processamento concluído.")
}
