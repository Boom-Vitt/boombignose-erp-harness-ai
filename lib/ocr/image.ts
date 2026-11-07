import { OCR_LIMITS, sniffOcrMime } from "./contracts"

/** Inspect encoded dimensions before browser decode allocates a bitmap. */
export function rasterDimensions(bytes: Uint8Array): { width: number; height: number; mime: string } {
  const mime = sniffOcrMime(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0, height = 0
  try {
    if (mime === "image/png") {
      if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") throw new Error("header")
      width = view.getUint32(16); height = view.getUint32(20)
      for (let at = 8; at + 12 <= bytes.length;) {
        const size = view.getUint32(at)
        const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
        if (type === "acTL") throw new Error("animation")
        if (size > bytes.length - at - 12) throw new Error("chunk")
        at += size + 12
      }
    } else if (mime === "image/jpeg") {
      for (let at = 2; at + 4 <= bytes.length;) {
        if (bytes[at++] !== 255) throw new Error("marker")
        while (bytes[at] === 255) at++
        const marker = bytes[at++]
        if (marker === 0xda || marker === 0xd9) break
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
        const length = view.getUint16(at)
        if (length < 2 || at + length > bytes.length) throw new Error("segment")
        if ([0xc0, 0xc1, 0xc2].includes(marker)) { height = view.getUint16(at + 3); width = view.getUint16(at + 5); break }
        at += length
      }
    } else if (mime === "image/webp") {
      const kind = String.fromCharCode(...bytes.subarray(12, 16))
      if (kind === "VP8X") {
        if ((bytes[20] & 2) !== 0) throw new Error("animation")
        width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
        height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
      } else if (kind === "VP8 ") {
        if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) throw new Error("frame")
        width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff
      } else if (kind === "VP8L" && bytes[20] === 0x2f) {
        const packed = view.getUint32(21, true)
        width = (packed & 0x3fff) + 1; height = ((packed >>> 14) & 0x3fff) + 1
      }
    }
  } catch { throw new Error("Invalid or animated image. Use a still JPEG, PNG or WebP.") }
  if (!mime || !width || !height || width * height > OCR_LIMITS.sourcePixels || Math.max(width, height) > 20000) throw new Error("Invalid image or image exceeds 20 million pixels / 20000 pixels per edge.")
  return { width, height, mime }
}
