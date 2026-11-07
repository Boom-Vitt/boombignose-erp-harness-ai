package erpcrm

import (
 "context"
 "encoding/json"
 "strings"

 "github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
 "github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func dealColumns(input erpwire.Row,quick bool)(erpwire.Row,string) {
 client:=text(input["clientId"]);if !validID(client){return nil,"Pick a client"}
 title,ok:=input["title"].(string);if !ok||jsLength(title)==0{return nil,"Title is required"}
 stage:=text(input["stage"]);if !has(stages,stage){return nil,"Invalid input"}
 value,ok:=numberText(input["valueBaht"]);if !ok{return nil,"Invalid input"};if strings.HasPrefix(strings.TrimSpace(value),"-"){return nil,"Value can't be negative"}
 amount,e:=money.ParseBaht(value);if e!=nil{return nil,"Enter a safe nonnegative THB amount with up to two decimals"}
 columns:=erpwire.Row{"client_id":client,"title":strings.TrimSpace(title),"stage":stage,"value_satang":int64(amount),"lost_reason_id":nil,"expected_close_date":nil,"next_follow_up_date":nil,"source":nil,"notes":nil}
 if quick {if stage=="lost"{return nil,"Create the deal first, then mark it lost"};return columns,""}
 if v,present:=input["probability"];present { n,ok:=numberText(v);if !ok{return nil,"Probability is 0 to 100"};p,e:=integer(n);if e!=nil||p<0||p>100{return nil,"Probability is 0 to 100"};columns["probability"]=p }
 if !optionalStrings(input,"lostReasonId","expectedCloseDate","nextFollowUpDate","source","notes"){return nil,"Invalid input"}
 reason:=text(input["lostReasonId"]);if reason!=""&&!validID(reason){return nil,"Invalid input"};if stage=="lost" {if reason==""{return nil,"Pick a lost reason"};columns["lost_reason_id"]=reason}
 for key,column:=range map[string]string{"expectedCloseDate":"expected_close_date","nextFollowUpDate":"next_follow_up_date","source":"source","notes":"notes"}{columns[column]=nilText(text(input[key]))}
 return columns,""
}
func (s *Service) insertDeal(ctx context.Context,a erpwire.Actor,columns erpwire.Row)(string,error) {
 columns["org_id"]=a.OrgID();var id string
 e:=s.store.Write(ctx,a,func(tx erpwire.WriteTx)error {rows,e:=tx.Insert(ctx,erpwire.Insert{Table:"deals",Rows:[]erpwire.Row{columns},Returning:[]string{"id"}});if e!=nil{return e};if len(rows)!=1{return erpwire.ErrNotFound};id=text(rows[0]["id"]);return nil})
 if e==nil{s.audit(ctx,a,"deal",id,"created",`Created deal "`+text(columns["title"])+`"`,nil)}
 return id,e
}
func (s *Service) createDeal(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {return s.createDealAction(ctx,a,raw,false)}
func (s *Service) quickCreateDeal(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {return s.createDealAction(ctx,a,raw,true)}
func (s *Service) createDealAction(ctx context.Context,a erpwire.Actor,raw json.RawMessage,quick bool)(any,error) {
 if e:=authorize(a,"");e!=nil{return nil,e};args,e:=arguments(raw,1,1);if e!=nil{return nil,e};var input erpwire.Row;if args.Decode(0,&input)!=nil{return invalid("Invalid input")}
 columns,message:=dealColumns(input,quick);if message!=""{return invalid(message)};id,e:=s.insertDeal(ctx,a,columns);if e!=nil{return failure(e)}
 redirect:="/deals/"+id;if quick{redirect=""};return response(redirect,"/deals"),nil
}
func (s *Service) updateDeal(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {
 if e:=authorize(a,"");e!=nil{return nil,e};args,e:=arguments(raw,2,2);if e!=nil{return nil,e};id,e:=stringArg(args,0);if e!=nil{return nil,e};var input erpwire.Row
 if args.Decode(1,&input)!=nil{return invalid("Invalid input")};columns,message:=dealColumns(input,false);if message!=""{return invalid(message)}
 e=s.store.Write(ctx,a,func(tx erpwire.WriteTx)error{rows,e:=tx.Update(ctx,"deals",columns,scoped(a,id),[]string{"id"});if e!=nil{return e};if len(rows)==0{return businessError(gone)};return nil});if e!=nil{return failure(e)}
 return response("/deals/"+id,"/deals","/deals/"+id),nil
}
func (s *Service) updateDealStage(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {
 if e:=authorize(a,"");e!=nil{return nil,e};args,e:=arguments(raw,2,3);if e!=nil{return nil,e};id,e:=stringArg(args,0);if e!=nil{return nil,e};stage,e:=stringArg(args,1);if e!=nil{return nil,e}
 place:=erpwire.Row{};if args.Present(2)&&!args.Null(2){if args.Decode(2,&place)!=nil{return invalid("Invalid stage")}}
 // The source object spread permits place.id/place.stage to override the parsed move only.
 moveID:=id;if v,ok:=place["id"];ok{moveID=text(v)};if v,ok:=place["stage"];ok{stage=text(v)}
 if !validID(moveID)||!has(stages,stage){return invalid("Invalid stage")}
 after:=place["after"];if after!=nil&&!validID(text(after)){return invalid("Invalid stage")}
 reason:=place["lostReasonId"];if _,ok:=place["lostReasonId"];ok&&!validID(text(reason)){return invalid("Invalid stage")}
 note:="";if v,ok:=place["note"];ok{n,valid:=v.(string);if !valid{return invalid("Invalid stage")};note=strings.TrimSpace(n);if jsLength(note)>2000{return invalid("Invalid stage")}}
 var title,from string
 e=s.store.Write(ctx,a,func(tx erpwire.WriteTx)error{
  before,e:=one(ctx,tx,erpwire.Select{Table:"deals",Columns:[]string{"title"},Where:scoped(a,id)});if e!=nil{return e};if before==nil{return businessError(gone)};title=text(before["title"])
  var closing any;if stage=="lost"&&note!=""{closing="Lost: "+note}
  result,e:=tx.Command(ctx,"move_deal",erpwire.Row{"p_org_id":a.OrgID(),"p_deal_id":id,"p_stage":stage,"p_after_id":after,"p_lost_reason_id":reason,"p_note":closing});if e!=nil{return e};return erpwire.DecodeJSON(result,&from)
 });if e!=nil{return failure(e)}
 if from!=stage{meta:=erpwire.Row{"from":from,"to":stage};if reason!=nil{meta["lostReasonId"]=reason};s.audit(ctx,a,"deal",id,"stage_changed",`Moved deal "`+title+`" from `+from+" → "+stage,meta)}
 return response("","/deals","/deals/"+id),nil
}
func (s *Service) deleteDeal(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {
 if e:=authorize(a,"");e!=nil{return nil,e};if authorize(a,"deal:delete")!=nil{return invalid("Only owners and admins can delete deals.")};args,e:=arguments(raw,1,1);if e!=nil{return nil,e};id,e:=stringArg(args,0);if e!=nil{return nil,e};var title string
 e=s.store.Write(ctx,a,func(tx erpwire.WriteTx)error{result,e:=tx.Command(ctx,"delete_deal",erpwire.Row{"p_org_id":a.OrgID(),"p_deal_id":id});if e!=nil{return e};return erpwire.DecodeJSON(result,&title)});if e!=nil{return failure(e)}
 s.audit(ctx,a,"deal",id,"deleted",`Deleted deal "`+title+`"`,nil);return response("/deals","/deals"),nil
}
func (s *Service) addActivity(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {
 if e:=authorize(a,"");e!=nil{return nil,e};args,e:=arguments(raw,1,1);if e!=nil{return nil,e};var input erpwire.Row;if args.Decode(0,&input)!=nil{return invalid("Invalid activity")}
 id:=text(input["dealId"]);kind:=text(input["type"]);if !validID(id)||!has([]string{"note","call","email","meeting","follow_up"},kind)||!optionalStrings(input,"body","dueDate"){return invalid("Invalid activity")}
 e=s.store.Write(ctx,a,func(tx erpwire.WriteTx)error{deal,e:=one(ctx,tx,erpwire.Select{Table:"deals",Columns:[]string{"client_id"},Where:scoped(a,id)});if e!=nil{return e};if deal==nil{return businessError("Deal not found in the active workspace")};_,e=tx.Insert(ctx,erpwire.Insert{Table:"activities",Rows:[]erpwire.Row{{"org_id":a.OrgID(),"deal_id":id,"client_id":deal["client_id"],"type":kind,"body":nilText(text(input["body"])),"due_date":nilText(text(input["dueDate"]))}}});return e});if e!=nil{return failure(e)}
 return response("","/deals/"+id),nil
}
func (s *Service) toggleActivityDone(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {
 if e:=authorize(a,"");e!=nil{return nil,e};args,e:=arguments(raw,3,3);if e!=nil{return nil,e};id,e:=stringArg(args,0);if e!=nil{return nil,e};var done bool;if args.Decode(1,&done)!=nil{return nil,erpwire.ErrBadArguments};deal,e:=stringArg(args,2);if e!=nil{return nil,e}
 e=s.store.Write(ctx,a,func(tx erpwire.WriteTx)error{_,e:=tx.Update(ctx,"activities",erpwire.Row{"done":done},scoped(a,id),nil);return e});if e!=nil{return failure(e)};return response("","/deals/"+deal),nil
}
func (s *Service) addLostReason(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {
 if e:=authorize(a,"settings:manage");e!=nil{return nil,e};args,e:=arguments(raw,1,1);if e!=nil{return nil,e};form,e:=args.Form(0);if e!=nil{return nil,e};name,_:=form.Text("name");name=strings.TrimSpace(name)
 if jsLength(name)<1||jsLength(name)>80{return response(reasonsPath+"?error=invalid"),nil};var id string
 e=s.store.Write(ctx,a,func(tx erpwire.WriteTx)error{rows,e:=tx.Insert(ctx,erpwire.Insert{Table:"deal_lost_reasons",Rows:[]erpwire.Row{{"org_id":a.OrgID(),"name":name}},Returning:[]string{"id"}});if e!=nil{return e};if len(rows)!=1{return erpwire.ErrNotFound};id=text(rows[0]["id"]);return nil})
 if e!=nil{if authError(e){return nil,e};code:="save";if state,ok:=e.(interface{SQLState()string});ok&&state.SQLState()=="23505"{code="duplicate"};return response(reasonsPath+"?error="+code),nil}
 s.audit(ctx,a,"deal_lost_reason",id,"created",`Added lost reason "`+name+`"`,nil);return response(reasonsPath,reasonsPath),nil
}
func (s *Service) setLostReasonActive(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {
 if e:=authorize(a,"settings:manage");e!=nil{return nil,e};args,e:=arguments(raw,1,1);if e!=nil{return nil,e};form,e:=args.Form(0);if e!=nil{return nil,e};id,_:=form.Text("id");active,_:=form.Text("active")
 if !validID(id)||(active!="true"&&active!="false"){return response(reasonsPath+"?error=invalid"),nil};var name string
 e=s.store.Write(ctx,a,func(tx erpwire.WriteTx)error{rows,e:=tx.Update(ctx,"deal_lost_reasons",erpwire.Row{"active":active=="true"},scoped(a,id),[]string{"id","name"});if e!=nil{return e};if len(rows)==0{return erpwire.ErrNotFound};name=text(rows[0]["name"]);return nil});if e!=nil{if authError(e){return nil,e};return response(reasonsPath+"?error=save"),nil}
 action,verb:="archived","Archived";if active=="true"{action,verb="restored","Restored"};s.audit(ctx,a,"deal_lost_reason",id,action,verb+` lost reason "`+name+`"`,nil);return response(reasonsPath,reasonsPath),nil
}
