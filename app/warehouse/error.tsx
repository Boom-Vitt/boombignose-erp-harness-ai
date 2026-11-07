"use client"

import Link from "next/link"

export default function OrganizationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto max-w-2xl space-y-4 p-6" role="alert">
    <h1 className="text-xl font-semibold">ไม่สามารถอ่านภาพรวมองค์กร / Organization overview unavailable</h1>
    <p>การอ่านข้อมูลไม่สำเร็จ จึงไม่แสดงตัวเลขศูนย์หรือข้อมูลจำลอง / The authorized data read failed. No zero counts or simulated records are substituted.</p>
    <div className="flex flex-wrap gap-3"><button type="button" className="rounded-md border px-4 py-2" onClick={reset}>ลองใหม่ / Retry</button><Link href="/dashboard" className="rounded-md border px-4 py-2">กลับสู่ ERP / Back to ERP</Link></div>
  </main>
}
