package erpwire

import (
	"context"
	"encoding/json"
)

// Row values retain exact database integers/decimals (int64 or json.Number),
// never a float64 round trip for money. JSON decoders must use UseNumber.
type Row map[string]any

type FilterOp string

const (
	Equal        FilterOp = "eq"
	NotEqual     FilterOp = "neq"
	Greater      FilterOp = "gt"
	GreaterEqual FilterOp = "gte"
	Less         FilterOp = "lt"
	LessEqual    FilterOp = "lte"
	In           FilterOp = "in"
	Is           FilterOp = "is"
	Like         FilterOp = "like"
	ILike        FilterOp = "ilike"
)

type Predicate struct {
	Column string
	Op     FilterOp
	Value  any
}

type Order struct {
	Column     string
	Descending bool
	NullsFirst bool
}

// Relation identifiers and foreign-key paths must be checked against the live
// public schema. Relation reads use the same RLS identity as their parent.
type Relation struct {
	Name          string
	Table         string
	LocalColumn   string
	ForeignColumn string
	Columns       []string
	Relations     []Relation
	Many          bool
}

// Select contains identifiers and bound VALUES, never SQL fragments. Where is
// AND; each Any group is an OR, and the groups are ANDed with Where. Ordering
// must include a stable key for traversable pages. Count is exact for the whole
// matching set in the SAME transaction snapshot, not the returned page length.
type Select struct {
	Table     string
	Columns   []string
	Relations []Relation
	Where     []Predicate
	Any       [][]Predicate
	Order     []Order
	Limit     int
	Offset    int
	Count     bool
}

type Selection struct {
	Rows    []Row
	Total   *int64 // nil means unknown, not zero
	HasMore bool
}

// ReadTx is backed by an authenticated, read-only repeatable-read transaction.
// ReadRPC executes allowlisted SQL functions; the database READ ONLY transaction
// still forbids mutations, including mutations inside SECURITY DEFINER code.
// Neither request JSON nor a model may select a database role or supply SQL.
type ReadTx interface {
	Select(context.Context, Select) (Selection, error)
	ReadRPC(context.Context, string, Row) (json.RawMessage, error)
}

type Insert struct {
	Table           string
	Rows            []Row
	Returning       []string
	ConflictColumns []string
	IgnoreConflicts bool
}

type WriteTx interface {
	Select(context.Context, Select) (Selection, error)
	Command(context.Context, string, Row) (json.RawMessage, error)
	Insert(context.Context, Insert) ([]Row, error)
	Update(context.Context, string, Row, []Predicate, []string) ([]Row, error)
	Delete(context.Context, string, []Predicate, []string) ([]Row, error)
}

// ReadStore implementations must reauthorize the actor's live identity,
// membership/role and MFA on EVERY invocation, bind auth.uid/claims to that
// identity, SET LOCAL ROLE authenticated, and apply current-org scope. A service
// role/superuser query or client-supplied claims are not valid implementations.
// Callbacks are transaction-scoped; their Tx must never escape or be retained.
type ReadStore interface {
	Read(context.Context, Actor, func(ReadTx) error) error
}

type Store interface {
	ReadStore
	Write(context.Context, Actor, func(WriteTx) error) error
}

// Operation is an application query/action, not a generic public SQL gateway.
// The HTTP layer authenticates, binds current workspace, checks trusted origin
// for mutations and enforces endpoint capability before dispatch. A handler
// remains responsible for domain validation and atomic audited/idempotent writes.
type Operation func(context.Context, Actor, json.RawMessage) (any, error)
