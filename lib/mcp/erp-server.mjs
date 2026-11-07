import { createHash } from "node:crypto"
import path from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import {
  createSupabaseDataLayer,
  loadSupabaseStatusConfig,
} from "./data.mjs"
import { runTool, TOOLS } from "./tools.mjs"
import { ERP_DATA_TOOL_NAMES, readerContextAvailable, requireReaderContext } from "./reader.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const DEFAULT_ERP_DIR = path.resolve(__dirname, "../..")

export const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
])

const KNOWN_TOOL_NAMES = new Set(TOOLS.map((t) => t.name))

/**
 * Create a secret redactor that strips registered secrets from any string.
 * @param {Iterable<string>} [initialSecrets]
 */
export function createSecretRedactor(initialSecrets = []) {
  /** @type {Set<string>} */
  const secrets = new Set()

  /**
   * @param {string | undefined | null} secret
   */
  function register(secret) {
    if (typeof secret === "string") {
      const trimmed = secret.trim()
      if (trimmed.length >= 6) {
        secrets.add(trimmed)
        const jsonEscaped = JSON.stringify(trimmed).slice(1, -1)
        if (jsonEscaped.length >= 6) {
          secrets.add(jsonEscaped)
        }
      }
    }
  }

  for (const s of initialSecrets) {
    register(s)
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  function redact(text) {
    let out = String(text ?? "")
    const ordered = [...secrets].sort((a, b) => b.length - a.length)
    for (const secret of ordered) {
      if (secret && out.includes(secret)) {
        out = out.split(secret).join("[REDACTED]")
      }
    }
    return out
  }

  return { register, redact }
}

/**
 * Create an ERP MCP server instance with injectable dependencies for testing.
 * @param {{
 *   erpDir?: string,
 *   erpOrgId?: string,
 *   dataLayer?: any,
 *   createDataLayer?: () => Promise<any> | any,
 *   execFileSyncImpl?: any,
 *   fsImpl?: any,
 *   supabaseClientFactory?: (url: string, key: string) => Promise<any> | any,
 *   secrets?: Iterable<string>,
 *   now?: Date,
 *   onLog?: (msg: string) => void,
 *   trustedCapabilities?: readonly string[],
 * }} [options]
 */
export function createErpMcpServer(options = {}) {
  const erpDir = options.erpDir || process.env.ERP_DIR || DEFAULT_ERP_DIR
  const erpOrgId =
    options.erpOrgId !== undefined ? options.erpOrgId : process.env.ERP_ORG_ID
  const redactor = createSecretRedactor(options.secrets)
  // Capabilities are parent-owned verified session context, never tool arguments or env.
  const trustedCapabilities = Array.isArray(options.trustedCapabilities)
    ? Object.freeze([...options.trustedCapabilities]) : undefined
  const broadToolsAvailable = !!(options.dataLayer || options.createDataLayer) && readerContextAvailable({ erpOrgId: options.erpOrgId, trustedCapabilities })
  const listedTools = broadToolsAvailable ? TOOLS : TOOLS.filter(tool => !ERP_DATA_TOOL_NAMES.includes(tool.name))

  // Register any secret-looking env values for redaction without ever echoing env.
  for (const [key, val] of Object.entries(process.env)) {
    if (
      val &&
      (key.includes("KEY") ||
        key.includes("SECRET") ||
        key.includes("TOKEN") ||
        key.includes("PASSWORD"))
    ) {
      redactor.register(val)
    }
  }

  const log =
    options.onLog ??
    ((msg) => {
      process.stderr.write(`${redactor.redact(msg)}\n`)
    })

  /** @type {any} */
  let cachedDataLayer = options.dataLayer ?? null

  async function getDataLayer() {
    if (cachedDataLayer) return cachedDataLayer
    if (options.createDataLayer) {
      cachedDataLayer = await options.createDataLayer()
      return cachedDataLayer
    }

    const { apiUrl, serviceRoleKey } = loadSupabaseStatusConfig({
      erpDir,
      execFileSyncImpl: options.execFileSyncImpl,
      fsImpl: options.fsImpl,
      registerSecret: (s) => redactor.register(s),
    })
    redactor.register(serviceRoleKey)

    let supabaseClient
    if (options.supabaseClientFactory) {
      supabaseClient = await options.supabaseClientFactory(apiUrl, serviceRoleKey)
    } else {
      const { createClient } = await import("@supabase/supabase-js")
      supabaseClient = createClient(apiUrl, serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    }

    cachedDataLayer = createSupabaseDataLayer(supabaseClient)
    return cachedDataLayer
  }

  /**
   * Handle a parsed JSON-RPC message. Returns a response object, or null for notifications.
   * @param {unknown} message
   * @returns {Promise<Record<string, unknown> | null>}
   */
  async function handleMessage(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      }
    }

    const msg = /** @type {Record<string, unknown>} */ (message)
    const hasId = Object.hasOwn(msg, "id") && msg.id !== undefined
    const id =
      typeof msg.id === "string" || typeof msg.id === "number" || msg.id === null
        ? msg.id
        : null

    if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string" || !msg.method) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Invalid Request" },
      }
    }

    const method = msg.method

    // Notifications produce no response.
    if (!hasId || method.startsWith("notifications/")) {
      return null
    }

    if (method === "initialize") {
      const params =
        msg.params && typeof msg.params === "object" && !Array.isArray(msg.params)
          ? /** @type {Record<string, unknown>} */ (msg.params)
          : {}
      const requestedVersion =
        typeof params.protocolVersion === "string" ? params.protocolVersion : ""
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion)
        ? requestedVersion
        : "2025-06-18"

      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: {
            name: "boombignose-erp-mcp",
            version: "0.1.0",
          },
        },
      }
    }

    if (method === "ping") {
      return {
        jsonrpc: "2.0",
        id,
        result: {},
      }
    }

    if (method === "tools/list") {
      if (
        msg.params !== undefined &&
        (typeof msg.params !== "object" ||
          msg.params === null ||
          Array.isArray(msg.params))
      ) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Invalid params" },
        }
      }
      const params = /** @type {Record<string, unknown>} */ (msg.params ?? {})
      if (params.cursor !== undefined) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Invalid pagination cursor" },
        }
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: listedTools,
        },
      }
    }

    if (method === "tools/call") {
      if (
        !msg.params ||
        typeof msg.params !== "object" ||
        Array.isArray(msg.params)
      ) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Invalid params: expected object" },
        }
      }
      const params = /** @type {Record<string, unknown>} */ (msg.params)
      const toolName = params.name
      if (typeof toolName !== "string" || !toolName) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Invalid params: missing tool name" },
        }
      }
      if (
        params.arguments !== undefined &&
        (typeof params.arguments !== "object" ||
          params.arguments === null ||
          Array.isArray(params.arguments))
      ) {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: "Invalid params: arguments must be an object",
          },
        }
      }

      if (!KNOWN_TOOL_NAMES.has(toolName)) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: redactor.redact(`Unknown tool: ${toolName}`),
              },
            ],
            isError: true,
          },
        }
      }

      try {
        if (ERP_DATA_TOOL_NAMES.includes(toolName)) {
          requireReaderContext({ erpOrgId: options.erpOrgId, trustedCapabilities })
          if (!options.dataLayer && !options.createDataLayer) {
            throw new Error("Broad ERP reads require an injected session data layer; service-role fallback is forbidden.")
          }
        }
        const dataLayer = await getDataLayer()
        const toolArgs = /** @type {Record<string, unknown>} */ (
          params.arguments ?? {}
        )
        const payload = await runTool(toolName, toolArgs, {
          dataLayer,
          erpOrgId,
          now: options.now,
          trustedCapabilities,
        })
        const originalText = JSON.stringify(payload)
        let text = redactor.redact(originalText)
        if (text !== originalText) {
          const visible = JSON.parse(text)
          visible.redacted = true
          visible.partial = true
          if (typeof visible.text === "string" && typeof visible.text_sha256 === "string") {
            visible.original_text_sha256 = visible.text_sha256
            visible.text_sha256 = createHash("sha256").update(visible.text, "utf8").digest("hex")
          }
          text = JSON.stringify(visible)
        }
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text }],
          },
        }
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : String(err)
        const safeMessage = redactor.redact(rawMessage)
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: safeMessage }],
            isError: true,
          },
        }
      }
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: redactor.redact(`Method not found: ${method}`),
      },
    }
  }

  /**
   * Process a single newline-delimited raw JSON-RPC line.
   * Returns a serialized JSON response string, or null for notifications/empty lines.
   * @param {string} line
   * @returns {Promise<string | null>}
   */
  async function handleLine(line) {
    const trimmed = line.trim()
    if (!trimmed) return null

    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return redactor.redact(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        })
      )
    }

    try {
      const response = await handleMessage(parsed)
      if (!response) return null
      return redactor.redact(JSON.stringify(response))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`Internal MCP server error: ${msg}`)
      const id =
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (typeof parsed.id === "string" || typeof parsed.id === "number")
          ? parsed.id
          : null
      return redactor.redact(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: redactor.redact(msg) },
        })
      )
    }
  }

  return {
    handleMessage,
    handleLine,
    redact: redactor.redact,
    registerSecret: redactor.register,
  }
}

