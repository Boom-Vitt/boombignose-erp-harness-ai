import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const roleSql = readFileSync("supabase/migrations/20261028130000_accountant_role.sql", "utf8")
const financeSql = readFileSync("supabase/migrations/20261028130100_accountant_finance.sql", "utf8")
const rlsTest = readFileSync("supabase/tests/workspace_roles.sql", "utf8")

const financeCommands = [
  "public.issue_invoice(uuid,uuid,integer,uuid)",
  "public.submit_customer_payment_claim(uuid,uuid,bigint,jsonb,text,uuid)",
  "public.apply_customer_credit(uuid,uuid,jsonb,uuid)",
  "public.refund_customer_credit(uuid,uuid,bigint,text,date,public.payment_method,uuid)",
  "public.issue_credit_note(uuid,uuid,jsonb,text,uuid)",
  "public.submit_internal_payment_claim(uuid,uuid,bigint,text,uuid)",
  "public.review_payment_claim_with_evidence(uuid,uuid,bigint,text,uuid,text,date,public.payment_method)",
  "public.reconcile_legacy_payment_with_evidence(uuid,uuid,bigint,text,uuid,date,public.payment_method)",
  "public.adopt_legacy_invoice(uuid,uuid,integer,uuid,text)",
  "public.add_bank_line(uuid,date,bigint,text)",
  "public.match_bank_line(uuid,uuid,uuid)",
]

describe("accountant role", () => {
  it("adds the enum label in its own migration", () => {
    expect(roleSql).toContain("add value if not exists 'accountant'")
    expect(roleSql).not.toContain("is_org_finance")
  })

  it("keeps owner and admin as staff and adds a finance helper", () => {
    expect(financeSql).toContain("role in ('owner', 'admin', 'accountant')")
    expect(financeSql).toContain("revoke all on function private.is_org_finance(uuid) from public, anon, service_role")
    expect(financeSql).toContain("grant execute on function private.is_org_finance(uuid) to authenticated")
    expect(financeSql).toContain("set search_path = ''")
    expect(financeSql).not.toMatch(/create or replace function private\.is_org_staff/)
  })

  it("lets finance roles write invoices and leaves deletes on the staff policy", () => {
    expect(financeSql).toContain("private.is_org_finance(org_id)")
    expect(financeSql).not.toMatch(/drop policy if exists tenant_delete/i)
    for (const signature of financeCommands) {
      expect(financeSql).toContain(`'${signature}'`)
    }
    expect(financeSql).toContain("if hits <> 1 then")
  })

  it("has an RLS test for accountant, staff, and receipt reversal", () => {
    expect(rlsTest).toContain("'accountant'")
    expect(rlsTest).toContain("'member'")
    expect(rlsTest).toContain("accountant can insert a draft invoice")
    expect(rlsTest).toContain("accountant cannot delete an invoice")
    expect(rlsTest).toContain("staff member cannot insert an invoice")
    expect(rlsTest).toContain("reversing a receipt stays with owner and admin")
  })
})
