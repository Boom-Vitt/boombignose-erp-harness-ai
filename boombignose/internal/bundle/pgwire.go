package bundle

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// queryPostgres uses pgx's maintained SCRAM implementation. Connection config
// is constructed explicitly; PG* environment, service/pass files, SQL and
// connection strings are never included in returned errors.
func queryPostgres(ctx context.Context, addr, user, database, sql string) ([][]string, error) {
	return queryAuthenticated(ctx, addr, user, database, passwordFor(addr, user), sql)
}
func queryAuthenticated(ctx context.Context, addr, user, database, password, sql string) ([][]string, error) {
	cfg, err := pgx.ParseConfig("postgres://localhost/postgres?sslmode=disable")
	if err != nil {
		return nil, errors.New("postgres client configuration failed")
	}
	if strings.HasPrefix(addr, "/") {
		cfg.Host = addr
		cfg.Port = uint16(portNumber(pgPort()))
	} else {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, errors.New("invalid private database address")
		}
		cfg.Host = host
		cfg.Port = uint16(portNumber(port))
	}
	cfg.User = user
	cfg.Password = password
	cfg.Database = database
	cfg.ConnectTimeout = 5 * time.Second
	cfg.RuntimeParams = map[string]string{"application_name": "boombignose-native"}
	cfg.Fallbacks = nil
	cfg.TLSConfig = nil
	cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return nil, safePGError(err, true)
	}
	defer conn.Close(context.Background())
	rows, err := conn.Query(ctx, sql)
	if err != nil {
		return nil, safePGError(err, false)
	}
	defer rows.Close()
	var result [][]string
	for rows.Next() {
		values := rows.RawValues()
		row := make([]string, len(values))
		for i, value := range values {
			row[i] = string(value)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, safePGError(err, false)
	}
	return result, nil
}
func portNumber(port string) int { n, _ := strconv.Atoi(port); return n }
func safePGError(err error, connecting bool) error {
	var server *pgconn.PgError
	if errors.As(err, &server) {
		// Messages from SQL errors may contain literals (including credentials).
		// Keep only structural SQLSTATE information, never server-provided literals.
		switch server.Code {
		case "42P04":
			return errors.New("database already exists")
		}
		return fmt.Errorf("postgres operation failed (SQLSTATE %s)", server.Code)
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	if connecting {
		return errors.New("private postgres connection refused or authentication failed")
	}
	return errors.New("private postgres query failed")
}

func quoteLiteral(name string) (string, error) {
	if name == "" || strings.ContainsAny(name, "/\\'") {
		return "", fmt.Errorf("migration name refused")
	}
	return "'" + name + "'", nil
}
