/**
 * Who files under Thai rules. BoomBigNose closes an operational month and
 * prepares support files. It does not file with the Revenue Department and
 * it does not keep a statutory ledger.
 */

export const FILING_LEAD_TH = "ปิดงบปฏิบัติการได้สบายๆ ใน BoomBigNose แล้วส่งตัวเลขให้นักบัญชี"
export const FILING_LEAD_EN = "Close the operational month here, then hand the numbers to your accountant."

export const FILING_PARTIES = [
  {
    th: "BoomBigNose เก็บเอกสาร ล็อกงวด และทำไฟล์ข้อมูลประกอบ",
    en: "BoomBigNose keeps the documents, the finance lock, and the support file.",
  },
  {
    th: "นักบัญชีตรวจและจัดทำงบตามกฎหมาย",
    en: "Your accountant reviews them and prepares the statutory books.",
  },
  {
    th: "ผู้ประกอบการกับนักบัญชียื่นแบบต่อกรมสรรพากร",
    en: "You and your accountant file with the Revenue Department.",
  },
] as const

export const FILING_LIMIT_TH = "BoomBigNose ไม่ยื่นแบบ ภ.พ.30 ไม่ส่ง e-Tax และไม่มีบัญชีแยกประเภทตามกฎหมาย"
export const FILING_LIMIT_EN = "BoomBigNose does not file ภ.พ.30, does not send e-Tax, and does not keep a statutory ledger."
