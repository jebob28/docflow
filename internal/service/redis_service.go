package service

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisService struct {
	client *redis.Client
}

func NewRedisService() (*RedisService, error) {
	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = "redis:6379"
	}

	client := redis.NewClient(&redis.Options{
		Addr: addr,
	})

	// Testa a conexão
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("erro ao conectar ao redis: %v", err)
	}

	return &RedisService{client: client}, nil
}

// CheckQuota verifica se o tenant ainda tem espaço em disco (usando Redis como cache rápido)
func (s *RedisService) CheckQuota(ctx context.Context, tenantID string, uploadSize int64, maxStorage int64) (bool, error) {
	key := fmt.Sprintf("quota:%s", tenantID)

	// Busca o uso atual
	used, err := s.client.Get(ctx, key).Int64()
	if err == redis.Nil {
		// Se não estiver no cache, no futuro buscaremos do DB e popularemos
		used = 0
	} else if err != nil {
		return false, err
	}

	if used+uploadSize > maxStorage {
		return false, nil
	}

	return true, nil
}

// UpdateQuotaCache atualiza o cache de uso de disco após um upload bem-sucedido
func (s *RedisService) UpdateQuotaCache(ctx context.Context, tenantID string, sizeChange int64) error {
	key := fmt.Sprintf("quota:%s", tenantID)
	return s.client.IncrBy(ctx, key, sizeChange).Err()
}

// BlacklistToken adiciona um token à lista negra até que expire
func (s *RedisService) BlacklistToken(ctx context.Context, tokenID string, expiration time.Duration) error {
	key := fmt.Sprintf("blacklist:%s", tokenID)
	return s.client.Set(ctx, key, "revoked", expiration).Err()
}

// IsTokenBlacklisted verifica se um token foi revogado
func (s *RedisService) IsTokenBlacklisted(ctx context.Context, tokenID string) (bool, error) {
	key := fmt.Sprintf("blacklist:%s", tokenID)
	val, err := s.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return val == "revoked", nil
}
