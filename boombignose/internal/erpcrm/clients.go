package erpcrm

import (
 "context"
 "encoding/json"
 "strings"
 "unicode/utf16"

 "github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func jsLength(s string) int { return len(utf16.Encode([]rune(s))) }
func optionalStrings(input erpwire.Row, keys ...string) bool { for _,key:=range keys {if v,ok:=input[key];ok {if _,valid:=v.(string);!valid{return false}}};return true }
func clientColumns(input erpwire.Row) (erpwire.Row,bool) {
 name,ok:=input["name"].(string)
 if !ok||jsLength(name)<1||!optionalStrings(input,"tax_id","branch_label","industry","source","notes") {return nil,false}
 tax:=strings.TrimSpace(text(input["tax_id"]))
 if tax!="" {if len(tax)!=13{return nil,false};for _,c:=range tax {if c<'0'||c>'9'{return nil,false}}}
 if jsLength(strings.TrimSpace(text(input["branch_label"])))>200{return nil,false}
 return erpwire.Row{"name":strings.TrimSpace(name),"tax_id":nilText(tax),"branch_label":nilText(text(input["branch_label"])),"industry":nilText(text(input["industry"])),"source":nilText(text(input["source"])),"notes":nilText(text(input["notes"]))},true
}
func (s *Service) createClient(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {
 if e:=authorize(a,"record:write");e!=nil{return nil,e};args,e:=arguments(raw,1,1);if e!=nil{return nil,e}
 var input erpwire.Row;if args.Decode(0,&input)!=nil{return invalid("Invalid input")};columns,ok:=clientColumns(input);if !ok{return invalid("Invalid input")}
 columns["org_id"]=a.OrgID();columns["owner"]=a.UserID();var id string
 e=s.store.Write(ctx,a,func(tx erpwire.WriteTx)error{rows,e:=tx.Insert(ctx,erpwire.Insert{Table:"clients",Rows:[]erpwire.Row{columns},Returning:[]string{"id"}});if e!=nil{return e};if len(rows)!=1{return erpwire.ErrNotFound};id=text(rows[0]["id"]);return nil});if e!=nil{return failure(e)}
 s.audit(ctx,a,"client",id,"created","Created client profile",nil)
 return response("/clients/"+id,"/clients"),nil
}
func (s *Service) updateClient(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {
 if e:=authorize(a,"record:write");e!=nil{return nil,e};args,e:=arguments(raw,2,2);if e!=nil{return nil,e};id,e:=stringArg(args,0);if e!=nil{return nil,e}
 var input erpwire.Row;if args.Decode(1,&input)!=nil{return invalid("Invalid input")};columns,ok:=clientColumns(input);if !ok{return invalid("Invalid input")}
 e=s.store.Write(ctx,a,func(tx erpwire.WriteTx)error{_,e:=tx.Update(ctx,"clients",columns,scoped(a,id),nil);return e});if e!=nil{return failure(e)}
 s.audit(ctx,a,"client",id,"updated","Updated client profile",nil)
 return response("","/clients","/clients/"+id),nil
}
func (s *Service) deleteClient(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {
 if e:=authorize(a,"");e!=nil{return nil,e};if authorize(a,"client:delete")!=nil{return invalid("Only owners and admins can delete clients.")}
 args,e:=arguments(raw,1,1);if e!=nil{return nil,e};id,e:=stringArg(args,0);if e!=nil{return nil,e}
 e=s.store.Write(ctx,a,func(tx erpwire.WriteTx)error{_,e:=tx.Delete(ctx,"clients",scoped(a,id),nil);return e});if e!=nil{return failure(e)};return response("/clients","/clients"),nil
}
func (s *Service) addContact(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {
 if e:=authorize(a,"");e!=nil{return nil,e};args,e:=arguments(raw,1,1);if e!=nil{return nil,e};var input erpwire.Row
 if args.Decode(0,&input)!=nil{return invalid("Invalid input")};id:=text(input["client_id"]);name,ok:=input["name"].(string)
 if !validID(id)||!ok||jsLength(name)==0||!optionalStrings(input,"email","phone","role"){return invalid("Invalid input")}
 row:=erpwire.Row{"org_id":a.OrgID(),"client_id":id,"name":strings.TrimSpace(name),"email":nilText(text(input["email"])),"phone":nilText(text(input["phone"])),"role":nilText(text(input["role"]))}
 e=s.store.Write(ctx,a,func(tx erpwire.WriteTx)error{_,e:=tx.Insert(ctx,erpwire.Insert{Table:"contacts",Rows:[]erpwire.Row{row}});return e});if e!=nil{return failure(e)};return response("","/clients/"+id),nil
}
func (s *Service) deleteContact(ctx context.Context,a erpwire.Actor,raw json.RawMessage)(any,error) {
 if e:=authorize(a,"");e!=nil{return nil,e};if authorize(a,"client:delete")!=nil{return invalid("Only owners and admins can delete contacts.")}
 args,e:=arguments(raw,2,2);if e!=nil{return nil,e};id,e:=stringArg(args,0);if e!=nil{return nil,e};client,e:=stringArg(args,1);if e!=nil{return nil,e}
 e=s.store.Write(ctx,a,func(tx erpwire.WriteTx)error{_,e:=tx.Delete(ctx,"contacts",scoped(a,id),nil);return e});if e!=nil{return failure(e)};return response("","/clients/"+client),nil
}
