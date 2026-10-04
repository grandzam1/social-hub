import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, fmtWhen } from "@/lib/api";
import {
  formatEnv,
  maskValue,
  parseBulk,
  previewRows,
  type PreviewRow,
} from "@/features/connections/parse-env";

type Kind = "secret" | "setting";

type ConnectionRow = {
  project: string;
  name: string;
  kind: Kind;
  updated_at: string;
  preview: string;
};

type HistoryRow = {
  project: string;
  name: string;
  action: "create" | "update" | "delete" | "refresh";
  at: string;
};

type TokenRow = {
  id: string;
  project: string;
  label: string;
  preview: string;
  created_at: string;
  last_used_at: string | null;
};

function rowKey(project: string, name: string) {
  return `${project}/${name}`;
}

function statusVariant(status: PreviewRow["status"]) {
  if (status === "Invalid") return "destructive" as const;
  if (status === "Will overwrite") return "secondary" as const;
  return "default" as const;
}

export function ConnectionsPage() {
  const [rows, setRows] = useState<ConnectionRow[]>([]);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [tokenRevealed, setTokenRevealed] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [project, setProject] = useState("global");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("secret");
  const [value, setValue] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [tokenProject, setTokenProject] = useState("global");
  const [tokenLabel, setTokenLabel] = useState("");

  const load = useCallback(async () => {
    setError("");
    const [list, tokenList, past] = await Promise.all([
      fetchJson<{ connections: ConnectionRow[] }>("/api/connections"),
      fetchJson<{ tokens: TokenRow[] }>("/api/vault/tokens"),
      fetchJson<{ history: HistoryRow[] }>("/api/connections/history"),
    ]);
    setRows(list.connections);
    setTokens(tokenList.tokens);
    setHistory(past.history);
  }, []);

  useEffect(() => {
    load()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [load]);

  const parsed = useMemo(() => parseBulk(paste), [paste]);
  const existingNames = useMemo(
    () => new Set(rows.filter((row) => row.project === project).map((row) => row.name)),
    [rows, project],
  );
  const preview = useMemo(
    () => ("pairs" in parsed ? previewRows(parsed.pairs, existingNames) : []),
    [parsed, existingNames],
  );
  const projects = useMemo(
    () => [...new Set(rows.map((row) => row.project))],
    [rows],
  );

  function resetAdd() {
    setEditing(null);
    setProject("global");
    setName("");
    setKind("secret");
    setValue("");
    setPaste("");
  }

  async function saveSingle(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await fetchJson(`/api/connections/${encodeURIComponent(project)}/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, value }),
      });
      setRevealed((current) => {
        const next = { ...current };
        delete next[rowKey(project, name)];
        return next;
      });
      setAddOpen(false);
      resetAdd();
      await load();
      toast.success("Connection saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveBulk() {
    if ("error" in parsed) {
      toast.error(parsed.error);
      return;
    }
    const valid = preview.filter((row) => row.status !== "Invalid");
    const invalid = preview.filter((row) => row.status === "Invalid");
    setBusy(true);
    setError("");
    try {
      if (valid.length) {
        await fetchJson(`/api/connections/${encodeURIComponent(project)}/bulk`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: valid.map((row) => ({ name: row.name, value: row.value, kind: "secret" as const })),
          }),
        });
      }
      if (invalid.length) {
        const reasons = [...new Set(invalid.map((row) => row.reason))].join(", ");
        toast.error(`Skipped ${invalid.length} invalid row${invalid.length === 1 ? "" : "s"}: ${reasons}`);
      }
      if (valid.length) toast.success(`Saved ${valid.length}`);
      setAddOpen(false);
      resetAdd();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function reveal(row: ConnectionRow) {
    const key = rowKey(row.project, row.name);
    if (revealed[key]) {
      setRevealed((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    const data = await fetchJson<{ value: string }>(
      `/api/connections/${encodeURIComponent(row.project)}/${encodeURIComponent(row.name)}/reveal`,
    );
    setRevealed((current) => ({ ...current, [key]: data.value }));
  }

  async function copyValue(row: ConnectionRow) {
    const key = rowKey(row.project, row.name);
    const text = revealed[key] ?? (await fetchJson<{ value: string }>(
      `/api/connections/${encodeURIComponent(row.project)}/${encodeURIComponent(row.name)}/reveal`,
    )).value;
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  }

  async function exportProject(projectName: string) {
    const data = await fetchJson<{ values: Array<{ name: string; value: string }> }>(
      `/api/connections/${encodeURIComponent(projectName)}/export`,
    );
    await navigator.clipboard.writeText(formatEnv(data.values));
    toast.success("Copied");
  }

  async function remove(row: ConnectionRow) {
    if (!window.confirm(`Delete ${row.project}/${row.name}?`)) return;
    await fetchJson(
      `/api/connections/${encodeURIComponent(row.project)}/${encodeURIComponent(row.name)}`,
      { method: "DELETE" },
    );
    await load();
    toast.success("Connection deleted");
  }

  async function createToken(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await fetchJson<{ token: TokenRow & { token: string } }>("/api/vault/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: tokenProject, label: tokenLabel }),
      });
      setTokenRevealed((current) => ({ ...current, [data.token.id]: data.token.token }));
      setTokenOpen(false);
      setTokenLabel("");
      await load();
      toast.success("Token created");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revealToken(row: TokenRow) {
    if (tokenRevealed[row.id]) {
      setTokenRevealed((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      return;
    }
    const data = await fetchJson<{ value: string }>(`/api/vault/tokens/${row.id}/reveal`);
    setTokenRevealed((current) => ({ ...current, [row.id]: data.value }));
  }

  async function copyToken(row: TokenRow) {
    const data = await fetchJson<{ value: string }>(`/api/vault/tokens/${row.id}/reveal`);
    await navigator.clipboard.writeText(data.value);
    toast.success("Copied");
  }

  async function refreshToken(row: TokenRow) {
    const data = await fetchJson<{ token: TokenRow & { token: string } }>(
      `/api/vault/tokens/${row.id}/refresh`,
      { method: "POST" },
    );
    setTokenRevealed((current) => ({ ...current, [row.id]: data.token.token }));
    await load();
    toast.success("Token refreshed");
  }

  async function removeToken(row: TokenRow) {
    if (!window.confirm(`Delete token ${row.label || row.preview}?`)) return;
    await fetchJson(`/api/vault/tokens/${row.id}`, { method: "DELETE" });
    setTokenRevealed((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    await load();
    toast.success("Token deleted");
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Tabs defaultValue="connections">
        <TabsList>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="tokens">Tokens</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="flex flex-col gap-3 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => {
                resetAdd();
                setAddOpen(true);
              }}
            >
              Add connection
            </Button>
            {projects.map((projectName) => (
              <Button
                key={projectName}
                type="button"
                variant="outline"
                onClick={() => exportProject(projectName).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}
              >
                Export .env · {projectName}
              </Button>
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6}>Loading…</TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>No connections yet.</TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const key = rowKey(row.project, row.name);
                  return (
                    <TableRow key={key}>
                      <TableCell>{row.project}</TableCell>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.kind}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{revealed[key] ?? row.preview}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtWhen(row.updated_at)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button type="button" size="xs" variant="outline" onClick={() => reveal(row).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                            {revealed[key] ? "Hide" : "Reveal"}
                          </Button>
                          <Button type="button" size="xs" variant="outline" onClick={() => copyValue(row).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                            Copy
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => {
                              setEditing(key);
                              setProject(row.project);
                              setName(row.name);
                              setKind(row.kind);
                              setValue("");
                              setPaste("");
                              setAddOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button type="button" size="xs" variant="destructive" onClick={() => remove(row).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="tokens" className="flex flex-col gap-3 pt-3">
          <div>
            <Button type="button" onClick={() => setTokenOpen(true)}>
              Create token
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6}>Loading…</TableCell>
                </TableRow>
              ) : tokens.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>No tokens yet.</TableCell>
                </TableRow>
              ) : (
                tokens.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.project}</TableCell>
                    <TableCell>{row.label || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{tokenRevealed[row.id] ?? row.preview}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtWhen(row.created_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtWhen(row.last_used_at ?? undefined)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" size="xs" variant="outline" onClick={() => revealToken(row).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                          {tokenRevealed[row.id] ? "Hide" : "Reveal"}
                        </Button>
                        <Button type="button" size="xs" variant="outline" onClick={() => copyToken(row).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                          Copy
                        </Button>
                        <Button type="button" size="xs" variant="outline" onClick={() => refreshToken(row).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                          Refresh
                        </Button>
                        <Button type="button" size="xs" variant="destructive" onClick={() => removeToken(row).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="history" className="pt-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>No changes yet.</TableCell>
                </TableRow>
              ) : (
                history.map((row, index) => (
                  <TableRow key={`${row.at}-${row.project}-${row.name}-${row.action}-${index}`}>
                    <TableCell className="whitespace-nowrap">{fmtWhen(row.at)}</TableCell>
                    <TableCell>{row.project}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.action}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetAdd();
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit connection" : "Add connection"}</DialogTitle>
            <DialogDescription>
              Values are encrypted before they are stored.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="single">
            <TabsList>
              <TabsTrigger value="single">Single</TabsTrigger>
              <TabsTrigger value="bulk">Bulk paste</TabsTrigger>
            </TabsList>
            <TabsContent value="single" className="pt-3">
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={saveSingle}>
                <div className="space-y-1.5">
                  <Label htmlFor="connection-project">Project</Label>
                  <Input id="connection-project" value={project} onChange={(event) => setProject(event.target.value)} disabled={Boolean(editing)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="connection-name">Name</Label>
                  <Input id="connection-name" value={name} onChange={(event) => setName(event.target.value)} disabled={Boolean(editing)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="connection-kind">Kind</Label>
                  <Select value={kind} onValueChange={(next) => setKind(next as Kind)}>
                    <SelectTrigger id="connection-kind" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="secret">secret</SelectItem>
                      <SelectItem value="setting">setting</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="connection-value">Value</Label>
                  <Input id="connection-value" type="password" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" required />
                </div>
                <DialogFooter className="sm:col-span-2">
                  <Button type="submit" disabled={busy}>{editing ? "Save changes" : "Save"}</Button>
                </DialogFooter>
              </form>
            </TabsContent>
            <TabsContent value="bulk" className="flex flex-col gap-3 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="bulk-project">Project</Label>
                <Input id="bulk-project" value={project} onChange={(event) => setProject(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bulk-paste">Bulk paste</Label>
                <Textarea
                  id="bulk-paste"
                  className="min-h-40 font-mono"
                  value={paste}
                  onChange={(event) => setPaste(event.target.value)}
                  placeholder={'KEY=value\nexport OTHER="quoted"'}
                />
              </div>
              {"error" in parsed && paste.trim() ? (
                <p className="text-sm text-destructive">{parsed.error}</p>
              ) : null}
              {preview.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((row, index) => (
                      <TableRow key={`${row.name}-${index}`}>
                        <TableCell className="font-mono text-xs">{row.name || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{maskValue(row.value)}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                          {row.reason ? <span className="ml-2 text-xs text-muted-foreground">{row.reason}</span> : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if ("pairs" in parsed) setPaste(formatEnv(parsed.pairs));
                  }}
                >
                  Format
                </Button>
                <Button type="button" disabled={busy || "error" in parsed || !preview.some((row) => row.status !== "Invalid")} onClick={() => saveBulk()}>
                  Save
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={tokenOpen} onOpenChange={setTokenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create token</DialogTitle>
            <DialogDescription>The token stays available to reveal and copy.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={createToken}>
            <div className="space-y-1.5">
              <Label htmlFor="token-project">Project</Label>
              <Input id="token-project" value={tokenProject} onChange={(event) => setTokenProject(event.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="token-label">Label</Label>
              <Input id="token-label" value={tokenLabel} onChange={(event) => setTokenLabel(event.target.value)} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>Create token</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
