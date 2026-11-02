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
import { CommandPalette } from "@/components/command-palette/command-palette"
import { VersionDock } from "@/components/chrome/version-dock"
import { StageBackdrop } from "@/components/three/stage-backdrop"

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
      {/* The 3D base: one persistent full-bleed stage behind every page (layouts don't remount on navigation). */}
      <StageBackdrop />
      <SidebarProvider className="relative z-10">
        <AppSidebar
          email={ctx.email}
          role={ctx.role}
          workspaceHeader={<WorkspaceHeader context={ctx} />}
        />
        {/* min-w-0: wide content (kanban boards) scrolls in its own container instead of widening the page. */}
        <SidebarInset className="bbn-shell min-w-0">
          <header className="bbn-shell-header sticky top-0 z-10 flex h-14 min-w-0 items-center gap-2 px-3 backdrop-blur-md sm:px-5">
            <SidebarTrigger className="-ml-1 shrink-0" />
            <Separator orientation="vertical" className="mr-1 hidden h-5 sm:block" />
            <div className="min-w-0 flex-1 basis-0"><span className="bbn-chip max-w-full truncate">{ctx.orgName}</span></div>
            <CommandPalette role={ctx.role} orgId={ctx.orgId} />
            <ModeSwitch />
            <ActivityCounter />
          </header>
          <div id="content" tabIndex={-1} className="mx-auto flex w-full max-w-[1480px] min-w-0 flex-1 flex-col gap-5 p-4 outline-none sm:p-5 lg:px-7 lg:py-6 [&>*]:min-w-0"><ModeTip />{children}</div>
        </SidebarInset>
      </SidebarProvider>
      <VersionDock canUpdate={ctx.role === "owner" || ctx.role === "admin"} />
    </>
  )
}
