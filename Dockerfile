# Build stage
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Instala dependências do sistema necessárias para build (se houver)
RUN apk add --no-cache git

# Copia arquivos de dependências
COPY go.mod go.sum ./
RUN go mod download

# Copia o código fonte
COPY . .

# Build da aplicação
RUN CGO_ENABLED=0 GOOS=linux go build -o main cmd/api/main.go

# Final stage
FROM alpine:latest

WORKDIR /app

# Instala certificados CA para chamadas HTTPS e tzdata para fuso horário
RUN apk --no-cache add ca-certificates tzdata

# Copia o binário do estágio de build
COPY --from=builder /app/main .

# Copia as migrações para dentro da imagem
COPY --from=builder /app/migrations ./migrations

# Copia o arquivo .env (opcional, geralmente é melhor injetar via variáveis de ambiente no docker-compose)
# COPY .env .

# Exponha a porta da aplicação (ajuste conforme necessário)
EXPOSE 8080

# Comando para rodar a aplicação
CMD ["./main"]
