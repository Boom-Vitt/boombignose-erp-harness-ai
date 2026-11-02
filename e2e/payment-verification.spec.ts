import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { community } from "./edition"

const env = Object.fromEntries(readFileSync(".env.local","utf8").trim().split("\n").map(line=>[line.slice(0,line.indexOf("=")),line.slice(line.indexOf("=")+1)]))
const isolation=JSON.parse(readFileSync(".local-stack/isolation.json","utf8"))
if(env.NEXT_PUBLIC_SUPABASE_URL!==`http://127.0.0.1:${isolation.api}`) throw new Error("Expected isolated local API")
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})

test("customer report stays pending until owner verifies actual receipt",async({page})=>{
  test.skip(community, "The client portal is Pro-only (BBN_EDITION=pro)")
  const org=randomUUID(), email=`erp-${randomUUID()}@example.invalid`, password=`Local-${randomUUID()}!`, token=randomUUID()+randomUUID()
  const user=await admin.auth.admin.createUser({email,password,email_confirm:true})
  expect(user.error).toBeNull()
  const uid=user.data.user!.id
  let invoiceId:string|undefined
  try {
    expect((await admin.from("organizations").insert({id:org,name:"Synthetic payment pilot",slug:`test-${org}`})).error).toBeNull()
    expect((await admin.from("memberships").insert({org_id:org,user_id:uid,role:"owner"})).error).toBeNull()
    const client=await admin.from("clients").insert({org_id:org,name:"Synthetic client",portal_enabled:true,portal_token:token}).select().single()
    expect(client.error).toBeNull()
    const invoice=await admin.from("invoices").insert({org_id:org,client_id:client.data.id,number:"E2E-PILOT",status:"draft",amount_satang:10000}).select().single()
    expect(invoice.error).toBeNull()
    invoiceId=invoice.data.id
    const staff=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}})
    expect((await staff.auth.signInWithPassword({email,password})).error).toBeNull()
    expect((await staff.rpc("update_business_profile",{p_org_id:org,p_legal_name:"Synthetic payment seller",p_business_address:"Synthetic address",p_tax_id:null,p_tax_status:"not_registered"})).error).toBeNull()
    expect((await staff.from("invoice_items").insert({org_id:org,invoice_id:invoiceId,description:"Synthetic service",unit_price_satang:10000})).error).toBeNull()
    const draft=await staff.from("invoices").select("version").eq("id",invoiceId!).single()
    expect(draft.error).toBeNull()
    expect((await staff.rpc("issue_invoice",{p_org_id:org,p_invoice_id:invoiceId,p_expected_version:draft.data!.version,p_key:randomUUID()})).error).toBeNull()
    await page.goto(`/portal/${token}`)
    await page.getByLabel("Reported payment amount (THB)").fill("100.00")
    await page.getByLabel("Customer payment reference").fill("Synthetic reported transfer")
    await page.getByRole("button",{name:/Report payment/}).click()
    await expect(page.getByText("รอตรวจสอบ / Pending verification",{exact:true})).toBeVisible()
    expect((await admin.from("payments").select().eq("invoice_id",invoiceId!)).data).toHaveLength(0)
    expect((await admin.from("invoices").select("status").eq("id",invoiceId!).single()).data?.status).toBe("sent")
    await page.goto("/login")
    await page.getByLabel(/^(Email|อีเมล)$/).fill(email)
    await page.getByLabel("Password",{exact:true}).fill(password)
    await page.getByRole("button",{name:"Sign in",exact:true}).click()
    await page.waitForURL("**/dashboard")
    await page.goto(`/finance/invoices/${invoiceId}`)
    await page.getByLabel("Verification evidence reference").fill("Synthetic bank statement receipt 001")
    let dropped=false
    await page.route(`**/finance/invoices/${invoiceId}`,async route=>{
      if(route.request().method()==="POST"&&!dropped) {
        await route.fetch() // Let the server commit, then simulate a lost response.
        dropped=true
        await route.abort("failed")
      } else await route.continue()
    })
    await page.getByRole("button",{name:"Verify receipt",exact:true}).click()
    await expect.poll(async()=> (await admin.from("payments").select().eq("invoice_id",invoiceId!)).data?.length).toBe(1)
    await page.getByRole("button",{name:"Verify receipt",exact:true}).click()
    await expect(page.getByRole("button",{name:"Verify receipt",exact:true})).toHaveCount(0)
    const receipts=await admin.from("payments").select().eq("invoice_id",invoiceId!)
    expect(receipts.data).toHaveLength(1)
    expect(receipts.data![0].verification_state).toBe("verified")
    expect(receipts.data![0].amount_satang).toBe(10000)
    expect((await admin.from("invoices").select("status").eq("id",invoiceId!).single()).data?.status).toBe("paid")
  } finally {
    if(invoiceId) {
      await admin.from("payment_claims").delete().eq("invoice_id",invoiceId)
      await admin.from("payment_allocations").delete().eq("invoice_id",invoiceId)
      await admin.from("payments").delete().eq("invoice_id",invoiceId)
    }
    await admin.from("organizations").delete().eq("id",org)
    await admin.auth.admin.deleteUser(uid)
  }
})
