package service

import (
	"context"
	"io"
	"log"
	"os"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type StorageService struct {
	client *minio.Client
	bucket string
}

func NewStorageService() (*StorageService, error) {
	endpoint := os.Getenv("MINIO_ENDPOINT")
	accessKey := os.Getenv("MINIO_ACCESS_KEY")
	secretKey := os.Getenv("MINIO_SECRET_KEY")
	bucketName := os.Getenv("MINIO_BUCKET_NAME")
	useSSL := parseEnvBool(os.Getenv("MINIO_USE_SSL"))

	// Inicializa cliente MinIO
	minioClient, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, err
	}

	// Garante que o bucket existe
	ctx := context.Background()
	exists, err := minioClient.BucketExists(ctx, bucketName)
	if err != nil {
		return nil, err
	}

	if !exists {
		// Criar bucket com Object Locking habilitado para suportar WORM (Write Once Read Many)
		err = minioClient.MakeBucket(ctx, bucketName, minio.MakeBucketOptions{
			ObjectLocking: true,
		})
		if err != nil {
			return nil, err
		}
		log.Printf("Bucket %s criado com sucesso com Object Locking habilitado", bucketName)
	}

	// Garantir que o Versionamento está habilitado (mesmo se o bucket já existir)
	// Isso permite recuperar arquivos deletados acidentalmente
	err = minioClient.SetBucketVersioning(ctx, bucketName, minio.BucketVersioningConfiguration{
		Status: "Enabled",
	})
	if err != nil {
		log.Printf("Aviso: Não foi possível habilitar versionamento no bucket %s: %v", bucketName, err)
	}

	return &StorageService{
		client: minioClient,
		bucket: bucketName,
	}, nil
}

func parseEnvBool(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

// UploadEncrypted salva um arquivo criptografado no MinIO
func (s *StorageService) UploadEncrypted(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucket, objectName, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	return err
}

// GetEncrypted busca um arquivo criptografado do MinIO
func (s *StorageService) GetEncrypted(ctx context.Context, objectName string) (io.ReadCloser, error) {
	object, err := s.client.GetObject(ctx, s.bucket, objectName, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	return object, nil
}

// Delete remove um arquivo do MinIO
func (s *StorageService) Delete(ctx context.Context, objectName string) error {
	return s.client.RemoveObject(ctx, s.bucket, objectName, minio.RemoveObjectOptions{})
}
