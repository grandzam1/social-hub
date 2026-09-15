# Standalone API + automation

Full endpoint reference (inputs, responses, UI usage): **[api.md](./api.md)** — also in the UI at `/docs/api`.

You can run the CDN → R2 → Airtable flow **without Cursor**.

## 1) Start API only (sync mode — fully standalone)

```bash
cd ~/workspace/social-hub
npm run dev:api
```

### Sync API (no Inngest)
```bash
curl -X POST http://127.0.0.1:8787/api/media/save-sync \
  -H 'Content-Type: application/json' \
  -d '{"mediaRecordId":"recXXXXXXXX","force":true}'
```

Returns when R2 upload + Airtable update are done.

### Async API (needs Inngest Dev or Cloud)
```bash
npm run dev:inngest   # second terminal
curl -X POST http://127.0.0.1:8787/api/media/save \
  -H 'Content-Type: application/json' \
  -d '{"mediaRecordId":"recXXXXXXXX"}'
```

## 2) Automation script

```bash
# sync (API only)
npm run save-media:sync -- --id recAII3fGeek7ShHa --force

# async queue
npm run save-media -- --id recAII3fGeek7ShHa
```

Optional flags: `--url`, `--post`, `--key`, `--type`, `--api http://127.0.0.1:8787`

## Body fields

| Field | Required | Meaning |
|-------|----------|---------|
| `mediaRecordId` | yes | Airtable Media row id |
| `fileUrl` | no | Override CDN (else uses File link) |
| `postRecordId` | no | Also mark Post Status = Saved |
| `objectKey` | no | R2 object path |
| `mediaType` | no | image / video / gif |
| `force` | no | Re-upload even if Saved copy exists |
