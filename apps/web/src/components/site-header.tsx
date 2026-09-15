import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { CreditsChip } from "@/components/credits-chip";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur supports-backdrop-filter:bg-background/70 md:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium md:text-base">
        {title}
      </h1>
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <CreditsChip />
      </div>
    </header>
  );
}
