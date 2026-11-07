// Package erpcrm implements the workspace CRM operations from the ERP application.
package erpcrm

import (
 "context"
 "encoding/json"
 "errors"
 "strconv"
 "strings"
 "time"

 "github.com/google/uuid"
 "github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
 "github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type TextGenerator interface {
 GenerateText(context.Context, string, string, int) (string, error)
}

type Options struct {
 Store erpwire.Store
 TextGenerator TextGenerator
 // Model is the actual configured local model identifier written to the output cache.
 Model string
}

type Service struct { store erpwire.Store; generator TextGenerator; model string }

func New(options Options) (*Service, error) {
 if options.Store == nil { return nil, errors.New("CRM store is required") }
 if options.TextGenerator != nil && strings.TrimSpace(options.Model) == "" { return nil, errors.New("CRM configured model identifier is required") }
 return &Service{store:options.Store, generator:options.TextGenerator, model:strings.TrimSpace(options.Model)}, nil
}

func (s *Service) Operations() map[string]erpwire.Operation {
 return map[string]erpwire.Operation{
  "app/(app)/clients/actions.ts::createClient":s.createClient,
  "app/(app)/clients/actions.ts::updateClient":s.updateClient,
  "app/(app)/clients/actions.ts::deleteClient":s.deleteClient,
  "app/(app)/clients/actions.ts::addContact":s.addContact,
  "app/(app)/clients/actions.ts::deleteContact":s.deleteContact,
  "app/(app)/deals/actions.ts::createDeal":s.createDeal,
  "app/(app)/deals/actions.ts::quickCreateDeal":s.quickCreateDeal,
  "app/(app)/deals/actions.ts::updateDeal":s.updateDeal,
  "app/(app)/deals/actions.ts::updateDealStage":s.updateDealStage,
  "app/(app)/deals/actions.ts::deleteDeal":s.deleteDeal,
  "app/(app)/deals/actions.ts::addActivity":s.addActivity,
  "app/(app)/deals/actions.ts::toggleActivityDone":s.toggleActivityDone,
  "app/(app)/deals/lost-reasons/actions.ts::addLostReason":s.addLostReason,
  "app/(app)/deals/lost-reasons/actions.ts::setLostReasonActive":s.setLostReasonActive,
  "app/(app)/deals/ai-actions.ts::summarizeDeal":s.summarizeDeal,
  "app/(app)/deals/ai-actions.ts::draftFollowup":s.draftFollowup,
  "app/(app)/clients/page.tsx::load":s.clientsPage,
  "app/(app)/clients/[id]/page.tsx::load":s.clientPage,
  "app/(app)/clients/[id]/edit/page.tsx::load":s.clientEditPage,
  "app/(app)/clients/new/page.tsx::load":s.clientNewPage,
  "app/(app)/deals/page.tsx::load":s.dealsPage,
  "app/(app)/deals/[id]/page.tsx::load":s.dealPage,
  "app/(app)/deals/[id]/edit/page.tsx::load":s.dealEditPage,
  "app/(app)/deals/new/page.tsx::load":s.dealNewPage,
  "app/(app)/deals/lost-reasons/page.tsx::load":s.reasonsPage,
  "app/(app)/deals/export/route.ts::GET":s.exportDeals,
 }
}

var stages = []string{"lead","contacted","discovery","proposal","negotiation","won","lost"}
const gone = "This deal no longer exists. Refresh to see the latest pipeline."
const quotedClient = "This deal has quotes for its current client. Unlink them before changing the client."
const reasonsPath = "/deals/lost-reasons"

