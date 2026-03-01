package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"gestao_documentos/internal/config"
	"gestao_documentos/internal/database"
	"gestao_documentos/internal/service"
)

func main() {
	fmt.Println("Starting trash cleanup process...")

	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Error loading config: %v", err)
	}

	db, err := database.NewDB(cfg.GetDBConnString())
	if err != nil {
		log.Fatalf("Error connecting to database: %v", err)
	}
	defer db.Close()

	storage, err := service.NewStorageService()
	if err != nil {
		log.Fatalf("Error initializing storage service: %v", err)
	}

	// Define the threshold (e.g., 30 days)
	days := 30
	threshold := time.Now().AddDate(0, 0, -days)

	fmt.Printf("Cleaning up items deleted before: %v\n", threshold.Format(time.RFC3339))

	// 1. Permanent delete documents
	rows, err := db.Conn.Query(`
		SELECT id, minio_key FROM documents 
		WHERE deleted_at IS NOT NULL AND deleted_at < $1`, threshold)
	if err != nil {
		log.Fatalf("Error querying documents for cleanup: %v", err)
	}

	var deletedDocsCount int
	for rows.Next() {
		var id, minioKey string
		if e := rows.Scan(&id, &minioKey); e != nil {
			log.Printf("Error scanning document row: %v", e)
			continue
		}

		// Delete from MinIO
		if e := storage.Delete(context.Background(), minioKey); e != nil {
			log.Printf("Error deleting document %s from storage: %v", id, e)
		}

		// Delete from database
		if _, e := db.Conn.Exec("DELETE FROM documents WHERE id = $1", id); e != nil {
			log.Printf("Error deleting document %s from database: %v", id, e)
		} else {
			deletedDocsCount++
		}
	}
	rows.Close()
	fmt.Printf("Permanently deleted %d documents.\n", deletedDocsCount)

	// 2. Permanent delete folders
	// Folders don't have storage keys directly, but we might want to ensure they are empty first
	// For simplicity, we delete folders that were marked as deleted long ago.
	res, err := db.Conn.Exec(`
		DELETE FROM folders 
		WHERE deleted_at IS NOT NULL AND deleted_at < $1`, threshold)
	if err != nil {
		log.Printf("Error deleting folders from database: %v", err)
	} else {
		count, _ := res.RowsAffected()
		fmt.Printf("Permanently deleted %d folders.\n", count)
	}

	fmt.Println("Trash cleanup process finished.")
}
