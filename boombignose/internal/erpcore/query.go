package erpcore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/jackc/pgx/v5"
)

type queryBuilder struct {
	transaction   *transaction
	values        []any
	orgParameter  string
	userParameter string
	aliases       int
}

func (builder *queryBuilder) parameter(value any) (string, error) {
	switch typed := value.(type) {
	case json.Number:
		value = string(typed) // exact decimal/integer, never float64
	case json.RawMessage:
		if !json.Valid(typed) {
			return "", ErrInvalidInput
		}
		value = string(typed)
	case map[string]any:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return "", ErrInvalidInput
		}
		value = string(encoded)
	case erpwire.Row:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return "", ErrInvalidInput
		}
		value = string(encoded)
	case float32, float64:
		return "", errors.New("database numeric input must retain its exact decimal representation")
	}
	builder.values = append(builder.values, value)
	return "$" + strconv.Itoa(len(builder.values)), nil
}

func (builder *queryBuilder) org() string {
	if builder.orgParameter == "" {
		builder.values = append(builder.values, builder.transaction.actor.OrgID())
		builder.orgParameter = "$" + strconv.Itoa(len(builder.values))
	}
	return builder.orgParameter
}

func (builder *queryBuilder) user() string {
	if builder.userParameter == "" {
		builder.values = append(builder.values, builder.transaction.actor.UserID())
		builder.userParameter = "$" + strconv.Itoa(len(builder.values))
	}
	return builder.userParameter
}

func (builder *queryBuilder) alias() string {
	builder.aliases++
	return "r" + strconv.Itoa(builder.aliases)
}

func qualified(alias, column string) string { return pgx.Identifier{alias, column}.Sanitize() }
func publicTable(table string) string       { return pgx.Identifier{"public", table}.Sanitize() }

// scope is explicit even when RLS permits an actor to belong to several orgs.
// Child rows without org_id follow a real foreign key to their owning org.
// Profiles use own-row selection here; team projections use the scoped RPC.
func (builder *queryBuilder) scope(table *tableSchema, alias string, path []string) (string, error) {
	if table.hasColumn("org_id") {
		return qualified(alias, "org_id") + "=" + builder.org(), nil
	}
	if table.name == "organizations" {
		return qualified(alias, "id") + "=" + builder.org(), nil
	}
	if table.name == "profiles" {
		return qualified(alias, "id") + "=" + builder.user(), nil
	}
	if len(path) >= 8 {
		return "", erpwire.ErrForbidden
	}
	for _, previous := range path {
		if previous == table.name {
			return "", erpwire.ErrForbidden
		}
	}
	path = append(path, table.name)
	for _, key := range table.foreign {
		parent := builder.transaction.store.schema.tables[key.foreignTable]
		if parent == nil || parent.name == "profiles" || len(key.columns) == 0 {
			continue
		}
		parentAlias := builder.alias()
		// A failed candidate must not leave unused bound placeholders behind.
		previousValues, previousOrg, previousUser := len(builder.values), builder.orgParameter, builder.userParameter
		parentScope, err := builder.scope(parent, parentAlias, path)
		if err != nil {
			builder.values = builder.values[:previousValues]
			builder.orgParameter, builder.userParameter = previousOrg, previousUser
			continue
		}
		var conditions strings.Builder
		for index, column := range key.columns {
			if index > 0 {
				conditions.WriteString(" and ")
			}
			conditions.WriteString(qualified(parentAlias, key.foreignColumns[index]))
			conditions.WriteByte('=')
			conditions.WriteString(qualified(alias, column))
		}
		return "exists(select 1 from " + publicTable(parent.name) + " " + pgx.Identifier{parentAlias}.Sanitize() + " where " + conditions.String() + " and " + parentScope + ")", nil
	}
	return "", erpwire.ErrForbidden
}

