package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	DBUser     string
	DBPassword string
	DBName     string
	DBHost     string
	DBPort     string
	DBSSLMode  string
	AppEnv     string
}

func LoadConfig() (*Config, error) {
	err := godotenv.Load()
	if err != nil {
		// Se não encontrar o arquivo .env, assume que as variáveis estão no ambiente
		// Isso é útil para deploy onde o .env pode não existir
		fmt.Println("Arquivo .env não encontrado, usando variáveis de ambiente")
	}

	return &Config{
		DBUser:     getEnv("POSTGRES_USER", "postgres"),
		DBPassword: getEnv("POSTGRES_PASSWORD", "postgres"),
		DBName:     getEnv("POSTGRES_DB", "gestao_documentos"),
		DBHost:     getEnv("POSTGRES_HOST", "localhost"),
		DBPort:     getEnv("POSTGRES_PORT", "5432"),
		DBSSLMode:  getEnv("POSTGRES_SSLMODE", "disable"),
		AppEnv:     getEnv("APP_ENV", "development"),
	}, nil
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

func (c *Config) GetDBConnString() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
		c.DBUser, c.DBPassword, c.DBHost, c.DBPort, c.DBName, c.DBSSLMode)
}
