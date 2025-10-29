package storage

import (
	"database/sql"
	"fmt"

	"github.com/kliuchnikovv/genie-api/internal/config"
	_ "github.com/lib/pq"
)

type Storage struct {
	DB *sql.DB
}

func New(cfg *config.Config) (*Storage, error) {
	psqlInfo := fmt.Sprintf("host=%s port=%d user=%s "+
		"password=%s dbname=%s sslmode=disable",
		cfg.Database.Host, cfg.Database.Port, cfg.Database.User, cfg.Database.Password, cfg.Database.DBName)

	db, err := sql.Open("postgres", psqlInfo)
	if err != nil {
		return nil, err
	}

	if err := db.Ping(); err != nil {
		return nil, err
	}

	return &Storage{DB: db}, nil
}
