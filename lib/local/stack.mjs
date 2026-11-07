import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process"
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

export const EXPECTED_PROJECT_ID = "boombignose-erp"

export const EXCLUDED_SERVICES = [
  "studio",
  "imgproxy",
  "vector",
  "logflare",
  "edge-runtime",
  "supavisor",
  "realtime",
  "storage-api",
]

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_ERP_DIR = path.resolve(MODULE_DIR, "../..")

const FORBIDDEN_SUBCOMMANDS = [
  ["db", "reset"],
  ["stop", "--no-backup"],
  ["stop", "--all"],
]

export function verifyErpWorkdir(erpDir = DEFAULT_ERP_DIR) {
  const resolved = path.resolve(erpDir)
  const configPath = path.join(resolved, "supabase", "config.toml")
  if (!existsSync(configPath)) {
    throw new Error(
      `Refusing to run Supabase CLI: missing ${configPath} (expected project_id = "${EXPECTED_PROJECT_ID}").`
    )
  }
  const content = readFileSync(configPath, "utf8")
  const match = content.match(/^\s*project_id\s*=\s*"([^"]+)"/m)
  if (!match || match[1] !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Refusing to run Supabase CLI in ${resolved}: supabase/config.toml project_id must be "${EXPECTED_PROJECT_ID}" (found ${match ? `"${match[1]}"` : "none"}).`
    )
  }
  return resolved
}

export function assertSafeSupabaseArgs(args) {
  const tokens = args.map((a) => String(a))
  for (const [first, second] of FORBIDDEN_SUBCOMMANDS) {
    if (tokens.includes(first) && tokens.includes(second)) {
      throw new Error(
        `Refusing forbidden Supabase command: supabase ${first} ${second}`
      )
    }
  }
  const workdirIdx = tokens.indexOf("--workdir")
  if (workdirIdx === -1 || !tokens[workdirIdx + 1]) {
    throw new Error("Supabase CLI calls must include --workdir <erpDir>.")
  }
  verifyErpWorkdir(tokens[workdirIdx + 1])
}

export function resolveSupabaseBin(erpDir = DEFAULT_ERP_DIR) {
  const localBin = path.join(
    path.resolve(erpDir),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "supabase.cmd" : "supabase"
  )
  if (existsSync(localBin)) {
    return localBin
  }
  return "supabase"
}

export function createDefaultRunner() {
  return {
    exec(cmd, args = [], options = {}) {
      return new Promise((resolve) => {
        nodeExecFile(
          cmd,
          args,
          {
            cwd: options.cwd,
            env: options.env,
            encoding: options.encoding ?? "utf8",
            maxBuffer: 50 * 1024 * 1024,
          },
          (error, stdout, stderr) => {
            if (error) {
              const code =
                typeof error.code === "number"
                  ? error.code
                  : error.code === "ENOENT"
                    ? 127
                    : 1
              resolve({
                code,
                stdout: stdout ?? "",
                stderr: stderr ?? error.message ?? "",
                error,
              })
              return
            }
            resolve({
              code: 0,
              stdout: stdout ?? "",
              stderr: stderr ?? "",
            })
          }
        )
      })
    },
    spawn(cmd, args = [], options = {}) {
      return nodeSpawn(cmd, args, options)
    },
  }
}

export async function runSupabase(runner, erpDir, subArgs, options = {}) {
  const verifiedDir = verifyErpWorkdir(erpDir)
  const fullArgs = [...subArgs, "--workdir", verifiedDir]
  assertSafeSupabaseArgs(fullArgs)
  const bin = resolveSupabaseBin(verifiedDir)
  return runner.exec(bin, fullArgs, {
    cwd: verifiedDir,
    env: options.env,
  })
}

export function parseStatusEnv(stdout) {
  const map = {}
  const lines = String(stdout ?? "").split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    map[key] = val
  }
  return map
}

export function validateLocalSupabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Missing local Supabase API_URL from supabase status.")
  }
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid Supabase URL: ${rawUrl}`)
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "")
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(
      `Refusing non-local Supabase URL host "${parsed.hostname}" (must be 127.0.0.1, localhost, or ::1).`
    )
  }
  return rawUrl
}

