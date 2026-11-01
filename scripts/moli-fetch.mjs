#!/usr/bin/env node
/**
 * Fetch one public https page with the Moli CLI and write it under artifacts/moli/.
 * Refuses bank hosts, login/MFA URLs, embedded credentials, and private hosts.
 * Does not download Moli, store cookies, or accept passwords.
 */
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  INSTALL_HELP,
  artifactMetaPath,
  artifactRelativePath,
  buildArtifactMeta,
  byteLimit,
  decidePublicFetch,
  moliFetchArgs,
  parseFetchArgs,
  validateFetchBody,
} from "../lib/moli/public-fetch.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const HELP = `Usage: pnpm moli:fetch -- [--url URL] [--dump markdown|semantic_tree_text|screenshot|screenshot_full] [--layout] [--timeout ms]

Fetches one public https page with Moli and writes it under artifacts/moli/.
The default URL is the public Revenue Department main page, https://www.rd.go.th/272.html
Run it from the ERP checkout next to the BoomBigNose desktop app. It does not
open the Wails window and it refuses http://127.0.0.1:3100.

Text dumps stay structure-first. screenshot and screenshot_full turn --layout on.
The wrapper does not forward cookies, profiles, headers, proxy settings, or --eval.

Exit 0  wrote a file
Exit 1  refused URL, bad arguments, or Moli failed
Exit 2  moli is not installed
`

async function fileIsUsable(file) {
  try {
    await access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveMoliBin() {
  const candidates = []
  if (process.env.MOLI_BIN && process.env.MOLI_BIN.trim()) candidates.push(process.env.MOLI_BIN.trim())
  candidates.push(path.join(os.homedir(), ".local", "bin", "moli"))
  for (const candidate of candidates) {
    if (await fileIsUsable(candidate)) return candidate
  }
  return "moli"
}

function runMoli(bin, args, timeoutMs, limit) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    const stdout = []
    const stderr = []
    let received = 0
    let capped = false
    let stderrBytes = 0

    child.stdout.on("data", (chunk) => {
      received += chunk.length
      if (received > limit) {
        capped = true
        child.kill("SIGKILL")
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length
      if (stderrBytes <= 16_384) stderr.push(chunk)
    })

    const timer = setTimeout(() => {
      child.kill("SIGKILL")
    }, timeoutMs + 5_000)

    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({
        code: error && error.code === "ENOENT" ? 127 : 1,
        missing: Boolean(error && error.code === "ENOENT"),
        stdout: Buffer.concat(stdout),
        stderr: error instanceof Error ? error.message : "Failed to start Moli.",
        capped,
      })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({
        code: code ?? 1,
        missing: false,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8"),
        capped,
      })
    })
  })
}

async function main() {
  const parsed = parseFetchArgs(process.argv.slice(2))
  if (parsed.help) {
    process.stdout.write(HELP)
    return 0
  }
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n${HELP}`)
    return 1
  }

  const decision = decidePublicFetch(parsed)
  if (!decision.ok) {
    process.stderr.write(`${decision.reason}\n`)
    return 1
  }

  const bin = await resolveMoliBin()
  const args = moliFetchArgs(decision)
  const result = await runMoli(bin, args, decision.timeoutMs, byteLimit(decision.dump))
  if (result.missing || (bin === "moli" && result.code === 127)) {
    process.stderr.write(`${INSTALL_HELP}\n`)
    return 2
  }
  if (result.capped) {
    process.stderr.write("Moli output exceeded the local size cap. Nothing was written.\n")
    return 1
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim()
    process.stderr.write(detail ? `moli exited ${result.code}\n${detail}\n` : `moli exited ${result.code}\n`)
    return 1
  }

  const body = result.stdout
  const checked = validateFetchBody(decision.dump, body)
  if (!checked.ok) {
    process.stderr.write(`${checked.reason}\n`)
    return 1
  }

  const relative = artifactRelativePath(decision.url, decision.dump)
  const outputPath = path.join(repoRoot, relative)
  const metaPath = path.join(repoRoot, artifactMetaPath(relative))
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, body)
  await writeFile(
    metaPath,
    `${JSON.stringify(
      buildArtifactMeta({
        sourceUrl: decision.url.href,
        dump: decision.dump,
        layout: decision.layout,
        bytes: body.length,
        createdAt: new Date().toISOString(),
      }),
      null,
      2
    )}\n`
  )
  process.stdout.write(`wrote ${relative} (${body.length} bytes)\n`)
  return 0
}

const code = await main()
process.exit(code)
