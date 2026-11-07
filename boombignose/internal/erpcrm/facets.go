package erpcrm

import (
 "context"
 "errors"
 "net/url"
 "strings"
 "time"
 "unicode/utf16"

 "github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
 "github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

type FacetConfig struct {
 Q string `json:"q,omitempty"`
 Status string `json:"status,omitempty"`
 Period string `json:"period,omitempty"`
 Mine string `json:"mine,omitempty"`
 GroupBy string `json:"groupBy,omitempty"`
}
type SavedView struct { ID string `json:"id"`; Name string `json:"name"`; Config FacetConfig `json:"config"` }
type RowGroup struct { Key string `json:"key"`; Label string `json:"label"`; Rows []erpwire.Row `json:"rows"`; TotalSatang *money.Satang `json:"totalSatang,omitempty"` }
var bangkok = time.FixedZone("Asia/Bangkok",7*60*60)
func today(now time.Time) string {return now.In(bangkok).Format("2006-01-02")}
func searchParams(args erpwire.Arguments) (erpwire.Row,error) {
 params:=erpwire.Row{};if !args.Present(0)||args.Null(0){return params,nil};if args.Decode(0,&params)!=nil||params==nil{return nil,erpwire.ErrBadArguments};return params,nil
}
func parseFacets(params erpwire.Row,list string) FacetConfig {
 get:=func(key string)string{return strings.TrimSpace(text(params[key]))};config:=FacetConfig{}
 q:=get("q");if jsLength(q)>200 {units:=utf16.Encode([]rune(q));q=string(utf16.Decode(units[:200]))};config.Q=q
 selected:=get("status");if selected==""&&list=="deals"{selected=get("stage")};picked:=[]string{};for _,value:=range strings.Split(selected,","){picked=append(picked,strings.TrimSpace(value))}
 statuses:=[]string{};if list=="deals"{for _,stage:=range stages{if has(picked,stage){statuses=append(statuses,stage)}}};config.Status=strings.Join(statuses,",")
 if has([]string{"this_month","last_month","this_quarter","this_year"},get("period")){config.Period=get("period")};if get("mine")=="1"{config.Mine="1"}
 groups:=[]string{"industry","source","month"};if list=="deals"{groups=[]string{"stage","client","owner","month"}};if has(groups,get("groupBy")){config.GroupBy=get("groupBy")};return config
}
func serializeFacets(c FacetConfig) string { // URLSearchParams preserves this source key order.
 values:=[][2]string{{"q",c.Q},{"status",c.Status},{"period",c.Period},{"mine",c.Mine},{"groupBy",c.GroupBy}};parts:=[]string{};for _,pair:=range values{if pair[1]!=""{parts=append(parts,url.QueryEscape(pair[0])+"="+url.QueryEscape(pair[1]))}};return strings.Join(parts,"&")
}
func dateOnly(value string) string {if len(value)==10{return value};t,e:=time.Parse(time.RFC3339Nano,value);if e!=nil{return ""};return today(t)}
func inPeriod(value,period string,now time.Time) bool {
 date:=dateOnly(value);if date==""{return false};now=now.In(bangkok);year,month,_:=now.Date();startMonth:=int(month);length:=1
 switch period{case "this_year":startMonth=1;length=12;case "this_quarter":startMonth=(startMonth-1)/3*3+1;length=3;case "last_month":startMonth--}
 start:=time.Date(year,time.Month(startMonth),1,0,0,0,0,time.UTC);return date>=start.Format("2006-01-02")&&date<start.AddDate(0,length,0).Format("2006-01-02")
}
func matches(c FacetConfig,row erpwire.Row,label,date string,a erpwire.Actor,now time.Time)bool {
 return (c.Q==""||strings.Contains(strings.ToLower(label),strings.ToLower(c.Q)))&&(c.Status==""||has(strings.Split(c.Status,","),text(row["stage"])))&&(c.Period==""||inPeriod(date,c.Period,now))&&(c.Mine==""||text(row["owner"])==a.UserID())
}
func (s *Service) savedViews(ctx context.Context,tx erpwire.ReadTx,a erpwire.Actor,list string)([]SavedView,error) {
 rows,e:=all(ctx,tx,erpwire.Select{Table:"saved_views",Columns:[]string{"id","name","config"},Where:[]erpwire.Predicate{eq("org_id",a.OrgID()),eq("user_id",a.UserID()),eq("module",list)},Order:ordered("created_at","id")});if e!=nil{return nil,e};views:=make([]SavedView,0,len(rows))
 for _,r:=range rows{config:=erpwire.Row{};switch v:=r["config"].(type){case map[string]any:config=v;case erpwire.Row:config=v};views=append(views,SavedView{ID:text(r["id"]),Name:text(r["name"]),Config:parseFacets(config,list)})};return views,nil
}
func relationName(row erpwire.Row,key string) string {switch v:=row[key].(type){case map[string]any:return text(v["name"]);case erpwire.Row:return text(v["name"])};return ""}
func clientRelation() erpwire.Relation{return erpwire.Relation{Name:"client",Table:"clients",LocalColumn:"client_id",ForeignColumn:"id",Columns:[]string{"name"}}}
func reasonRelation() erpwire.Relation{return erpwire.Relation{Name:"lost_reason",Table:"deal_lost_reasons",LocalColumn:"lost_reason_id",ForeignColumn:"id",Columns:[]string{"name"}}}
func expected(value money.Satang,probability int64)(money.Satang,error){if value<0||probability<0||probability>100{return 0,errors.New("CRM expected revenue unavailable")};return value/100*money.Satang(probability)+money.Satang((int64(value%100)*probability+50)/100),nil}
func checkedSum(total,value money.Satang)(money.Satang,error){if value>0&&total>money.MaxSafeSatang-value||value<0&&total < -money.MaxSafeSatang-value{return 0,errors.New("CRM total exceeds safe monetary range")};return total+value,nil}
func groupRows(rows []erpwire.Row,group func(erpwire.Row)(string,string),amount bool)([]RowGroup,error) {
 groups:=[]RowGroup{};positions:=map[string]int{}
 for _,row:=range rows{key,label:="all","";if group!=nil{key,label=group(row)};index,ok:=positions[key];if !ok{index=len(groups);positions[key]=index;g:=RowGroup{Key:key,Label:label,Rows:[]erpwire.Row{}};if amount{zero:=money.Satang(0);g.TotalSatang=&zero};groups=append(groups,g)};groups[index].Rows=append(groups[index].Rows,row);if amount{v,e:=satang(row["value_satang"]);if e!=nil{return nil,e};sum,e:=checkedSum(*groups[index].TotalSatang,v);if e!=nil{return nil,e};*groups[index].TotalSatang=sum}}
 return groups,nil
}
func facetLabel(value string)string{words:=strings.Split(value,"_");for i,w:=range words{if len(w)>0{words[i]=strings.ToUpper(w[:1])+w[1:]}};return strings.Join(words," ")}