func has(values []string, value string) bool { for _, v := range values { if v == value { return true } }; return false }
func validID(id string) bool { return len(id)==36 && uuid.Validate(id)==nil }
func text(v any) string { s,_:=v.(string); return s }
func nilText(v string) any { v=strings.TrimSpace(v); if v=="" { return nil }; return v }
func eq(column string, value any) erpwire.Predicate { return erpwire.Predicate{Column:column,Op:erpwire.Equal,Value:value} }
func scoped(a erpwire.Actor, id string) []erpwire.Predicate { return []erpwire.Predicate{eq("org_id",a.OrgID()),eq("id",id)} }
func response(redirect string, paths ...string) erpwire.ActionResponse { return erpwire.ActionResponse{Value:map[string]any{},Redirect:redirect,Refresh:paths} }
func invalid(message string) (any,error) { return erpwire.ActionResponse{Value:map[string]any{"error":message}},nil }
func authError(err error) bool { return errors.Is(err,erpwire.ErrUnauthenticated)||errors.Is(err,erpwire.ErrForbidden)||errors.Is(err,erpwire.ErrStepUpRequired)||errors.Is(err,erpwire.ErrAuthUnavailable)||errors.Is(err,erpwire.ErrIdentityChanged) }
func failure(err error) (any,error) {
 if authError(err) { return nil,err }
 var db interface { SQLState() string; ConstraintName() string }
 if errors.As(err,&db) {
  if db.SQLState()=="P0002" { return invalid(gone) }
  if db.ConstraintName()=="quotes_deal_client_fkey" { return invalid(quotedClient) }
 }
 var safe interface { BusinessMessage() string }
 if errors.As(err,&safe) && safe.BusinessMessage()!="" { return invalid(safe.BusinessMessage()) }
 var business businessError
 if errors.As(err,&business) { return invalid(business.Error()) }
 return invalid("Unable to save changes. Please try again.")
}
type businessError string
func (e businessError) Error() string { return string(e) }
func integer(v any) (int64,error) {
 switch n:=v.(type) {
 case int64:return n,nil
 case int:return int64(n),nil
 case int32:return int64(n),nil
 case int16:return int64(n),nil
 case json.Number:return strconv.ParseInt(n.String(),10,64)
 case string:return strconv.ParseInt(n,10,64)
 default:return 0,errors.New("CRM numeric value unavailable")
 }
}
func satang(v any) (money.Satang,error) { n,e:=integer(v); if e!=nil||n < -int64(money.MaxSafeSatang)||n>int64(money.MaxSafeSatang) {return 0,errors.New("CRM monetary value unavailable")}; return money.Satang(n),nil }
func numberText(v any) (string,bool) { switch n:=v.(type) {case string:return n,true; case json.Number:return n.String(),true; default:return "",false} }
func ordered(columns ...string) []erpwire.Order { orders:=make([]erpwire.Order,0,len(columns));for _,c:=range columns {orders=append(orders,erpwire.Order{Column:c})}; return orders }

type selector interface { Select(context.Context,erpwire.Select)(erpwire.Selection,error) }
func all(ctx context.Context, tx selector, q erpwire.Select) ([]erpwire.Row,error) {
 q.Limit=1000; q.Offset=0
 rows:=[]erpwire.Row{}
 for { page,e:=tx.Select(ctx,q);if e!=nil{return nil,e};rows=append(rows,page.Rows...);if !page.HasMore{return rows,nil};if len(page.Rows)==0{return nil,errors.New("CRM page unavailable")};q.Offset+=len(page.Rows) }
}
func one(ctx context.Context, tx selector, q erpwire.Select) (erpwire.Row,error) {
 q.Limit=1;result,e:=tx.Select(ctx,q);if e!=nil{return nil,e};if len(result.Rows)==0{return nil,nil};return result.Rows[0],nil
}
func (s *Service) audit(ctx context.Context,a erpwire.Actor,entity,id,action,summary string,meta erpwire.Row) {
 if meta==nil {meta=erpwire.Row{}}
 // The source audit is best effort and separate from the successful business mutation.
 _=s.store.Write(ctx,a,func(tx erpwire.WriteTx) error { _,e:=tx.Insert(ctx,erpwire.Insert{Table:"audit_log",Rows:[]erpwire.Row{{"org_id":a.OrgID(),"actor_id":a.UserID(),"actor_email":a.Email(),"entity":entity,"entity_id":id,"action":action,"summary":summary,"meta":meta}}});return e })
}
func authorize(a erpwire.Actor,capability erpwire.Capability) error { return a.Authorize(capability,time.Now()) }
func arguments(raw json.RawMessage,min,max int) (erpwire.Arguments,error) { args,e:=erpwire.ParseArguments(raw);if e!=nil||len(args)<min||len(args)>max{return nil,erpwire.ErrBadArguments};return args,nil }
func stringArg(args erpwire.Arguments,index int) (string,error) {var value string;e:=args.Decode(index,&value);return value,e}
