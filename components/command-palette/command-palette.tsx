"use client"

import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { usePathname, useRouter } from "next/navigation"
import { ArrowRight, Command as CommandKey, Plus, Search, Zap } from "lucide-react"
import { toast } from "sonner"

import type { Role } from "@/lib/auth"
import { paletteCommands } from "@/lib/search/commands"
import { SEARCH_SOURCES, searchTerm } from "@/lib/search/query"
import { recordFromPath, type PaletteAction } from "@/lib/search/record-actions"
import { recordActions, runRecordAction, searchRecords, type SearchHit } from "@/lib/search/actions"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"

const TYPE_LABEL = Object.fromEntries(SEARCH_SOURCES.map((s) => [s.type, s.label]))
const SEARCH_DELAY_MS = 250

const noSubscribe = () => () => {}
const isApple = () => /Mac|iPhone|iPad/.test(navigator.userAgent)

export function CommandPalette({ role }: { role: Role; orgId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const commands = useMemo(() => paletteCommands(role), [role])
  const apple = useSyncExternalStore(noSubscribe, isApple, () => false)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [actions, setActions] = useState<PaletteAction[]>([])
  const [selected, setSelected] = useState("")
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef("")
  const actionsRequest = useRef(0)
  const touched = useRef(false)

  function changeOpen(next: boolean) {
    setOpen(next)
    clearTimeout(timer.current)
    latest.current = ""
    setQuery("")
    setHits([])
    setSearching(false)
    setActions([])
    setSelected(`go ${commands.goTo[0]?.title}`)
    touched.current = false
    // A late answer for an earlier opening is dropped.
    const request = ++actionsRequest.current
    if (!next || !recordFromPath(pathname)) return
    recordActions(pathname).then((loaded) => {
      if (request !== actionsRequest.current) return
      setActions(loaded)
      // Highlight the next step, as the StatusBar's primary button.
      if (loaded[0] && !touched.current) setSelected(`action ${loaded[0].label}`)
    }, () => {})
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // `code` keeps the shortcut working while a Thai (or other non-Latin) layout is active.
    const k = event.key.toLowerCase() === "k" || event.code === "KeyK"
    if (!k || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
    event.preventDefault()
    changeOpen(!open)
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    document.addEventListener("keydown", listener)
    return () => document.removeEventListener("keydown", listener)
  }, [])

  // Once the user types, arrows or points, a late Actions answer must not move the selection under them.
  function touch() {
    touched.current = true
  }

  function changeQuery(value: string) {
    touch()
    setQuery(value)
    clearTimeout(timer.current)
    const term = searchTerm(value)
    latest.current = term ?? ""
    if (!term) {
      setHits([])
      setSearching(false)
      return
    }
    setSearching(true)
    timer.current = setTimeout(async () => {
      let found: SearchHit[] = []
      let failure: string | undefined
      try {
        ;({ hits: found, error: failure } = await searchRecords(term))
      } catch {
        failure = "Record search failed. Try again."
      }
      // A newer query owns the results.
      if (latest.current !== term) return
      if (failure) toast.error(failure)
      setHits(found)
      setSearching(false)
    }, SEARCH_DELAY_MS)
  }

  function go(href: string) {
    changeOpen(false)
    router.push(href)
  }

  async function run(action: PaletteAction) {
    if ("href" in action) return go(action.href)
    changeOpen(false)
    if ("to" in action) {
      const res = await runRecordAction({ pathname, to: action.to }).catch(() => ({
        error: "The status change could not be confirmed. Reload the page to check.",
      }))
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success("Status updated")
        router.refresh()
      }
      return
    }
    const quoteId = recordFromPath(pathname)?.id
    if (action.command !== "convert" || !quoteId) return
    const invoiceControl = document.getElementById("create-invoice")
    if (invoiceControl) invoiceControl.click()
    else go(`/quotes/${quoteId}#invoices`)
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-muted-foreground sm:w-56 sm:justify-start"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => changeOpen(true)}
      >
        <Search aria-hidden />
        <span className="max-sm:sr-only">Search</span>
        <kbd className="bg-muted pointer-events-none ml-auto inline-flex items-center gap-0.5 rounded border border-dashed px-1.5 font-mono text-[10px] font-medium max-sm:hidden">
          {apple ? <><CommandKey className="size-2.5" aria-hidden />K</> : "Ctrl K"}
        </kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={changeOpen}
        title="Command palette"
        description="Go to a module, create a record, search records, or run an action on this record."
      >
        <Command
          label="Search commands and records"
          loop
          value={selected}
          onValueChange={setSelected}
          onKeyDown={touch}
        >
          <CommandInput placeholder="Type a command or search…" value={query} onValueChange={changeQuery} />
          <CommandList onPointerMove={touch}>
            <CommandEmpty>{searching ? "Searching…" : "No results."}</CommandEmpty>
            {actions.length ? (
              <CommandGroup heading="Actions">
                {actions.map((action) => (
                  <CommandItem key={action.label} value={`action ${action.label}`} onSelect={() => run(action)}>
                    <Zap aria-hidden />
                    {action.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandGroup heading="Go to">
              {commands.goTo.map(({ title, href, icon: Icon = ArrowRight }) => (
                <CommandItem key={href} value={`go ${title}`} onSelect={() => go(href)}>
                  <Icon aria-hidden />
                  {title}
                </CommandItem>
              ))}
            </CommandGroup>
            {commands.create.length ? (
              <CommandGroup heading="Create">
                {commands.create.map(({ title, href }) => (
                  <CommandItem key={href} value={`create ${title}`} onSelect={() => go(href)}>
                    <Plus aria-hidden />
                    {title}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {hits.length ? (
              <CommandGroup heading="Records">
                {hits.map((hit) => (
                  <CommandItem
                    key={hit.href}
                    value={`${hit.type}-${hit.id}`}
                    keywords={[hit.title, hit.detail ?? ""]}
                    onSelect={() => go(hit.href)}
                  >
                    <span className="truncate">{hit.title}</span>
                    <CommandShortcut className="tracking-normal">
                      {[TYPE_LABEL[hit.type], hit.detail].filter(Boolean).join(" · ")}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
