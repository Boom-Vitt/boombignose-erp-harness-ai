import { EventEmitter } from "node:events"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  assertSafeSupabaseArgs,
  EXPECTED_PROJECT_ID,
  mapStatusEnvToServerEnv,
  prepareCachedBuild,
  runCli,
  runDoctor,
  runServe,
  runStop,
  runSupabase,
  runUp,
  validateLocalSupabaseUrl,
  verifyErpWorkdir,
} from "./stack.mjs"

const tempDirs: string[] = []

function makeTempErpDir(withValidConfig = true): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "erp-stack-test-"))
  tempDirs.push(dir)
  if (withValidConfig) {
    mkdirSync(path.join(dir, "supabase"), { recursive: true })
    writeFileSync(
      path.join(dir, "supabase", "config.toml"),
      `project_id = "${EXPECTED_PROJECT_ID}"\n`
    )
  }
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("local stack manager", () => {
  it("never runs db reset or stop --no-backup", async () => {
    const erpDir = makeTempErpDir(true)
    const calls: Array<{ cmd: string; args: string[] }> = []
    const runner = {
      async exec(cmd: string, args: string[]) {
        calls.push({ cmd, args })
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected spawn")
      },
    }

    expect(() =>
      assertSafeSupabaseArgs(["db", "reset", "--workdir", erpDir])
    ).toThrow(/forbidden/i)
    expect(() =>
      assertSafeSupabaseArgs(["stop", "--no-backup", "--workdir", erpDir])
    ).toThrow(/forbidden/i)

    await expect(
      runSupabase(runner, erpDir, ["db", "reset"])
    ).rejects.toThrow(/forbidden/i)
    await expect(
      runSupabase(runner, erpDir, ["stop", "--no-backup"])
    ).rejects.toThrow(/forbidden/i)

    await runStop({ erpDir, runner })
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual(["stop", "--workdir", erpDir])
    expect(calls[0].args).not.toContain("--no-backup")
  })

  it("maps supabase status env to the ERP server env", () => {
    const stdout = [
      "Stopped services: [supabase_studio_boombignose-erp]",
      'API_URL="http://127.0.0.1:54421"',
      'ANON_KEY="anon-short"',
      'SERVICE_ROLE_KEY="srv-short"',
    ].join("\n")

    const env = mapStatusEnvToServerEnv(stdout, 3100, {
      PATH: "/usr/bin:/bin",
      HOME: "/tmp/home",
    })

    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54421")
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("anon-short")
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("srv-short")
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://127.0.0.1:3100")
  })

  it("refuses a non-local Supabase URL", () => {
    expect(() =>
      validateLocalSupabaseUrl("https://xyzcompany.supabase.co")
    ).toThrow(/non-local/i)
    expect(() =>
      validateLocalSupabaseUrl("http://192.168.1.10:54421")
    ).toThrow(/non-local/i)
    expect(validateLocalSupabaseUrl("http://127.0.0.1:54421")).toBe(
      "http://127.0.0.1:54421"
    )
    expect(validateLocalSupabaseUrl("http://localhost:54421")).toBe(
      "http://localhost:54421"
    )
  })

  it("passes only allowlisted env to the ERP server", () => {
    const stdout = [
      'API_URL="http://127.0.0.1:54421"',
      'ANON_KEY="anon-short"',
      'SERVICE_ROLE_KEY="srv-short"',
    ].join("\n")

    const parentEnv = {
      PATH: "/usr/bin",
      HOME: "/Users/test",
      TMPDIR: "/tmp",
      LANG: "en_US.UTF-8",
      OPENROUTER_API_KEY: "or-short",
      OPENROUTER_MODEL: "openai/gpt-4o-mini",
      ANTHROPIC_API_KEY: "drop-anthropic",
      OLLAMA_HOST: "127.0.0.1:11434",
      OLLAMA_MODEL: "qwen2.5:3b",
      CRON_SECRET: "drop-me",
      RESEND_API_KEY: "drop-resend",
      EMAIL_FROM: "noreply@example.com",
      N8N_WEBHOOK_SECRET: "drop-n8n",
      DATABASE_URL: "postgresql://localhost/drop",
    }

    const env: Record<string, string | undefined> = mapStatusEnvToServerEnv(
      stdout,
      3989,
      parentEnv
    )
    expect(Object.keys(env).sort()).toEqual(
      [
        "HOME",
        "LANG",
        "NEXT_PUBLIC_APP_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
        "NODE_ENV",
        "OLLAMA_HOST",
        "OLLAMA_MODEL",
        "PATH",
        "SUPABASE_SERVICE_ROLE_KEY",
        "TMPDIR",
      ].sort()
    )
    expect(env.OLLAMA_HOST).toBe("127.0.0.1:11434")
    expect(env.OLLAMA_MODEL).toBe("qwen2.5:3b")
    expect(env.OPENROUTER_API_KEY).toBeUndefined()
    expect(env.OPENROUTER_MODEL).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.CRON_SECRET).toBeUndefined()

    const remote = mapStatusEnvToServerEnv(stdout, 3989, {
      ...parentEnv,
      OLLAMA_HOST: "https://models.example:11434",
    })
    expect(remote.OLLAMA_HOST).toBeUndefined()
    expect(remote.OLLAMA_MODEL).toBe("qwen2.5:3b")
    expect(env.RESEND_API_KEY).toBeUndefined()
    expect(env.EMAIL_FROM).toBeUndefined()
    expect(env.N8N_WEBHOOK_SECRET).toBeUndefined()
    expect(env.LOCAL_TOTP_ENROLL).toBeUndefined()
  })

  it("copies the TOTP enrollment flag only when it is exactly 1", () => {
    const stdout = [
      'API_URL="http://127.0.0.1:54421"',
      'ANON_KEY="anon-short"',
      'SERVICE_ROLE_KEY="srv-short"',
    ].join("\n")
    const enabled = mapStatusEnvToServerEnv(stdout, 3100, { LOCAL_TOTP_ENROLL: "1" })
    expect(enabled.LOCAL_TOTP_ENROLL).toBe("1")
    const closed = mapStatusEnvToServerEnv(stdout, 3100, { LOCAL_TOTP_ENROLL: "true" })
    expect(closed.LOCAL_TOTP_ENROLL).toBeUndefined()
  })

  it("exits 3 with a clear message when Docker is not running", async () => {
    const erpDir = makeTempErpDir(true)
    let errText = ""
    const stderr = {
      write(chunk: string) {
        errText += chunk
      },
    }
    const runner = {
      async exec(cmd: string) {
        if (cmd === "docker") {
          return { code: 1, stdout: "", stderr: "Cannot connect to daemon" }
        }
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected spawn")
      },
    }

    const code = await runUp({ erpDir, runner, stderr })
    expect(code).toBe(3)
    expect(errText).toMatch(/Docker/i)
  })

  it("builds from a clean export of HEAD with no .env files", async () => {
    const erpDir = makeTempErpDir(true)
    const cacheDir = makeTempErpDir(false)
    const sha = "a".repeat(40)
    const buildEnvs: Array<Record<string, string | undefined>> = []
    let archivedWithGit = false
    let archiveArgs: string[] = []
    let envExistedDuringBuild = false

    const runner = {
      async exec(
        cmd: string,
        args: string[],
        opts: { cwd?: string; env?: Record<string, string | undefined> } = {}
      ) {
        if (cmd === "git" && args.includes("rev-parse")) {
          return { code: 0, stdout: `${sha}\n`, stderr: "" }
        }
        if (cmd === "git" && args.includes("archive")) {
          archivedWithGit = true
          archiveArgs = args
          const outIdx = args.indexOf("-o")
          writeFileSync(args[outIdx + 1], "fake-tar")
          return { code: 0, stdout: "", stderr: "" }
        }
        if (cmd === "tar") {
          const dirIdx = args.indexOf("-C")
          const target = args[dirIdx + 1]
          writeFileSync(path.join(target, "package.json"), "{}")
          writeFileSync(path.join(target, ".env.local"), "LEAK=1")
          writeFileSync(path.join(target, ".env"), "LEAK=2")
          return { code: 0, stdout: "", stderr: "" }
        }
        if (cmd === "pnpm") {
          buildEnvs.push(opts.env ?? {})
          return { code: 0, stdout: "", stderr: "" }
        }
        if (args.includes("build")) {
          buildEnvs.push(opts.env ?? {})
          if (opts.cwd) {
            envExistedDuringBuild =
              existsSync(path.join(opts.cwd, ".env")) ||
              existsSync(path.join(opts.cwd, ".env.local"))
            mkdirSync(path.join(opts.cwd, ".next"), { recursive: true })
            writeFileSync(path.join(opts.cwd, ".next", "BUILD_ID"), "b1")
          }
          return { code: 0, stdout: "", stderr: "" }
        }
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected spawn")
      },
    }

    const res = await prepareCachedBuild({
      erpDir,
      cacheDir,
      runner,
      parentEnv: {
        PATH: "/usr/bin",
        NEXT_PUBLIC_SUPABASE_URL: "https://should-not-leak.supabase.co",
      },
      stderr: { write() {} },
    })

    expect(archivedWithGit).toBe(true)
    expect(archiveArgs).toContain(sha)
    expect(archiveArgs).not.toContain("HEAD")
    expect(envExistedDuringBuild).toBe(false)
    expect(existsSync(path.join(res.buildDir, ".env.local"))).toBe(false)
    for (const env of buildEnvs) {
      expect(env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined()
    }
  })

  it("always passes --workdir and refuses a dir without the boombignose-erp config", async () => {
    const emptyDir = makeTempErpDir(false)
    expect(() => verifyErpWorkdir(emptyDir)).toThrow(/boombignose-erp/)

    const wrongDir = makeTempErpDir(false)
    mkdirSync(path.join(wrongDir, "supabase"), { recursive: true })
    writeFileSync(
      path.join(wrongDir, "supabase", "config.toml"),
      'project_id = "other-project"\n'
    )
    expect(() => verifyErpWorkdir(wrongDir)).toThrow(/boombignose-erp/)

    const validDir = makeTempErpDir(true)
    const seenArgs: string[][] = []
    const runner = {
      async exec(_cmd: string, args: string[]) {
        seenArgs.push(args)
        return { code: 0, stdout: "2.120.0\n", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected spawn")
      },
    }

    await runSupabase(runner, validDir, ["--version"])
    expect(seenArgs[0]).toEqual(["--version", "--workdir", validDir])
  })

  it("never stops all projects", async () => {
    const erpDir = makeTempErpDir(true)
    expect(() =>
      assertSafeSupabaseArgs(["stop", "--all", "--workdir", erpDir])
    ).toThrow(/forbidden/i)
    await expect(
      runSupabase(
        {
          async exec() {
            return { code: 0, stdout: "", stderr: "" }
          },
          spawn() {
            throw new Error("unexpected")
          },
        },
        erpDir,
        ["stop", "--all"]
      )
    ).rejects.toThrow(/forbidden/i)
  })

  it("a partial stack is not running", async () => {
    const erpDir = makeTempErpDir(true)
    const calls: string[][] = []
    let started = false
    const runner = {
      async exec(cmd: string, args: string[]) {
        if (cmd === "docker" && args[0] === "info") {
          return { code: 0, stdout: "ok", stderr: "" }
        }
        if (cmd === "docker" && args[0] === "ps") {
          return {
            code: 0,
            stdout: [
              "supabase_db_boombignose-erp\t\tUp 5 minutes",
              "supabase_kong_boombignose-erp\t\tUp 5 minutes",
              // a real start brings the other services up
              ...(started
                ? [
                    "supabase_auth_boombignose-erp\t\tUp 5 seconds",
                    "supabase_rest_boombignose-erp\t\tUp 5 seconds",
                  ]
                : []),
              // another project's containers never count
              "supabase_auth_boombignose-erp-2\t\tUp 5 minutes",
              "supabase_rest_boombignose-erp-2\t\tUp 5 minutes",
            ].join("\n"),
            stderr: "",
          }
        }
        if (args[0] === "start") started = true
        calls.push(args)
        if (args.includes("status")) {
          // the CLI answers as soon as db is up, so status alone proves nothing
          return {
            code: 0,
            stdout: 'API_URL="http://127.0.0.1:54421"\nANON_KEY="anon-short"\n',
            stderr: "",
          }
        }
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected spawn")
      },
    }

    expect((await runDoctor({ erpDir, runner })).stack).toBe("stopped")
    calls.length = 0
    expect(await runUp({ erpDir, runner })).toBe(0)
    expect(calls.some((a) => a[0] === "start")).toBe(true)
    expect(
      calls.some((a) => a.includes("reset") || a[0] === "stop")
    ).toBe(false)
  })

  // `supabase start` exits 0 without starting anything when db is already up: db + kong run, `stopped` lists the rest.
  function startNoopRunner(stopped: string[]) {
    const running = [
      "supabase_db_boombignose-erp",
      "supabase_kong_boombignose-erp",
    ]
    const dockerStarts: string[] = []
    const cliCalls: string[][] = []
    const runner = {
      async exec(cmd: string, args: string[]) {
        if (cmd === "docker" && args[0] === "info") {
          return { code: 0, stdout: "ok", stderr: "" }
        }
        if (cmd === "docker" && args[0] === "ps") {
          const names = args.includes("-a")
            ? [...running, ...stopped]
            : [...running, ...dockerStarts]
          return { code: 0, stdout: names.join("\n"), stderr: "" }
        }
        if (cmd === "docker" && args[0] === "start") {
          dockerStarts.push(args[1])
          return { code: 0, stdout: args[1], stderr: "" }
        }
        cliCalls.push(args)
        if (args.includes("status")) {
          return {
            code: 0,
            stdout: 'API_URL="http://127.0.0.1:54421"\nANON_KEY="anon-short"\n',
            stderr: "",
          }
        }
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected spawn")
      },
    }
    return { runner, dockerStarts, cliCalls }
  }
  const noResetOrStop = (calls: string[][]) =>
    !calls.some((a) => a.includes("reset") || a[0] === "stop")

  it("up starts only the stopped required containers of this project when start does nothing", async () => {
    const erpDir = makeTempErpDir(true)
    const { runner, dockerStarts, cliCalls } = startNoopRunner([
      "supabase_auth_boombignose-erp",
      "supabase_rest_boombignose-erp",
      "supabase_auth_boombignose-erp-2",
      "supabase_rest_boombignose-erp-2",
    ])

    expect(await runUp({ erpDir, runner })).toBe(0)
    expect(cliCalls.some((a) => a[0] === "start")).toBe(true)
    expect(dockerStarts).toEqual([
      "supabase_auth_boombignose-erp",
      "supabase_rest_boombignose-erp",
    ])
    expect(cliCalls.some((a) => a[0] === "migration")).toBe(true)
    expect(noResetOrStop(cliCalls)).toBe(true)
  })

  it("up fails before the migration when a required service stays down", async () => {
    const erpDir = makeTempErpDir(true)
    // only another project has auth and rest: nothing of ours can be started
    const { runner, dockerStarts, cliCalls } = startNoopRunner([
      "supabase_auth_boombignose-erp-2",
      "supabase_rest_boombignose-erp-2",
    ])
    let errText = ""
    const stderr = {
      write(chunk: string) {
        errText += chunk
      },
    }

    expect(await runUp({ erpDir, runner, stderr })).not.toBe(0)
    expect(errText).toContain("auth, rest")
    expect(errText).toContain("pnpm local:stop")
    expect(dockerStarts).toEqual([])
    expect(cliCalls.some((a) => a[0] === "migration")).toBe(false)
    expect(noResetOrStop(cliCalls)).toBe(true)
  })

  it("doctor reports exposed when a stack port is bound to 0.0.0.0", async () => {
    const erpDir = makeTempErpDir(true)
    const runner = {
      async exec(cmd: string, args: string[]) {
        if (cmd === "docker" && args[0] === "info") {
          return { code: 0, stdout: "ok", stderr: "" }
        }
        if (cmd === "docker" && args[0] === "ps") {
          return {
            code: 0,
            stdout: [
              "supabase_db_boombignose-erp\t0.0.0.0:54422->5432/tcp\tUp 5 minutes",
              "supabase_kong_boombignose-erp\t0.0.0.0:54421->8000/tcp\tUp 5 minutes",
              "supabase_auth_boombignose-erp\t\tUp 5 minutes",
              "supabase_rest_boombignose-erp\t\tUp 5 minutes",
            ].join("\n"),
            stderr: "",
          }
        }
        if (args.includes("--version")) {
          return {
            code: 0,
            stdout: "2.120.0\n",
            stderr: "A new version of Supabase CLI is available\n",
          }
        }
        if (args.includes("status")) {
          return {
            code: 0,
            stdout: [
              'API_URL="http://127.0.0.1:54421"',
              'ANON_KEY="anon-short"',
              'SERVICE_ROLE_KEY="srv-short"',
            ].join("\n"),
            stderr: "",
          }
        }
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected")
      },
    }

    const doc = await runDoctor({ erpDir, runner })
    expect(doc).toEqual({
      docker: "running",
      cli: "2.120.0",
      stack: "running",
      exposed: true,
    })
    expect(JSON.stringify(doc)).not.toContain("anon-short")
    expect(JSON.stringify(doc)).not.toContain("srv-short")
  })

  it("falls back to the last good build when a rebuild fails", async () => {
    const erpDir = makeTempErpDir(true)
    const cacheDir = makeTempErpDir(false)
    const goodSha = "1".repeat(40)
    const badSha = "2".repeat(40)

    const goodDir = path.join(cacheDir, goodSha, ".next")
    mkdirSync(goodDir, { recursive: true })
    writeFileSync(path.join(goodDir, "BUILD_ID"), "good-build")
    writeFileSync(path.join(cacheDir, "last-good"), `${goodSha}\n`)

    let errLog = ""
    const runner = {
      async exec(cmd: string, args: string[]) {
        if (cmd === "git" && args.includes("rev-parse")) {
          return { code: 0, stdout: `${badSha}\n`, stderr: "" }
        }
        if (cmd === "git" && args.includes("archive")) {
          const outIdx = args.indexOf("-o")
          writeFileSync(args[outIdx + 1], "fake-tar")
          return { code: 0, stdout: "", stderr: "" }
        }
        if (cmd === "tar") {
          return { code: 0, stdout: "", stderr: "" }
        }
        if (cmd === "pnpm") {
          return { code: 0, stdout: "", stderr: "" }
        }
        if (args.includes("build")) {
          return {
            code: 1,
            stdout: "",
            stderr: "next/font/google network failure",
          }
        }
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected")
      },
    }

    const res = await prepareCachedBuild({
      erpDir,
      cacheDir,
      runner,
      parentEnv: { PATH: "/usr/bin" },
      stderr: {
        write(s: string) {
          errLog += s
        },
      },
    })

    expect(res.fellBack).toBe(true)
    expect(res.sha).toBe(goodSha)
    expect(res.buildDir).toBe(path.join(cacheDir, goodSha))
    expect(errLog).toMatch(/falling back to last good build/i)
  })

  it("serve exits when its parent process dies", async () => {
    const erpDir = makeTempErpDir(true)
    const cacheDir = makeTempErpDir(false)
    const sha = "3".repeat(40)
    mkdirSync(path.join(cacheDir, sha, ".next"), { recursive: true })
    writeFileSync(path.join(cacheDir, sha, ".next", "BUILD_ID"), "b3")

    let parentAlive = true
    let killedWith: string | null = null
    let spawnArgs: string[] = []
    let spawnEnv: Record<string, string | undefined> = {}
    const fakeChild = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: (sig?: string) => boolean
    }
    fakeChild.stdout = new EventEmitter()
    fakeChild.stderr = new EventEmitter()
    fakeChild.kill = (sig = "SIGTERM") => {
      killedWith = sig
      fakeChild.emit("exit", 0, sig)
      return true
    }

    const runner = {
      async exec(cmd: string, args: string[]) {
        if (cmd === "git" && args.includes("rev-parse")) {
          return { code: 0, stdout: `${sha}\n`, stderr: "" }
        }
        if (args.includes("status")) {
          return {
            code: 0,
            stdout: [
              'API_URL="http://127.0.0.1:54421"',
              'ANON_KEY="anon-short"',
              'SERVICE_ROLE_KEY="srv-short"',
            ].join("\n"),
            stderr: "",
          }
        }
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn(
        _cmd: string,
        args: string[],
        opts: { env?: Record<string, string | undefined> }
      ) {
        spawnArgs = args
        spawnEnv = opts.env ?? {}
        setTimeout(() => {
          parentAlive = false
        }, 30)
        return fakeChild
      },
    }

    const code = await runServe({
      erpDir,
      cacheDir,
      port: 3991,
      runner,
      env: {
        PATH: "/usr/bin",
        HOME: "/home/test",
        CRON_SECRET: "cron-hidden",
        RESEND_API_KEY: "resend-hidden",
      },
      checkPort: async () => true,
      probeLogin: async () => true,
      isParentAlive: () => parentAlive,
      parentWatchIntervalMs: 10,
      stdout: { write() {} },
      stderr: { write() {} },
    })

    expect(killedWith).toBe("SIGTERM")
    expect(code).toBe(0)
    expect(spawnArgs.join(" ")).toContain("-H 127.0.0.1")
    expect(Object.keys(spawnEnv).sort()).toEqual([
      "HOME",
      "NEXT_PUBLIC_APP_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NODE_ENV",
      "PATH",
      "SUPABASE_SERVICE_ROLE_KEY",
    ])
  })

  it("a build leaves unrelated files in the cache dir alone", async () => {
    const erpDir = makeTempErpDir(true)
    const cacheDir = makeTempErpDir(false)
    const sha = "4".repeat(40)
    const oldSha = "5".repeat(40)
    mkdirSync(path.join(cacheDir, oldSha, ".next"), { recursive: true })
    mkdirSync(path.join(cacheDir, "my-notes"), { recursive: true })
    writeFileSync(path.join(cacheDir, "my-notes", "a.txt"), "keep")
    writeFileSync(path.join(cacheDir, "readme.md"), "keep")

    const runner = {
      async exec(
        cmd: string,
        args: string[],
        opts: { cwd?: string } = {}
      ) {
        if (cmd === "git" && args.includes("rev-parse")) {
          return { code: 0, stdout: `${sha}\n`, stderr: "" }
        }
        if (cmd === "git" && args.includes("archive")) {
          writeFileSync(args[args.indexOf("-o") + 1], "fake-tar")
        }
        if (args.includes("build") && opts.cwd) {
          mkdirSync(path.join(opts.cwd, ".next"), { recursive: true })
          writeFileSync(path.join(opts.cwd, ".next", "BUILD_ID"), "b4")
        }
        return { code: 0, stdout: "", stderr: "" }
      },
      spawn() {
        throw new Error("unexpected spawn")
      },
    }

    await prepareCachedBuild({
      erpDir,
      cacheDir,
      runner,
      parentEnv: { PATH: "/usr/bin" },
      stderr: { write() {} },
    })

    expect(existsSync(path.join(cacheDir, sha, ".next", "BUILD_ID"))).toBe(true)
    expect(existsSync(path.join(cacheDir, oldSha))).toBe(false)
    expect(existsSync(path.join(cacheDir, "my-notes", "a.txt"))).toBe(true)
    expect(existsSync(path.join(cacheDir, "readme.md"))).toBe(true)
  })

  it("serve accepts the -- that pnpm forwards before its flags", async () => {
    let errText = ""
    const code = await runCli(["serve", "--", "--port", "3993"], {
      erpDir: makeTempErpDir(true),
      checkPort: async () => false,
      stderr: {
        write(s: string) {
          errText += s
        },
      },
    })
    expect(code).toBe(1)
    expect(errText).toContain("3993")
  })

  it("a busy port gives a clear message", async () => {
    const erpDir = makeTempErpDir(true)
    let errText = ""
    const code = await runServe({
      erpDir,
      port: 3992,
      checkPort: async () => false,
      stderr: {
        write(s: string) {
          errText += s
        },
      },
    })

    expect(code).toBe(1)
    expect(errText).toContain("3992")
    expect(errText).toMatch(/already in use|busy/i)
  })
})
