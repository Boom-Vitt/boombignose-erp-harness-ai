package bundle

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgproto3"
)

func TestQueryPostgresErrorOmitsSQLAndServerSecrets(t *testing.T) {
	addr, received := postgresFailureServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := queryPostgres(ctx, addr, "boombignose", "boombignose", "select hidden-sql-token")
	if err == nil {
		t.Fatal("expected server error")
	}
	select {
	case <-received:
	default:
		t.Fatal("query never reached the server; redaction was not exercised")
	}
	if strings.Contains(err.Error(), "hidden-sql-token") || strings.Contains(err.Error(), "server-secret") {
		t.Fatal("server error leaked a SQL literal or secret")
	}
}

func TestQuoteLiteralRefusesAQuote(t *testing.T) {
	if _, err := quoteLiteral("a'b"); err == nil {
		t.Fatal("quote accepted")
	}
}

func postgresFailureServer(t *testing.T) (string, <-chan struct{}) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	received := make(chan struct{})
	go func() {
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		defer connection.Close()
		connection.SetDeadline(time.Now().Add(3 * time.Second))
		server := pgproto3.NewBackend(connection, connection)
		if _, err := server.ReceiveStartupMessage(); err != nil {
			return
		}
		server.Send(&pgproto3.AuthenticationOk{})
		server.Send(&pgproto3.ParameterStatus{Name: "client_encoding", Value: "UTF8"})
		server.Send(&pgproto3.ParameterStatus{Name: "standard_conforming_strings", Value: "on"})
		server.Send(&pgproto3.ReadyForQuery{TxStatus: 'I'})
		if server.Flush() != nil {
			return
		}
		message, err := server.Receive()
		query, ok := message.(*pgproto3.Query)
		if err != nil || !ok || !strings.Contains(query.String, "hidden-sql-token") {
			return
		}
		close(received)
		server.Send(&pgproto3.ErrorResponse{Severity: "ERROR", Code: "XX000", Message: "hidden-sql-token server-secret"})
		server.Send(&pgproto3.ReadyForQuery{TxStatus: 'I'})
		server.Flush()
	}()
	return listener.Addr().String(), received
}
