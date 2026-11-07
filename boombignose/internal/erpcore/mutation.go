package erpcore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/jackc/pgx/v5"
)

func writeTable(schema publicSchema, name string) (*tableSchema, error) {
	table, err := schema.table(name)
	if err != nil {
		return nil, err
	}
	if table.kind != "r" && table.kind != "p" {
		return nil, ErrInvalidInput
	}
	return table, nil
}

func rowColumns(table *tableSchema, rows []erpwire.Row) ([]string, error) {
	set := make(map[string]struct{})
	for _, row := range rows {
		for key := range row {
			set[key] = struct{}{}
		}
	}
	if table.hasColumn("org_id") {
		set["org_id"] = struct{}{}
	}
	columns := make([]string, 0, len(set))
	for column := range set {
		columns = append(columns, column)
	}
	slices.Sort(columns)
	return table.checkedColumns(columns, true)
}

// authorizeInsertRows does not mutate caller maps or trust an org in JSON.
// Unscoped child tables must point to a session-visible current-org parent.
func (tx *transaction) authorizeInsertRows(ctx context.Context, table *tableSchema, rows []erpwire.Row) error {
	if table.hasColumn("org_id") {
		for _, row := range rows {
			if supplied, ok := row["org_id"]; ok && supplied != tx.actor.OrgID() {
				return erpwire.ErrForbidden
			}
		}
		return nil
	}
	if table.name == "organizations" || table.name == "profiles" {
		id := tx.actor.OrgID()
		if table.name == "profiles" {
			id = tx.actor.UserID()
		}
		for _, row := range rows {
			if row["id"] != id {
				return erpwire.ErrForbidden
			}
		}
		return nil
	}
	checked := make(map[string]struct{})
	for _, row := range rows {
		authorized := false
		for _, key := range table.foreign {
			parent := tx.store.schema.tables[key.foreignTable]
			if parent == nil || parent.name == "profiles" || len(key.columns) == 0 {
				continue
			}
			builder := queryBuilder{transaction: tx}
			var path [8]string
			scope, err := builder.scope(parent, "parent", path[:0])
			if err != nil {
				continue
			}
			conditions := make([]string, 0, len(key.columns)+1)
			conditions = append(conditions, scope)
			values := make([]any, 0, len(key.columns)+1)
			values = append(values, parent.name)
			present := true
			for index, column := range key.columns {
				value, ok := row[column]
				if !ok || value == nil {
					present = false
					break
				}
				parameter, err := builder.parameter(value)
				if err != nil {
					return err
				}
				conditions = append(conditions, qualified("parent", key.foreignColumns[index])+"="+parameter)
				values = append(values, value)
			}
			if !present {
				continue
			}
			cacheKey, err := json.Marshal(values)
			if err != nil {
				return ErrInvalidInput
			}
			if _, ok := checked[string(cacheKey)]; ok {
				authorized = true
				break
			}
			var exists bool
			queryCtx, cancel := tx.queryContext(ctx)
			err = tx.tx.QueryRow(queryCtx, "select exists(select 1 from "+publicTable(parent.name)+" parent where "+strings.Join(conditions, " and ")+")", builder.values...).Scan(&exists)
			cancel()
			if err != nil {
				return databaseError(err)
			}
			if exists {
				checked[string(cacheKey)] = struct{}{}
				authorized = true
				break
			}
		}
		if !authorized {
			return erpwire.ErrForbidden
		}
	}
	return nil
}

