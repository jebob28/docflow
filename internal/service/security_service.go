package service

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type SecurityService struct {
	jwtSecret        []byte
	virusTotalAPIKey string
}

func NewSecurityService() *SecurityService {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "segredo-padrao-mudar-em-producao"
	}

	vtKey := os.Getenv("API_KEY_VIRUSTOTAL")

	return &SecurityService{
		jwtSecret:        []byte(secret),
		virusTotalAPIKey: vtKey,
	}
}

// GenerateRandomKey gera uma chave aleatória de 32 bytes (AES-256)
func (s *SecurityService) GenerateRandomKey() ([]byte, error) {
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, err
	}
	return key, nil
}

// EncryptAES criptografa dados usando AES-GCM
func (s *SecurityService) EncryptAES(plaintext []byte, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// DecryptAES descriptografa dados usando AES-GCM
func (s *SecurityService) DecryptAES(ciphertext []byte, key []byte) ([]byte, error) {
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
	return gcm.Open(nil, nonce, actualCiphertext, nil)
}

// HashPassword criptografa a senha
func (s *SecurityService) HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

// CheckPasswordHash verifica se a senha bate
func (s *SecurityService) CheckPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func (s *SecurityService) ValidatePasswordStrength(password string) error {
	if len(password) < 12 {
		return fmt.Errorf("senha deve ter pelo menos 12 caracteres")
	}
	var hasUpper, hasLower, hasDigit, hasSpecial bool
	for _, char := range password {
		switch {
		case unicode.IsUpper(char):
			hasUpper = true
		case unicode.IsLower(char):
			hasLower = true
		case unicode.IsDigit(char):
			hasDigit = true
		case unicode.IsPunct(char) || unicode.IsSymbol(char):
			hasSpecial = true
		}
	}

	if !hasUpper || !hasLower || !hasDigit || !hasSpecial {
		return fmt.Errorf("senha deve conter letras maiúsculas, minúsculas, números e caracteres especiais")
	}
	return nil
}

// VirusTotalResponse representa a resposta simplificada da API v3 do VirusTotal
type VirusTotalResponse struct {
	Data struct {
		Attributes struct {
			LastAnalysisStats struct {
				Malicious  int `json:"malicious"`
				Suspicious int `json:"suspicious"`
				Harmless   int `json:"harmless"`
				Undetected int `json:"undetected"`
			} `json:"last_analysis_stats"`
		} `json:"attributes"`
	} `json:"data"`
}

// ScanFileHash verifica se o hash do arquivo já é conhecido pelo VirusTotal
// Retorna isSafe (true se não houver detecções maliciosas) e um erro se houver falha na API
func (s *SecurityService) ScanFileHash(fileBytes []byte) (bool, string, error) {
	if s.virusTotalAPIKey == "" {
		log.Println("Aviso: VIRUSTOTAL_API_KEY não configurada. Ignorando scan.")
		return true, "SKIPPED_NO_KEY", nil
	}

	// 1. Calcular hash SHA-256
	hash := sha256.Sum256(fileBytes)
	hashStr := hex.EncodeToString(hash[:])

	// 2. Consultar VirusTotal por hash (API v3)
	url := fmt.Sprintf("https://www.virustotal.com/api/v3/files/%s", hashStr)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("x-apikey", s.virusTotalAPIKey)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return true, "ERROR_VT_API", err // Falha na API não bloqueia o sistema
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		// Hash não encontrado = Arquivo novo ou nunca escaneado
		return true, "NOT_FOUND_IN_VT", nil
	}

	if resp.StatusCode != http.StatusOK {
		return true, "VT_API_ERROR_CODE", fmt.Errorf("VirusTotal API retornou status %d", resp.StatusCode)
	}

	var vtResp VirusTotalResponse
	if err := json.NewDecoder(resp.Body).Decode(&vtResp); err != nil {
		return true, "VT_DECODE_ERROR", err
	}

	// 3. Analisar resultados
	malicious := vtResp.Data.Attributes.LastAnalysisStats.Malicious
	suspicious := vtResp.Data.Attributes.LastAnalysisStats.Suspicious

	if malicious > 0 {
		return false, fmt.Sprintf("MALICIOUS(%d)", malicious), nil
	}

	if suspicious > 5 {
		// Limite arbitrário de suspeitos
		return false, fmt.Sprintf("SUSPICIOUS(%d)", suspicious), nil
	}

	return true, "SAFE", nil
}