export function mapStatusEnvToServerEnv(statusStdout, port, parentEnv = {}) {
  const parsed =
    typeof statusStdout === "string"
      ? parseStatusEnv(statusStdout)
      : statusStdout
  const apiUrl = validateLocalSupabaseUrl(parsed.API_URL)
  const anonKey = parsed.ANON_KEY || parsed.PUBLISHABLE_KEY || ""
  const serviceRoleKey = parsed.SERVICE_ROLE_KEY || parsed.SECRET_KEY || ""
  if (!anonKey || !serviceRoleKey) {
    throw new Error(
      "Missing ANON_KEY or SERVICE_ROLE_KEY in local supabase status output."
    )
  }

  /** @type {Record<string, string>} */
  const env = {
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
  }

  for (const key of ["PATH", "HOME", "TMPDIR", "LANG"]) {
    if (typeof parentEnv[key] === "string" && parentEnv[key].length > 0) {
      env[key] = parentEnv[key]
    }
  }

  const ollamaHost = loopbackService(parentEnv.OLLAMA_HOST)
  if (ollamaHost) env.OLLAMA_HOST = ollamaHost
  if (typeof parentEnv.OLLAMA_MODEL === "string" && parentEnv.OLLAMA_MODEL.trim()) {
    env.OLLAMA_MODEL = parentEnv.OLLAMA_MODEL.trim()
  }

  // Exact value only. Any other string leaves the enrollment screen closed.
  if (parentEnv.LOCAL_TOTP_ENROLL === "1") {
    env.LOCAL_TOTP_ENROLL = "1"
  }

  return env
}

function loopbackService(value) {
  if (typeof value !== "string") return ""
  const raw = value.trim()
  if (!raw) return ""
  const withScheme = raw.includes("://") ? raw : `http://${raw}`
  try {
    const host = new URL(withScheme).hostname.replace(/^\[|\]$/g, "").toLowerCase()
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return raw
  } catch {
    return ""
  }
  return ""
}

export function buildCleanBuildEnv(parentEnv = {}) {
  const env = {
    NODE_ENV: "production",
  }
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG"]) {
    if (typeof parentEnv[key] === "string" && parentEnv[key].length > 0) {
      env[key] = parentEnv[key]
    }
  }
  return env
}

export function detectExposedPorts(dockerPsStdout, projectId = EXPECTED_PROJECT_ID) {
  const lines = String(dockerPsStdout ?? "").split(/\r?\n/)
  for (const line of lines) {
    if (!line.includes(projectId)) continue
    if (line.includes("0.0.0.0:")) {
      return true
    }
  }
  return false
}

export async function inspectDocker(runner) {
  const infoRes = await runner.exec("docker", ["info"])
  if (infoRes.code === 127 || infoRes.error?.code === "ENOENT") {
    return { docker: "missing", psStdout: "" }
  }
  if (infoRes.code !== 0) {
    return { docker: "stopped", psStdout: "" }
  }
  const psRes = await runner.exec("docker", [
    "ps",
    "--filter",
    `name=${EXPECTED_PROJECT_ID}`,
    "--format",
    "{{.Names}}\t{{.Ports}}\t{{.Status}}",
  ])
  return {
    docker: "running",
    psStdout: psRes.code === 0 ? psRes.stdout : "",
  }
}

// The services the ERP needs; the stack is running only when all of them are up.
const REQUIRED_SERVICES = ["db", "kong", "auth", "rest"]

const serviceContainer = (service) =>
  `supabase_${service}_${EXPECTED_PROJECT_ID}`

// Container names (the first tab field of each line) that mention the project.
const projectContainerNames = (stdout) =>
  new Set(
    String(stdout ?? "")
      .split(/\r?\n/)
      .map((l) => l.split("\t")[0].trim())
      .filter((n) => n.includes(EXPECTED_PROJECT_ID))
  )

const missingServices = (names) =>
  REQUIRED_SERVICES.filter((s) => !names.has(serviceContainer(s)))

export function isProjectStackRunning(psStdout, statusRes) {
  const names = projectContainerNames(psStdout)
  if (names.size > 0) {
    // A partial stack is not running: `supabase status` succeeds with only db up, so docker decides.
    return missingServices(names).length === 0
  }
  if (statusRes && statusRes.code === 0) {
    const parsed = parseStatusEnv(statusRes.stdout)
    if (parsed.API_URL && (parsed.ANON_KEY || parsed.PUBLISHABLE_KEY)) {
      return true
    }
  }
  return false
}

