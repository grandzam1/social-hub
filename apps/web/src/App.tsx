import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminLayout } from "@/components/admin-layout";
import { ThemeProvider } from "@/components/theme-provider";
import { BatchPage } from "@/pages/batch";
import { DocsPage } from "@/pages/docs";
import { PullPage } from "@/pages/pull";
import { ScrapsPage } from "@/pages/scraps";
import { SettingsPage } from "@/pages/settings";

export default function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AdminLayout />}>
              <Route index element={<PullPage />} />
              <Route path="batch" element={<BatchPage />} />
              <Route path="scraps" element={<ScrapsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="docs" element={<DocsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster closeButton position="top-right" />
      </TooltipProvider>
    </ThemeProvider>
  );
}
