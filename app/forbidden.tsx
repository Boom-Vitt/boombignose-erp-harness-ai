import Link from "next/link"

export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center gap-4 p-8">
      <p className="text-muted-foreground text-sm">403 · Access restricted / จำกัดสิทธิ์การเข้าถึง</p>
      <h1 className="text-2xl font-semibold">This workspace action is not available to your session.</h1>
      <p>Your role may not allow this page, or session assurance could not be verified. Ask a workspace owner for access, or sign in again and complete your authenticator check.</p>
      <p>หน้านี้ต้องใช้สิทธิ์ที่เหมาะสมและยืนยันตัวตนสำเร็จ โปรดติดต่อเจ้าของพื้นที่ทำงานหรือเข้าสู่ระบบอีกครั้ง</p>
      <div className="flex gap-4"><Link className="underline" href="/dashboard">Back to workspace</Link><Link className="underline" href="/login/mfa">Verify authenticator</Link></div>
    </main>
  )
}