func (builder *queryBuilder) predicate(table *tableSchema, alias string, predicate erpwire.Predicate) (string, error) {
	if !table.hasColumn(predicate.Column) || !identifier(predicate.Column) {
		return "", ErrInvalidInput
	}
	column := qualified(alias, predicate.Column)
	if predicate.Op == erpwire.Is || ((predicate.Op == erpwire.Equal || predicate.Op == erpwire.NotEqual) && predicate.Value == nil) {
		if predicate.Op == erpwire.NotEqual {
			return column + " is not null", nil
		}
		switch value := predicate.Value.(type) {
		case nil:
			return column + " is null", nil
		case bool:
			if value {
				return column + " is true", nil
			}
			return column + " is false", nil
		default:
			return "", ErrInvalidInput
		}
	}
	if predicate.Op == erpwire.In {
		values := reflect.ValueOf(predicate.Value)
		if !values.IsValid() || (values.Kind() != reflect.Slice && values.Kind() != reflect.Array) || values.Len() > 10000 {
			return "", ErrInvalidInput
		}
		if values.Len() == 0 {
			return "false", nil
		}
		var expression strings.Builder
		expression.WriteString(column)
		expression.WriteString(" in (")
		for index := range values.Len() {
			parameter, err := builder.parameter(values.Index(index).Interface())
			if err != nil {
				return "", err
			}
			if index > 0 {
				expression.WriteByte(',')
			}
			expression.WriteString(parameter)
		}
		expression.WriteByte(')')
		return expression.String(), nil
	}
	var operation string
	switch predicate.Op {
	case erpwire.Equal:
		operation = "="
	case erpwire.NotEqual:
		operation = "<>"
	case erpwire.Greater:
		operation = ">"
	case erpwire.GreaterEqual:
		operation = ">="
	case erpwire.Less:
		operation = "<"
	case erpwire.LessEqual:
		operation = "<="
	case erpwire.Like:
		operation = " like "
	case erpwire.ILike:
		operation = " ilike "
	default:
		return "", ErrInvalidInput
	}
	if predicate.Op == erpwire.Like || predicate.Op == erpwire.ILike {
		if _, ok := predicate.Value.(string); !ok {
			return "", ErrInvalidInput
		}
	}
	parameter, err := builder.parameter(predicate.Value)
	if err != nil {
		return "", err
	}
	return column + operation + parameter, nil
}

func (builder *queryBuilder) where(table *tableSchema, alias string, predicates []erpwire.Predicate, alternatives [][]erpwire.Predicate) (string, error) {
	var path [8]string
	scope, err := builder.scope(table, alias, path[:0])
	if err != nil {
		return "", err
	}
	var clause strings.Builder
	clause.WriteString(scope)
	for _, predicate := range predicates {
		part, err := builder.predicate(table, alias, predicate)
		if err != nil {
			return "", err
		}
		clause.WriteString(" and (")
		clause.WriteString(part)
		clause.WriteByte(')')
	}
	for _, group := range alternatives {
		if len(group) == 0 {
			return "", ErrInvalidInput
		}
		clause.WriteString(" and (")
		for index, predicate := range group {
			part, err := builder.predicate(table, alias, predicate)
			if err != nil {
				return "", err
			}
			if index > 0 {
				clause.WriteString(" or ")
			}
			clause.WriteString(part)
		}
		clause.WriteByte(')')
	}
	return clause.String(), nil
}

// PostgreSQL variadic functions accept at most 100 arguments. Chunk wide ERP
// projections instead of dropping columns or failing on an existing wide row.
func jsonPairSeparator(result *strings.Builder, index int) {
	if index == 0 {
		return
	}
	if index%40 == 0 {
		result.WriteString(") || jsonb_build_object(")
	} else {
		result.WriteByte(',')
	}
}

