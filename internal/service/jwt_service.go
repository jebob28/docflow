package service

import (
	"context"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type JWTService struct {
	secretKey []byte
	issuer    string
}

type Claims struct {
	UserID   int       `json:"user_id"`
	TenantID uuid.UUID `json:"tenant_id"`
	Email    string    `json:"email"`
	IsMaster bool      `json:"is_master"`
	Role     string    `json:"role"`
	jwt.RegisteredClaims
}

func NewJWTService() *JWTService {
	return &JWTService{
		secretKey: []byte(getJWTSecret()),
		issuer:    "gestao-documentos-saas",
	}
}

func (s *JWTService) GenerateToken(userID int, tenantID uuid.UUID, email string, isMaster bool, role string) (string, error) {
	jti := uuid.New().String()
	claims := &Claims{
		UserID:   userID,
		TenantID: tenantID,
		Email:    email,
		IsMaster: isMaster,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)), // Expira em 24h
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    s.issuer,
			ID:        jti,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.secretKey)
}

func (s *JWTService) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return s.secretKey, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("token inválido")
}

// GetClaimsFromContext extrai os claims do contexto de forma segura
func GetClaimsFromContext(ctx context.Context) (*Claims, bool) {
	// Importante: use a mesma chave definida no middleware
	// Para evitar dependência circular, o middleware usa uma string "claims"
	// mas o ideal é ter um pacote compartilhado de tipos de contexto.
	// Por enquanto, vamos assumir que o valor está lá.
	claims, ok := ctx.Value("claims").(*Claims)
	return claims, ok
}
