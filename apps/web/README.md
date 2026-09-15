# Social Hub — admin web

Vite + React + TypeScript + shadcn/ui (Radix) admin shell.

## Dev

From repo root:

```bash
npm run install:web
npm run dev:web
```

Opens on http://127.0.0.1:5173 with `/api` proxied to the Hono API on `:8787`.

## Stack

- Sidebar layout (`SidebarProvider` + `AppSidebar`)
- Theme + autoplay prefs (`Settings`, `social-hub.theme` / `social-hub.media.v1`)
- Pages: Pull, Batch, Scraps (Carousel + Avatar + caption copy), API docs, Settings