func (builder *queryBuilder) projection(table *tableSchema, alias string, columns []string, relations []erpwire.Relation, depth int) (string, error) {
	if depth > 4 {
		return "", ErrInvalidInput
	}
	columns, err := table.checkedColumns(columns, false)
	if err != nil {
		return "", err
	}
	var result strings.Builder
	result.WriteString("jsonb_build_object(")
	for index, column := range columns {
		jsonPairSeparator(&result, index)
		result.WriteByte('\'')
		result.WriteString(column)
		result.WriteString("',")
		result.WriteString(qualified(alias, column))
	}
	for index, relation := range relations {
		if !identifier(relation.Name) || containsColumn(columns, relation.Name) {
			return "", ErrInvalidInput
		}
		for _, previous := range relations[:index] {
			if previous.Name == relation.Name {
				return "", ErrInvalidInput
			}
		}
		target, err := builder.transaction.store.schema.table(relation.Table)
		if err != nil {
			return "", err
		}
		join, valid := table.relation(target, relation.LocalColumn, relation.ForeignColumn)
		if !valid {
			return "", ErrInvalidInput
		}
		if !relation.Many && !join.forward {
			uniqueTarget := len(target.primaryKey) > 0
			for _, column := range target.primaryKey {
				uniqueTarget = uniqueTarget && containsColumn(join.foreign, column)
			}
			if !uniqueTarget {
				return "", errors.New("single reverse relation requires a unique referenced key")
			}
		}
		targetAlias := builder.alias()
		projection, err := builder.projection(target, targetAlias, relation.Columns, relation.Relations, depth+1)
		if err != nil {
			return "", err
		}
		var path [8]string
		scope, err := builder.scope(target, targetAlias, path[:0])
		if err != nil {
			return "", err
		}
		var conditionBuilder strings.Builder
		for index, column := range join.local {
			if index > 0 {
				conditionBuilder.WriteString(" and ")
			}
			conditionBuilder.WriteString(qualified(targetAlias, join.foreign[index]))
			conditionBuilder.WriteByte('=')
			conditionBuilder.WriteString(qualified(alias, column))
		}
		conditionBuilder.WriteString(" and ")
		conditionBuilder.WriteString(scope)
		condition := conditionBuilder.String()
		jsonPairSeparator(&result, len(columns)+index)
		result.WriteByte('\'')
		result.WriteString(relation.Name)
		result.WriteString("',(")
		if relation.Many {
			result.WriteString("select coalesce(jsonb_agg(related.payload), '[]'::jsonb) from (select ")
			result.WriteString(projection)
			result.WriteString(" as payload from ")
			result.WriteString(publicTable(target.name))
			result.WriteByte(' ')
			result.WriteString(pgx.Identifier{targetAlias}.Sanitize())
			result.WriteString(" where ")
			result.WriteString(condition)
			if len(target.primaryKey) > 0 {
				result.WriteString(" order by ")
				for index, column := range target.primaryKey {
					if index > 0 {
						result.WriteByte(',')
					}
					result.WriteString(qualified(targetAlias, column))
				}
			}
			result.WriteString(") related")
		} else {
			result.WriteString("select ")
			result.WriteString(projection)
			result.WriteString(" from ")
			result.WriteString(publicTable(target.name))
			result.WriteByte(' ')
			result.WriteString(pgx.Identifier{targetAlias}.Sanitize())
			result.WriteString(" where ")
			result.WriteString(condition)
		}
		result.WriteByte(')')
	}
	result.WriteByte(')')
	return result.String(), nil
}

func orderClause(table *tableSchema, alias string, order []erpwire.Order) (string, error) {
	var result strings.Builder
	for index, item := range order {
		if !table.hasColumn(item.Column) {
			return "", ErrInvalidInput
		}
		if index > 0 {
			result.WriteByte(',')
		}
		result.WriteString(qualified(alias, item.Column))
		if item.Descending {
			result.WriteString(" desc")
		} else {
			result.WriteString(" asc")
		}
		if item.NullsFirst {
			result.WriteString(" nulls first")
		} else {
			result.WriteString(" nulls last")
		}
	}
	for _, column := range table.primaryKey {
		present := false
		for _, item := range order {
			present = present || item.Column == column
		}
		if !present {
			if result.Len() > 0 {
				result.WriteByte(',')
			}
			result.WriteString(qualified(alias, column))
			result.WriteString(" asc")
		}
	}
	return result.String(), nil
}

