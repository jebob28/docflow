package service

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/hashicorp/vault/api"
)

type VaultService struct {
	client *api.Client
}

func NewVaultService() (*VaultService, error) {
	config := api.DefaultConfig()
	config.Address = os.Getenv("VAULT_ADDR")

	client, err := api.NewClient(config)
	if err != nil {
		return nil, fmt.Errorf("erro ao criar cliente vault: %v", err)
	}

	// Token de acesso (em dev estamos usando 'root')
	client.SetToken(os.Getenv("VAULT_TOKEN"))

	s := &VaultService{client: client}

	// Inicializar motor transit se necessário
	if err := s.ensureTransitEnabled(); err != nil {
		fmt.Printf("Aviso: Não foi possível verificar/habilitar motor transit: %v\n", err)
	}

	return s, nil
}

// ensureTransitEnabled garante que o motor transit está montado em 'transit/'
func (s *VaultService) ensureTransitEnabled() error {
	mounts, err := s.client.Sys().ListMounts()
	if err != nil {
		return err
	}

	if _, ok := mounts["transit/"]; !ok {
		err := s.client.Sys().Mount("transit/", &api.MountInput{
			Type: "transit",
		})
		if err != nil {
			return fmt.Errorf("erro ao montar motor transit: %v", err)
		}
		fmt.Println("Motor 'transit' habilitado com sucesso no Vault")
	}

	return nil
}

// CreateTenantKey cria uma nova chave no motor 'transit' para o tenant
func (s *VaultService) CreateTenantKey(ctx context.Context, tenantID string) error {
	keyName := fmt.Sprintf("tenant-%s", tenantID)
	path := fmt.Sprintf("transit/keys/%s", keyName)

	_, err := s.client.Logical().Write(path, map[string]interface{}{
		"type": "aes256-gcm96",
	})
	if err != nil {
		return fmt.Errorf("erro ao criar chave para o tenant no vault: %v", err)
	}

	return nil
}

// EncryptData usa o Vault Transit para criptografar dados (Recomendado para dados pequenos como chaves)
func (s *VaultService) EncryptData(ctx context.Context, tenantID string, plaintext []byte) (string, error) {
	keyName := fmt.Sprintf("tenant-%s", tenantID)
	path := fmt.Sprintf("transit/encrypt/%s", keyName)

	data := map[string]interface{}{
		"plaintext": base64.StdEncoding.EncodeToString(plaintext),
	}

	secret, err := s.client.Logical().Write(path, data)
	if err != nil {
		// Se a chave não existir, tentar criar e repetir uma vez
		if err := s.CreateTenantKey(ctx, tenantID); err == nil {
			secret, err = s.client.Logical().Write(path, data)
			if err != nil {
				return "", fmt.Errorf("erro ao criptografar dados no vault após criar chave: %v", err)
			}
		} else {
			return "", fmt.Errorf("erro ao criptografar dados no vault: %v", err)
		}
	}

	ciphertext, ok := secret.Data["ciphertext"].(string)
	if !ok {
		return "", fmt.Errorf("formato de resposta do vault inválido")
	}

	return ciphertext, nil
}

// DecryptData usa o Vault Transit para descriptografar dados
func (s *VaultService) DecryptData(ctx context.Context, tenantID string, ciphertext string) ([]byte, error) {
	keyName := fmt.Sprintf("tenant-%s", tenantID)
	path := fmt.Sprintf("transit/decrypt/%s", keyName)

	data := map[string]interface{}{
		"ciphertext": ciphertext,
	}

	secret, err := s.client.Logical().Write(path, data)
	if err != nil {
		// Se a chave não existir, o erro do Vault é 400 "encryption key not found"
		// Tentar criar a chave caso ela tenha sido deletada/perdida (ajuda a novos uploads)
		if strings.Contains(err.Error(), "encryption key not found") {
			if createErr := s.CreateTenantKey(ctx, tenantID); createErr == nil {
				// Tentar descriptografar novamente (quase sempre vai falhar com "ciphertext authentication failed"
				// se o dado foi encriptado com a chave antiga, pois a nova chave é diferente)
				secret, err = s.client.Logical().Write(path, data)
				if err != nil {
					if strings.Contains(err.Error(), "cipher: message authentication failed") {
						return nil, fmt.Errorf("erro na descriptografia Vault: a chave mestra original do tenant foi perdida e a nova chave não pode descriptografar este arquivo (os dados antigos são irrecuperáveis)")
					}
					return nil, fmt.Errorf("erro na descriptografia Vault: a chave mestra do tenant foi perdida e recriada, os dados antigos são irrecuperáveis: %v", err)
				}
				// Se por algum milagre funcionar, continuamos
			} else {
				return nil, fmt.Errorf("erro ao descriptografar dados no vault: chave mestra do tenant não encontrada e não pôde ser recriada: %v", createErr)
			}
		} else if strings.Contains(err.Error(), "cipher: message authentication failed") {
			return nil, fmt.Errorf("erro na descriptografia Vault: falha na autenticação (possível troca de chave mestra, perda de persistência do Vault ou dados corrompidos para o tenant %s)", tenantID)
		} else {
			return nil, fmt.Errorf("erro ao descriptografar dados no vault para o tenant %s: %v", tenantID, err)
		}
	}

	plaintextBase64, ok := secret.Data["plaintext"].(string)
	if !ok {
		return nil, fmt.Errorf("formato de resposta do vault inválido para o tenant %s", tenantID)
	}

	plaintext, err := base64.StdEncoding.DecodeString(plaintextBase64)
	if err != nil {
		return nil, fmt.Errorf("erro ao decodificar base64 do vault para o tenant %s: %v", tenantID, err)
	}

	return plaintext, nil
}

// SyncTenantKeys garante que todos os tenants fornecidos tenham chaves no Vault
func (s *VaultService) SyncTenantKeys(ctx context.Context, tenantIDs []string) error {
	for _, id := range tenantIDs {
		keyName := fmt.Sprintf("tenant-%s", id)
		path := fmt.Sprintf("transit/keys/%s", keyName)

		// Verificar se a chave já existe
		secret, err := s.client.Logical().Read(path)
		if err != nil || secret == nil {
			fmt.Printf("Sincronizando chave do Vault para tenant %s...\n", id)
			if err := s.CreateTenantKey(ctx, id); err != nil {
				fmt.Printf("Aviso: falha ao criar chave para tenant %s: %v\n", id, err)
			}
		}
	}
	return nil
}

// EncryptDataEnvelope usa o Vault Transit para criptografar uma chave local (DEK)
// e criptografar os dados com essa DEK usando AES-GCM localmente.
// Retorna (ciphertext, encryptedDEK, error)
func (s *VaultService) EncryptDataEnvelope(ctx context.Context, tenantID string, plaintext []byte) ([]byte, []byte, error) {
	// 1. Gerar uma DEK (Data Encryption Key) aleatória de 32 bytes (AES-256)
	dek := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, dek); err != nil {
		return nil, nil, fmt.Errorf("erro ao gerar DEK: %v", err)
	}

	// 2. Criptografar a DEK com o Vault Transit (Master Key do Tenant)
	encryptedDEKString, err := s.EncryptData(ctx, tenantID, dek)
	if err != nil {
		return nil, nil, fmt.Errorf("erro ao criptografar DEK no vault: %v", err)
	}
	encryptedDEK := []byte(encryptedDEKString)

	// 3. Criptografar os dados reais com a DEK localmente usando AES-GCM
	block, err := aes.NewCipher(dek)
	if err != nil {
		return nil, nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}

	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return ciphertext, encryptedDEK, nil
}
