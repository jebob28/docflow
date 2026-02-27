DB_URL=postgres://postgres:postgres@localhost:5432/gestao_documentos?sslmode=disable

run:
	go run cmd/api/main.go

migrate-create:
	@read -p "Enter migration name: " name; \
	migrate create -ext sql -dir migrations -seq $$name

migrate-up:
	migrate -path migrations -database "${DB_URL}" up

migrate-down:
	migrate -path migrations -database "${DB_URL}" down

.PHONY: run migrate-create migrate-up migrate-down