func (tx *transaction) selectRows(ctx context.Context, query erpwire.Select) (erpwire.Selection, error) {
	out := erpwire.Selection{Rows: make([]erpwire.Row, 0)}
	if query.Limit == 0 {
		query.Limit = 1000
	}
	if query.Limit < 1 || query.Limit > 10000 || query.Offset < 0 {
		return out, ErrInvalidInput
	}
	table, err := tx.store.schema.table(query.Table)
	if err != nil {
		return out, err
	}
	builder := queryBuilder{transaction: tx}
	where, err := builder.where(table, "base", query.Where, query.Any)
	if err != nil {
		return out, err
	}
	countValues := builder.values
	projection, err := builder.projection(table, "base", query.Columns, query.Relations, 0)
	if err != nil {
		return out, err
	}
	order, err := orderClause(table, "base", query.Order)
	if err != nil {
		return out, err
	}
	ctx, cancel := tx.queryContext(ctx)
	defer cancel()
	from := publicTable(table.name) + " base where " + where
	if query.Count {
		var count int64
		if err := tx.tx.QueryRow(ctx, "select count(*)::bigint from "+from, countValues...).Scan(&count); err != nil {
			return out, databaseError(err)
		}
		if count < 0 || count > erpwire.MaxSafeInteger {
			return out, erpwire.ErrUnsafeAmount
		}
		out.Total = &count
	}
	limit := query.Limit
	if !query.Count {
		limit++
	}
	limitParameter, err := builder.parameter(limit)
	if err != nil {
		return out, err
	}
	offsetParameter, err := builder.parameter(query.Offset)
	if err != nil {
		return out, err
	}
	sql := "select " + projection + " from " + from
	if order != "" {
		sql += " order by " + order
	}
	sql += " limit " + limitParameter + " offset " + offsetParameter
	rows, err := tx.tx.Query(ctx, sql, builder.values...)
	if err != nil {
		return out, databaseError(err)
	}
	defer rows.Close()
	for rows.Next() {
		var encoded []byte
		if err := rows.Scan(&encoded); err != nil {
			return out, databaseError(err)
		}
		var row erpwire.Row
		decoder := json.NewDecoder(bytes.NewReader(encoded))
		decoder.UseNumber()
		if err := decoder.Decode(&row); err != nil || row == nil {
			return out, errors.New("invalid database row projection")
		}
		out.Rows = append(out.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return out, databaseError(err)
	}
	if out.Total != nil {
		out.HasMore = int64(query.Offset)+int64(len(out.Rows)) < *out.Total
	} else if len(out.Rows) > query.Limit {
		out.HasMore = true
		out.Rows = out.Rows[:query.Limit]
	}
	return out, nil
}

func (tx *transaction) call(ctx context.Context, name string, args erpwire.Row) (json.RawMessage, error) {
	function, err := tx.store.schema.function(name, args)
	if err != nil {
		return nil, err
	}
	for _, argument := range function.arguments {
		if argument == "p_org_id" || argument == "org_id" {
			value, exists := args[argument]
			if !exists {
				return nil, erpwire.ErrForbidden
			}
			org, ok := value.(string)
			if !ok || org != tx.actor.OrgID() {
				return nil, erpwire.ErrForbidden
			}
		}
	}
	builder := queryBuilder{transaction: tx}
	var invocation strings.Builder
	invocation.WriteString(publicTable(name))
	invocation.WriteByte('(')
	first := true
	for _, argument := range function.arguments {
		value, exists := args[argument]
		if !exists {
			continue
		}
		parameter, err := builder.parameter(value)
		if err != nil {
			return nil, err
		}
		if !first {
			invocation.WriteByte(',')
		}
		first = false
		invocation.WriteString(pgx.Identifier{argument}.Sanitize())
		invocation.WriteString(" => ")
		invocation.WriteString(parameter)
	}
	invocation.WriteByte(')')
	sql := "select to_jsonb(" + invocation.String() + ")"
	if function.returnsSet {
		sql = "select coalesce(jsonb_agg(result), '[]'::jsonb) from (" + sql + " as result) rpc_rows"
	}
	ctx, cancel := tx.queryContext(ctx)
	defer cancel()
	var encoded []byte
	if err := tx.tx.QueryRow(ctx, sql, builder.values...).Scan(&encoded); err != nil {
		return nil, databaseError(err)
	}
	if encoded == nil {
		return json.RawMessage("null"), nil
	}
	return json.RawMessage(encoded), nil
}
