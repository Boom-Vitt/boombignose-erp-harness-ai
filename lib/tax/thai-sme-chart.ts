/** Reference accounts for a Thai SME. The list stores names and codes. A draft journal can post balanced lines that use these codes. Those lines are not signed statutory books. */
export const THAI_SME_CHART = [
  { code: "1110", nameTh: "เงินสด", nameEn: "Cash", kind: "asset" },
  { code: "1120", nameTh: "เงินฝากธนาคาร", nameEn: "Bank", kind: "asset" },
  { code: "1130", nameTh: "ลูกหนี้การค้า", nameEn: "Accounts receivable", kind: "asset" },
  { code: "1140", nameTh: "ภาษีซื้อ", nameEn: "VAT input", kind: "asset" },
  { code: "1150", nameTh: "ภาษีถูกหัก ณ ที่จ่าย", nameEn: "Withholding receivable", kind: "asset" },
  { code: "2110", nameTh: "เจ้าหนี้การค้า", nameEn: "Accounts payable", kind: "liability" },
  { code: "2130", nameTh: "ภาษีขาย", nameEn: "VAT output", kind: "liability" },
  { code: "2140", nameTh: "ภาษีหัก ณ ที่จ่ายค้างจ่าย", nameEn: "Withholding payable", kind: "liability" },
  { code: "3100", nameTh: "ทุน", nameEn: "Owner equity", kind: "equity" },
  { code: "4100", nameTh: "รายได้จากการขาย", nameEn: "Sales", kind: "income" },
  { code: "5100", nameTh: "ต้นทุนขาย", nameEn: "Cost of goods sold", kind: "expense" },
  { code: "6100", nameTh: "ค่าใช้จ่ายในการดำเนินงาน", nameEn: "Operating expense", kind: "expense" },
] as const

export type ChartKind = (typeof THAI_SME_CHART)[number]["kind"]
