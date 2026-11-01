import { inflateRawSync, gunzipSync } from "node:zlib"

export const ASR_RELEASE = "b5454"

export const ASR_MODEL = {
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
  sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
  bytes: 77_691_713,
  file: "ggml-tiny.bin",
} as const

export type AsrArchive = {
  url: string
  sha256: string
  binary: string
}

const ARCHIVES = {
  "linux-amd64": {
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-ubuntu-x64.tar.gz",
    sha256: "a72becf15d7917f990f6313867a52638b82b7f9ef237fb0c980dac56a135781c",
    binary: "whisper-bin-ubuntu-x64/whisper-cli",
  },
  "linux-arm64": {
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-ubuntu-arm64.tar.gz",
    sha256: "6b95ebfc60447df48e70ef00a73bdc3f41679ed2d01ef465827206a2ff325149",
    binary: "whisper-bin-ubuntu-arm64/whisper-cli",
  },
  "windows-amd64": {
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip",
    sha256: "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb",
    binary: "Release/whisper-cli.exe",
  },
} as const satisfies Record<string, AsrArchive>

export type AsrHostKey = keyof typeof ARCHIVES

export function asrHostKey(platform: NodeJS.Platform, arch: string): AsrHostKey | null {
  const cpu = arch === "x64" ? "amd64" : arch
  if (platform === "linux" && (cpu === "amd64" || cpu === "arm64")) return `linux-${cpu}`
  if (platform === "win32" && cpu === "amd64") return "windows-amd64"
  return null
}

export function asrArchive(platform: NodeJS.Platform, arch: string): AsrArchive | null {
  const key = asrHostKey(platform, arch)
  return key ? ARCHIVES[key] : null
}

export function asrArgs(modelPath: string, audioPath: string): string[] {
  return ["-m", modelPath, "-f", audioPath, "-l", "auto", "-nt", "-np", "-ng"]
}

export function pinnedUrl(url: string): boolean {
  return url === ASR_MODEL.url || Object.values(ARCHIVES).some((item) => item.url === url)
}

export function allowedDownloadHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === "github.com"
    || host === "objects.githubusercontent.com"
    || host === "release-assets.githubusercontent.com"
    || host === "huggingface.co"
    || host.endsWith(".hf.co")
    || host.endsWith(".huggingface.co")
}

export function safeArchiveName(raw: string): string | null {
  const name = raw.replace(/\\/g, "/").replace(/^\.\//, "")
  if (!name || name.startsWith("/") || name.includes("\0")) return null
  const parts = name.split("/").filter((part) => part !== "" && part !== ".")
  if (parts.length === 0 || parts.some((part) => part === "..")) return null
  return parts.join("/")
}

export type ArchiveFile = { name: string; data: Buffer }

function tarName(header: Buffer): string {
  const text = (buf: Buffer) => {
    const end = buf.indexOf(0)
    return buf.subarray(0, end === -1 ? buf.length : end).toString("utf8")
  }
  const name = text(header.subarray(0, 100))
  if (header.subarray(257, 262).toString("utf8").startsWith("ustar")) {
    const prefix = text(header.subarray(345, 500))
    if (prefix) return `${prefix}/${name}`
  }
  return name
}

export function unpackTarGz(gz: Buffer): ArchiveFile[] {
  const tar = gunzipSync(gz)
  const files: ArchiveFile[] = []
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    offset += 512
    const size = Number.parseInt(header.subarray(124, 136).toString("utf8").replace(/\0/g, "").trim() || "0", 8)
    if (!Number.isFinite(size) || size < 0 || offset + size > tar.length) throw new Error("archive entry is not valid")
    const type = String.fromCharCode(header[156] ?? 0)
    const data = tar.subarray(offset, offset + size)
    offset += Math.ceil(size / 512) * 512
    if (type === "5") continue
    if (type === "1" || type === "2") throw new Error("archive links are refused")
    if (type !== "0" && type !== "\0") continue
    const name = safeArchiveName(tarName(header))
    if (!name) throw new Error("archive path is refused")
    files.push({ name, data: Buffer.from(data) })
  }
  return files
}

export function unpackZip(zip: Buffer): ArchiveFile[] {
  const files: ArchiveFile[] = []
  let offset = 0
  while (offset + 30 <= zip.length) {
    const sig = zip.readUInt32LE(offset)
    if (sig === 0x02014b50 || sig === 0x06054b50) break
    if (sig !== 0x04034b50) throw new Error("archive is not a zip")
    const flags = zip.readUInt16LE(offset + 6)
    const method = zip.readUInt16LE(offset + 8)
    const compSize = zip.readUInt32LE(offset + 18)
    const nameLen = zip.readUInt16LE(offset + 26)
    const extraLen = zip.readUInt16LE(offset + 28)
    if (flags & 0x8) throw new Error("archive sizes are refused")
    const nameStart = offset + 30
    const name = zip.subarray(nameStart, nameStart + nameLen).toString("utf8")
    const dataStart = nameStart + nameLen + extraLen
    if (dataStart + compSize > zip.length) throw new Error("archive entry is not valid")
    const compressed = zip.subarray(dataStart, dataStart + compSize)
    offset = dataStart + compSize
    if (name.endsWith("/")) continue
    const safe = safeArchiveName(name)
    if (!safe) throw new Error("archive path is refused")
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null
    if (!data) throw new Error("archive compression is refused")
    files.push({ name: safe, data })
  }
  return files
}

export function audioKind(bytes: Buffer): "wav" | "flac" | "ogg" | "mp3" | null {
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE") return "wav"
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "fLaC") return "flac"
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "OggS") return "ogg"
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString("ascii") === "ID3") return "mp3"
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "mp3"
  return null
}
