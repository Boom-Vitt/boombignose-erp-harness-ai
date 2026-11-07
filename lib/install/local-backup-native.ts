import { execFile } from "node:child_process"
import { constants } from "node:fs"
import { lstat, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { loopbackBackupURL, type BackupEnv } from "./local-backup"

const execFileAsync = promisify(execFile)

// Windows mode bits do not enforce privacy. Match the native owner's protected,
// single-owner-grant DACL rather than treating chmod(0600) as an ACL check.
async function windowsPrivacy(file: string, create = false): Promise<void> {
  const script = create
    ? "$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=Get-Acl -LiteralPath $env:BBN_PRIVATE_PATH; $acl.SetAccessRuleProtection($true,$false); foreach($r in @($acl.Access)){$acl.RemoveAccessRuleSpecific($r)}; $inherit=if((Get-Item -LiteralPath $env:BBN_PRIVATE_PATH).PSIsContainer){[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{[System.Security.AccessControl.InheritanceFlags]::None}; $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',$inherit,[System.Security.AccessControl.PropagationFlags]::None,'Allow')); Set-Acl -LiteralPath $env:BBN_PRIVATE_PATH -AclObject $acl"
    : "$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $acl=Get-Acl -LiteralPath $env:BBN_PRIVATE_PATH; $rules=@($acl.Access); if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid -or !$acl.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid -or $rules[0].AccessControlType -ne 'Allow'){exit 1}"
  await execFileAsync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; ${script}`], {
    env: { NODE_ENV: "production", SystemRoot: process.env.SystemRoot, BBN_PRIVATE_PATH: file }, timeout: 10_000, maxBuffer: 1024, windowsHide: true,
  })
}

async function ancestors(file: string): Promise<void> {
  let current = path.dirname(file)
  while (true) {
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe native directory.")
    if (process.getuid && ((info.uid !== 0 && info.uid !== process.getuid()) || ((info.mode & 0o022) !== 0 && !(info.uid === 0 && (info.mode & 0o1000) !== 0)))) throw new Error("Unsafe native ancestor.")
    if (current === path.dirname(current)) break
    current = path.dirname(current)
  }
}

async function privatePath(file: string, directory: boolean): Promise<void> {
  await ancestors(file)
  const info = await lstat(file)
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) throw new Error("Unsafe native file.")
  if (process.platform === "win32") await windowsPrivacy(file)
  else if (!process.getuid || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) throw new Error("Native file is not private.")
}

async function privateRead(file: string): Promise<string> {
  await privatePath(file, false)
  const before = await lstat(file)
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size < 1 || opened.size > 4096 || before.ino !== opened.ino || before.dev !== opened.dev) throw new Error("Invalid native file.")
    const bytes = Buffer.alloc(opened.size + 1)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    const after = await lstat(file)
    if (bytesRead !== opened.size || after.ino !== opened.ino || after.dev !== opened.dev || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error("Native file changed.")
    await privatePath(file, false)
    return bytes.subarray(0, bytesRead).toString("utf8")
  } finally { await handle.close() }
}

export type NativeBackupSession = {
  data: string
  port: string
  directory: string
  pgpass: string
  close: () => Promise<void>
}

/** No legacy/trust credentials, inherited connection strings, or install defaults. */
export async function nativeBackupSession(env: BackupEnv): Promise<NativeBackupSession> {
  const url = new URL(loopbackBackupURL(env))
  const data = env.BOOMBIGNOSE_DATA
  if (!data || !path.isAbsolute(data) || path.resolve(data) !== data || await realpath(data) !== data || data === path.parse(data).root) throw new Error("Native database directory is unavailable.")
  await privatePath(data, true)
  const secrets = `${data}.secrets`
  await privatePath(secrets, true)
  if ((await privateRead(path.join(secrets, "cluster.path"))).trim() !== data) throw new Error("Native cluster marker does not match.")
  const pid = (await privateRead(path.join(data, "postmaster.pid"))).trim().split(/\r?\n/)
  if (!/^[1-9][0-9]+$/.test(pid[0] ?? "") || pid[1] !== data || pid[3] !== url.port) throw new Error("Native running cluster does not match.")
  const password = (await privateRead(path.join(secrets, "admin.password"))).trim()
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error("Native database credentials are unavailable.")
  const directory = await mkdtemp(path.join(secrets, ".backup-"))
  try {
    if (process.platform === "win32") await windowsPrivacy(directory, true)
    await privatePath(directory, true)
    const pgpass = path.join(directory, "pgpass")
    await writeFile(pgpass, `127.0.0.1:${url.port}:boombignose:boombignose:${password}\n`, { flag: "wx", mode: 0o600 })
    if (process.platform === "win32") await windowsPrivacy(pgpass, true)
    await privatePath(pgpass, false)
    return { data, port: url.port, directory, pgpass, close: () => rm(directory, { recursive: true, force: true }) }
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
}
