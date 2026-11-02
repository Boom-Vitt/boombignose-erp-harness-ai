"use client"

import Link from "next/link"
import { ArrowLeft, Cpu, Mail, MessageSquare, NotebookText, Plug, PlugZap, Search, HardDrive, type LucideIcon } from "lucide-react"
import { useState, useSyncExternalStore } from "react"

import { PageHeader } from "@/components/page-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  CATALOG, CATEGORIES, LOCALE_KEY, STATUS_LABEL, filterEntries, parseLocale, pick, statusOf,
  type Category, type Locale, type Probes, type Text,
} from "@/lib/connections/catalog"

const ICON: Record<string, LucideIcon> = {
  "erp-mcp": Plug, "local-ai": Cpu, flowaccount: PlugZap, gmail: Mail, slack: MessageSquare, "google-drive": HardDrive, notion: NotebookText,
}

const EVENT = "bbn-locale-change"
const subscribe = (onChange: () => void) => {
  window.addEventListener(EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener("storage", onChange) }
}

/** The user's saved choice wins; otherwise profiles.locale; otherwise Thai. */
function useLocale(profileLocale: Locale): [Locale, (l: Locale) => void] {
  const saved = useSyncExternalStore(subscribe, () => parseLocale(window.localStorage.getItem(LOCALE_KEY)), () => null)
  return [saved ?? profileLocale, (l) => { window.localStorage.setItem(LOCALE_KEY, l); window.dispatchEvent(new Event(EVENT)) }]
}

const UI = {
  title: { th: "เชื่อมต่อแอป", en: "Connect apps" },
  subtitle: { th: "เลือกแอปที่จะเชื่อม", en: "Pick apps to link." },
  search: { th: "ค้นหาแอป", en: "Search apps" },
  all: { th: "ทั้งหมด", en: "All" },
  connect: { th: "เชื่อมต่อ", en: "Connect" },
  manage: { th: "จัดการ", en: "Manage" },
  notReady: { th: "ยังไม่พร้อม", en: "Not ready yet" },
  empty: { th: "ไม่พบแอปที่ตรงกับการค้นหา", en: "No apps match your search." },
  back: { th: "ตั้งค่า", en: "Settings" },
  categories: { th: "หมวดหมู่", en: "Categories" },
} satisfies Record<string, Text>

export function ConnectionsCatalog({ probes, profileLocale }: { probes: Probes; profileLocale: Locale }) {
  const [locale, setLocale] = useLocale(profileLocale)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<Category | "all">("all")
  const t = (text: Text) => pick(text, locale)
  const shown = filterEntries(CATALOG, query, category)
  const chips: { id: Category | "all"; label: Text }[] = [{ id: "all", label: UI.all }, ...CATEGORIES]

  return (
    <div className="space-y-6" lang={locale}>
      <PageHeader title={t(UI.title)} description={t(UI.subtitle)}>
        <Button variant="outline" onClick={() => setLocale(locale === "th" ? "en" : "th")} aria-label={locale === "th" ? "Switch to English" : "สลับเป็นภาษาไทย"}>
          {locale === "th" ? "สลับ ENG" : "สลับ ไทย"}
        </Button>
        <Link href="/settings" className={buttonVariants({ variant: "outline" })}><ArrowLeft /> {t(UI.back)}</Link>
      </PageHeader>

      <div className="space-y-3">
        <div className="relative max-w-md">
          <Search className="text-muted-foreground absolute top-2.5 left-3 size-4" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t(UI.search)} aria-label={t(UI.search)} className="pl-9" />
        </div>
        <div role="group" aria-label={t(UI.categories)} className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}
              className="border-input text-muted-foreground hover:bg-accent hover:text-foreground aria-pressed:border-primary aria-pressed:text-primary rounded-full border px-3.5 py-1.5 text-sm transition-colors">
              {t(c.label)}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? <p className="text-muted-foreground text-sm">{t(UI.empty)}</p> : (
        <ul className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3 [&>li]:min-w-0">
          {shown.map((e) => {
            const status = statusOf(e, probes)
            const Icon = ICON[e.id] ?? Plug
            return (
              <li key={e.id}>
                <Card className="bbn-deck-panel h-full border-0" data-testid={`connection-${e.id}`} data-status={status}>
                  <CardHeader>
                    <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                      <Icon className="text-primary size-4 shrink-0" aria-hidden /><span className="min-w-0 truncate" title={e.name}>{e.name}</span>
                      <span className="bbn-chip ml-auto shrink-0">{t(STATUS_LABEL[status])}</span>
                    </CardTitle>
                    <CardDescription>{t(e.description)}</CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto">
                    {status === "coming-soon" || !e.href
                      ? <Button variant="outline" disabled>{t(UI.notReady)}</Button>
                      : <Link href={e.href} className={buttonVariants({ variant: status === "connected" ? "outline" : "default" })}>
                          {e.cta ? t(e.cta) : t(status === "connected" ? UI.manage : UI.connect)}
                        </Link>}
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
