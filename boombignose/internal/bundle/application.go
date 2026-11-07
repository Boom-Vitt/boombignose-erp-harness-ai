package bundle

import (
	"context"
	"errors"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ApplicationSettings is server configuration, not a browser/model response.
// AnonKey is the public auth key; signing/admin/service-role secrets are absent.
type ApplicationSettings struct {
	AuthOrigin      string
	AnonKey         string
	ERPOrigin       string
	PublicOrigin    string
	OperatorUserIDs []string
}

func ReadApplicationSettings(dataDir string) (ApplicationSettings, error) {
	if err := privateDirectory(dataDir); err != nil {
		return ApplicationSettings{}, err
	}
	cfg, err := ValidateConfig(localERPOrigin())
	if err != nil {
		return ApplicationSettings{}, err
	}
	anon, err := privateRead(filepath.Join(dataDir, "anon.key"))
	if err != nil || len(strings.TrimSpace(string(anon))) == 0 {
		return ApplicationSettings{}, errors.New("native public authentication key is unavailable")
	}
	runtime, err := readPersistedRuntime(dataDir)
	if err != nil {
		return ApplicationSettings{}, err
	}
	return ApplicationSettings{
		AuthOrigin: "http://127.0.0.1:" + cfg.AuthPort,
		AnonKey:    strings.TrimSpace(string(anon)), ERPOrigin: cfg.ERPOrigin,
		PublicOrigin: cfg.PublicOrigin, OperatorUserIDs: runtime.OperatorUserIDs,
	}, nil
}

// OpenApplicationDatabase reuses the existing private REST login instead of
// giving the Go application's business queries the bootstrap superuser. Every
// application transaction must additionally SET LOCAL ROLE authenticated and
// bind live verified claims/current workspace. This pool itself grants no actor.
func OpenApplicationDatabase(ctx context.Context, dataDir string) (*pgxpool.Pool, error) {
	if err := privateDirectory(dataDir); err != nil {
		return nil, err
	}
	credentials, err := loadDBCredentials(dataDir, false)
	if err != nil || credentials.rest == "" {
		return nil, errors.New("private application database credential is unavailable")
	}
	address := &url.URL{
		Scheme: "postgres", User: url.User("boombignose_rest"), Host: pgAddr(),
		Path: "/boombignose", RawQuery: "sslmode=disable",
	}
	config, err := pgxpool.ParseConfig(address.String())
	if err != nil {
		return nil, errors.New("invalid local application database configuration")
	}
	config.ConnConfig.Password = credentials.rest
	config.ConnConfig.ConnectTimeout = 5 * time.Second
	config.ConnConfig.Fallbacks = nil
	config.ConnConfig.TLSConfig = nil
	config.ConnConfig.StatementCacheCapacity = 64
	config.ConnConfig.DescriptionCacheCapacity = 64
	config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeCacheStatement
	config.ConnConfig.RuntimeParams = map[string]string{
		"application_name": "nose-erp-go", "search_path": "public",
		"timezone": "UTC", "statement_timeout": "15000",
		"idle_in_transaction_session_timeout": "15000",
	}
	config.MaxConns, config.MinConns = 4, 0
	config.MaxConnIdleTime, config.MaxConnLifetime = 2*time.Minute, 30*time.Minute
	config.AfterConnect = func(ctx context.Context, connection *pgx.Conn) error {
		var role, database string
		var superuser, bypass, inherit bool
		err := connection.QueryRow(ctx, `select current_user, current_database(), rolsuper, rolbypassrls, rolinherit from pg_roles where rolname = current_user`).Scan(&role, &database, &superuser, &bypass, &inherit)
		if err != nil || role != "boombignose_rest" || database != "boombignose" || superuser || bypass || inherit {
			return errors.New("application database requires the private non-superuser NOINHERIT login")
		}
		return nil
	}
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, errors.New("local application database pool could not be created")
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, errors.New("private local application database connection failed")
	}
	return pool, nil
}
