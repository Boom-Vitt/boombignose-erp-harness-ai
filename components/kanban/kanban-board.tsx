"use client"

import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronsLeftRight, ChevronsRightLeft, Plus, X } from "lucide-react"
import { toast } from "sonner"

import {
  activityCounts,
  activityState,
  afterForDrop,
  groupCards,
  hasTypedInput,
  moveCard,
  movedCardFocus,
  reorderAfter,
  serialQueue,
  type DueState,
  type KanbanCard as Card,
  type KanbanColumn,
  type KanbanGroup,
} from "@/lib/kanban"
import { formatTHBWhole } from "@/lib/money"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { KanbanCard } from "./kanban-card"
import { useFoldedColumns } from "./use-folded-columns"

/** `cancelled`: the user backed out (e.g. closed a dialog the move needed); nothing to report. */
type Result = { error?: string; cancelled?: boolean }

/** What the quick-create card holds; `form` carries any extra named fields. */
export type QuickCreateValues = { title: string; amount: string; form: FormData }

export type QuickCreateConfig<S extends string> = {
  titleLabel: string
  /** Extra inputs (named form fields) rendered under title and amount. */
  fields?: React.ReactNode
  onCreate: (stage: S, values: QuickCreateValues) => Promise<Result>
  /** Columns that offer quick create; all of them when omitted. */
  canCreateIn?: (stage: S) => boolean
  /** The full form, prefilled from what was typed so far. */
  fullFormHref: (stage: S, values: QuickCreateValues) => string
}

function readQuickCreate(form: HTMLFormElement): QuickCreateValues {
  const data = new FormData(form)
  const text = (key: string) => String(data.get(key) ?? "").trim()
  return { title: text("title"), amount: text("amount"), form: data }
}

const OFFLINE = "Couldn't reach the server. Please try again."

