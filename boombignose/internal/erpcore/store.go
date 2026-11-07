package erpcore

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNoWorkspace  = errors.New("workspace onboarding required")
	ErrInvalidInput = errors.New("invalid application input")
	ErrConflict     = errors.New("record changed or conflicts with existing data")
)

// DatabaseError intentionally excludes query text, parameter values, details,
// hints and server addresses. Domain handlers can map a safe SQL state/constraint
// to their validated user-facing action feedback without leaking a failed row.
type DatabaseError struct {
	State      string
	Constraint string
	business   string
	cause      error
}

func (e *DatabaseError) Error() string { return "database operation could not be completed" }

func (e *DatabaseError) SQLState() string        { return e.State }
func (e *DatabaseError) ConstraintName() string  { return e.Constraint }
func (e *DatabaseError) BusinessMessage() string { return e.business }
func (e *DatabaseError) Unwrap() error           { return e.cause }

func databaseError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return erpwire.ErrNotFound
	}
	var postgres *pgconn.PgError
	if errors.As(err, &postgres) {
		var cause error
		switch postgres.Code {
		case "42501", "25006":
			cause = erpwire.ErrForbidden
		case "23505", "40001", "40P01":
			cause = ErrConflict
		case "23502", "23503", "23514", "22003", "22P02", "22007", "22008":
			cause = ErrInvalidInput
		}
		constraint := postgres.ConstraintName
		if constraint != "" && !identifier(constraint) {
			constraint = ""
		}
		return &DatabaseError{State: postgres.Code, Constraint: constraint, business: businessMessage(postgres.Code, postgres.Message), cause: cause}
	}
	return &DatabaseError{}
}

type Store struct {
	pool      *pgxpool.Pool
	auth      *Authenticator
	schema    publicSchema
	operators map[string]struct{}
}

func NewStore(ctx context.Context, pool *pgxpool.Pool, auth *Authenticator, operatorUserIDs []string) (*Store, error) {
	if pool == nil || auth == nil {
		return nil, errors.New("Go store requires the private database and live authenticator")
	}
	operators := make(map[string]struct{}, len(operatorUserIDs))
	for _, id := range operatorUserIDs {
		if uuid.Validate(id) != nil {
			return nil, errors.New("invalid native operator configuration")
		}
		operators[id] = struct{}{}
	}
	schema, err := loadPublicSchema(ctx, pool)
	if err != nil {
		return nil, err
	}
	return &Store{pool: pool, auth: auth, schema: schema, operators: operators}, nil
}

// Actor authenticates the request, then chooses the preferred workspace ONLY
// from live memberships (otherwise the stable first membership, as before).
// No browser/model role or workspace name is accepted as authority.
func (s *Store) Actor(request *http.Request) (context.Context, erpwire.Actor, error) {
	ctx, identity, err := s.auth.RequestIdentity(request)
	if err != nil {
		return ctx, erpwire.Actor{}, err
	}
	preferred := ""
	if cookie, err := request.Cookie("active_org"); err == nil {
		preferred = cookie.Value
	}
	transaction, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return ctx, erpwire.Actor{}, databaseError(err)
	}
	finished := false
	defer rollbackUnlessFinished(transaction, &finished)
	if err := bindIdentity(ctx, transaction, identity); err != nil {
		return ctx, erpwire.Actor{}, err
	}
	var membership erpwire.Membership
	membership.UserID = identity.UserID
	var role string
	err = transaction.QueryRow(ctx, `select m.org_id::text, m.role::text, o.name
from public.memberships m join public.organizations o on o.id=m.org_id
where m.user_id=$1::uuid
order by case when m.org_id::text=$2 then 0 else 1 end, m.created_at, m.org_id
limit 1`, identity.UserID, preferred).Scan(&membership.OrgID, &role, &membership.OrgName)
	if errors.Is(err, pgx.ErrNoRows) {
		return ctx, erpwire.Actor{}, ErrNoWorkspace
	}
	if err != nil {
		return ctx, erpwire.Actor{}, databaseError(err)
	}
	membership.Role = erpwire.Role(role)
	_, operator := s.operators[identity.UserID]
	actor, err := erpwire.BindActor(identity, membership, operator, s.auth.now())
	if err != nil {
		return ctx, erpwire.Actor{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return ctx, erpwire.Actor{}, databaseError(err)
	}
	finished = true
	return ctx, actor, nil
}

func bindIdentity(ctx context.Context, tx pgx.Tx, identity erpwire.VerifiedIdentity) error {
	claims, err := json.Marshal(struct {
		Subject   string            `json:"sub"`
		Role      string            `json:"role"`
		Email     string            `json:"email"`
		Assurance erpwire.Assurance `json:"aal"`
		Expires   int64             `json:"exp"`
	}{identity.UserID, "authenticated", identity.Email, identity.Assurance, identity.ExpiresAt.Unix()})
	if err != nil {
		return erpwire.ErrAuthUnavailable
	}
	if _, err := tx.Exec(ctx, "set local role authenticated"); err != nil {
		return databaseError(err)
	}
	_, err = tx.Exec(ctx, `select set_config('request.jwt.claims',$1,true), set_config('request.jwt.claim.sub',$2,true), set_config('request.jwt.claim.role','authenticated',true)`, string(claims), identity.UserID)
	return databaseError(err)
}

