import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { NativeAttachmentStore } from "./native-attachments"
import { attachmentBytes, validAttachmentContent } from "./attachment-content"
import { MAX_ATTACHMENT_SIZE } from "@/lib/record-history/input"

let temporary: string
let root: string
beforeEach(async () => {
  temporary = await mkdtemp(join(await realpath(tmpdir()), "bbn-files-"))
  root = join(temporary, "attachments")
})
afterEach(async () => { await rm(temporary, { recursive: true, force: true }) })

describe("private retained native bytes", () => {
  it("persists exact Thai/English bytes across independent store instances with private permissions", async () => {
    const bytes = Buffer.from("หลักฐาน invoice\nยอด,125.00\n", "utf8")
    const id = randomUUID()
    await new NativeAttachmentStore(root).publish(id, bytes)
    expect(await new NativeAttachmentStore(root).read(id, bytes.length)).toEqual(bytes)
    expect((await stat(root)).mode & 0o777).toBe(0o700)
    expect((await stat(join(root, id))).mode & 0o777).toBe(0o400)
    expect(await readdir(root)).toEqual([id])
  })
  it("never overwrites existing retained evidence, even on an object collision", async () => {
    const id = randomUUID()
    const store = new NativeAttachmentStore(root)
    await store.publish(id, Buffer.from("original"))
    await expect(store.publish(id, Buffer.from("replacement"))).rejects.toThrow()
    expect(await store.read(id, 8)).toEqual(Buffer.from("original"))
    expect(await readdir(root)).toEqual([id])
  })
  it("removes only its own orphan and preserves unrelated retained objects", async () => {
    const store = new NativeAttachmentStore(root)
    const retained = randomUUID(), orphan = randomUUID()
    await store.publish(retained, Buffer.from("keep"))
    const publication = await store.publish(orphan, Buffer.from("orphan"))
    await publication.discardOrphan()
    expect(await readdir(root)).toEqual([retained])
    expect(await store.read(retained, 4)).toEqual(Buffer.from("keep"))
  })
  it("does not remove a replacement object during orphan cleanup", async () => {
    const id = randomUUID()
    const publication = await new NativeAttachmentStore(root).publish(id, Buffer.from("orphan"))
    const replacement = join(temporary, "replacement")
    await writeFile(replacement, "unrelated", { mode: 0o400 })
    await unlink(join(root, id))
    await symlink(replacement, join(root, id))
    await publication.discardOrphan()
    expect(await readFile(replacement, "utf8")).toBe("unrelated")
    expect(await readdir(root)).toEqual([id])
  })
  it.each(["../outside", "/etc/passwd", "a/b", "https://example.invalid/file", "\\..\\file", "00000000-0000-0000-0000-000000000000/../x"])("rejects arbitrary object paths %s", async id => {
    const store = new NativeAttachmentStore(root)
    await expect(store.publish(id, Buffer.from("x"))).rejects.toThrow()
    await expect(store.read(id, 1)).rejects.toThrow()
  })
  it("rejects a symlink root and a symlink ancestor without creating external files", async () => {
    const external = join(temporary, "external")
    await mkdir(external, { mode: 0o700 })
    await symlink(external, root)
    await expect(new NativeAttachmentStore(root).publish(randomUUID(), Buffer.from("x"))).rejects.toThrow()
    await expect(new NativeAttachmentStore(join(root, "child")).publish(randomUUID(), Buffer.from("x"))).rejects.toThrow()
    expect(await readdir(external)).toEqual([])
  })
  it("rejects symlink files, readable-by-others roots, writable retained objects and wrong sizes", async () => {
    const id = randomUUID(), store = new NativeAttachmentStore(root)
    await store.publish(id, Buffer.from("safe"))
    await expect(store.read(id, 3)).rejects.toThrow()
    await chmod(join(root, id), 0o600)
    await expect(store.read(id, 4)).rejects.toThrow()
    await chmod(join(root, id), 0o400)
    await chmod(root, 0o755)
    await expect(store.read(id, 4)).rejects.toThrow()
    await chmod(root, 0o700)
    const alias = randomUUID()
    await symlink(join(root, id), join(root, alias))
    await expect(store.read(alias, 4)).rejects.toThrow()
    await expect(store.publish(alias, Buffer.from("changed"))).rejects.toThrow()
    expect(await readFile(join(root, id), "utf8")).toBe("safe")
  })
  it("rejects empty/oversized writes and non-absolute configuration", async () => {
    const store = new NativeAttachmentStore(root)
    await expect(store.publish(randomUUID(), Buffer.alloc(0))).rejects.toThrow()
    await expect(store.publish(randomUUID(), Buffer.alloc(MAX_ATTACHMENT_SIZE + 1))).rejects.toThrow()
    expect(() => new NativeAttachmentStore("relative")).toThrow()
    expect(() => new NativeAttachmentStore(`${root}/../attachments`)).toThrow()
  })
})

describe("attachment MIME and magic boundary", () => {
  it.each([
    ["application/pdf", Buffer.from("%PDF-1.7\n")],
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["image/webp", Buffer.from("RIFF0000WEBP")],
    ["text/plain", Buffer.from("ใบเสร็จ receipt")],
    ["text/csv", Buffer.from("สินค้า,ยอด\nbook,250")],
  ] as const)("recognizes declared %s bytes, not just browser metadata", async (type, bytes) => {
    expect(await attachmentBytes(new File([bytes], "evidence", { type }))).toEqual(bytes)
    expect(validAttachmentContent(Buffer.from("not an image or PDF"), "image/png")).toBe(false)
  })
  it("rejects mismatched binary, invalid UTF-8, control bytes, unsupported MIME and traversal filenames", async () => {
    for (const file of [
      new File(["html"], "bill.pdf", { type: "application/pdf" }),
      new File([new Uint8Array([0xff])], "text.txt", { type: "text/plain" }),
      new File(["a\u0000b"], "text.txt", { type: "text/plain" }),
      new File(["<html>"], "page.html", { type: "text/html" }),
      new File(["evidence"], "../outside", { type: "text/plain" }),
    ]) await expect(attachmentBytes(file)).rejects.toThrow()
  })
})
