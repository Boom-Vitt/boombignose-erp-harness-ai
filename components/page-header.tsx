import { Fragment } from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export function PageHeader({
  title,
  description,
  breadcrumbs,
  children,
  className,
}: {
  title: string
  description?: string
  /** Ancestor pages, root first; the title closes the trail. */
  breadcrumbs?: { label: string; href: string }[]
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "border-border/70 flex min-w-0 flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-1.5">
        {breadcrumbs?.length ? (
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((crumb) => (
                <Fragment key={crumb.href}>
                  <BreadcrumbItem>
                    <BreadcrumbLink render={<Link href={crumb.href} />}>
                      {crumb.label}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </Fragment>
              ))}
              <BreadcrumbItem>
                <BreadcrumbPage>{title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        ) : null}
        <h1 className="text-[1.75rem] leading-tight font-semibold break-words sm:text-3xl">{title}</h1>
        {description ? (
          <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  )
}
