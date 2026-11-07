package erpcore

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type columnSchema struct {
	name      string
	typeName  string
	generated bool
}

type foreignKey struct {
	columns        []string
	foreignTable   string
	foreignColumns []string
}

type tableSchema struct {
	name       string
	kind       string
	columns    map[string]columnSchema
	columnList []string
	primaryKey []string
	foreign    []foreignKey
}

type functionSchema struct {
	name       string
	arguments  []string
	required   int
	returnsSet bool
}

type publicSchema struct {
	tables    map[string]*tableSchema
	functions map[string][]functionSchema
}

func identifier(value string) bool {
	if value == "" || len(value) > 63 {
		return false
	}
	for i := range len(value) {
		char := value[i]
		if char != '_' && !(char >= 'a' && char <= 'z') && !(char >= 'A' && char <= 'Z') && !(i > 0 && char >= '0' && char <= '9') {
			return false
		}
	}
	return true
}

func loadPublicSchema(ctx context.Context, pool *pgxpool.Pool) (publicSchema, error) {
	schema := publicSchema{tables: make(map[string]*tableSchema), functions: make(map[string][]functionSchema)}
	rows, err := pool.Query(ctx, `select c.relname, c.relkind::text, a.attname, t.typname, a.attgenerated <> '' or a.attidentity <> ''
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
join pg_catalog.pg_type t on t.oid = a.atttypid
where n.nspname = 'public' and c.relkind in ('r','p','v','m')
order by c.relname, a.attnum`)
	if err != nil {
		return publicSchema{}, errors.New("application schema could not be read")
	}
	for rows.Next() {
		var table, kind, column, typeName string
		var generated bool
		if err := rows.Scan(&table, &kind, &column, &typeName, &generated); err != nil {
			rows.Close()
			return publicSchema{}, errors.New("invalid application column metadata")
		}
		if !identifier(table) || !identifier(column) {
			continue
		}
		entry := schema.tables[table]
		if entry == nil {
			entry = &tableSchema{name: table, kind: kind, columns: make(map[string]columnSchema)}
			schema.tables[table] = entry
		}
		entry.columns[column] = columnSchema{name: column, typeName: typeName, generated: generated}
		entry.columnList = append(entry.columnList, column)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return publicSchema{}, errors.New("application column inventory failed")
	}
	rows.Close()

	rows, err = pool.Query(ctx, `select c.relname, con.contype::text,
array(select a.attname::text from unnest(con.conkey) with ordinality k(num, ord) join pg_catalog.pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.num order by k.ord),
coalesce(fc.relname,''),
case when con.contype='f' then array(select a.attname::text from unnest(con.confkey) with ordinality k(num, ord) join pg_catalog.pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.num order by k.ord) else array[]::text[] end
from pg_catalog.pg_constraint con
join pg_catalog.pg_class c on c.oid=con.conrelid
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
left join pg_catalog.pg_class fc on fc.oid=con.confrelid
left join pg_catalog.pg_namespace fn on fn.oid=fc.relnamespace
where n.nspname='public' and con.contype in ('p','f') and (con.contype='p' or fn.nspname='public')
order by c.relname, con.conname`)
	if err != nil {
		return publicSchema{}, errors.New("application key inventory could not be read")
	}
	for rows.Next() {
		var table, kind, foreignTable string
		var columns, foreignColumns []string
		if err := rows.Scan(&table, &kind, &columns, &foreignTable, &foreignColumns); err != nil {
			rows.Close()
			return publicSchema{}, errors.New("invalid application key metadata")
		}
		entry := schema.tables[table]
		if entry == nil {
			continue
		}
		if kind == "p" {
			entry.primaryKey = columns
		} else if schema.tables[foreignTable] != nil && len(columns) == len(foreignColumns) {
			entry.foreign = append(entry.foreign, foreignKey{columns: columns, foreignTable: foreignTable, foreignColumns: foreignColumns})
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return publicSchema{}, errors.New("application key inventory failed")
	}
	rows.Close()

	rows, err = pool.Query(ctx, `select p.proname, coalesce(p.proargnames[1:p.pronargs], array[]::text[]), p.pronargs-p.pronargdefaults, p.proretset
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f' and p.provariadic=0
order by p.proname, p.oid`)
	if err != nil {
		return publicSchema{}, errors.New("application function inventory could not be read")
	}
	for rows.Next() {
		var function functionSchema
		if err := rows.Scan(&function.name, &function.arguments, &function.required, &function.returnsSet); err != nil {
			rows.Close()
			return publicSchema{}, errors.New("invalid application function metadata")
		}
		if !identifier(function.name) || function.required > len(function.arguments) {
			continue // Unnamed/variadic functions are not a named application RPC.
		}
		valid := true
		for _, name := range function.arguments {
			valid = valid && identifier(name)
		}
		if valid {
			schema.functions[function.name] = append(schema.functions[function.name], function)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return publicSchema{}, errors.New("application function inventory failed")
	}
	rows.Close()
	if len(schema.tables) == 0 {
		return publicSchema{}, errors.New("application schema is empty; native migrations must finish first")
	}
	return schema, nil
}

func (table *tableSchema) hasColumn(name string) bool {
	_, ok := table.columns[name]
	return ok
}

func (schema publicSchema) table(name string) (*tableSchema, error) {
	if !identifier(name) {
		return nil, errors.New("invalid application table identifier")
	}
	table := schema.tables[name]
	if table == nil {
		return nil, errors.New("unknown application table")
	}
	return table, nil
}

func (table *tableSchema) checkedColumns(requested []string, writable bool) ([]string, error) {
	if len(requested) == 0 || (len(requested) == 1 && requested[0] == "*") {
		if writable {
			return nil, errors.New("write columns must be explicit")
		}
		return table.columnList, nil
	}
	for index, name := range requested {
		column, ok := table.columns[name]
		if !ok || !identifier(name) || (writable && column.generated) {
			return nil, errors.New("invalid application column")
		}
		for _, previous := range requested[:index] {
			if previous == name {
				return nil, errors.New("duplicate application column")
			}
		}
	}
	return requested, nil
}

func (schema publicSchema) function(name string, supplied map[string]any) (functionSchema, error) {
	if !identifier(name) {
		return functionSchema{}, errors.New("invalid application function identifier")
	}
	var matched *functionSchema
	for index := range schema.functions[name] {
		candidate := &schema.functions[name][index]
		valid := true
		for key := range supplied {
			found := false
			for _, argument := range candidate.arguments {
				found = found || argument == key
			}
			valid = valid && found
		}
		for _, required := range candidate.arguments[:candidate.required] {
			_, ok := supplied[required]
			valid = valid && ok
		}
		if !valid {
			continue
		}
		if matched != nil {
			return functionSchema{}, errors.New("ambiguous application function signature")
		}
		matched = candidate
	}
	if matched == nil {
		return functionSchema{}, errors.New("unknown application function signature")
	}
	return *matched, nil
}

type relationJoin struct {
	local, foreign []string
	forward        bool
}

// The requested pair identifies an actual FK, not the whole join. Preserve all
// of its columns, including org_id, and reject ambiguous relationships.
func (table *tableSchema) relation(target *tableSchema, localColumn, foreignColumn string) (relationJoin, bool) {
	var result relationJoin
	matches := 0
	for _, key := range table.foreign {
		if key.foreignTable != target.name {
			continue
		}
		for index, column := range key.columns {
			if column == localColumn && key.foreignColumns[index] == foreignColumn {
				result = relationJoin{local: key.columns, foreign: key.foreignColumns, forward: true}
				matches++
				break
			}
		}
	}
	for _, key := range target.foreign {
		if key.foreignTable != table.name {
			continue
		}
		for index, column := range key.columns {
			if column == foreignColumn && key.foreignColumns[index] == localColumn {
				result = relationJoin{local: key.foreignColumns, foreign: key.columns}
				matches++
				break
			}
		}
	}
	return result, matches == 1
}

func containsColumn(columns []string, name string) bool {
	for _, column := range columns {
		if strings.EqualFold(column, name) {
			return true
		}
	}
	return false
}
