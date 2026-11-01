import { requireOrgContext } from "@/lib/auth"
import { WorkspaceHeader } from "@edition"
import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { ActivityCounter } from "@/components/record/activity-counter"
import { ModeSwitch, ModeTip } from "@/components/mode-switch"
import { ThemeToggle } from "@/components/theme-toggle"
import { CommandPalette } from "@/components/command-palette/command-palette"

// Authenticated pages read the session cookie. A build without one must not
// freeze a redirect to /login and serve it to a signed-in browser.
export const dynamic = "force-dynamic"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await requireOrgContext()

  return (
    <>
      <a
        href="#content"
        className="bg-background text-foreground sr-only z-50 rounded-md border px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <SidebarProvider>
        <AppSidebar
          email={ctx.email}
          role={ctx.role}
          workspaceHeader={<WorkspaceHeader context={ctx} />}
        />
        {/* min-w-0: wide content (kanban boards) scrolls in its own container instead of widening the page. */}
        <SidebarInset className="bbn-shell min-w-0">
          <header className="bbn-shell-header bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10 flex h-14 min-w-0 items-center gap-1 border-b px-2 backdrop-blur sm:gap-2 sm:px-4">
            <SidebarTrigger className="-ml-1 shrink-0" />
            <Separator orientation="vertical" className="mr-1 hidden h-5 sm:block" />
            <span className="min-w-0 flex-1 basis-0 truncate text-sm font-medium">{ctx.orgName}</span>
            <ModeSwitch />
            <ActivityCounter />
            <CommandPalette role={ctx.role} orgId={ctx.orgId} />
            <ThemeToggle />
          </header>
          <div id="content" tabIndex={-1} className="flex w-full min-w-0 flex-1 flex-col gap-6 p-4 outline-none md:p-6 [&>*]:min-w-0"><ModeTip />{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </>
  )
}
