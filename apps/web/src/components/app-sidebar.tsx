import { Link, useLocation } from "react-router-dom";
import {
  ActivityIcon,
  BookOpenIcon,
  DownloadIcon,
  LayersIcon,
  Link2Icon,
  SettingsIcon,
} from "lucide-react";
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
} from "@/components/ui/sidebar";

const nav = [
  { title: "Pull media", href: "/", icon: Link2Icon },
  { title: "Batch", href: "/batch", icon: DownloadIcon },
  { title: "Scraps", href: "/scraps", icon: LayersIcon },
  { title: "Usage", href: "/usage", icon: ActivityIcon },
  { title: "API docs", href: "/docs", icon: BookOpenIcon },
  { title: "Settings", href: "/settings", icon: SettingsIcon },
];

export function AppSidebar() {
  const location = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-4">
        <Link to="/" className="flex flex-col gap-0.5 overflow-hidden px-1">
          <span className="truncate text-sm font-semibold tracking-tight text-sidebar-primary">
            Social Hub
          </span>
          <span className="truncate text-xs text-muted-foreground">
            scrape · save · scrapbook
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Admin</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
                const active =
                  item.href === "/"
                    ? location.pathname === "/"
                    : location.pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                    >
                      <Link to={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3 text-xs text-muted-foreground">
        Vite admin · Hono API
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
