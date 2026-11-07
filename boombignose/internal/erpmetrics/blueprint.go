package erpmetrics

import (
 "context"
 "time"

 "github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type BlueprintOrgSummary struct {
 OrgRole erpwire.Role `json:"orgRole"`
 ClientsTotal int64 `json:"clientsTotal"`
 DealsTotal int64 `json:"dealsTotal"`
 DealsWon int64 `json:"dealsWon"`
 DealsOpen int64 `json:"dealsOpen"`
 QuotesTotal int64 `json:"quotesTotal"`
 QuotesAcceptedOrConverted int64 `json:"quotesAcceptedOrConverted"`
 QuotesOpen int64 `json:"quotesOpen"`
 ProjectsTotal int64 `json:"projectsTotal"`
 ProjectsActive int64 `json:"projectsActive"`
 MilestonesTotal int64 `json:"milestonesTotal"`
 MilestonesDone int64 `json:"milestonesDone"`
 TimeEntriesTotal int64 `json:"timeEntriesTotal"`
 InvoicesTotal int64 `json:"invoicesTotal"`
 InvoicesIssued int64 `json:"invoicesIssued"`
 PaymentClaimsPending int64 `json:"paymentClaimsPending"`
 PaymentClaimsVerified int64 `json:"paymentClaimsVerified"`
 PaymentsVerified int64 `json:"paymentsVerified"`
 PaymentAllocationsTotal int64 `json:"paymentAllocationsTotal"`
 SubscriptionsActive int64 `json:"subscriptionsActive"`
 OutboundEventsQueued *int64 `json:"outboundEventsQueued"`
 OutboundEventsDelivered *int64 `json:"outboundEventsDelivered"`
 AIOutputsCached int64 `json:"aiOutputsCached"`
}
func (s *Service) blueprint(ctx context.Context,tx erpwire.ReadTx,actor erpwire.Actor,now time.Time)(any,error){return s.blueprintSummary(ctx,tx,actor)}
func (s *Service) blueprintSummary(ctx context.Context,tx erpwire.ReadTx,actor erpwire.Actor)(BlueprintOrgSummary,error){
 d:=BlueprintOrgSummary{OrgRole:actor.Role()}
 specs:=[]struct{target *int64;table string;where []erpwire.Predicate}{
  {&d.ClientsTotal,"clients",nil},
  {&d.DealsTotal,"deals",nil},
  {&d.DealsWon,"deals",[]erpwire.Predicate{eq("stage","won")}},
  {&d.DealsOpen,"deals",[]erpwire.Predicate{pred("stage",erpwire.NotEqual,"won"),pred("stage",erpwire.NotEqual,"lost")}},
  {&d.QuotesTotal,"quotes",nil},
  {&d.QuotesAcceptedOrConverted,"quotes",[]erpwire.Predicate{pred("status",erpwire.In,[]string{"accepted","converted"})}},
  {&d.QuotesOpen,"quotes",[]erpwire.Predicate{pred("status",erpwire.In,[]string{"draft","sent","accepted"})}},
  {&d.ProjectsTotal,"projects",nil},
  {&d.ProjectsActive,"projects",[]erpwire.Predicate{pred("status",erpwire.In,[]string{"not_started","in_progress","review","support"})}},
  {&d.MilestonesTotal,"milestones",nil},
  {&d.MilestonesDone,"milestones",[]erpwire.Predicate{eq("done",true)}},
  {&d.TimeEntriesTotal,"time_entries",nil},
  {&d.InvoicesTotal,"invoices",nil},
  {&d.InvoicesIssued,"invoices",[]erpwire.Predicate{pred("issued_snapshot_id",erpwire.NotEqual,nil)}},
  {&d.PaymentClaimsPending,"payment_claims",[]erpwire.Predicate{eq("status","pending")}},
  {&d.PaymentClaimsVerified,"payment_claims",[]erpwire.Predicate{eq("status","verified")}},
  {&d.PaymentsVerified,"payments",[]erpwire.Predicate{eq("verification_state","verified")}},
  {&d.PaymentAllocationsTotal,"payment_allocations",nil},
  {&d.SubscriptionsActive,"subscriptions",[]erpwire.Predicate{eq("status","active")}},
  {&d.AIOutputsCached,"ai_outputs",nil},
 }
 for _,spec:=range specs {n,err:=count(ctx,tx,selection(actor,spec.table,[]string{"id"},spec.where...));if err!=nil{return d,err};*spec.target=n}
 if actor.Role()==erpwire.Owner || actor.Role()==erpwire.Admin {
  queued,err:=count(ctx,tx,selection(actor,"outbound_events",[]string{"id"},eq("status","queued")));if err!=nil{return d,err}
  delivered,err:=count(ctx,tx,selection(actor,"outbound_events",[]string{"id"},eq("status","delivered")));if err!=nil{return d,err}
  d.OutboundEventsQueued=&queued;d.OutboundEventsDelivered=&delivered
 }
 return d,nil
}
type BlueprintPageData struct { Model BlueprintSceneModel `json:"model"` }
func (s *Service) blueprintPage(ctx context.Context,tx erpwire.ReadTx,actor erpwire.Actor,now time.Time)(any,error){
 summary,err:=s.blueprintSummary(ctx,tx,actor);if err!=nil{return nil,err};return BlueprintPageData{Model:buildBlueprintScene(summary)},nil
}