export function KanbanBoard<S extends string>({
  label,
  columns,
  moveTargets = columns,
  cards,
  today,
  storageKey,
  emptyLabel,
  onMove,
  reorderable = false,
  quickCreate,
}: {
  label: string
  columns: readonly KanbanColumn<S>[]
  /** Stages offered in each card's "Move to…" menu (defaults to the shown columns). */
  moveTargets?: readonly KanbanColumn<S>[]
  cards: readonly Card<S>[]
  /** YYYY-MM-DD in the org's timezone, for the due-state dots. */
  today: string
  /** localStorage key for fold state; include the user id. */
  storageKey: string
  emptyLabel: string
  /** `after`: the card the moved one now follows in column `to`; null for the top. */
  onMove: (id: string, to: S, after: string | null) => Promise<Result>
  /** Persisted card order: drops land where they are released, and cards can move up or down. */
  reorderable?: boolean
  quickCreate?: QuickCreateConfig<S>
}) {
  // While a move is in flight the card shows in its new column; React drops this layer when the
  // transition ends, so a rejected move falls back to the unchanged server list.
  const [shown, applyMove] = useOptimistic(
    cards,
    (state: readonly Card<S>[], m: { id: string; to: S; after: string | null }) => moveCard(state, m.id, m.to, m.after)
  )
  const [pending, startTransition] = useTransition()
  // Moves reach the server one at a time in the order they were made, so a later drop that
  // names an earlier-moved card as its neighbour never lands first.
  const [enqueue] = useState(serialQueue)
  const [dueFilter, setDueFilter] = useState<Partial<Record<S, DueState>>>({})
  const [folded, toggleFold] = useFoldedColumns(
    storageKey,
    columns.filter((c) => c.foldedByDefault).map((c) => c.id)
  )
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<{ column: S; after: string | null } | null>(null)
  const [creatingIn, setCreatingIn] = useState<S | null>(null)
  // Folds and closing quick create unmount the focused control; refocus its replacement.
  const refocus = useRef<string[]>([])
  // A card moved from its menu, followed until the move settles (see movedCardFocus).
  const followCard = useRef<string | null>(null)
  useEffect(() => {
    const active = document.activeElement
    const moved = movedCardFocus(followCard.current, shown, {
      pending,
      focusLost: !active || active === document.body,
    })
    followCard.current = moved.followId
    const target = [...refocus.current, ...moved.selectors]
      .map((selector) => document.querySelector<HTMLElement>(selector))
      .find(Boolean)
    if (!target) return
    refocus.current = []
    target.focus()
  })

  function fold(id: S) {
    refocus.current = [folded.has(id) ? `[data-fold="${id}"]` : `[data-unfold="${id}"]`]
    toggleFold(id)
  }

  function move(id: string, to: S, after: string | null = null) {
    const card = shown.find((c) => c.id === id)
    if (!card || (!reorderable && card.stage === to) || moveCard(shown, id, to, after) === shown) return
    const target = moveTargets.find((c) => c.id === to)?.label ?? to
    startTransition(async () => {
      applyMove({ id, to, after })
      const res = await enqueue(() => onMove(id, to, after)).catch((): Result => ({ error: OFFLINE }))
      if (res.cancelled) return
      if (res.error) toast.error(res.error)
      else if (card.stage !== to) toast.success(`Moved "${card.title}" to ${target}`)
    })
  }

  function moveFromMenu(id: string, to: S, after: string | null = null) {
    followCard.current = id
    move(id, to, after)
  }

  const filtered = shown.filter((c) => !dueFilter[c.stage] || activityState(c, today) === dueFilter[c.stage])
  // Drops and keyboard moves are relative to the cards the user can see.
  const columnIds = (column: S) => filtered.filter((c) => c.stage === column).map((c) => c.id)

  /** Where a drop in `column` would land: before the first card whose middle is below the pointer. */
  function dropSlot(e: React.DragEvent<HTMLElement>, column: S): string | null {
    if (!reorderable) return null
    const ids = columnIds(column)
    const next = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-card]")].find((el) => {
      const box = el.getBoundingClientRect()
      return e.clientY < box.top + box.height / 2
    })?.dataset.card
    const anchor = next ?? ids.at(-1)
    return anchor && ids.includes(anchor) ? afterForDrop(ids, anchor, !next, dragging ?? undefined) : null
  }

  function dropProps(column: S) {
    return {
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!dragging) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        const after = dropSlot(e, column)
        if (over?.column !== column || over.after !== after) setOver({ column, after })
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
      },
      onDrop: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault()
        const id = dragging ?? e.dataTransfer.getData("text/plain")
        const after = over?.column === column ? over.after : dropSlot(e, column)
        setOver(null)
        setDragging(null)
        if (id) move(id, column, after)
      },
    }
  }

  const groups = groupCards(columns, filtered)
  const idsByColumn = new Map(groups.map((g) => [g.id, g.cards.map((c) => c.id)]))
  // A single (filtered) column is never folded away.
  const canFold = columns.length > 1

  return (
    <section aria-label={label} className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-start gap-4">
        {groups.map((group) =>
          canFold && folded.has(group.id) ? (
            <FoldedColumn
              key={group.id}
              group={group}
              highlighted={over?.column === group.id}
              onUnfold={() => fold(group.id)}
              {...dropProps(group.id)}
            />
          ) : (
            <section
              key={group.id}
              aria-label={group.label}
              data-testid="kanban-column"
              className="w-72 shrink-0"
              {...dropProps(group.id)}
            >
              <div className="mb-2 flex items-center gap-1.5 px-1">
                <h2 className="text-sm font-semibold">{group.label}</h2>
                <span className="text-muted-foreground text-xs">{group.cards.length}</span>
                <span className="text-muted-foreground ms-auto text-xs tabular-nums">
                  {formatTHBWhole(group.sumSatang)}
                </span>
                {quickCreate && (quickCreate.canCreateIn?.(group.id) ?? true) ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Quick create in ${group.label}`}
                    aria-expanded={creatingIn === group.id}
                    data-create={group.id}
                    onClick={() => setCreatingIn(creatingIn === group.id ? null : group.id)}
                  >
                    <Plus />
                  </Button>
                ) : null}
                {canFold ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Fold ${group.label}`}
                    data-fold={group.id}
                    onClick={() => fold(group.id)}
                  >
                    <ChevronsRightLeft />
                  </Button>
                ) : null}
              </div>
              {group.expectedSatang !== null ? (
                <p className="text-muted-foreground -mt-1.5 mb-2 px-1 text-end text-xs tabular-nums">
                  Expected {formatTHBWhole(group.expectedSatang)}
                </p>
              ) : null}
              <ActivityBar
                column={group.label}
                counts={activityCounts(shown.filter((c) => c.stage === group.id), today)}
                active={dueFilter[group.id] ?? null}
                onSelect={(state) => setDueFilter((f) => ({ ...f, [group.id]: state ?? undefined }))}
              />
              <div
                className={cn(
                  "border-border/60 bg-sidebar/70 min-h-24 space-y-2 rounded-xl border p-2 transition-colors",
                  over?.column === group.id && "bg-accent ring-2 ring-ring/40"
                )}
              >
                {quickCreate && creatingIn === group.id ? (
                  <QuickCreate
                    stage={group.id}
                    config={quickCreate}
                    onClose={() => {
                      refocus.current = [`[data-create="${group.id}"]`]
                      setCreatingIn(null)
                    }}
                  />
                ) : null}
                {group.cards.length === 0 && creatingIn !== group.id ? (
                  <p className="text-muted-foreground px-2 py-6 text-center text-xs">{emptyLabel}</p>
                ) : null}
                {group.cards.map((card, i) => {
                  const ids = idsByColumn.get(group.id)!
                  const up = reorderable ? reorderAfter(ids, card.id, "up") : undefined
                  const down = reorderable ? reorderAfter(ids, card.id, "down") : undefined
                  const dropHere = reorderable && over?.column === group.id
                  return (
                    <KanbanCard
                      key={card.id}
                      card={card}
                      columns={moveTargets}
                      today={today}
                      dragging={dragging === card.id}
                      dropMark={dropHere && over.after === card.id ? "after" : dropHere && i === 0 && over.after === null ? "before" : undefined}
                      onDragStart={() => setDragging(card.id)}
                      onDragEnd={() => {
                        setDragging(null)
                        setOver(null)
                      }}
                      onMove={(to) => moveFromMenu(card.id, to)}
                      onMoveUp={up === undefined ? undefined : () => moveFromMenu(card.id, card.stage, up)}
                      onMoveDown={down === undefined ? undefined : () => moveFromMenu(card.id, card.stage, down)}
                    />
                  )
                })}
              </div>
            </section>
          )
        )}
      </div>
    </section>
  )
}