/**
 * Start the stdio JSON-RPC loop on `stdin`/`stdout`.
 * @param {{
 *   stdin?: NodeJS.ReadableStream,
 *   stdout?: NodeJS.WritableStream,
 *   stderr?: NodeJS.WritableStream,
 *   serverOptions?: Parameters<typeof createErpMcpServer>[0],
 *   exitOnClose?: boolean,
 * }} [io]
 */
export function startStdioServer(io = {}) {
  const stdin = io.stdin ?? process.stdin
  const stdout = io.stdout ?? process.stdout
  const stderr = io.stderr ?? process.stderr
  const exitOnClose = io.exitOnClose ?? true

  const server = createErpMcpServer({
    ...io.serverOptions,
    onLog: (msg) => {
      stderr.write(`${server.redact(msg)}\n`)
    },
  })

  const rl = createInterface({
    input: stdin,
    crlfDelay: Infinity,
  })

  /** @type {Promise<void>} */
  let queue = Promise.resolve()

  rl.on("line", (line) => {
    queue = queue.then(async () => {
      const reply = await server.handleLine(line)
      if (reply !== null) {
        stdout.write(`${reply}\n`)
      }
    })
  })

  const done = new Promise((resolve) => {
    rl.on("close", () => {
      queue.finally(() => {
        // process.exit() drops stdout still buffered in an async pipe; wait for the flush.
        stdout.write("", () => {
          if (exitOnClose) {
            process.exit(0)
          }
          resolve(undefined)
        })
      })
    })
  })

  return { server, done }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename)

if (isMain) {
  startStdioServer()
}
