// Package erpmetrics implements authenticated workspace aggregate loaders.
package erpmetrics

import (
 "context"
 "encoding/json"
 "errors"
 "math/big"
 "time"

 "github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type Options struct {
 Store erpwire.Store
 Now func() time.Time
}
type Service struct { store erpwire.Store; now func() time.Time }
func New(options Options) (*Service, error) {
 if options.Store == nil { return nil, errors.New("metrics store required") }
 if options.Now == nil { options.Now = time.Now }
 return &Service{store: options.Store, now: options.Now}, nil
}

func (s *Service) Operations() map[string]erpwire.Operation {
 return map[string]erpwire.Operation{
  "lib/queries/dashboard.ts::getDashboardData": s.operation(s.dashboard),
  "lib/blueprint/queries.ts::getBlueprintOrgSummary": s.operation(s.blueprint),
  "components/warehouse/data.ts::organizationSnapshot": s.operation(s.organization),
  "app/(app)/dashboard/page.tsx::load": s.operation(s.dashboardPage),
  "app/(app)/blueprint/page.tsx::load": s.operation(s.blueprintPage),
  "app/warehouse/page.tsx::load": s.operation(s.organizationPage),
 }
}
type loader func(context.Context, erpwire.ReadTx, erpwire.Actor, time.Time) (any, error)
func (s *Service) operation(load loader) erpwire.Operation {
 return func(ctx context.Context, actor erpwire.Actor, raw json.RawMessage) (any, error) {
  args, err := erpwire.ParseArguments(raw)
  if err != nil || len(args) != 0 { return nil, erpwire.ErrBadArguments }
  now := s.now()
  if err := actor.Validate(time.Now()); err != nil { return nil, err }
  var result any
  err = s.store.Read(ctx, actor, func(tx erpwire.ReadTx) error {
   var err error
   result, err = load(ctx, tx, actor, now)
   return err
  })
  if err != nil { return nil, publicError(err) }
  return result, nil
 }
}
var errData = errors.New("Workspace aggregate data unavailable. Reload to retry.")
func publicError(err error) error {
 for _, safe := range []error{erpwire.ErrUnauthenticated, erpwire.ErrForbidden, erpwire.ErrStepUpRequired, erpwire.ErrAuthUnavailable, erpwire.ErrIdentityChanged, erpwire.ErrUnsafeAmount} {
  if errors.Is(err, safe) { return safe }
 }
 return errData
}
var bangkok = time.FixedZone("Asia/Bangkok", 7*60*60)
func eq(column string, value any) erpwire.Predicate { return erpwire.Predicate{Column:column, Op:erpwire.Equal, Value:value} }
func pred(column string, op erpwire.FilterOp, value any) erpwire.Predicate { return erpwire.Predicate{Column:column, Op:op, Value:value} }
func selection(actor erpwire.Actor, table string, columns []string, where ...erpwire.Predicate) erpwire.Select {
 return erpwire.Select{Table: table, Columns:columns, Where:append([]erpwire.Predicate{eq("org_id",actor.OrgID())}, where...), Order:[]erpwire.Order{{Column:"id"}}, Limit:1000}
}
func all(ctx context.Context, tx erpwire.ReadTx, q erpwire.Select) ([]erpwire.Row, error) {
 rows := []erpwire.Row{}
 for {
  page, err := tx.Select(ctx,q)
  if err != nil { return nil, err }
  rows = append(rows,page.Rows...)
  if !page.HasMore { return rows,nil }
  if len(page.Rows)==0 { return nil,errData }
  q.Offset += len(page.Rows)
 }
}
func rowsAs[T any](rows []erpwire.Row) ([]T,error) {
 data, err := json.Marshal(rows)
 if err != nil { return nil,errData }
 var result []T
 if erpwire.DecodeJSON(data,&result)!=nil { return nil,errData }
 if result==nil { result=[]T{} }
 return result,nil
}
func readAs[T any](ctx context.Context, tx erpwire.ReadTx, q erpwire.Select) ([]T,error) {
 rows,err:=all(ctx,tx,q); if err!=nil { return nil,err }; return rowsAs[T](rows)
}
func count(ctx context.Context,tx erpwire.ReadTx,q erpwire.Select)(int64,error){
 q.Count=true; q.Limit=1
 result,err:=tx.Select(ctx,q)
 if err!=nil { return 0,err }
 if result.Total==nil || *result.Total<0 || *result.Total>erpwire.MaxSafeInteger { return 0,errData }
 return *result.Total,nil
}
func safe(n int64)(int64,error){ if n < -erpwire.MaxSafeInteger || n > erpwire.MaxSafeInteger { return 0,erpwire.ErrUnsafeAmount }; return n,nil }
func add(a,b int64)(int64,error){ if _,err:=safe(a);err!=nil{return 0,err};if _,err:=safe(b);err!=nil{return 0,err};return safe(a+b) }
func roundedProduct(a,b,denominator int64)(int64,error){
 if a<0 || b<0 { return 0,errData }
 if _,err:=safe(a);err!=nil{return 0,err};if _,err:=safe(b);err!=nil{return 0,err}
 var value big.Int
 value.Mul(big.NewInt(a),big.NewInt(b)); value.Add(&value,big.NewInt(denominator/2));value.Quo(&value,big.NewInt(denominator))
 if !value.IsInt64(){return 0,erpwire.ErrUnsafeAmount};return safe(value.Int64())
}
func dateMonth(value string)(string,error){
 if len(value)==10 { if _,err:=time.Parse("2006-01-02",value);err!=nil{return "",errData};return value[:7],nil }
 instant,err:=time.Parse(time.RFC3339Nano,value);if err!=nil{return "",errData};return instant.In(bangkok).Format("2006-01"),nil
}
