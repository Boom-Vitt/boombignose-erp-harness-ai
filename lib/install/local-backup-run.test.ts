import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type * as AuthModule from "@/lib/auth"
import { getVerifiedApiContext } from "@/lib/auth"
import { GET, POST } from "@/app/api/local-backup/route"
import { GET as restoreGET, POST as restorePOST } from "@/app/api/local-backup/restore/route"
import { checksumLine, sha256Hex } from "./local-backup"
import { MAX_BACKUP_BYTES } from "./local-backup-run"

vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof AuthModule>()),
  getVerifiedApiContext: vi.fn(),
}))
const verified = vi.mocked(getVerifiedApiContext)
const OPERATOR = "11111111-1111-4111-8111-111111111111"
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222"
const NAME = "boombignose-20261106T000000Z.dump"
const DUMP = Buffer.from("PGDMP-synthetic-boundary-fixture")
// These tools are deterministic subprocess fixtures, not evidence of PostgreSQL
// compatibility. Real authenticated pg_dump/pg_restore is an integration gate.
describe.skipIf(process.platform === "win32")("local backup route / native consumer boundary", () => {
  let root: string
  let data: string
  let secrets: string
  let bundle: string

  async function control(value: Record<string, unknown>) {
    await writeFile(path.join(root, "control.json"), JSON.stringify(value), { mode: 0o600 })
  }
  async function calls(): Promise<{ tool: string; args: string[]; privatePassfile: boolean; passwordArg: boolean; inheritedPassword: boolean }[]> {
    const body = await readFile(path.join(root, "calls.jsonl"), "utf8").catch(() => "")
    return body.trim() ? body.trim().split("\n").map((line) => JSON.parse(line)) : []
  }
  function request(body?: FormData, endpoint = "/api/local-backup") {
    return new Request(`http://127.0.0.1:3128${endpoint}`, { method: "POST", headers: { origin: "http://127.0.0.1:3128" }, body })
  }
  function restoreRequest(options: { bytes?: Buffer; sidecar?: string; confirmation?: string; trusted?: boolean; name?: string } = {}) {
    const form = new FormData()
    const bytes = options.bytes ?? DUMP
    const name = options.name ?? NAME
    form.set("dump", new File([new Uint8Array(bytes)], name))
    form.set("checksum", new File([options.sidecar ?? checksumLine(NAME, sha256Hex(bytes))], `${NAME}.sha256`))
    form.set("confirmation", options.confirmation ?? "RESTORE ALL WORKSPACES")
    if (options.trusted !== false) form.set("trustedSource", "yes")
    return request(form, "/api/local-backup/restore")
  }
  async function assertClean() {
    expect((await readdir(secrets)).filter((name) => name.startsWith(".backup-"))).toEqual([])
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(await realpath(tmpdir()), "bbn-backup-test-"))
    data = path.join(root, "pg")
    secrets = `${data}.secrets`
    bundle = path.join(root, "bundle")
    await mkdir(data, { mode: 0o700 })
    await mkdir(secrets, { mode: 0o700 })
    await mkdir(path.join(bundle, "postgres", "bin"), { recursive: true, mode: 0o700 })
    await writeFile(path.join(data, "postmaster.pid"), `${process.pid}\n${data}\n0\n55292\n`, { mode: 0o600 })
    await writeFile(path.join(secrets, "cluster.path"), `${data}\n`, { mode: 0o600 })
    await writeFile(path.join(secrets, "admin.password"), `${"a".repeat(64)}\n`, { mode: 0o600 })
    await control({})
    const script = `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
const root = ${JSON.stringify(root)}; const data = ${JSON.stringify(data)};
const tool = path.basename(process.argv[1]); const args = process.argv.slice(2);
const ctl = JSON.parse(fs.readFileSync(path.join(root,'control.json'),'utf8'));
const pgpass = fs.readFileSync(process.env.PGPASSFILE,'utf8');
fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify({tool,args,privatePassfile:(fs.statSync(process.env.PGPASSFILE).mode&63)===0,passwordArg:args.some(x=>x.includes('a'.repeat(64))),inheritedPassword:!!process.env.PGPASSWORD})+'\\n',{mode:384});
if((!ctl.liveTrust && !pgpass.endsWith(':'+ 'a'.repeat(64)+'\\n')) || ctl.failTool===tool) process.exit(1);
if(tool==='psql') process.stdout.write(JSON.stringify({data:ctl.wrongData?'/unrelated-install':data,port:'55292',scram:!ctl.trust,credential:true}));
else if(tool==='pg_dump') {
 if(ctl.oversize) { const chunk=Buffer.alloc(1024*1024,120); chunk.write('PGDMP'); let n=0; const write=()=>{while(n++<513){if(!process.stdout.write(chunk)) {process.stdout.once('drain',write);return}}};write(); }
 else if(ctl.large) {const chunk=Buffer.alloc(1024*1024,120);chunk.write('PGDMP');process.stdout.write(chunk);}
 else process.stdout.write(${JSON.stringify(DUMP.toString())});
} else if(tool==='pg_restore') {
 if(args.includes('--list')) {if(ctl.invalidArchive) process.exit(1);process.stdout.write(ctl.strippedAcl ? '123; 1259 42 TABLE public memberships boombignose' : '123; 1259 42 TABLE public memberships boombignose\\n3387; 0 0 ACL public TABLE memberships boombignose');}
 else {fs.writeFileSync(path.join(root,'restore-started'),'yes');if(ctl.restoreFailure)process.exit(1);}
}
`
    for (const tool of ["psql", "pg_dump", "pg_restore"]) await writeFile(path.join(bundle, "postgres", "bin", tool), script, { mode: 0o700 })
    for (const [key, value] of Object.entries({ BOOMBIGNOSE_NATIVE: "1", BOOMBIGNOSE_DATA: data, BOOMBIGNOSE_BUNDLE: bundle, BOOMBIGNOSE_PG_PORT: "55292", BOOMBIGNOSE_OPERATOR_USER_IDS: OPERATOR, PGPASSWORD: "must-not-inherit", DATABASE_URL: "postgresql://unrelated.example/db" })) vi.stubEnv(key, value)
    verified.mockReset()
    verified.mockResolvedValue({ ctx: { userId: OPERATOR, email: null, role: "owner", orgId: "org-a", orgName: "Workspace A" } })
  })
  afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

  it("returns JSON auth failures for GET and POST before reading native credentials or upload", async () => {
    verified.mockImplementation(async () => ({ response: Response.json({ error: "Sign in required." }, { status: 401 }) }))
    for (const handle of [GET, restoreGET, POST, restorePOST]) {
      const response = await handle(request())
      expect(response.status).toBe(401)
      expect(response.headers.get("content-type")).toContain("application/json")
    }
    expect(await calls()).toEqual([])
  })
  it("rejects a verified owner of another workspace without explicit machine-operator authority", async () => {
    verified.mockResolvedValue({ ctx: { userId: OTHER_OWNER, email: null, role: "owner", orgId: "org-b", orgName: "Workspace B" } })
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(await calls()).toEqual([])
  })
  it.each(["", "invalid", `${OPERATOR},invalid`])("fails closed for missing or invalid operator configuration: %s", async (operators) => {
    vi.stubEnv("BOOMBIGNOSE_OPERATOR_USER_IDS", operators)
    expect((await POST(request())).status).toBe(403)
    expect(await calls()).toEqual([])
  })
  it("propagates Origin/MFA/role denials from the verified boundary", async () => {
    verified.mockResolvedValue({ response: Response.json({ error: "Untrusted request origin." }, { status: 403 }) })
    expect((await POST(request())).status).toBe(403)
    expect((await restorePOST(restoreRequest())).status).toBe(403)
    expect(await calls()).toEqual([])
  })
  it("describes the database-only all-workspace scope without returning a dump", async () => {
    const response = await GET(new Request("http://127.0.0.1/api/local-backup"))
    expect(await response.json()).toMatchObject({ scope: "database-only", allWorkspaces: true, maxBytes: MAX_BACKUP_BYTES })
    expect(await calls()).toEqual([])
  })
  it.each(["BOOMBIGNOSE_NATIVE", "BOOMBIGNOSE_DATA", "BOOMBIGNOSE_PG_PORT", "BOOMBIGNOSE_BUNDLE"])("never falls back when %s is missing", async (key) => {
    vi.stubEnv(key, "")
    vi.stubEnv("BOOMBIGNOSE_PG_BIN", path.join(bundle, "postgres", "bin"))
    expect((await POST(request())).status).toBe(503)
    expect(await calls()).toEqual([])
    await assertClean()
  })
  it.each(["psql", "pg_dump", "pg_restore"])("reports a missing shipped %s client without using host tools", async (tool) => {
    await rm(path.join(bundle, "postgres", "bin", tool))
    const response = tool === "pg_restore" ? await restorePOST(restoreRequest()) : await POST(request())
    expect(response.status).toBe(503)
    await assertClean()
  })
  it("rejects a foreign running-install port before spawning tools", async () => {
    vi.stubEnv("BOOMBIGNOSE_PG_PORT", "54329")
    expect((await POST(request())).status).toBe(503)
    expect(await calls()).toEqual([])
    await assertClean()
  })
  it.each(["wrongData", "trust"])("refuses the authenticated server identity/policy mismatch %s", async (key) => {
    await control({ [key]: true })
    expect((await POST(request())).status).toBe(503)
    expect((await calls()).map((call) => call.tool)).toEqual(["psql", "psql"])
    await assertClean()
  })
  it("refuses a live trust-auth endpoint even if its on-disk HBA claims SCRAM", async () => {
    await control({ liveTrust: true })
    expect((await POST(request())).status).toBe(503)
    expect((await calls()).map((call) => call.tool)).toEqual(["psql"])
    await assertClean()
  })
  it("fails safely for wrong or missing private credentials", async () => {
    await writeFile(path.join(secrets, "admin.password"), `${"b".repeat(64)}\n`, { mode: 0o600 })
    expect((await POST(request())).status).toBe(503)
    await assertClean()
    await rm(path.join(secrets, "admin.password"))
    expect((await restorePOST(restoreRequest())).status).toBe(503)
    await assertClean()
  })
  it("rejects public credentials, credential symlinks, and ancestor symlinks", async () => {
    const password = path.join(secrets, "admin.password")
    await chmod(password, 0o644)
    expect((await POST(request())).status).toBe(503)
    await chmod(password, 0o600)
    await rm(password)
    await writeFile(path.join(root, "other-password"), `${"a".repeat(64)}\n`, { mode: 0o600 })
    await symlink(path.join(root, "other-password"), password)
    expect((await POST(request())).status).toBe(503)
    await symlink(data, path.join(root, "alias-pg"))
    vi.stubEnv("BOOMBIGNOSE_DATA", path.join(root, "alias-pg"))
    expect((await POST(request())).status).toBe(503)
    expect(await calls()).toEqual([])
    await assertClean()
  })
  it("exports a checksummed stream using only a private passfile, then removes private staging", async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(response.headers.get("X-Backup-Scope")).toBe("database-only-all-workspaces")
    expect(response.headers.get("X-Backup-Sha256")).toBe(sha256Hex(DUMP))
    expect(Buffer.from(await response.arrayBuffer())).toEqual(DUMP)
    await vi.waitFor(assertClean)
    const invocations = await calls()
    expect(invocations.map((call) => call.tool)).toEqual(["psql", "psql", "pg_dump"])
    expect(invocations.every((call) => call.privatePassfile && !call.passwordArg && !call.inheritedPassword)).toBe(true)
    expect(invocations[2]!.args).toContain("--port=55292")
  })
  it("cleans staging and releases the operation lock after tool failure", async () => {
    await control({ failTool: "pg_dump" })
    expect((await POST(request())).status).toBe(503)
    await assertClean()
    await control({})
    const response = await POST(request())
    expect(response.status).toBe(200)
    await response.arrayBuffer()
    await vi.waitFor(assertClean)
  })
  it("bounds real subprocess export output and removes the failed partial dump", async () => {
    await control({ oversize: true })
    expect((await POST(request())).status).toBe(413)
    await assertClean()
  }, 30_000)
  it("rejects concurrent export/restore work while a streamed export owns staging", async () => {
    await control({ large: true })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect((await POST(request())).status).toBe(409)
    expect((await restorePOST(restoreRequest())).status).toBe(409)
    await response.body!.cancel()
    await vi.waitFor(assertClean)
  })
  it("cleans a cancelled download and releases its lock", async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    await response.body!.cancel()
    await vi.waitFor(assertClean)
  })
  it.each([{ confirmation: "" }, { trusted: false }])("requires server-enforced explicit restore confirmation: %j", async (options) => {
    expect((await restorePOST(restoreRequest(options))).status).toBe(400)
    expect(await calls()).toEqual([])
    await assertClean()
  })
  it.each([{ sidecar: "0".repeat(64) + `  ${NAME}\n` }, { bytes: Buffer.from("not a custom archive") }, { name: "../../escape.dump" }])("rejects checksum/archive/name errors without invoking restore: %j", async (options) => {
    expect((await restorePOST(restoreRequest(options))).status).toBe(400)
    expect(await calls()).toEqual([])
    await assertClean()
  })
  it("rejects a checksum-valid but invalid archive using the consumer tool", async () => {
    await control({ invalidArchive: true })
    expect((await restorePOST(restoreRequest())).status).toBe(400)
    expect((await calls()).map((call) => call.tool)).toEqual(["pg_restore"])
    await assertClean()
  })
  it("rejects an ACL-stripped archive before the mutating restore process starts", async () => {
    await control({ strippedAcl: true })
    expect((await restorePOST(restoreRequest())).status).toBe(400)
    expect(await readFile(path.join(root, "restore-started"), "utf8").catch(() => null)).toBeNull()
    await assertClean()
  })
  it("returns a JSON bad-upload error for malformed multipart data and cleans staging", async () => {
    const req = new Request("http://127.0.0.1:3128/api/local-backup/restore", {
      method: "POST", headers: { origin: "http://127.0.0.1:3128", "content-type": "multipart/form-data; boundary=missing" }, body: "not multipart",
    })
    expect((await restorePOST(req)).status).toBe(400)
    expect(await calls()).toEqual([])
    await assertClean()
  })
  it("bounds upload content length before parsing files", async () => {
    const req = request()
    req.headers.set("content-length", String(MAX_BACKUP_BYTES + 100_000))
    expect((await restorePOST(req)).status).toBe(413)
    expect(await calls()).toEqual([])
    await assertClean()
  })
})
