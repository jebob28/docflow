package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
	"io"
)

// CryptoService lida com a criptografia de arquivos antes do envio ao MinIO
type CryptoService struct{}

func NewCryptoService() *CryptoService {
	return &CryptoService{}
}

// EncryptFile criptografa os dados usando AES-256-GCM
// O segredo deve ter 32 bytes para AES-256
func (s *CryptoService) EncryptFile(plaintext []byte, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	// GCM é um modo de criptografia autenticada (AEAD) que garante integridade
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	// Nonce deve ser único para cada criptografia com a mesma chave
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	// O resultado é nonce + ciphertext
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// DecryptFile descriptografa os dados AES-256-GCM
func (s *CryptoService) DecryptFile(ciphertext []byte, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext muito curto")
	}

	nonce, actualCiphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, actualCiphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("falha ao descriptografar (chave incorreta ou dados corrompidos): %v", err)
	}

	return plaintext, nil
}
