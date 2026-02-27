package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // Driver pgx para database/sql
	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

// DB mantém a conexão com o banco de dados
type DB struct {
	Conn *sql.DB
}

// NewDB cria uma nova conexão com o banco de dados
func NewDB(connString string) (*DB, error) {
	db, err := sql.Open("pgx", connString)
	if err != nil {
		return nil, fmt.Errorf("erro ao abrir conexão com o banco de dados: %w", err)
	}

	// Configurações de pool de conexões (opcional, mas recomendado)
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(25)
	db.SetConnMaxLifetime(5 * time.Minute)

	// Tenta conectar com retry, pois o banco pode não estar pronto imediatamente
	var errPing error
	for i := 0; i < 10; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		errPing = db.PingContext(ctx)
		cancel()
		
		if errPing == nil {
			break
		}
		
		log.Printf("Tentativa %d: Aguardando banco de dados ficar pronto... (%v)", i+1, errPing)
		time.Sleep(2 * time.Second)
	}

	if errPing != nil {
		return nil, fmt.Errorf("erro ao conectar ao banco de dados após várias tentativas: %w", errPing)
	}

	log.Println("Conexão com o banco de dados estabelecida com sucesso!")
	return &DB{Conn: db}, nil
}

// Close fecha a conexão com o banco de dados
func (d *DB) Close() {
	if d.Conn != nil {
		d.Conn.Close()
	}
}

// RunMigrations executa as migrações do banco de dados
func (d *DB) RunMigrations(migrationsPath string, dbName string) error {
	driver, err := postgres.WithInstance(d.Conn, &postgres.Config{})
	if err != nil {
		return fmt.Errorf("erro ao criar driver de migração: %w", err)
	}

	m, err := migrate.NewWithDatabaseInstance(
		fmt.Sprintf("file://%s", migrationsPath),
		dbName,
		driver,
	)
	if err != nil {
		return fmt.Errorf("erro ao criar instância de migração: %w", err)
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("erro ao executar migrações up: %w", err)
	}

	log.Println("Migrações executadas com sucesso!")
	return nil
}
