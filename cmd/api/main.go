package main

import (
	"fmt"

	"github.com/kliuchnikovv/genie-api/internal/server"
)

func main() {
	srv := server.New()

	fmt.Println("Server is listening on port 8080")
	srv.ListenAndServe()
}