// VTUploadResponse representa a resposta de upload do VirusTotal
type VTUploadResponse struct {
	Data struct {
		ID   string `json:"id"`
		Type string `json:"type"`
	} `json:"data"`
}

// VTAnalysisResponse representa a resposta de análise do VirusTotal
type VTAnalysisResponse struct {
	Data struct {
		Attributes struct {
			Status string `json:"status"` // queued, in-progress, completed
			Stats  struct {
				Malicious  int `json:"malicious"`
				Suspicious int `json:"suspicious"`
				Harmless   int `json:"harmless"`
				Undetected int `json:"undetected"`
			} `json:"stats"`
		} `json:"attributes"`
	} `json:"data"`
}

// UploadFileToVT faz o upload completo de um arquivo para o VirusTotal
// Retorna o ID da análise para consulta posterior
func (s *SecurityService) UploadFileToVT(fileBytes []byte, filename string) (string, error) {
	if s.virusTotalAPIKey == "" {
		return "", fmt.Errorf("VIRUSTOTAL_API_KEY não configurada")
	}

	// 1. Criar form-data
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return "", err
	}
	part.Write(fileBytes)
	writer.Close()

	// 2. Fazer requisição POST para v3/files
	req, _ := http.NewRequest("POST", "https://www.virustotal.com/api/v3/files", body)
	req.Header.Set("x-apikey", s.virusTotalAPIKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: 60 * time.Second} // Timeout maior para upload
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("VirusTotal upload falhou com status %d", resp.StatusCode)
	}

	var vtResp VTUploadResponse
	if err := json.NewDecoder(resp.Body).Decode(&vtResp); err != nil {
		return "", err
	}

	return vtResp.Data.ID, nil
}

// GetVTAnalysisResult consulta o status de uma análise no VirusTotal
// Retorna isSafe, status (queued, completed), e erro
func (s *SecurityService) GetVTAnalysisResult(analysisID string) (bool, string, error) {
	if s.virusTotalAPIKey == "" {
		return true, "SKIPPED", nil
	}

	url := fmt.Sprintf("https://www.virustotal.com/api/v3/analyses/%s", analysisID)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("x-apikey", s.virusTotalAPIKey)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return true, "ERROR", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return true, "ERROR", fmt.Errorf("VirusTotal analysis consulta falhou com status %d", resp.StatusCode)
	}

	var vtResp VTAnalysisResponse
	if err := json.NewDecoder(resp.Body).Decode(&vtResp); err != nil {
		return true, "ERROR", err
	}

	status := vtResp.Data.Attributes.Status
	if status != "completed" {
		return true, status, nil // Ainda em processamento
	}

	// Analisar resultados finais
	malicious := vtResp.Data.Attributes.Stats.Malicious
	suspicious := vtResp.Data.Attributes.Stats.Suspicious

	if malicious > 0 || suspicious > 5 {
		return false, "completed", nil
	}

	return true, "completed", nil
}

// GenerateToken gera um novo JWT para o usuário
func (s *SecurityService) GenerateToken(userID int, tenantID string, role string) (string, error) {
	claims := jwt.MapClaims{
		"user_id":   userID,
		"tenant_id": tenantID,
		"role":      role,
		"exp":       time.Now().Add(time.Hour * 24).Unix(), // 24 horas
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.jwtSecret)
}

// ValidateToken valida o token e retorna os claims
func (s *SecurityService) ValidateToken(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("método de assinatura inesperado: %v", token.Header["alg"])
		}
		return s.jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("token inválido")
}

func (s *SecurityService) GenerateTOTPSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf), nil
}

func (s *SecurityService) ValidateTOTP(secret, code string) bool {
	cleanCode := strings.TrimSpace(code)
	if len(cleanCode) != 6 {
		return false
	}
	for _, r := range cleanCode {
		if r < '0' || r > '9' {
			return false
		}
	}
	secret = strings.ToUpper(strings.TrimSpace(secret))
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil {
		return false
	}
	now := time.Now().Unix()
	for i := int64(-1); i <= 1; i++ {
		counter := (now / 30) + i
		if generateHOTP(key, counter) == cleanCode {
			return true
		}
	}
	return false
}

func generateHOTP(key []byte, counter int64) string {
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], uint64(counter))
	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	bin := (int(sum[offset])&0x7f)<<24 |
		(int(sum[offset+1])&0xff)<<16 |
		(int(sum[offset+2])&0xff)<<8 |
		(int(sum[offset+3]) & 0xff)
	otp := bin % 1000000
	return fmt.Sprintf("%06d", otp)
}
