import { constants } from "node:fs"
import { link, lstat, mkdir, open, unlink } from "node:fs/promises"
import type { FileHandle } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { dirname, isAbsolute, join, parse, resolve } from "node:path"
import { MAX_ATTACHMENT_SIZE } from "@/lib/record-history/input"

const OBJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function nativeAttachmentStorage(): boolean {
  return process.env.BOOMBIGNOSE_NATIVE === "1"
}

/** Flat random objects, never user filenames. No retained-object delete/overwrite API. */
export class NativeAttachmentStore {
  private readonly root: string

  constructor(root = process.env.BOOMBIGNOSE_FILES_ROOT) {
    if (!root || !isAbsolute(root) || resolve(root) !== root || root === parse(root).root) throw new Error("Native attachment storage is not configured.")
    this.root = root
  }

  private async directory(): Promise<FileHandle> {
    // Check every ancestor, not just the leaf: O_NOFOLLOW alone only protects the leaf.
    let ancestor = dirname(this.root)
    while (true) {
      const info = await lstat(ancestor)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe attachment directory.")
      if (ancestor === dirname(ancestor)) break
      ancestor = dirname(ancestor)
    }
    try { await mkdir(this.root, { mode: 0o700 }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
    const handle = await open(this.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try {
      const info = await handle.stat()
      const named = await lstat(this.root)
      if (!info.isDirectory() || named.isSymbolicLink() || info.dev !== named.dev || info.ino !== named.ino || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error("Unsafe attachment directory.")
      return handle
    } catch (error) { await handle.close(); throw error }
  }

  private async unchanged(directory: FileHandle): Promise<void> {
    const [opened, named] = await Promise.all([directory.stat(), lstat(this.root)])
    if (!named.isDirectory() || named.isSymbolicLink() || opened.dev !== named.dev || opened.ino !== named.ino || (named.mode & 0o077) !== 0 || (process.getuid && named.uid !== process.getuid())) throw new Error("Attachment directory changed.")
    let ancestor = dirname(this.root)
    while (true) {
      const info = await lstat(ancestor)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Attachment directory changed.")
      if (ancestor === dirname(ancestor)) break
      ancestor = dirname(ancestor)
    }
  }

  async publish(id: string, bytes: Uint8Array): Promise<{ discardOrphan: () => Promise<void> }> {
    if (!OBJECT_ID.test(id) || !bytes.length || bytes.length > MAX_ATTACHMENT_SIZE) throw new Error("Invalid attachment object.")
    const directory = await this.directory()
    const temporary = join(this.root, `.upload-${randomUUID()}`)
    const destination = join(this.root, id)
    let file: FileHandle | undefined
    let published = false
    let staged = false
    try {
      await this.unchanged(directory)
      file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      staged = true
      await file.writeFile(bytes)
      await file.chmod(0o400)
      await file.sync()
      const identity = await file.stat()
      await this.unchanged(directory)
      // Hard-link publication is atomic and fails if destination exists (rename would overwrite).
      await link(temporary, destination)
      published = true
      await unlink(temporary)
      staged = false
      await directory.sync()
      await this.unchanged(directory)
      return {
        discardOrphan: async () => {
          const currentDirectory = await this.directory()
          try {
            await this.unchanged(currentDirectory)
            const current = await lstat(destination)
            if (current.isFile() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) {
              await unlink(destination)
              await currentDirectory.sync()
            }
          } finally { await currentDirectory.close() }
        },
      }
    } catch (error) {
      // Only names created by this invocation can be removed. Never touch a collision.
      await this.unchanged(directory)
      const identity = await file?.stat()
      for (const path of [...(published ? [destination] : []), ...(staged ? [temporary] : [])]) {
        const current = await lstat(path)
        if (identity && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) await unlink(path)
      }
      throw error
    } finally {
      await file?.close()
      await directory.close()
    }
  }

  async read(id: string, expectedSize: number): Promise<Buffer> {
    if (!OBJECT_ID.test(id) || !Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_ATTACHMENT_SIZE) throw new Error("Invalid attachment object.")
    const directory = await this.directory()
    let file: FileHandle | undefined
    try {
      await this.unchanged(directory)
      file = await open(join(this.root, id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const info = await file.stat()
      if (!info.isFile() || info.nlink !== 1 || info.size !== expectedSize || (info.mode & 0o077) !== 0 || (info.mode & 0o222) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error("Unsafe attachment object.")
      const bytes = Buffer.allocUnsafe(expectedSize)
      let offset = 0
      while (offset < bytes.length) {
        const read = await file.read(bytes, offset, bytes.length - offset, offset)
        if (!read.bytesRead) throw new Error("Incomplete attachment object.")
        offset += read.bytesRead
      }
      const extra = await file.read(Buffer.allocUnsafe(1), 0, 1, offset)
      const [after, named] = await Promise.all([file.stat(), lstat(join(this.root, id))])
      if (extra.bytesRead || after.size !== info.size || after.mtimeMs !== info.mtimeMs || named.isSymbolicLink() || named.dev !== info.dev || named.ino !== info.ino || after.nlink !== 1 || (after.mode & 0o277) !== 0) throw new Error("Attachment object changed.")
      await this.unchanged(directory)
      return bytes
    } finally {
      await file?.close()
      await directory.close()
    }
  }
}
