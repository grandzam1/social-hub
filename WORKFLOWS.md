# Social Hub — current workflows

Exact flowcharts for what exists today (`social-hub` + Airtable base `appkPrLfwDGwIIbTL`).

---

## End-to-end happy path

```mermaid
flowchart LR
  A[Request: post URL / handle] --> B[ScrapeCreators API]
  B --> C[Normalize fields]
  C --> D[Upsert Airtable<br/>Profiles / Posts / Media]
  D --> E{Save mode}
  E -->|sync| F[POST /api/media/save-sync]
  E -->|async| G[POST /api/media/save]
  G --> H[Inngest event<br/>media/cdn.ready]
  H --> I[save-media-to-r2]
  F --> J[Download CDN File link]
  I --> J
  J --> K[Upload Cloudflare R2]
  K --> L[PATCH Media<br/>Saved copy = R2 URL]
  L --> M[File status:<br/>Saved copy ready]
  M --> N[Optional: Post Status = Saved]

  style D fill:#1e3a5f,color:#fff
  style K fill:#1e3a5f,color:#fff
  style L fill:#1e3a5f,color:#fff
```

---

## Workflow A — Scrape post → Airtable

> Still **manual / agent / script** today. No single `POST /api/scrape-post` yet.

```mermaid
flowchart TD
  A1[User or agent requests<br/>post URL or handle] --> A2[ScrapeCreators<br/>caption + media CDN URLs]
  A2 --> A3[Normalize to schema]
  A3 --> A4[Upsert Profiles]
  A3 --> A5[Upsert Posts]
  A3 --> A6[Create Media rows]
  A4 --> A7[Airtable ready]
  A5 --> A7
  A6 --> A7
  A6 --> A8[Media.File link = platform CDN]
  A6 --> A9[Media.File status =<br/>File link ready]
  A5 --> A10[Optional: Sounds / Hashtags links]
```

### Airtable writes

| Table | Key fields |
|-------|------------|
| Profiles | Handle, Platform, Followers, Verified |
| Posts | Post ID, Text, Link, Stats, Status |
| Media | File link (CDN), Preview, Type, Order |
| Sounds / Hashtags | Optional Topics / Sound links |

---

## Workflow B — CDN → R2 → Saved copy

### B1 — Sync (standalone, no Inngest)

```mermaid
flowchart TD
  B1[POST /api/media/save-sync<br/>mediaRecordId ± fileUrl, force] --> B2[Load Media from Airtable]
  B2 --> B3{Saved copy exists<br/>and force = false?}
  B3 -->|yes| B4[Skip: already-saved]
  B3 -->|no| B5[Read File link CDN URL]
  B5 --> B6[Download CDN bytes]
  B6 --> B7[Upload R2<br/>key: social-hub/{mediaId}/{ts}.ext]
  B7 --> B8[PATCH Media]
  B8 --> B9[File link unchanged CDN]
  B8 --> B10[Saved copy = R2 public URL]
  B8 --> B11[File status = Saved copy ready]
  B8 --> B12{postRecordId?}
  B12 -->|yes| B13[PATCH Post<br/>Status = Saved]
  B12 -->|no| B14[Done]
  B13 --> B14
```

CLI: `npm run save-media:sync -- --id rec…`

### B2 — Async (Inngest queue)

```mermaid
flowchart TD
  C1[POST /api/media/save<br/>mediaRecordId ± fileUrl, force] --> C2[inngest.send<br/>media/cdn.ready]
  C2 --> C3[Inngest Dev :8288<br/>or Inngest Cloud]
  C3 --> C4[Function: save-media-to-r2<br/>retries 3 · concurrency 3]
  C4 --> C5[Same pipeline as sync:<br/>CDN → R2 → Airtable PATCH]
  C5 --> C6[Idempotent skip<br/>if Saved copy exists]
```

CLI: `npm run save-media -- --id rec…`

---

## Workflow C — Health / smoke

```mermaid
flowchart LR
  H1[GET /health] --> H2[Check Inngest / Airtable / R2 keys]
  H3[POST /demo/hello] --> H4[Inngest smoke event]
  H5[npm run test:inngest-cloud] --> H6[Cloud event ingest]
  H7[npm run save-media:sync] --> H8[CLI → sync API]
```

---

## Media field contract

```mermaid
flowchart LR
  subgraph before [After scrape]
    F1[File link = CDN]
    F2[Preview link = thumb CDN]
    F3[Saved copy empty]
    F4[File status = File link ready]
  end

  subgraph after [After successful R2 save]
    G1[File link = CDN kept]
    G2[Preview link unchanged]
    G3[Saved copy = R2 URL]
    G4[File status = Saved copy ready]
  end

  before --> after
```

| Field | Owner | After successful save |
|-------|--------|------------------------|
| File link | Platform CDN | Unchanged (kept) |
| Saved copy | Our R2 | Public R2 URL set |
| File status | Pipeline | `Saved copy ready` |
| Preview link | Platform thumb | Usually unchanged |

---

## Gap

Carousel / multi-media: see [docs/carousel.md](docs/carousel.md).

```mermaid
flowchart LR
  X1[Paste URL in UI] --> X2[POST /api/scrape-post]
  X2 --> X3[ScrapeCreators]
  X3 --> X4[Airtable Post + Media Order 0..n]
  X4 --> X5{media count}
  X5 -->|1| X6[sync CDN→R2]
  X5 -->|2+| X7[batch Inngest media/cdn.ready]
  X6 --> X8[Status Saved iff all slides ready]
  X7 --> X8
```

UI: open `http://127.0.0.1:8787/` with `npm run dev:api`.
