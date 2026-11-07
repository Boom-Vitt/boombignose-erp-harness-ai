package erpinsight

const (
	reportFilingLeadTh               = "ปิดงบปฏิบัติการได้สบายๆ ใน BoomBigNose แล้วส่งตัวเลขให้นักบัญชี"
	reportFilingLeadEn               = "Close the operational month here, then hand the numbers to your accountant."
	reportFilingLimitTh              = "BoomBigNose ไม่ยื่นแบบ ภ.พ.30 ไม่ส่ง e-Tax และไม่มีบัญชีแยกประเภทตามกฎหมาย"
	reportFilingLimitEn              = "BoomBigNose does not file ภ.พ.30, does not send e-Tax, and does not keep a statutory ledger."
	reportBahtCaptionTh              = "จำนวนเงินเป็นบาท"
	reportBahtCaptionEn              = "Amounts are baht (THB)."
	reportVatSupportTh               = "ภาษีขายและภาษีซื้อคือยอดภาษีมูลค่าเพิ่มที่บันทึกในเอกสาร อัตรามาตรฐานคือ 7% เมื่อกิจการจดทะเบียนภาษีมูลค่าเพิ่ม เป็นข้อมูลประกอบ ไม่ใช่การยื่นแบบ ภ.พ.30"
	reportVatSupportEn               = "Output VAT and input VAT are the VAT amounts stored on the documents. The standard rate is 7% when the seller is VAT-registered. Support data for your accountant. Not a ภ.พ.30 filing."
	reportAccountantPackDisclaimerEn = "Support data for the external accountant only. This pack does not file ภ.พ.30, does not call the Revenue Department, and is not a statutory ledger."
	reportAccountantPackDisclaimerTh = "ข้อมูลประกอบสำหรับนักบัญชีภายนอกเท่านั้น ชุดนี้ไม่ยื่นแบบ ภ.พ.30 ไม่ติดต่อกรมสรรพากร และไม่ใช่งบการเงินตามกฎหมาย"
	reportVendorWhtNote              = "Customer withholding is only what is already stored on issued invoices and credit notes, grouped by customer. Withholding we deducted on purchases is listed separately from the purchase withholding records. Withholding is the amount already stored on issued invoices and credit notes. Rates in this app are 0%, 1%, 2%, 3%, 5%. This does not file a withholding return. หัก ณ ที่จ่ายคือยอดที่บันทึกไว้ในใบแจ้งหนี้และใบลดหนี้ อัตราที่ระบบรับได้คือ 0%, 1%, 2%, 3%, 5% ไม่ใช่การยื่นแบบหัก ณ ที่จ่าย"
	reportVatReportDisclaimerTh      = "ข้อมูลประกอบสำหรับนักบัญชีภายนอกเท่านั้น ชุดนี้ไม่ยื่นแบบ ภ.พ.30 ไม่ติดต่อกรมสรรพากร และไม่ใช่งบการเงินตามกฎหมาย รายงานนี้เป็นข้อมูลประกอบ ไม่ใช่การยื่นแบบ ภ.พ.30 และไม่ใช่ e-Tax. BoomBigNose ไม่ยื่นแบบ ภ.พ.30 ไม่ส่ง e-Tax และไม่มีบัญชีแยกประเภทตามกฎหมาย"
	reportVatReportDisclaimerEn      = "Support data for the external accountant only. This pack does not file ภ.พ.30, does not call the Revenue Department, and is not a statutory ledger. This report is a ภ.พ.30-style support summary, not a filing and not e-Tax. BoomBigNose does not file ภ.พ.30, does not send e-Tax, and does not keep a statutory ledger."
	reportWhtReportDisclaimerTh      = "รายการนี้เป็นข้อมูลประกอบสำหรับนักบัญชี ไม่ใช่การยื่นแบบ ภ.ง.ด.3 หรือ ภ.ง.ด.53 และเลขที่ WHT เป็นเลขอ้างอิงภายใน ไม่ใช่หนังสือรับรอง 50 ทวิ ที่ลงนามแล้ว BoomBigNose ไม่ยื่นแบบ ภ.พ.30 ไม่ส่ง e-Tax และไม่มีบัญชีแยกประเภทตามกฎหมาย"
	reportWhtReportDisclaimerEn      = "Support data for the external accountant only. Not a filing: these lists help prepare ภ.ง.ด.3 / ภ.ง.ด.53, and the WHT number is an internal working-copy reference, not a signed 50 ทวิ. BoomBigNose does not file ภ.พ.30, does not send e-Tax, and does not keep a statutory ledger."
)

var reportFilingParties = []string{
	"BoomBigNose เก็บเอกสาร ล็อกงวด และทำไฟล์ข้อมูลประกอบ / BoomBigNose keeps the documents, the finance lock, and the support file.",
	"นักบัญชีตรวจและจัดทำงบตามกฎหมาย / Your accountant reviews them and prepares the statutory books.",
	"ผู้ประกอบการกับนักบัญชียื่นแบบต่อกรมสรรพากร / You and your accountant file with the Revenue Department.",
}
