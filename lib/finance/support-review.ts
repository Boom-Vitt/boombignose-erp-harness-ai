/**
 * A support-pack review mark. The signed-in person says they looked at one
 * stored checksum. It is not a statutory sign-off and not a filing.
 */

export const SUPPORT_REVIEW_MARK_TH =
  "เครื่องหมายนี้แปลว่าผู้ใช้คนนี้ดูไฟล์ที่มีเช็คซัมนี้แล้ว ไม่ใช่ความเห็นทางกฎหมาย ไม่ใช่การปิดงบตามกฎหมาย และไม่ใช่การยื่นแบบ ภ.พ.30"

export const SUPPORT_REVIEW_MARK_EN =
  "This mark means this person looked at the file with this checksum. It is not a legal opinion, not a statutory sign-off, and not a ภ.พ.30 filing."

export function reviewedChecksums(
  rows: readonly { action: string; actorId: string | null; sha256: string | null }[],
  viewerId: string,
): Set<string> {
  const mine = new Set<string>()
  for (const row of rows) {
    if (row.action === "support_pack_reviewed" && row.actorId === viewerId && row.sha256) mine.add(row.sha256)
  }
  return mine
}