export async function runDoctor(options = {}) {
  const erpDir = verifyErpWorkdir(options.erpDir ?? DEFAULT_ERP_DIR)
  const runner = options.runner ?? createDefaultRunner()

  const dockerState = await inspectDocker(runner)
  const cliRes = await runSupabase(runner, erpDir, ["--version"])
  const cliVersion =
    cliRes.code === 0 ? cliRes.stdout.trim().split(/\r?\n/)[0].trim() : null

  let stack = "stopped"
  let exposed = false

  if (dockerState.docker === "running") {
    exposed = detectExposedPorts(dockerState.psStdout, EXPECTED_PROJECT_ID)
    const statusRes = await runSupabase(runner, erpDir, ["status", "-o", "env"])
    if (isProjectStackRunning(dockerState.psStdout, statusRes)) {
      stack = "running"
    }
  }

  return {
    docker: dockerState.docker,
    cli: cliVersion,
    stack,
    exposed,
  }
}

// `supabase start` does nothing when db is already up, so a partial stack stays partial.
// Start (never stop, reset or remove) the stopped containers named exactly supabase_<svc>_boombignose-erp, then
// return the required services that are still down.
async function repairRequiredServices(runner) {
  const down = async () =>
    missingServices(
      projectContainerNames((await inspectDocker(runner)).psStdout)
    )
  const missing = await down()
  if (missing.length === 0) return missing
  const all = await runner.exec("docker", [
    "ps",
    "-a",
    "--filter",
    `name=${EXPECTED_PROJECT_ID}`,
    "--format",
    "{{.Names}}",
  ])
  const existing = projectContainerNames(all.code === 0 ? all.stdout : "")
  for (const service of missing) {
    if (existing.has(serviceContainer(service))) {
      await runner.exec("docker", ["start", serviceContainer(service)])
    }
  }
  return down()
}

export async function runUp(options = {}) {
  const erpDir = verifyErpWorkdir(options.erpDir ?? DEFAULT_ERP_DIR)
  const runner = options.runner ?? createDefaultRunner()
  const stderr = options.stderr ?? process.stderr

  const dockerState = await inspectDocker(runner)
  if (dockerState.docker !== "running") {
    stderr.write(
      `Docker is ${dockerState.docker}. Please start Docker Desktop before running the local Supabase stack.\n`
    )
    return 3
  }

  const statusRes = await runSupabase(runner, erpDir, ["status", "-o", "env"])
  const running = isProjectStackRunning(dockerState.psStdout, statusRes)

  if (!running) {
    const startRes = await runSupabase(runner, erpDir, [
      "start",
      "-x",
      EXCLUDED_SERVICES.join(","),
    ])
    if (startRes.code !== 0) {
      stderr.write(
        `supabase start failed (exit ${startRes.code}): ${startRes.stderr || startRes.stdout}\n`
      )
      return startRes.code || 1
    }
    const down = await repairRequiredServices(runner)
    if (down.length > 0) {
      stderr.write(
        `supabase start left ${down.join(", ")} down for ${EXPECTED_PROJECT_ID}. Run \`pnpm local:stop\` (keeps the data), then \`pnpm local:up\`.\n`
      )
      return 1
    }
  }

  const migrateRes = await runSupabase(runner, erpDir, [
    "migration",
    "up",
    "--local",
  ])
  if (migrateRes.code !== 0) {
    stderr.write(
      `supabase migration up --local failed (exit ${migrateRes.code}): ${migrateRes.stderr || migrateRes.stdout}\n`
    )
    return migrateRes.code || 1
  }

  return 0
}

export async function runStatus(options = {}) {
  const erpDir = verifyErpWorkdir(options.erpDir ?? DEFAULT_ERP_DIR)
  const runner = options.runner ?? createDefaultRunner()
  const stdout = options.stdout ?? process.stdout
  const doctor = await runDoctor({ erpDir, runner })
  stdout.write(`${JSON.stringify(doctor)}\n`)
  return doctor.stack === "running" ? 0 : 1
}

