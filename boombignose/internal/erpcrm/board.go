package erpcrm

import (
 "context"
 "encoding/json"
 "sort"
 "time"

 "github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
 "github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type BoardColumn struct { ID string `json:"id"`; Label string `json:"label"`; FoldedByDefault bool `json:"foldedByDefault,omitempty"` }
type BoardCard struct {
 ID string `json:"id"`; Stage string `json:"stage"`; Title string `json:"title"`; Href string `json:"href"`
 AmountSatang money.Satang `json:"amountSatang"`; Probability int64 `json:"probability"`
 Client *string `json:"client"`; Owner *string `json:"owner"`; Due *string `json:"due"`
}
type DealsPageData struct {
 AllDeals []erpwire.Row `json:"allDeals"`; Deals []erpwire.Row `json:"deals"`; ListRows []erpwire.Row `json:"listRows"`
 Config FacetConfig `json:"config"`; View string `json:"view"`; FacetQuery string `json:"facetQuery"`
 Clients []erpwire.Row `json:"clients"`; SavedViews []SavedView `json:"savedViews"`; LostReasons []erpwire.Row `json:"lostReasons"`
 OwnerName erpwire.BrowserMap `json:"ownerName"`; NextActivity erpwire.BrowserMap `json:"nextActivity"`
 VisibleColumns []BoardColumn `json:"visibleColumns"`; MoveTargets []BoardColumn `json:"moveTargets"`; Cards []BoardCard `json:"cards"`
 OpenValue money.Satang `json:"openValue"`; Weighted money.Satang `json:"weighted"`
 Groups []RowGroup `json:"groups"`; Today string `json:"today"`; StorageKey string `json:"storageKey"`; CanManageReasons bool `json:"canManageReasons"`
}
func columns()[]BoardColumn{out:=make([]BoardColumn,0,len(stages));for _,stage:=range stages{out=append(out,BoardColumn{ID:stage,Label:facetLabel(stage),FoldedByDefault:stage=="won"||stage=="lost"})};return out}
func ptrText(value string)*string{if value==""{return nil};return &value}
func earliest(a,b string)*string {if a==""{return ptrText(b)};if b==""||a<b{return &a};return &b}
func namedOptions(ctx context.Context,tx erpwire.ReadTx,a erpwire.Actor,table string,active bool)([]erpwire.Row,error){q:=erpwire.Select{Table:table,Columns:[]string{"id","name"},Where:[]erpwire.Predicate{eq("org_id",a.OrgID())},Order:ordered("name","id")};if active{q.Where=append(q.Where,eq("active",true))};return all(ctx,tx,q)}
func ownerNames(ctx context.Context,tx erpwire.ReadTx,a erpwire.Actor,deals []erpwire.Row)(map[string]string,erpwire.BrowserMap,error){
 wanted:=map[string]bool{};for _,deal:=range deals{if id:=text(deal["owner"]);id!=""{wanted[id]=true}}
 names:=map[string]string{};entries:=[][2]any{};if len(wanted)==0{return names,erpwire.Map(entries),nil}
 raw,e:=tx.ReadRPC(ctx,"record_activity_assignees",erpwire.Row{"p_org_id":a.OrgID()});if e!=nil{return nil,erpwire.BrowserMap{},e};var profiles []erpwire.Row;if e=erpwire.DecodeJSON(raw,&profiles);e!=nil{return nil,erpwire.BrowserMap{},e}
 for _,profile:=range profiles{id,name:=text(profile["user_id"]),text(profile["full_name"]);if wanted[id]&&name!=""{names[id]=name;entries=append(entries,[2]any{id,name})}};return names,erpwire.Map(entries),nil
}
func (s *Service) dealsPage(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error){
 if e:=authorize(a,"");e!=nil{return nil,e};args,e:=arguments(raw,0,1);if e!=nil{return nil,e};params,e:=searchParams(args);if e!=nil{return nil,e};config:=parseFacets(params,"deals");now:=time.Now()
 out:=DealsPageData{Config:config,View:"board",FacetQuery:serializeFacets(config),Deals:[]erpwire.Row{},Cards:[]BoardCard{},Today:today(now),StorageKey:"kanban:deals:"+a.UserID(),CanManageReasons:authorize(a,"settings:manage")==nil,MoveTargets:columns(),VisibleColumns:[]BoardColumn{}}
 if text(params["view"])=="list"{out.View="list"};for _,column:=range out.MoveTargets{if config.Status==""||has(splitStatuses(config.Status),column.ID){out.VisibleColumns=append(out.VisibleColumns,column)}}
 var names map[string]string;next:=map[string]string{}
 e=s.store.Read(ctx,a,func(tx erpwire.ReadTx)error{
  var e error;out.AllDeals,e=all(ctx,tx,erpwire.Select{Table:"deals",Columns:[]string{"id","title","stage","value_satang","probability","sequence","client_id","owner","expected_close_date","next_follow_up_date","created_at"},Relations:[]erpwire.Relation{clientRelation()},Where:[]erpwire.Predicate{eq("org_id",a.OrgID())},Order:[]erpwire.Order{{Column:"created_at",Descending:true},{Column:"id"}}});if e!=nil{return e}
  out.Clients,e=namedOptions(ctx,tx,a,"clients",false);if e!=nil{return e};out.SavedViews,e=s.savedViews(ctx,tx,a,"deals");if e!=nil{return e};out.LostReasons,e=namedOptions(ctx,tx,a,"deal_lost_reasons",true);if e!=nil{return e}
  nextRows,e:=all(ctx,tx,erpwire.Select{Table:"deal_next_activity",Columns:[]string{"deal_id","next_due_date"},Where:[]erpwire.Predicate{eq("org_id",a.OrgID())},Order:ordered("deal_id")});if e!=nil{return e};entries:=make([][2]any,0,len(nextRows));for _,row:=range nextRows{next[text(row["deal_id"])]=text(row["next_due_date"]);entries=append(entries,[2]any{row["deal_id"],row["next_due_date"]})};out.NextActivity=erpwire.Map(entries)
  names,out.OwnerName,e=ownerNames(ctx,tx,a,out.AllDeals);return e
 });if e!=nil{return nil,loadError(e,"Deals unavailable. Please reload.")}
 sequences:=make(map[string]int64,len(out.AllDeals))
 for _,deal:=range out.AllDeals{
  value,e:=satang(deal["value_satang"]);if e!=nil{return nil,e};p,e:=integer(deal["probability"]);if e!=nil{return nil,e};weighted,e:=expected(value,p);if e!=nil{return nil,e};deal["expectedRevenueSatang"]=weighted
  sequence,e:=integer(deal["sequence"]);if e!=nil{return nil,e};sequences[text(deal["id"])]=sequence
  if has(stages[:5],text(deal["stage"])){out.OpenValue,e=checkedSum(out.OpenValue,value);if e!=nil{return nil,e};out.Weighted,e=checkedSum(out.Weighted,weighted);if e!=nil{return nil,e}}
  if matches(config,deal,text(deal["title"])+" "+relationName(deal,"client"),text(deal["expected_close_date"]),a,now){out.Deals=append(out.Deals,deal)}
 }
 out.ListRows=append([]erpwire.Row{},out.Deals...)
 if config.GroupBy=="stage"{index:=map[string]int{};for i,stage:=range stages{index[stage]=i};sort.SliceStable(out.ListRows,func(i,j int)bool{return index[text(out.ListRows[i]["stage"])]<index[text(out.ListRows[j]["stage"]) ]})}
 if config.GroupBy=="month"{sort.SliceStable(out.ListRows,func(i,j int)bool{a,b:=text(out.ListRows[i]["expected_close_date"]),text(out.ListRows[j]["expected_close_date"]);if a==""{a="9999-12-31"};if b==""{b="9999-12-31"};return a<b})}
 var group func(erpwire.Row)(string,string)
 if config.GroupBy!=""{group=func(row erpwire.Row)(string,string){switch config.GroupBy{case "stage":stage:=text(row["stage"]);return stage,facetLabel(stage);case "client":label:=relationName(row,"client");if label==""{label="Unassigned"};return text(row["client_id"]),label;case "owner":owner:=text(row["owner"]);name:=names[owner];if name==""{name="Unassigned"};return owner,name;default:date:=text(row["expected_close_date"]);if len(date)>=7{return date[:7],date[:7]};return "","No close date"}}}
 out.Groups,e=groupRows(out.ListRows,group,true);if e!=nil{return nil,e}
 sorted:=append([]erpwire.Row{},out.Deals...);sort.SliceStable(sorted,func(i,j int)bool{return sequences[text(sorted[i]["id"])]<sequences[text(sorted[j]["id"])]})
 for _,deal:=range sorted{value,e:=satang(deal["value_satang"]);if e!=nil{return nil,e};p,e:=integer(deal["probability"]);if e!=nil{return nil,e};id:=text(deal["id"]);out.Cards=append(out.Cards,BoardCard{ID:id,Stage:text(deal["stage"]),Title:text(deal["title"]),Href:"/deals/"+id,AmountSatang:value,Probability:p,Client:ptrText(relationName(deal,"client")),Owner:ptrText(names[text(deal["owner"])]),Due:earliest(text(deal["next_follow_up_date"]),next[id])})}
 return out,nil
}
func splitStatuses(value string)[]string{out:=[]string{};start:=0;for i:=0;i<=len(value);i++{if i==len(value)||value[i]==','{out=append(out,value[start:i]);start=i+1}};return out}
