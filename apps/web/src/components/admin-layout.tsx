import { Outlet, useLocation } from "react-router-dom";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

const titles: Record<string, string> = {
  "/": "Pull media",
  "/batch": "Batch",
  "/scraps": "Saved scraps",
  "/settings": "Settings",
  "/docs": "API docs",
};

export function AdminLayout() {
  const { pathname } = useLocation();
  const title =
    titles[pathname] ||
    Object.entries(titles).find(([k]) => pathname.startsWith(k) && k !== "/")?.[1] ||
    "Social Hub";

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader title={title} />
        <div className="flex flex-1 flex-col gap-4 p-3 md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
