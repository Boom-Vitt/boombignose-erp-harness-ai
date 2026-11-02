"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogOut, Pin } from "lucide-react"

import { NAV_GROUPS, NAV_ITEMS, showNavItem, type NavItem } from "@/components/nav"
import { useMode } from "@/components/mode-switch"
import { MODE_COPY, orderForMode } from "@/lib/mode"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"

export function AppSidebar({
  email,
  role,
  workspaceHeader,
}: {
  email: string | null
  role: string
  workspaceHeader: React.ReactNode
}) {
  const pathname = usePathname()
  const mode = useMode()

  const visible = NAV_ITEMS.filter((item) => showNavItem(role, item))
  // Mode-first: the current mode's starter pages lead the rail; the rest sit in their sections.
  const ordered = orderForMode(visible, mode)
  const starters = ordered.filter((item) => MODE_COPY[mode].first.includes(item.href))
  const sections = NAV_GROUPS.map((g) => ({
    ...g,
    items: ordered.filter((item) => item.group === g.id && !starters.includes(item)),
  })).filter((g) => g.items.length > 0)

  function renderItem(item: NavItem) {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
    const Icon = item.icon
    return (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton
          isActive={active}
          tooltip={item.title}
          className="bbn-nav-link"
          render={<Link href={item.href} prefetch={false} />}
        >
          <Icon />
          <span>{item.title}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <Sidebar collapsible="icon" className="bbn-shell-sidebar">
      <SidebarHeader className="border-sidebar-border border-b pb-3">
        {workspaceHeader}
      </SidebarHeader>

      <SidebarContent className="gap-1 py-2">
        <SidebarGroup>
          <SidebarGroupLabel data-start="true" className="bbn-nav-label h-auto! rounded-full!">
            <Pin className="size-3" aria-hidden />
            เริ่มที่นี่ / Start here
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{starters.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {sections.map((section) => (
          <SidebarGroup key={section.id}>
            <SidebarGroupLabel className="bbn-nav-label h-auto! rounded-full!">{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{section.items.map(renderItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-sidebar-border border-t">
        <div className="flex items-center gap-2 px-1 py-1.5">
          <Avatar className="border-primary/60 size-7 border">
            <AvatarFallback className="text-xs">
              {(email ?? "?").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-xs font-medium">{email ?? "—"}</span>
            <span className="text-muted-foreground text-[11px] capitalize">{role}</span>
          </div>
          <form
            action="/auth/signout"
            method="post"
            className="group-data-[collapsible=icon]:hidden"
          >
            <Button type="submit" variant="ghost" size="icon-sm" aria-label="Sign out">
              <LogOut />
            </Button>
          </form>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