func rollbackUnlessFinished(tx pgx.Tx, finished *bool) {
	if *finished {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = tx.Rollback(ctx)
}

type transaction struct {
	tx       pgx.Tx
	store    *Store
	actor    erpwire.Actor
	deadline time.Time
}

type readTransaction struct{ transaction *transaction }
type writeTransaction struct{ transaction *transaction }

func (s *Store) beginActor(ctx context.Context, actor erpwire.Actor, readOnly bool) (*transaction, error) {
	if err := actor.Validate(s.auth.now()); err != nil {
		return nil, err
	}
	identity, err := s.auth.reverify(ctx)
	if err != nil {
		return nil, err
	}
	if identity.UserID != actor.UserID() || identity.Assurance != actor.Assurance() || identity.Email != actor.Email() {
		return nil, erpwire.ErrIdentityChanged
	}
	if !identity.FactorStateKnown {
		return nil, erpwire.ErrAuthUnavailable
	}
	if identity.HasVerifiedFactor && identity.Assurance != erpwire.AAL2 {
		return nil, erpwire.ErrStepUpRequired
	}
	mode := pgx.ReadWrite
	if readOnly {
		mode = pgx.ReadOnly
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: mode})
	if err != nil {
		return nil, databaseError(err)
	}
	transferred := false
	defer rollbackUnlessFinished(tx, &transferred)
	if err := bindIdentity(ctx, tx, identity); err != nil {
		return nil, err
	}
	var role string
	err = tx.QueryRow(ctx, `select role::text from public.memberships where user_id=$1::uuid and org_id=$2::uuid`, identity.UserID, actor.OrgID()).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, erpwire.ErrIdentityChanged
	}
	if err != nil {
		return nil, databaseError(err)
	}
	if erpwire.Role(role) != actor.Role() {
		return nil, erpwire.ErrIdentityChanged
	}
	if !s.auth.now().Before(identity.ExpiresAt) {
		return nil, erpwire.ErrUnauthenticated
	}
	transferred = true
	return &transaction{tx: tx, store: s, actor: actor, deadline: identity.ExpiresAt}, nil
}

func (s *Store) Read(ctx context.Context, actor erpwire.Actor, operation func(erpwire.ReadTx) error) error {
	if operation == nil {
		return ErrInvalidInput
	}
	tx, err := s.beginActor(ctx, actor, true)
	if err != nil {
		return err
	}
	finished := false
	defer rollbackUnlessFinished(tx.tx, &finished)
	if err := operation(&readTransaction{transaction: tx}); err != nil {
		return err
	}
	if err := actor.Validate(s.auth.now()); err != nil {
		return err
	}
	if err := tx.tx.Commit(ctx); err != nil {
		return databaseError(err)
	}
	finished = true
	return nil
}

func (s *Store) Write(ctx context.Context, actor erpwire.Actor, operation func(erpwire.WriteTx) error) error {
	if operation == nil {
		return ErrInvalidInput
	}
	tx, err := s.beginActor(ctx, actor, false)
	if err != nil {
		return err
	}
	finished := false
	defer rollbackUnlessFinished(tx.tx, &finished)
	if err := operation(&writeTransaction{transaction: tx}); err != nil {
		return err
	}
	if err := actor.Validate(s.auth.now()); err != nil {
		return err
	}
	if err := tx.tx.Commit(ctx); err != nil {
		return databaseError(err)
	}
	finished = true
	return nil
}

// queryContext honors caller cancellation and never lets a SQL query outlive
// the authenticated bearer. Ordinary HTTP deadlines already tighter than token
// expiry are reused without allocating another timer/context.
func (tx *transaction) queryContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if deadline, ok := ctx.Deadline(); ok && !tx.deadline.Before(deadline) {
		return ctx, noCancel
	}
	return context.WithDeadline(ctx, tx.deadline)
}

func noCancel() {}

func (tx *readTransaction) Select(ctx context.Context, query erpwire.Select) (erpwire.Selection, error) {
	return tx.transaction.selectRows(ctx, query)
}
func (tx *writeTransaction) Select(ctx context.Context, query erpwire.Select) (erpwire.Selection, error) {
	return tx.transaction.selectRows(ctx, query)
}
func (tx *readTransaction) ReadRPC(ctx context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	switch name {
	case "assistant_invoice_snapshot", "assistant_finance_snapshot", "assistant_workspace_profiles", "list_finance_lock_reopen_requests", "record_activity_assignees":
		return tx.transaction.call(ctx, name, args)
	default:
		return nil, erpwire.ErrForbidden
	}
}
func (tx *writeTransaction) Command(ctx context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	return tx.transaction.call(ctx, name, args)
}

var _ erpwire.ReadStore = (*Store)(nil)
var _ erpwire.Store = (*Store)(nil)