func decodeReturnedRows(rows pgx.Rows) ([]erpwire.Row, error) {
	defer rows.Close()
	result := make([]erpwire.Row, 0)
	for rows.Next() {
		var encoded []byte
		if err := rows.Scan(&encoded); err != nil {
			return nil, databaseError(err)
		}
		var row erpwire.Row
		decoder := json.NewDecoder(bytes.NewReader(encoded))
		decoder.UseNumber()
		if err := decoder.Decode(&row); err != nil || row == nil {
			return nil, errors.New("invalid mutation row projection")
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, databaseError(err)
	}
	return result, nil
}

func (writer *writeTransaction) Insert(ctx context.Context, input erpwire.Insert) ([]erpwire.Row, error) {
	tx := writer.transaction
	if len(input.Rows) == 0 {
		return []erpwire.Row{}, nil
	}
	table, err := writeTable(tx.store.schema, input.Table)
	if err != nil {
		return nil, err
	}
	columns, err := rowColumns(table, input.Rows)
	if err != nil || len(columns) == 0 {
		return nil, ErrInvalidInput
	}
	if err := tx.authorizeInsertRows(ctx, table, input.Rows); err != nil {
		return nil, err
	}
	if len(input.ConflictColumns) > 0 {
		if _, err := table.checkedColumns(input.ConflictColumns, false); err != nil {
			return nil, err
		}
	}
	// Split only protocol-sized SQL batches, all inside the SAME caller-owned
	// transaction. A later batch failure rolls every earlier batch back.
	batchSize := (65535 - 8) / len(columns)
	if batchSize < 1 {
		return nil, ErrInvalidInput
	}
	result := make([]erpwire.Row, 0, len(input.Rows))
	for start := 0; start < len(input.Rows); {
		end := min(start+batchSize, len(input.Rows))
		builder := queryBuilder{transaction: tx}
		projection, err := builder.projection(table, "target", input.Returning, nil, 0)
		if err != nil {
			return nil, err
		}
		var sql strings.Builder
		sql.WriteString("insert into ")
		sql.WriteString(publicTable(table.name))
		sql.WriteString(" as target (")
		for index, column := range columns {
			if index > 0 {
				sql.WriteByte(',')
			}
			sql.WriteString(pgx.Identifier{column}.Sanitize())
		}
		sql.WriteString(") values ")
		for rowIndex, row := range input.Rows[start:end] {
			if rowIndex > 0 {
				sql.WriteByte(',')
			}
			sql.WriteByte('(')
			for index, column := range columns {
				if index > 0 {
					sql.WriteByte(',')
				}
				if column == "org_id" {
					sql.WriteString(builder.org())
					continue
				}
				value, present := row[column]
				if !present {
					sql.WriteString("default")
					continue
				}
				parameter, err := builder.parameter(value)
				if err != nil {
					return nil, err
				}
				sql.WriteString(parameter)
			}
			sql.WriteByte(')')
		}
		if len(input.ConflictColumns) > 0 || input.IgnoreConflicts {
			sql.WriteString(" on conflict")
			if len(input.ConflictColumns) > 0 {
				sql.WriteString(" (")
				for index, column := range input.ConflictColumns {
					if index > 0 {
						sql.WriteByte(',')
					}
					sql.WriteString(pgx.Identifier{column}.Sanitize())
				}
				sql.WriteByte(')')
			}
			if input.IgnoreConflicts {
				sql.WriteString(" do nothing")
			} else {
				updated := 0
				var assignments strings.Builder
				for _, column := range columns {
					if column == "org_id" || containsColumn(input.ConflictColumns, column) || containsColumn(table.primaryKey, column) {
						continue
					}
					if updated > 0 {
						assignments.WriteByte(',')
					}
					assignments.WriteString(pgx.Identifier{column}.Sanitize())
					assignments.WriteString("=excluded.")
					assignments.WriteString(pgx.Identifier{column}.Sanitize())
					updated++
				}
				if updated == 0 {
					sql.WriteString(" do nothing")
				} else {
					sql.WriteString(" do update set ")
					sql.WriteString(assignments.String())
					var path [8]string
					scope, err := builder.scope(table, "target", path[:0])
					if err != nil {
						return nil, err
					}
					sql.WriteString(" where ")
					sql.WriteString(scope)
				}
			}
		}
		sql.WriteString(" returning ")
		sql.WriteString(projection)
		queryCtx, cancel := tx.queryContext(ctx)
		rows, err := tx.tx.Query(queryCtx, sql.String(), builder.values...)
		if err != nil {
			cancel()
			return nil, databaseError(err)
		}
		returned, err := decodeReturnedRows(rows)
		cancel()
		if err != nil {
			return nil, err
		}
		if !input.IgnoreConflicts && len(input.ConflictColumns) == 0 && len(returned) != end-start {
			return nil, erpwire.ErrForbidden
		}
		result = append(result, returned...)
		start = end
	}
	return result, nil
}

func (writer *writeTransaction) Update(ctx context.Context, name string, values erpwire.Row, where []erpwire.Predicate, returning []string) ([]erpwire.Row, error) {
	tx := writer.transaction
	if len(values) == 0 || len(where) == 0 {
		return nil, ErrInvalidInput
	}
	table, err := writeTable(tx.store.schema, name)
	if err != nil {
		return nil, err
	}
	columns := make([]string, 0, len(values))
	for column := range values {
		columns = append(columns, column)
	}
	slices.Sort(columns)
	if _, err := table.checkedColumns(columns, true); err != nil {
		return nil, err
	}
	if org, present := values["org_id"]; present && org != tx.actor.OrgID() {
		return nil, erpwire.ErrForbidden
	}
	if table.name == "profiles" {
		if id, present := values["id"]; present && id != tx.actor.UserID() {
			return nil, erpwire.ErrForbidden
		}
	}
	if table.name == "organizations" {
		if id, present := values["id"]; present && id != tx.actor.OrgID() {
			return nil, erpwire.ErrForbidden
		}
	}
	builder := queryBuilder{transaction: tx}
	predicate, err := builder.where(table, "target", where, nil)
	if err != nil {
		return nil, err
	}
	parentScope, err := builder.prospectiveParentScope(table, "target", values)
	if err != nil {
		return nil, err
	}
	if parentScope != "" {
		predicate += " and (" + parentScope + ")"
	}
	projection, err := builder.projection(table, "target", returning, nil, 0)
	if err != nil {
		return nil, err
	}
	var sql strings.Builder
	sql.WriteString("update ")
	sql.WriteString(publicTable(name))
	sql.WriteString(" as target set ")
	for index, column := range columns {
		parameter, err := builder.parameter(values[column])
		if err != nil {
			return nil, err
		}
		if index > 0 {
			sql.WriteByte(',')
		}
		sql.WriteString(pgx.Identifier{column}.Sanitize())
		sql.WriteByte('=')
		sql.WriteString(parameter)
	}
	sql.WriteString(" where ")
	sql.WriteString(predicate)
	sql.WriteString(" returning ")
	sql.WriteString(projection)
	queryCtx, cancel := tx.queryContext(ctx)
	defer cancel()
	rows, err := tx.tx.Query(queryCtx, sql.String(), builder.values...)
	if err != nil {
		return nil, databaseError(err)
	}
	return decodeReturnedRows(rows)
}

func (writer *writeTransaction) Delete(ctx context.Context, name string, where []erpwire.Predicate, returning []string) ([]erpwire.Row, error) {
	tx := writer.transaction
	if len(where) == 0 {
		return nil, ErrInvalidInput
	}
	table, err := writeTable(tx.store.schema, name)
	if err != nil {
		return nil, err
	}
	builder := queryBuilder{transaction: tx}
	predicate, err := builder.where(table, "target", where, nil)
	if err != nil {
		return nil, err
	}
	projection, err := builder.projection(table, "target", returning, nil, 0)
	if err != nil {
		return nil, err
	}
	sql := "delete from " + publicTable(name) + " as target where " + predicate + " returning " + projection
	queryCtx, cancel := tx.queryContext(ctx)
	defer cancel()
	rows, err := tx.tx.Query(queryCtx, sql, builder.values...)
	if err != nil {
		return nil, databaseError(err)
	}
	return decodeReturnedRows(rows)
}

// A foreign-key update must not move a visible row/relation into another org
// merely because this user happens to be a member of both organizations.
func (builder *queryBuilder) prospectiveParentScope(table *tableSchema, alias string, values erpwire.Row) (string, error) {
	var result strings.Builder
	for _, key := range table.foreign {
		changed, detached := false, false
		for _, column := range key.columns {
			value, present := values[column]
			changed = changed || present
			detached = detached || present && value == nil
		}
		// A NULL reference cannot identify a foreign parent. Leave actual NULL
		// validity (including MATCH FULL and NOT NULL) to the real constraints.
		if !changed || detached {
			continue
		}
		parent := builder.transaction.store.schema.tables[key.foreignTable]
		if parent == nil || parent.name == "profiles" {
			continue
		}
		parentAlias := builder.alias()
		before, oldOrg, oldUser := len(builder.values), builder.orgParameter, builder.userParameter
		var path [8]string
		scope, err := builder.scope(parent, parentAlias, path[:0])
		if err != nil {
			builder.values = builder.values[:before]
			builder.orgParameter, builder.userParameter = oldOrg, oldUser
			continue
		}
		prospective := make([]string, len(key.columns))
		for index, column := range key.columns {
			if value, present := values[column]; present {
				parameter, err := builder.parameter(value)
				if err != nil {
					return "", err
				}
				prospective[index] = parameter
			} else {
				prospective[index] = qualified(alias, column)
			}
		}
		if result.Len() > 0 {
			result.WriteString(" and ")
		}
		result.WriteByte('(')
		for _, column := range key.columns {
			if _, present := values[column]; !present {
				result.WriteString(qualified(alias, column))
				result.WriteString(" is null or ")
			}
		}
		// Only existing typed columns need a NULL guard. New non-NULL bound
		// values are checked by equality, avoiding ambiguous parameter types.
		result.WriteString("exists(select 1 from ")
		result.WriteString(publicTable(parent.name))
		result.WriteByte(' ')
		result.WriteString(pgx.Identifier{parentAlias}.Sanitize())
		result.WriteString(" where ")
		result.WriteString(scope)
		for index, expression := range prospective {
			result.WriteString(" and ")
			result.WriteString(qualified(parentAlias, key.foreignColumns[index]))
			result.WriteByte('=')
			result.WriteString(expression)
		}
		result.WriteString("))")
	}
	return result.String(), nil
}