const ACTIVITY_SEGMENTS: { state: DueState; label: string; className: string }[] = [
  { state: "overdue", label: "overdue", className: "bg-red-500" },
  { state: "today", label: "due today", className: "bg-amber-500" },
  { state: "planned", label: "planned", className: "bg-emerald-500" },
]

/** Next-activity mix of a column; a segment filters the column to its cards. */
function ActivityBar({
  column,
  counts,
  active,
  onSelect,
}: {
  column: string
  counts: Record<DueState | "none", number>
  active: DueState | null
  onSelect: (state: DueState | null) => void
}) {
  // The active segment stays even at zero, so its filter can always be cleared.
  const segments = ACTIVITY_SEGMENTS.filter((s) => counts[s.state] > 0 || s.state === active)
  if (!segments.length) return null
  return (
    <div role="group" aria-label={`${column} activities`} className="mb-2 flex h-1.5 gap-px px-1">
      {segments.map((s) => (
        <button
          key={s.state}
          type="button"
          aria-pressed={active === s.state}
          aria-label={`${counts[s.state]} ${s.label}${active === s.state ? ", showing only these" : ""}`}
          title={`${counts[s.state]} ${s.label}`}
          style={{ flexGrow: counts[s.state] }}
          className={cn(
            "relative min-w-3 rounded-full transition-opacity after:absolute after:-inset-y-2.5 after:inset-x-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            s.className,
            active && active !== s.state && "opacity-30"
          )}
          onClick={() => onSelect(active === s.state ? null : s.state)}
        />
      ))}
      {counts.none ? <span aria-hidden className="bg-muted rounded-full" style={{ flexGrow: counts.none }} /> : null}
    </div>
  )
}

