// Concurrent TX/ABB issue must leave consecutive numbers, refusals included.
// Needs a DISPOSABLE migrated Postgres (commits rows): PGHOST/PGPORT/PGUSER/PGDATABASE as for psql.
// node supabase/tests/tax-invoice-concurrency.test.mjs
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"

const psqlArgs = ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"]
const sql = text => execFileSync("psql", psqlArgs, { input: text, encoding: "utf8" })
const org = randomUUID(), owner = randomUUID(), full = randomUUID(), bare = randomUUID()
const TX_OK = 10, TX_BAD = 4, ABB = 5
const drafts = Array.from({ length: TX_OK + TX_BAD + ABB }, () => randomUUID())

sql(`begin;
  insert into auth.users(id,email) values('${owner}','conc-${owner}@example.invalid');
  insert into public.organizations(id,name,slug) values('${org}','TX concurrency','conc-${org}');
  insert into public.memberships(org_id,user_id,role) values('${org}','${owner}','owner');
  insert into public.clients(id,org_id,name,billing_address) values('${full}','${org}','Full','1 Road'),('${bare}','${org}','Bare',null);
  select set_config('request.jwt.claim.sub','${owner}',true); set local role authenticated;
  select public.update_tax_business_profile('${org}','Seller','1 Seller Rd','1111111111119',true,700,false,'HQ');
  select public.save_tax_invoice_template('${org}','{"seller_phone":"","branch_code":"00000","copy_label":""}');
  reset role;
  ${drafts.map((id, i) => `insert into public.invoices(id,org_id,client_id,number) values('${id}','${org}','${i >= TX_OK && i < TX_OK + TX_BAD ? bare : full}','DRAFT-C${i}');
  insert into public.invoice_items(org_id,invoice_id,description,unit_price_satang,tax_rate_bps) values('${org}','${id}','Line',10000,700);`).join("\n")}
commit;`)

// version is read as owner before the race; psql above cannot select invoices as authenticated.
const versions = Object.fromEntries(sql(`select id||' '||version from public.invoices where org_id='${org}'`).trim().split("\n").map(l => l.split(" ")))
const run = (invoice, type) => new Promise(resolve => {
  const child = spawn("psql", psqlArgs)
  let out = ""
  child.stdout.on("data", d => { out += d }); child.stderr.on("data", d => { out += d })
  child.on("close", code => resolve({ code, out }))
  child.stdin.end(`begin;select set_config('request.jwt.claim.sub','${owner}',true);set local role authenticated;
    select public.issue_tax_invoice('${org}','${invoice}',${versions[invoice]},'${randomUUID()}','${type}');commit;`)
})

const jobs = drafts.map((id, i) => run(id, i >= TX_OK + TX_BAD ? "ABB" : "TX"))
const results = await Promise.all(jobs)
const refused = results.filter(r => r.code !== 0)
assert.equal(refused.length, TX_BAD, `expected ${TX_BAD} refusals, got ${refused.length}`)
for (const r of refused) assert.match(r.out, /Buyer address required/)
const numbers = sql(`select number from public.invoice_snapshots where org_id='${org}' order by number`).trim().split("\n")
const yr = new Date().getFullYear()
const expected = [
  ...Array.from({ length: ABB }, (_, i) => `ABB-${yr}-${String(i + 1).padStart(6, "0")}`),
  ...Array.from({ length: TX_OK }, (_, i) => `TX-${yr}-${String(i + 1).padStart(6, "0")}`),
].sort()
assert.deepEqual(numbers, expected)
console.log(`ok: ${TX_OK} TX + ${ABB} ABB consecutive, ${TX_BAD} refusals left no gap`)
