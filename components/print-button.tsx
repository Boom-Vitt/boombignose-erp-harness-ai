"use client"

import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"

export function PrintButton({ children }: { children: ReactNode }) {
  return <Button className="print:hidden" variant="outline" type="button" onClick={() => window.print()}>{children}</Button>
}
