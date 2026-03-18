package service

import (
	"crypto/rand"
	"encoding/base64"
	"log"
	"os"
	"strings"
	"sync"
)

var (
	runtimeJWTSecret  string
	runtimeSecretOnce sync.Once
)

func getJWTSecret() string {
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if secret != "" {
		return secret
	}

	runtimeSecretOnce.Do(func() {
		randomBytes := make([]byte, 64)
		if _, err := rand.Read(randomBytes); err != nil {
			log.Fatalf("não foi possível gerar JWT_SECRET em memória: %v", err)
		}
		runtimeJWTSecret = base64.RawURLEncoding.EncodeToString(randomBytes)
		log.Printf("AVISO: JWT_SECRET ausente; usando segredo efêmero em memória para esta execução")
	})

	return runtimeJWTSecret
}
