package erpmetrics

import (
 "context"
 "math/big"
 "strconv"
 "time"

 "github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type FollowUp struct { ID string `json:"id"`; Body *string `json:"body"`; Type string `json:"type"`; DueDate *string `json:"due_date"` }
type RevenueMonth struct { Month string `json:"month"`; RevenueSatang int64 `json:"revenueSatang"` }
type DashboardData struct {
 CashSatang int64 `json:"cashSatang"`
 MonthlyRevenueSatang int64 `json:"monthlyRevenueSatang"`
 RevenueHistory []RevenueMonth `json:"revenueHistory"`
 MonthlyBurnSatang int64 `json:"monthlyBurnSatang"`
 MonthlyCogsSatang int64 `json:"monthlyCogsSatang"`
 NetBurnSatang int64 `json:"netBurnSatang"`
 RunwayMonths *float64 `json:"runwayMonths"`
 PipelineSatang int64 `json:"pipelineSatang"`
 WeightedPipelineSatang int64 `json:"weightedPipelineSatang"`
 MrrSatang int64 `json:"mrrSatang"`
 InvoiceMrrSatang int64 `json:"invoiceMrrSatang"`
 SubscriptionMrrSatang int64 `json:"subscriptionMrrSatang"`
 OpenQuotesCount int64 `json:"openQuotesCount"`
 OpenQuotesValueSatang int64 `json:"openQuotesValueSatang"`
 BillableHoursThisMonth float64 `json:"billableHoursThisMonth"`
 BillableValueThisMonthSatang int64 `json:"billableValueThisMonthSatang"`
 UtilizationThisMonth float64 `json:"utilizationThisMonth"`
 UnpaidSatang int64 `json:"unpaidSatang"`
 UnpaidInvoiceCount int64 `json:"unpaidInvoiceCount"`
 OverdueInvoiceCount int64 `json:"overdueInvoiceCount"`
 ActiveProjectCount int64 `json:"activeProjectCount"`
 NewClientsThisMonth int64 `json:"newClientsThisMonth"`
 FollowUpsDueToday []FollowUp `json:"followUpsDueToday"`
 OverdueFollowUps []FollowUp `json:"overdueFollowUps"`
}
type invoice struct {
 ID string `json:"id"`; Status string `json:"status"`; Amount int64 `json:"amount_satang"`; Total int64 `json:"total_satang"`; VAT int64 `json:"vat_satang"`; IssueDate string `json:"issue_date"`; Recurring bool `json:"is_recurring"`; Interval *string `json:"recurring_interval"`; DueDate *string `json:"due_date"`
}
type balance struct { ID string `json:"invoice_id"`; Paid int64 `json:"paid_satang"`; Credited int64 `json:"credited_satang"`; Outstanding int64 `json:"outstanding_satang"` }
type recurring struct { Status string `json:"status"`; Amount int64 `json:"amount_satang"`; Interval string `json:"interval"` }
type accumulator struct { err error }
func (a *accumulator) sum(target *int64,n int64){ if a.err!=nil{return};*target,a.err=add(*target,n) }
func (a *accumulator) valid(values ...int64){ for _,value:=range values { if a.err!=nil{return};_,a.err=safe(value) } }
func (a *accumulator) product(x,y,d int64)int64 { if a.err!=nil{return 0};n,err:=roundedProduct(x,y,d);a.err=err;return n }
func (a *accumulator) monthly(values []recurring)int64 {
 factors:=map[string]int64{"weekly":52,"monthly":12,"quarterly":4,"yearly":1}
 total:=new(big.Int)
 for _,v:=range values {
  a.valid(v.Amount);factor,ok:=factors[v.Interval];if !ok || v.Amount<0 { a.err=errData;return 0 }
  var term big.Int;term.Mul(big.NewInt(v.Amount),big.NewInt(factor));total.Add(total,&term)
 }
 total.Add(total,big.NewInt(6));total.Quo(total,big.NewInt(12))
 if !total.IsInt64(){a.err=erpwire.ErrUnsafeAmount;return 0};n:=total.Int64();a.valid(n);return n
}
func (s *Service) dashboard(ctx context.Context,tx erpwire.ReadTx,actor erpwire.Actor,now time.Time)(any,error){
 d,err:=s.dashboardData(ctx,tx,actor,now);return d,err
}
func (s *Service) dashboardData(ctx context.Context,tx erpwire.ReadTx,actor erpwire.Actor,now time.Time)(DashboardData,error){
 d:=DashboardData{RevenueHistory:[]RevenueMonth{},FollowUpsDueToday:[]FollowUp{},OverdueFollowUps:[]FollowUp{}}
 local:=now.In(bangkok);month:=local.Format("2006-01");today:=local.Format("2006-01-02")
 start:=time.Date(local.Year(),local.Month(),1,0,0,0,0,bangkok);next:=start.AddDate(0,1,0)
 oldestMonth:=start.AddDate(0,-5,0).Format("2006-01")
 deals,err:=readAs[struct{Stage string `json:"stage"`;Value int64 `json:"value_satang"`;Probability int64 `json:"probability"`}](ctx,tx,selection(actor,"deals",[]string{"stage","value_satang","probability"}));if err!=nil{return d,err}
 invoices,err:=readAs[invoice](ctx,tx,selection(actor,"invoices",[]string{"id","status","amount_satang","total_satang","vat_satang","issue_date","is_recurring","recurring_interval","due_date"}));if err!=nil{return d,err}
 payments,err:=readAs[struct{Amount int64 `json:"amount_satang"`;PaidAt string `json:"paid_at"`}](ctx,tx,selection(actor,"payments",[]string{"invoice_id","amount_satang","paid_at"},eq("verification_state","verified")));if err!=nil{return d,err}
 costs,err:=readAs[struct{Category string `json:"category"`;Amount int64 `json:"amount_satang"`;VAT int64 `json:"input_vat_satang"`;Date string `json:"incurred_on"`}](ctx,tx,selection(actor,"costs",[]string{"category","amount_satang","input_vat_satang","incurred_on"}));if err!=nil{return d,err}
 projects,err:=readAs[struct{Status string `json:"status"`}](ctx,tx,selection(actor,"projects",[]string{"status"}));if err!=nil{return d,err}
 activities,err:=readAs[struct{FollowUp;Done bool `json:"done"`}](ctx,tx,selection(actor,"activities",[]string{"id","body","type","due_date","done"}));if err!=nil{return d,err}
 settingsQ:=selection(actor,"org_settings",[]string{"cash_balance_satang","monthly_burn_satang"});settingsQ.Order=[]erpwire.Order{{Column:"org_id"}}
 settings,err:=readAs[struct{Cash *int64 `json:"cash_balance_satang"`;Burn *int64 `json:"monthly_burn_satang"`}](ctx,tx,settingsQ);if err!=nil{return d,err};if len(settings)>1{return d,errData}
 subs,err:=readAs[recurring](ctx,tx,selection(actor,"subscriptions",[]string{"status","amount_satang","interval"},eq("status","active")));if err!=nil{return d,err}
 quotes,err:=readAs[struct{Total int64 `json:"total_satang"`}](ctx,tx,selection(actor,"quotes",[]string{"status","total_satang"},pred("status",erpwire.In,[]string{"draft","sent","accepted"})));if err!=nil{return d,err}
 entries,err:=readAs[struct{Minutes int64 `json:"minutes"`;Billable bool `json:"billable"`;Rate *int64 `json:"rate_satang"`}](ctx,tx,selection(actor,"time_entries",[]string{"project_id","minutes","billable","rate_satang","work_date"},pred("work_date",erpwire.GreaterEqual,start.Format("2006-01-02")),pred("work_date",erpwire.Less,next.Format("2006-01-02"))));if err!=nil{return d,err}
 d.NewClientsThisMonth,err=count(ctx,tx,selection(actor,"clients",[]string{"id"},pred("created_at",erpwire.GreaterEqual,start.UTC().Format(time.RFC3339Nano)),pred("created_at",erpwire.Less,next.UTC().Format(time.RFC3339Nano))));if err!=nil{return d,err}
 cogsQ:=selection(actor,"monthly_inventory_cogs",[]string{"month","amount_satang"},eq("month",start.Format("2006-01-02")));cogsQ.Order=[]erpwire.Order{{Column:"month"}}
 cogs,err:=readAs[struct{Amount int64 `json:"amount_satang"`}](ctx,tx,cogsQ);if err!=nil{return d,err}
 balancesQ:=selection(actor,"invoice_balances",[]string{"invoice_id","paid_satang","credited_satang","outstanding_satang"});balancesQ.Order=[]erpwire.Order{{Column:"invoice_id"}}
 balances,err:=readAs[balance](ctx,tx,balancesQ);if err!=nil{return d,err}
 credits,err:=readAs[struct{Date string `json:"issue_date"`;Base int64 `json:"base_satang"`}](ctx,tx,selection(actor,"credit_note_revenue",[]string{"id","invoice_id","issue_date","project_id","client_name","base_satang","total_satang"}));if err!=nil{return d,err}
 a:=accumulator{}
 paidByID:=make(map[string]balance,len(balances));for _,b:=range balances { a.valid(b.Paid,b.Credited,b.Outstanding);paidByID[b.ID]=b }
 revenue:=map[string]int64{}
 invoiceRecurring:=[]recurring{}
 for _,i:=range invoices {
  a.valid(i.Amount,i.Total,i.VAT)
  if i.Status=="draft" || i.Status=="cancelled" {continue}
  key,e:=dateMonth(i.IssueDate);if e!=nil{return d,e};if key>=oldestMonth && key<=month {v:=revenue[key];a.sum(&v,i.Total-i.VAT);revenue[key]=v}
  if i.Recurring && i.Interval!=nil { invoiceRecurring=append(invoiceRecurring,recurring{Amount:i.Amount,Interval:*i.Interval}) }
  b:=paidByID[i.ID];remaining:=i.Amount-b.Credited-b.Paid
  if remaining>0 { a.sum(&d.UnpaidSatang,remaining);d.UnpaidInvoiceCount++ }
  // Canonical status checks paid plus credits before due dates; draft/cancelled are terminal.
  if !(i.Amount>0 && b.Paid+b.Credited>=i.Amount) && i.DueDate!=nil && *i.DueDate<today {d.OverdueInvoiceCount++}
 }
 creditTotals:=map[string]int64{}
 for _,credit:=range credits {a.valid(credit.Base);key,e:=dateMonth(credit.Date);if e!=nil{return d,e};if key>=oldestMonth && key<=month {v:=creditTotals[key];a.sum(&v,credit.Base);creditTotals[key]=v}}
 for i:=5;i>=0;i-- {key:=start.AddDate(0,-i,0).Format("2006-01");v:=revenue[key];a.sum(&v,-creditTotals[key]);d.RevenueHistory=append(d.RevenueHistory,RevenueMonth{key,v});if key==month{d.MonthlyRevenueSatang=v}}
 var cashReceived int64
 for _,p:=range payments { a.valid(p.Amount);key,e:=dateMonth(p.PaidAt);if e!=nil{return d,e};if key==month{a.sum(&cashReceived,p.Amount)} }
 for _,c:=range costs {a.valid(c.Amount,c.VAT);key,e:=dateMonth(c.Date);if e!=nil{return d,e};if c.Category!="inventory" && key==month{a.sum(&d.MonthlyBurnSatang,c.Amount)}}
 if len(settings)==1 {if settings[0].Cash!=nil{d.CashSatang=*settings[0].Cash;a.valid(d.CashSatang)};if settings[0].Burn!=nil{d.MonthlyBurnSatang=*settings[0].Burn;a.valid(d.MonthlyBurnSatang)}}
 a.sum(&d.NetBurnSatang,d.MonthlyBurnSatang);a.sum(&d.NetBurnSatang,-cashReceived)
 if d.NetBurnSatang>0 {ratio:=float64(d.CashSatang)/float64(d.NetBurnSatang);d.RunwayMonths=&ratio}
 for _,deal:=range deals {if !contains([]string{"lead","contacted","discovery","proposal","negotiation"},deal.Stage){continue};a.sum(&d.PipelineSatang,deal.Value);a.sum(&d.WeightedPipelineSatang,a.product(deal.Value,deal.Probability,100))}
 d.InvoiceMrrSatang=a.monthly(invoiceRecurring);d.SubscriptionMrrSatang=a.monthly(subs);d.MrrSatang=d.SubscriptionMrrSatang
 d.OpenQuotesCount=int64(len(quotes));for _,q:=range quotes{a.sum(&d.OpenQuotesValueSatang,q.Total)}
 var minutes,billableMinutes int64
 for _,entry:=range entries {a.sum(&minutes,entry.Minutes);if entry.Billable{a.sum(&billableMinutes,entry.Minutes);if entry.Rate!=nil{a.sum(&d.BillableValueThisMonthSatang,a.product(entry.Minutes,*entry.Rate,60))}}}
 d.BillableHoursThisMonth=float64(minutes)/60
 if minutes!=0{d.UtilizationThisMonth=float64(billableMinutes)/float64(minutes)}
 for _,p:=range projects {if contains([]string{"not_started","in_progress","review","support"},p.Status){d.ActiveProjectCount++}}
 for _,row:=range cogs{a.sum(&d.MonthlyCogsSatang,row.Amount)}
 for _,activity:=range activities {if activity.Done || activity.DueDate==nil{continue};if *activity.DueDate==today{d.FollowUpsDueToday=append(d.FollowUpsDueToday,activity.FollowUp)}else if *activity.DueDate<today{d.OverdueFollowUps=append(d.OverdueFollowUps,activity.FollowUp)}}
 return d,a.err
}
func contains(values []string,value string)bool{for _,v:=range values{if v==value{return true}};return false}

type RunwayLabel struct { Value string `json:"value"`;Hint string `json:"hint"`;Tone string `json:"tone"` }
type DashboardPageData struct { Data DashboardData `json:"d"`; OverdueBills int64 `json:"overdueBills"`; ExpenseApprovals *int64 `json:"expenseApprovals"`; Today string `json:"today"`; Runway RunwayLabel `json:"runway"`;MaxRevenue int64 `json:"maxRevenue"` }
func (s *Service) dashboardPage(ctx context.Context,tx erpwire.ReadTx,actor erpwire.Actor,now time.Time)(any,error){
 d,err:=s.dashboardData(ctx,tx,actor,now);if err!=nil{return nil,err}
 today:=now.In(bangkok).Format("2006-01-02")
 bills,err:=count(ctx,tx,selection(actor,"costs",[]string{"id"},pred("vendor_id",erpwire.NotEqual,nil),eq("paid_at",nil),pred("due_date",erpwire.Less,today)));if err!=nil{return nil,err}
 var approvals *int64
 if erpwire.Can(actor.Role(),"expense:approve") {n,e:=count(ctx,tx,selection(actor,"expense_claims",[]string{"id"},eq("status","submitted"),pred("employee",erpwire.NotEqual,actor.UserID())));if e!=nil{return nil,e};approvals=&n}
 label:=RunwayLabel{Value:"∞",Hint:"Revenue ≥ burn this month",Tone:"positive"}
 if d.RunwayMonths!=nil {
  label=RunwayLabel{Value:fixedOne(*d.RunwayMonths)+" mo",Hint:"Healthy runway",Tone:"default"}
  if *d.RunwayMonths<6{label.Hint="Runway under 6 months";label.Tone="negative"}else if *d.RunwayMonths<12{label.Hint="Keep an eye on burn";label.Tone="warning"}
 }
 maxRevenue:=d.RevenueHistory[0].RevenueSatang
 for _,row:=range d.RevenueHistory[1:]{if row.RevenueSatang>maxRevenue{maxRevenue=row.RevenueSatang}}
 return DashboardPageData{d,bills,approvals,today,label,maxRevenue},nil
}
// ECMAScript toFixed(1) rounds the exact binary ratio's decimal midpoint upward.
func fixedOne(value float64) string {
 negative:=value<0
 if negative{value=-value}
 ratio:=new(big.Rat).SetFloat64(value)
 numerator:=new(big.Int).Mul(ratio.Num(),big.NewInt(10))
 quotient,remainder:=new(big.Int),new(big.Int)
 quotient.QuoRem(numerator,ratio.Denom(),remainder)
 if remainder.Lsh(remainder,1).Cmp(ratio.Denom())>=0{quotient.Add(quotient,big.NewInt(1))}
 units,tenths:=new(big.Int),new(big.Int)
 units.QuoRem(quotient,big.NewInt(10),tenths)
 result:=units.String()+"."+strconv.FormatInt(tenths.Int64(),10)
 if negative{return "-"+result};return result
}
