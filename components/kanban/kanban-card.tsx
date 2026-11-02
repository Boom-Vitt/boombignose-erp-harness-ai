"use client"

import Link from "next/link"
import { ArrowDown, ArrowRightLeft, ArrowUp } from "lucide-react"

import { dueState, initials, type DueState, type KanbanCard as Card, type KanbanColumn } from "@/lib/kanban"
import { formatTHB } from "@/lib/money"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const DUE: Record<DueState, { label: string; className: string }> = {
  overdue: { label: "overdue", className: "bg-red-500" },
  today: { label: "due today", className: "bg-amber-500" },
  planned: { label: "planned", className: "bg-emerald-500" },
}

export function KanbanCard<S extends string>({
  card,
  columns,
  today,
  dragging,
  dropMark,
  onDragStart,
  onDragEnd,
  onMove,
  onMoveUp,
  onMoveDown,
}: {
  card: Card<S>
  columns: readonly KanbanColumn<S>[]
  today: string
  dragging: boolean
  /** Where a drag in progress would land, drawn in the gap so the cards don't shift. */
  dropMark?: "before" | "after"
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (to: S) => void
  /** Keyboard reorder within the column; omitted at the column's edge or on unordered boards. */
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  const due = card.due ? DUE[dueState(card.due, today)] : null

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id)
        e.dataTransfer.effectAllowed = "move"
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      data-card={card.id}
      className={cn(
        "group/card relative cursor-grab rounded-[0.7rem] border bg-card p-3 text-card-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] transition-colors hover:border-primary/60 active:cursor-grabbing",
        dragging && "opacity-50"
      )}
    >
      {dropMark ? (
        <span
          aria-hidden
          data-testid="kanban-drop-line"
          className={cn("bg-primary pointer-events-none absolute inset-x-0 h-0.5 rounded-full", dropMark === "before" ? "-top-[5px]" : "-bottom-[5px]")}
        />
      ) : null}
      <Link
        href={card.href}
        draggable={false}
        className="block pr-7 text-sm font-medium leading-snug outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
      >
        {card.title}
      </Link>
      {card.amountSatang !== null ? (
        <div className="mt-1 text-sm font-semibold">
          {formatTHB(card.amountSatang)}
          {card.probability !== undefined ? (
            <span className="text-muted-foreground ms-1.5 text-xs font-normal">
              <span className="sr-only">win probability </span>
              {card.probability}%
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-muted-foreground truncate text-xs">{card.client ?? "—"}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {due ? (
            <span
              className={cn("size-2 rounded-full", due.className)}
              title={`Next activity ${due.label} (${card.due})`}
            >
              <span className="sr-only">
                Next activity {due.label} ({card.due})
              </span>
            </span>
          ) : null}
          {card.owner ? (
            <span
              className="bg-muted text-muted-foreground flex size-6 items-center justify-center rounded-full text-[0.65rem] font-semibold"
              title={card.owner}
            >
              <span aria-hidden>{initials(card.owner)}</span>
              <span className="sr-only">Owner: {card.owner}</span>
            </span>
          ) : null}
        </span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Move "${card.title}" to…`}
              data-move
              className="absolute top-2 right-2 z-10"
            />
          }
        >
          <ArrowRightLeft />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Move to…</DropdownMenuLabel>
            {columns
              .filter((c) => c.id !== card.stage)
              .map((c) => (
                <DropdownMenuItem key={c.id} onClick={() => onMove(c.id)}>
                  {c.label}
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
          {onMoveUp || onMoveDown ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {onMoveUp ? (
                  <DropdownMenuItem onClick={onMoveUp}>
                    <ArrowUp /> Move up
                  </DropdownMenuItem>
                ) : null}
                {onMoveDown ? (
                  <DropdownMenuItem onClick={onMoveDown}>
                    <ArrowDown /> Move down
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