function FoldedColumn<S extends string>({
  group,
  highlighted,
  onUnfold,
  ...drop
}: {
  group: KanbanGroup<S>
  highlighted: boolean
  onUnfold: () => void
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section aria-label={group.label} data-testid="kanban-column-folded" className="shrink-0" {...drop}>
      <button
        type="button"
        onClick={onUnfold}
        data-unfold={group.id}
        aria-label={`Unfold ${group.label} (${group.cards.length})`}
        className={cn(
          "text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-48 w-10 flex-col items-center gap-2 rounded-lg bg-muted/40 py-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          highlighted && "bg-muted ring-2 ring-ring/40"
        )}
      >
        <ChevronsLeftRight className="size-4" />
        <span className="font-medium [writing-mode:vertical-rl]">
          {group.label} ({group.cards.length})
        </span>
      </button>
    </section>
  )
}

function QuickCreate<S extends string>({
  stage,
  config,
  onClose,
}: {
  stage: S
  config: QuickCreateConfig<S>
  onClose: () => void
}) {
  const router = useRouter()
  const id = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  // Escape on a card that holds typed text asks first instead of dropping it.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const keepEditing = () => {
    setConfirmingDiscard(false)
    formRef.current?.querySelector<HTMLInputElement>("input[name=title]")?.focus()
  }

  return (
    <form
      ref={formRef}
      className="space-y-2 rounded-lg border bg-card p-3 shadow-sm"
      onKeyDown={(e) => {
        // Escape inside a portaled popup (the client select) only closes that popup.
        if (e.key !== "Escape" || !e.currentTarget.contains(e.target as Node)) return
        if (confirmingDiscard) keepEditing()
        else if (hasTypedInput(new FormData(e.currentTarget))) setConfirmingDiscard(true)
        else onClose()
      }}
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const values = readQuickCreate(form)
        startTransition(async () => {
          const res = await config.onCreate(stage, values).catch((): Result => ({ error: OFFLINE }))
          if (res.error) {
            toast.error(res.error)
            return
          }
          toast.success(`Created "${values.title}"`)
          form.reset()
          form.querySelector<HTMLInputElement>("input[name=title]")?.focus()
        })
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`${id}-title`}>{config.titleLabel}</Label>
        <Input id={`${id}-title`} name="title" required autoFocus autoComplete="off" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-amount`}>Amount (THB)</Label>
        <Input
          id={`${id}-amount`}
          name="amount"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          placeholder="0.00"
        />
      </div>
      {config.fields}
      {confirmingDiscard ? (
        <div role="alertdialog" aria-labelledby={`${id}-discard`} className="space-y-2 rounded-md border p-2">
          <p id={`${id}-discard`} className="text-sm">Discard what you typed?</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="destructive" onClick={onClose}>
              Discard
            </Button>
            <Button type="button" size="sm" variant="outline" autoFocus onClick={keepEditing}>
              Keep editing
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={pending}>
          Add
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            if (formRef.current) router.push(config.fullFormHref(stage, readQuickCreate(formRef.current)))
          }}
        >
          Edit
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Discard quick create"
          className="ms-auto"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
    </form>
  )
}
