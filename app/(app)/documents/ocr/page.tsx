import { requireOrgContext } from "@/lib/auth"
import { PageHeader } from "@/components/page-header"
import { OcrWorkbench } from "@/components/ocr/ocr-workbench"

export const dynamic = "force-dynamic"

export default async function DocumentOcrPage() {
  await requireOrgContext()
  return <div className="space-y-6">
    <PageHeader title="Document OCR / อ่านเอกสาร" description="Private local Thai/English document transcription and review. No financial records are created here." />
    <OcrWorkbench />
  </div>
}
