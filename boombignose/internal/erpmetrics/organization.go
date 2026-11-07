package erpmetrics

import (
 "context"
 "time"

 "github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type Bilingual struct { TH string `json:"th"`; EN string `json:"en"` }
type WorkloadMetric struct { TH string `json:"th"`; EN string `json:"en"`; Count int64 `json:"count"`; Href string `json:"href"`; Attention *bool `json:"attention,omitempty"` }
type WorkloadModule struct { ID string `json:"id"`; TH string `json:"th"`; EN string `json:"en"`; Href string `json:"href"`; Workload int64 `json:"workload"`; Unit Bilingual `json:"unit"`; Metrics []WorkloadMetric `json:"metrics"`; Scope string `json:"scope"` }
type WorkloadTask struct { ID string `json:"id"`;Title string `json:"title"`;Status string `json:"status"`;DueDate *string `json:"dueDate"`;Href string `json:"href"` }
type OrganizationSnapshot struct { OrgName string `json:"orgName"`; Role erpwire.Role `json:"role"`; CapturedAt string `json:"capturedAt"`; Modules []WorkloadModule `json:"modules"`; Tasks []WorkloadTask `json:"tasks"`; Limited bool `json:"limited"` }
func metric(th,en string,n int64,href string)WorkloadMetric{return WorkloadMetric{TH:th,EN:en,Count:n,Href:href}}
func attention(m WorkloadMetric,on bool)WorkloadMetric{m.Attention=&on;return m}
func module(id,th,en,href string,n int64,unitTH,unitEN,scope string,metrics ...WorkloadMetric)WorkloadModule{return WorkloadModule{ID:id,TH:th,EN:en,Href:href,Workload:n,Unit:Bilingual{unitTH,unitEN},Scope:scope,Metrics:metrics}}
func (s *Service) organization(ctx context.Context,tx erpwire.ReadTx,actor erpwire.Actor,now time.Time)(any,error){return s.organizationSnapshot(ctx,tx,actor,now)}
func (s *Service) organizationSnapshot(ctx context.Context,tx erpwire.ReadTx,actor erpwire.Actor,now time.Time)(OrganizationSnapshot,error){
 d:=OrganizationSnapshot{OrgName:actor.OrgName(),Role:actor.Role(),CapturedAt:now.UTC().Format("2006-01-02T15:04:05.000Z"),Modules:[]WorkloadModule{},Tasks:[]WorkloadTask{},Limited:!erpwire.Can(actor.Role(),"purchase:manage") || !erpwire.Can(actor.Role(),"payment:verify")}
 today:=now.In(bangkok).Format("2006-01-02");mine:=actor.Role()==erpwire.Member;scope:="workspace";if mine{scope="mine"}
 query:=func(table string,where ...erpwire.Predicate)erpwire.Select {q:=selection(actor,table,[]string{"id"},where...);if mine{switch table{case "projects","quotes":q.Where=append(q.Where,eq("owner",actor.UserID()));case "project_tasks":q.Where=append(q.Where,eq("assignee",actor.UserID()))}};return q}
 n:=func(table string,where ...erpwire.Predicate)(int64,error){return count(ctx,tx,query(table,where...))}
 active,err:=n("projects",pred("status",erpwire.In,[]string{"not_started","in_progress","review","support","paused"}));if err!=nil{return d,err}
 open,err:=n("project_tasks",eq("done",false));if err!=nil{return d,err}
 overdue,err:=n("project_tasks",eq("done",false),pred("due_date",erpwire.Less,today));if err!=nil{return d,err}
 d.Modules=append(d.Modules,module("delivery","การส่งมอบ","Delivery","/projects?view=board",open,"งานที่ยังไม่เสร็จ","open tasks",scope,
  metric("โปรเจกต์ที่ยังไม่ปิด","Open projects",active,"/projects"),metric("งานที่ยังไม่เสร็จ","Open tasks",open,"/projects?view=board"),attention(metric("งานเลยกำหนด","Overdue tasks",overdue,"/projects"),overdue>0)))
 draft,err:=n("quotes",eq("status","draft"));if err!=nil{return d,err}
 sent,err:=n("quotes",eq("status","sent"));if err!=nil{return d,err};workload,err:=add(draft,sent);if err!=nil{return d,err}
 d.Modules=append(d.Modules,module("sales","การขาย","Sales","/quotes",workload,"ใบเสนอราคาร่างหรือส่งแล้ว","draft or sent quotes",scope,
  metric("ใบเสนอราคาร่าง","Draft quotes",draft,"/quotes?status=draft"),metric("ใบเสนอราคาที่ส่งแล้ว","Sent quotes",sent,"/quotes?status=sent")))
 approve:=erpwire.Can(actor.Role(),"expense:approve")
 draft,err=n("expense_claims",eq("employee",actor.UserID()),eq("status","draft"));if err!=nil{return d,err}
 employee:=eq("employee",actor.UserID());if approve{employee=pred("employee",erpwire.NotEqual,actor.UserID())}
 submitted,err:=n("expense_claims",eq("status","submitted"),employee);if err!=nil{return d,err};workload,err=add(draft,submitted);if err!=nil{return d,err}
 claimScope:="mine";th:="คำขอของฉันที่ส่งแล้ว";en:="My submitted claims";href:="/expenses"
 if approve{claimScope="workspace";th="รอฉันอนุมัติ (ไม่รวมของตนเอง)";en="Awaiting my approval (excludes own)";href="/expenses?tab=approve"}
 d.Modules=append(d.Modules,module("claims","ค่าใช้จ่าย","Expenses","/expenses",workload,"คำขอร่างและรอดำเนินการ","draft and pending claims",claimScope,
  metric("คำขอร่างของฉัน","My draft claims",draft,"/expenses"),attention(metric(th,en,submitted,href),approve && submitted>0)))
 if erpwire.Can(actor.Role(),"purchase:manage"){
  draft,err=n("purchase_orders",eq("status","draft"));if err!=nil{return d,err}
  incoming,e:=n("purchase_orders",pred("status",erpwire.In,[]string{"sent","confirmed"}));if e!=nil{return d,e};workload,e=add(draft,incoming);if e!=nil{return d,e}
  d.Modules=append(d.Modules,module("purchasing","การจัดซื้อ","Purchasing","/purchases",workload,"ใบสั่งซื้อร่าง ส่งแล้ว หรือยืนยันแล้ว","draft, sent or confirmed orders","workspace",
   metric("ใบสั่งซื้อร่าง","Draft orders",draft,"/purchases?status=draft"),metric("ส่งแล้วหรือยืนยันแล้ว","Sent or confirmed orders",incoming,"/purchases")))
 }
 if erpwire.Can(actor.Role(),"inventory:manage"){
  products,e:=n("products",eq("active",true),eq("is_stockable",true));if e!=nil{return d,e}
  warehouses,e:=n("warehouses",eq("active",true));if e!=nil{return d,e}
  d.Modules=append(d.Modules,module("stock","สินค้าคงคลัง","Stock","/inventory",products,"รายการสินค้าในแค็ตตาล็อก","catalog items","workspace",
   metric("รายการสินค้าที่เก็บสต็อกและใช้งานอยู่","Active stockable catalog items",products,"/products"),metric("คลังที่ใช้งานอยู่","Active warehouses",warehouses,"/inventory")))
 }
 if erpwire.Can(actor.Role(),"payment:verify"){
  statuses:=pred("status",erpwire.In,[]string{"sent","partially_paid","overdue"})
  open,e:=n("invoices",statuses);if e!=nil{return d,e};overdue,e:=n("invoices",statuses,pred("due_date",erpwire.Less,today));if e!=nil{return d,e}
  d.Modules=append(d.Modules,module("receivables","ลูกหนี้","Receivables","/finance",open,"ใบแจ้งหนี้สถานะยังเปิด","open-status invoices","workspace",
   metric("สถานะส่งแล้ว / ชำระบางส่วน / เกินกำหนด","Sent / partially paid / overdue status",open,"/finance"),attention(metric("สถานะยังเปิดและเลยกำหนดชำระ","Open-status invoices past due",overdue,"/finance"),overdue>0)))
 }
 preview:=query("project_tasks",eq("done",false));preview.Columns=[]string{"id","title","status","due_date","project_id"};preview.Order=[]erpwire.Order{{Column:"due_date",NullsFirst:false},{Column:"id"}};preview.Limit=8
 result,err:=tx.Select(ctx,preview);if err!=nil{return d,err}
 tasks,err:=rowsAs[struct{ID string `json:"id"`;Title string `json:"title"`;Status string `json:"status"`;DueDate *string `json:"due_date"`;ProjectID string `json:"project_id"`}](result.Rows);if err!=nil{return d,err}
 for _,task:=range tasks{d.Tasks=append(d.Tasks,WorkloadTask{task.ID,task.Title,task.Status,task.DueDate,"/projects/"+task.ProjectID+"#tasks"})}
 return d,nil
}
type OrganizationPageData struct { Snapshot OrganizationSnapshot `json:"snapshot"`;Lang string `json:"lang"` }
func (s *Service) organizationPage(ctx context.Context,tx erpwire.ReadTx,actor erpwire.Actor,now time.Time)(any,error){
 snapshot,err:=s.organizationSnapshot(ctx,tx,actor,now);if err!=nil{return nil,err}
 q:=erpwire.Select{Table:"profiles",Columns:[]string{"locale"},Where:[]erpwire.Predicate{eq("id",actor.UserID())},Order:[]erpwire.Order{{Column:"id"}},Limit:1}
 result,err:=tx.Select(ctx,q);if err!=nil{return nil,err};locale:="th"
 if len(result.Rows)>0 && result.Rows[0]["locale"]=="en"{locale="en"}
 return OrganizationPageData{snapshot,locale},nil
}