export async function runMigrate(options = {}) {
  const erpDir = verifyErpWorkdir(options.erpDir ?? DEFAULT_ERP_DIR)
  const runner = options.runner ?? createDefaultRunner()
  const stderr = options.stderr ?? process.stderr
  const res = await runSupabase(runner, erpDir, ["migration", "up", "--local"])
  if (res.code !== 0) {
    stderr.write(
      `supabase migration up --local failed (exit ${res.code}): ${res.stderr || res.stdout}\n`
    )
    return res.code || 1
  }
  return 0
}

export async function runStop(options = {}) {
  const erpDir = verifyErpWorkdir(options.erpDir ?? DEFAULT_ERP_DIR)
  const runner = options.runner ?? createDefaultRunner()
  const stderr = options.stderr ?? process.stderr
  const res = await runSupabase(runner, erpDir, ["stop"])
  if (res.code !== 0) {
    stderr.write(
      `supabase stop failed (exit ${res.code}): ${res.stderr || res.stdout}\n`
    )
    return res.code || 1
  }
  return 0
}

export async function checkPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once("error", () => {
      resolve(false)
    })
    srv.once("listening", () => {
      srv.close(() => resolve(true))
    })
    srv.listen(port, host)
  })
}

async function acquireLock(lockPath, timeoutMs = 120000) {
  const start = Date.now()
  while (true) {
    try {
      const fd = openSync(lockPath, "wx")
      writeFileSync(fd, `${process.pid}\n`)
      return () => {
        try {
          closeSync(fd)
        } catch {
          // ignore
        }
        try {
          rmSync(lockPath, { force: true })
        } catch {
          // ignore
        }
      }
    } catch (err) {
      if (err && err.code !== "EEXIST") throw err
      try {
        const holderPid = Number(readFileSync(lockPath, "utf8").trim())
        if (holderPid && Number.isInteger(holderPid)) {
          try {
            process.kill(holderPid, 0)
          } catch {
            rmSync(lockPath, { force: true })
            continue
          }
        }
      } catch {
        // ignore
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out waiting for build lock ${lockPath}`)
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}

// Only names this module creates (<sha>, <sha>.tmp, <sha>.tar): a wrong --cache-dir must never lose other data.
const BUILD_ARTIFACT_NAME = /^[0-9a-f]{40}(\.tmp|\.tar)?$/

function pruneOldBuilds(cacheDir, keepDirs) {
  const keepSet = new Set(keepDirs.filter(Boolean))
  let entries = []
  try {
    entries = readdirSync(cacheDir)
  } catch {
    return
  }
  for (const name of entries) {
    if (keepSet.has(name) || !BUILD_ARTIFACT_NAME.test(name)) continue
    try {
      rmSync(path.join(cacheDir, name), { recursive: true, force: true })
    } catch {
      // ignore cleanup failures
    }
  }
}

export async function prepareCachedBuild({
  erpDir,
  cacheDir,
  runner,
  parentEnv,
  stderr,
}) {
  mkdirSync(cacheDir, { recursive: true })
  const lockPath = path.join(cacheDir, ".build.lock")
  const release = await acquireLock(lockPath)

  try {
    const revRes = await runner.exec("git", ["-C", erpDir, "rev-parse", "HEAD"])
    if (revRes.code !== 0) {
      throw new Error(
        `git rev-parse HEAD failed: ${revRes.stderr || revRes.stdout}`
      )
    }
    const sha = revRes.stdout.trim()
    const targetDir = path.join(cacheDir, sha)
    const lastGoodPath = path.join(cacheDir, "last-good")
    const prevGoodSha = existsSync(lastGoodPath)
      ? readFileSync(lastGoodPath, "utf8").trim()
      : null

    if (existsSync(path.join(targetDir, ".next", "BUILD_ID"))) {
      writeFileSync(lastGoodPath, `${sha}\n`)
      pruneOldBuilds(cacheDir, [sha, prevGoodSha])
      return { buildDir: targetDir, sha, fellBack: false }
    }

    const tmpDir = path.join(cacheDir, `${sha}.tmp`)
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })

    const tarPath = path.join(cacheDir, `${sha}.tar`)
    try {
      const archiveRes = await runner.exec("git", [
        "-C",
        erpDir,
        "archive",
        "--format=tar",
        "-o",
        tarPath,
        sha,
        "--",
        ".",
        ":!bignose",
      ])
      if (archiveRes.code !== 0) {
        throw new Error(
          `git archive failed: ${archiveRes.stderr || archiveRes.stdout}`
        )
      }

      const untarRes = await runner.exec("tar", ["-xf", tarPath, "-C", tmpDir])
      if (untarRes.code !== 0) {
        throw new Error(
          `tar extract failed: ${untarRes.stderr || untarRes.stdout}`
        )
      }
      rmSync(tarPath, { force: true })

      // Strip any tracked .env* files from export so nothing from .env* is ever inlined
      for (const entry of readdirSync(tmpDir)) {
        if (entry === ".env" || entry.startsWith(".env.")) {
          rmSync(path.join(tmpDir, entry), { force: true })
        }
      }

      const cleanEnv = buildCleanBuildEnv(parentEnv)
      const installRes = await runner.exec(
        "pnpm",
        ["install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
        { cwd: tmpDir, env: cleanEnv }
      )
      if (installRes.code !== 0) {
        throw new Error(
          `pnpm install failed: ${installRes.stderr || installRes.stdout}`
        )
      }

      const buildRes = await runner.exec(
        "pnpm",
        ["build"],
        { cwd: tmpDir, env: cleanEnv }
      )
      if (buildRes.code !== 0) {
        throw new Error(
          `pnpm build failed: ${buildRes.stderr || buildRes.stdout}`
        )
      }

      rmSync(targetDir, { recursive: true, force: true })
      renameSync(tmpDir, targetDir)
      writeFileSync(lastGoodPath, `${sha}\n`)
      pruneOldBuilds(cacheDir, [sha, prevGoodSha])
      return { buildDir: targetDir, sha, fellBack: false }
    } catch (buildErr) {
      rmSync(tarPath, { force: true })
      rmSync(tmpDir, { recursive: true, force: true })

      if (prevGoodSha) {
        const fallbackDir = path.join(cacheDir, prevGoodSha)
        if (existsSync(path.join(fallbackDir, ".next", "BUILD_ID"))) {
          stderr.write(
            `Rebuild for ${sha} failed (${buildErr.message}); falling back to last good build ${prevGoodSha}.\n`
          )
          pruneOldBuilds(cacheDir, [prevGoodSha])
          return { buildDir: fallbackDir, sha: prevGoodSha, fellBack: true }
        }
      }
      throw buildErr
    }
  } finally {
    release()
  }
}

export async function defaultProbeLogin(port) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/login",
        timeout: 1500,
      },
      (res) => {
        res.resume()
        resolve(res.statusCode >= 200 && res.statusCode < 500)
      }
    )
    req.on("error", () => resolve(false))
    req.on("timeout", () => {
      req.destroy()
      resolve(false)
    })
  })
}

export function defaultIsParentAlive(initialPpid) {
  if (!initialPpid || initialPpid <= 1) return false
  if (process.ppid !== initialPpid) return false
  try {
    process.kill(initialPpid, 0)
    return true
  } catch {
    return false
  }
}

export async function runServe(options = {}) {
  const erpDir = verifyErpWorkdir(options.erpDir ?? DEFAULT_ERP_DIR)
  const runner = options.runner ?? createDefaultRunner()
  const parentEnv = options.env ?? process.env
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  const port = Number(options.port)

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    stderr.write(`Invalid --port: ${options.port}\n`)
    return 1
  }

  const checkPort = options.checkPort ?? checkPortAvailable
  const portFree = await checkPort(port)
  if (!portFree) {
    stderr.write(
      `Port ${port} is already in use (busy port 127.0.0.1:${port}). Stop the conflicting process first.\n`
    )
    return 1
  }

  const defaultCacheRoot = parentEnv.BIGNOSE_HOME
    ? path.join(parentEnv.BIGNOSE_HOME, "erp")
    : path.join(os.homedir(), ".bignose", "erp")
  const cacheDir = path.resolve(options.cacheDir ?? defaultCacheRoot)

  const statusRes = await runSupabase(runner, erpDir, ["status", "-o", "env"])
  if (statusRes.code !== 0) {
    stderr.write(
      `Failed to read local Supabase status (exit ${statusRes.code}). Is the stack running?\n`
    )
    return statusRes.code || 1
  }

  let serverEnv
  try {
    serverEnv = mapStatusEnvToServerEnv(statusRes.stdout, port, parentEnv)
  } catch (err) {
    stderr.write(`${err.message}\n`)
    return 1
  }

  let prepared
  try {
    prepared = await prepareCachedBuild({
      erpDir,
      cacheDir,
      runner,
      parentEnv,
      stderr,
    })
  } catch (err) {
    stderr.write(`${err.message}\n`)
    return 1
  }

  const child = runner.spawn(
    process.execPath,
    [
      path.join("node_modules", "next", "dist", "bin", "next"),
      "start",
      "-H",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    {
      cwd: prepared.buildDir,
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"],
    }
  )

  if (child.stdout) {
    child.stdout.on("data", (chunk) => stdout.write(chunk))
  }
  if (child.stderr) {
    child.stderr.on("data", (chunk) => stderr.write(chunk))
  }

  let childExited = false
  let exitCode = 0
  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      childExited = true
      exitCode = typeof code === "number" ? code : signal ? 1 : 0
      resolve(exitCode)
    })
    child.once("error", (err) => {
      childExited = true
      stderr.write(`Failed to start next server: ${err.message}\n`)
      exitCode = 1
      resolve(1)
    })
  })

  const stopChild = (sig = "SIGTERM") => {
    if (!childExited) {
      try {
        child.kill(sig)
      } catch {
        // ignore
      }
    }
  }

  const onSigTerm = () => stopChild("SIGTERM")
  const onSigInt = () => stopChild("SIGINT")
  process.on("SIGTERM", onSigTerm)
  process.on("SIGINT", onSigInt)

  const initialPpid = options.initialPpid ?? process.ppid
  const isParentAlive =
    options.isParentAlive ?? (() => defaultIsParentAlive(initialPpid))
  const parentWatchIntervalMs = options.parentWatchIntervalMs ?? 500
  const parentTimer = setInterval(() => {
    if (!isParentAlive()) {
      stopChild("SIGTERM")
    }
  }, parentWatchIntervalMs)
  if (typeof parentTimer.unref === "function") {
    parentTimer.unref()
  }

  const probe = options.probeLogin ?? (() => defaultProbeLogin(port))
  const probeIntervalMs = options.probeIntervalMs ?? 250
  const maxProbeAttempts = options.maxProbeAttempts ?? 240

  ;(async () => {
    for (let i = 0; i < maxProbeAttempts && !childExited; i++) {
      const ok = await probe(port)
      if (ok && !childExited) {
        stdout.write(`ready http://127.0.0.1:${port}\n`)
        return
      }
      await new Promise((r) => setTimeout(r, probeIntervalMs))
    }
  })()

  try {
    return await exitPromise
  } finally {
    clearInterval(parentTimer)
    process.off("SIGTERM", onSigTerm)
    process.off("SIGINT", onSigInt)
  }
}

export async function runCli(argv = [], options = {}) {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  const command = argv[0]
  const rest = argv.slice(1)
  // `pnpm local:serve -- --port N` forwards the `--`; drop it so both forms work.
  if (rest[0] === "--") rest.shift()

  try {
    if (command === "doctor") {
      const result = await runDoctor(options)
      stdout.write(`${JSON.stringify(result)}\n`)
      return 0
    }
    if (command === "up") {
      return await runUp(options)
    }
    if (command === "status") {
      return await runStatus(options)
    }
    if (command === "migrate") {
      return await runMigrate(options)
    }
    if (command === "stop") {
      return await runStop(options)
    }
    if (command === "serve") {
      const { values } = parseArgs({
        args: rest,
        options: {
          port: { type: "string" },
          "cache-dir": { type: "string" },
        },
        strict: true,
      })
      return await runServe({
        ...options,
        port: values.port ? Number(values.port) : undefined,
        cacheDir: values["cache-dir"],
      })
    }

    stderr.write(
      `Usage: stack.mjs <doctor|up|status|migrate|stop|serve --port N [--cache-dir D]>\n`
    )
    return 1
  } catch (err) {
    stderr.write(`${err.message}\n`)
    return 1
  }
}
