import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyIcon, EyeIcon, EyeOffIcon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
import { SERVICE_GROUPS, serviceForName, serviceOrder } from "@/features/connections/groups";
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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [project, setProject] = useState("social-hub");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [tokenFilter, setTokenFilter] = useState("all");
  const [historyFilter, setHistoryFilter] = useState("all");
  const [formProject, setFormProject] = useState("social-hub");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("secret");
  const [value, setValue] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [tokenProject, setTokenProject] = useState("global");
  const [tokenLabel, setTokenLabel] = useState("");
  const [health, setHealth] = useState<Record<string, { status: "valid" | "invalid"; detail: string }>>({});
  const [healthBusy, setHealthBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<string[]>([]);
  const [linkPick, setLinkPick] = useState("none");
  const [linksBusy, setLinksBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [currentPreview, setCurrentPreview] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [rotateTarget, setRotateTarget] = useState<TokenRow | null>(null);

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

  useEffect(() => {
    if (!project || project === "global") {
      setLinks([]);
      return;
    }
    let cancelled = false;
    fetchJson<{ sources: string[] }>(`/api/connections/${encodeURIComponent(project)}/links`)
      .then((data) => {
        if (!cancelled) setLinks(data.sources);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

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
  const projectOptions = useMemo(() => {
    const names = new Set([
      ...projects,
      ...tokens.map((row) => row.project),
      ...history.map((row) => row.project),
    ]);
    if (project) names.add(project);
    if (names.size === 0) names.add("social-hub");
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [projects, tokens, history, project]);
  const visibleTokens = useMemo(
    () =>
      tokens.filter((row) => {
        if (row.project !== project) return false;
        if (tokenFilter === "used") return Boolean(row.last_used_at);
        if (tokenFilter === "unused") return !row.last_used_at;
        return true;
      }),
    [tokens, project, tokenFilter],
  );
  const historyGroups = useMemo(() => {
    const order = ["create", "update", "delete", "refresh"] as const;
    const matched = history.filter((row) => {
      if (row.project !== project) return false;
      return historyFilter === "all" || row.action === historyFilter;
    });
    return order
      .map((action) => ({
        action,
        rows: matched.filter((row) => row.action === action),
      }))
      .filter((group) => group.rows.length > 0);
  }, [history, project, historyFilter]);
  const grouped = useMemo(() => {
    const buckets = new Map<string, { project: string; serviceId: string; label: string; rows: ConnectionRow[] }>();
    for (const row of rows) {
      const group = serviceForName(row.name);
      const key = `${row.project}\0${group.id}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.rows.push(row);
      else buckets.set(key, { project: row.project, serviceId: group.id, label: group.label, rows: [row] });
    }
    return [...buckets.values()].sort((a, b) => {
      const byProject = a.project.localeCompare(b.project);
      if (byProject !== 0) return byProject;
      return serviceOrder(a.serviceId) - serviceOrder(b.serviceId);
    });
  }, [rows]);
  const visibleGroups = useMemo(
    () =>
      grouped.filter(
        (group) =>
          group.project === project &&
          (serviceFilter === "all" || group.serviceId === serviceFilter),
      ),
    [grouped, project, serviceFilter],
  );

  function resetForm() {
    setEditing(null);
    setFormProject(project);
    setName("");
    setKind("secret");
    setValue("");
    setCurrentPreview("");
    setFormError("");
  }

  async function saveSingle(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      await fetchJson(`/api/connections/${encodeURIComponent(formProject)}/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, value }),
      });
      setRevealed((current) => {
        const next = { ...current };
        delete next[rowKey(formProject, name)];
        return next;
      });
      setAddOpen(false);
      resetForm();
      await load();
      toast.success("Secret saved");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
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
    setFormError("");
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
      if (valid.length) {
        toast.success(`Saved ${valid.length} secret${valid.length === 1 ? "" : "s"}`);
        setPaste("");
        setBulkOpen(false);
      }
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveLinks(next: string[]) {
    setLinksBusy(true);
    setError("");
    try {
      const saved = await fetchJson<{ sources: string[] }>(
        `/api/connections/${encodeURIComponent(project)}/links`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sources: next }),
        },
      );
      setLinks(saved.sources);
      toast.success(saved.sources.length ? "Inheritance updated" : "Inheritance cleared");
    } finally {
      setLinksBusy(false);
    }
  }

  async function testService(projectName: string, serviceId: string) {
    const key = `${projectName}/${serviceId}`;
    setHealthBusy(key);
    try {
      const res = await fetch(
        `/api/connections/${encodeURIComponent(projectName)}/health/${encodeURIComponent(serviceId)}`,
        { method: "POST" },
      );
      const data = (await res.json()) as {
        status?: "valid" | "invalid";
        detail?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setHealth((current) => ({
        ...current,
        [key]: {
          status: data.status === "valid" ? "valid" : "invalid",
          detail: data.detail || "Invalid",
        },
      }));
    } catch (err) {
      setHealth((current) => ({
        ...current,
        [key]: { status: "invalid", detail: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setHealthBusy(null);
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
    toast.success("Secret deleted");
  }

  async function createToken(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const data = await fetchJson<{ token: TokenRow & { token: string } }>("/api/vault/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: tokenProject, label: tokenLabel }),
      });
      setTokenRevealed((current) => ({ ...current, [data.token.id]: data.token.token }));
      setIssuedToken(data.token.token);
      setTokenLabel("");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
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

  async function confirmRotate() {
    if (!rotateTarget) return;
    setBusy(true);
    setFormError("");
    try {
      const data = await fetchJson<{ token: TokenRow & { token: string } }>(
        `/api/vault/tokens/${rotateTarget.id}/refresh`,
        { method: "POST" },
      );
      setTokenRevealed((current) => ({ ...current, [data.token.id]: data.token.token }));
      setIssuedToken(data.token.token);
      setRotateTarget(null);
      setTokenOpen(true);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyIssuedToken() {
    if (!issuedToken) return;
    await navigator.clipboard.writeText(issuedToken);
    toast.success("Access token copied");
  }

  async function removeToken(row: TokenRow) {
    if (!window.confirm(`Delete access token ${row.label || row.preview}?`)) return;
    await fetchJson(`/api/vault/tokens/${row.id}`, { method: "DELETE" });
    setTokenRevealed((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    await load();
    toast.success("Access token deleted");
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="max-w-md">
        <ProjectField id="vault-project" value={project} options={projectOptions} onChange={setProject} />
      </div>
      <Tabs defaultValue="connections">
        <TabsList className="grid w-full grid-cols-3 md:inline-flex md:w-fit">
          <TabsTrigger value="connections">Secrets</TabsTrigger>
          <TabsTrigger value="tokens">Access Tokens</TabsTrigger>
          <TabsTrigger value="history">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="flex flex-col gap-3 pt-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                setFormError("");
                setBulkOpen(true);
              }}
            >
              Import .env
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => {
                resetForm();
                setAddOpen(true);
              }}
            >
              <PlusIcon />
              Add secret
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vault-service">Service</Label>
              <Select value={serviceFilter} onValueChange={setServiceFilter}>
                <SelectTrigger id="vault-service" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {SERVICE_GROUPS.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {project !== "global" ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="vault-inherit">Inherit secrets from</Label>
                {links.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {links.map((source, index) => (
                      <div key={source} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
                        <span className="min-w-0 truncate text-sm">
                          {index + 1}. {source}
                        </span>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="outline"
                          aria-label={`Stop inheriting from ${source}`}
                          disabled={linksBusy}
                          onClick={() => {
                            saveLinks(links.filter((item) => item !== source)).catch((err: unknown) =>
                              setError(err instanceof Error ? err.message : String(err)),
                            );
                          }}
                        >
                          <XIcon />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <Select
                  value={linkPick}
                  disabled={linksBusy}
                  onValueChange={(next) => {
                    setLinkPick("none");
                    if (next === "none" || links.includes(next)) return;
                    saveLinks([...links, next]).catch((err: unknown) =>
                      setError(err instanceof Error ? err.message : String(err)),
                    );
                  }}
                >
                  <SelectTrigger id="vault-inherit" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{links.length ? "Add a project" : "None"}</SelectItem>
                    {projectOptions
                      .filter((name) => name !== project && name !== "global" && !links.includes(name))
                      .map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  This project’s access token receives its own keys first, then these projects in order, then global. Linked keys stay read-only.
                </p>
              </div>
            ) : null}
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => exportProject(project).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}
            >
              Export .env
            </Button>
          </div>
          {loading ? (
            <EmptyNote>Loading…</EmptyNote>
          ) : visibleGroups.length === 0 ? (
            <EmptyNote>No secrets for this project and service.</EmptyNote>
          ) : (
            visibleGroups.map((group) => {
              const healthKey = `${group.project}/${group.serviceId}`;
              const signal = health[healthKey];
              return (
                <Card key={healthKey}>
                  <CardHeader>
                    <CardTitle>{group.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {group.rows.map((row) => {
                      const key = rowKey(row.project, row.name);
                      const shown = revealed[key];
                      return (
                        <div key={key} className="flex min-w-0 flex-col gap-2 border-t border-foreground/10 pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="break-all font-medium">{row.name}</p>
                            <p className="break-all font-mono text-xs text-muted-foreground">
                              {shown ?? row.preview}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Button type="button" size="sm" variant="outline" onClick={() => reveal(row).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                              {shown ? <EyeOffIcon /> : <EyeIcon />}
                              {shown ? "Hide" : "Reveal"}
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => copyValue(row).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                              <CopyIcon />
                              Copy
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setFormError("");
                                setEditing(key);
                                setFormProject(row.project);
                                setName(row.name);
                                setKind(row.kind);
                                setValue("");
                                setCurrentPreview(row.preview);
                                setAddOpen(true);
                              }}
                            >
                              <PencilIcon />
                              Edit
                            </Button>
                            <Button type="button" size="sm" variant="destructive" onClick={() => remove(row).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                              <Trash2Icon />
                              Delete
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                  <CardFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <Badge
                        variant={signal?.status === "invalid" ? "destructive" : "outline"}
                        className={signal?.status === "valid" ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400" : undefined}
                      >
                        {signal?.status === "valid"
                          ? "Valid"
                          : signal?.status === "invalid"
                            ? signal.detail && signal.detail !== "Valid"
                              ? `Invalid / ${signal.detail}`
                              : "Invalid"
                            : "Not tested"}
                      </Badge>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full sm:w-auto"
                      disabled={healthBusy === healthKey}
                      onClick={() => testService(group.project, group.serviceId)}
                    >
                      {healthBusy === healthKey ? "Testing…" : "Test Connection"}
                    </Button>
                  </CardFooter>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="tokens" className="flex flex-col gap-3 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="token-usage">Usage</Label>
              <Select value={tokenFilter} onValueChange={setTokenFilter}>
                <SelectTrigger id="token-usage" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All access tokens</SelectItem>
                  <SelectItem value="used">Used</SelectItem>
                  <SelectItem value="unused">Never used</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => {
                setFormError("");
                setIssuedToken(null);
                setTokenProject(project);
                setTokenOpen(true);
              }}
            >
              <PlusIcon />
              New access token
            </Button>
          </div>
          {loading ? (
            <EmptyNote>Loading…</EmptyNote>
          ) : visibleTokens.length === 0 ? (
            <EmptyNote>No access tokens for this project.</EmptyNote>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Access tokens</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {visibleTokens.map((row) => {
                  const shown = tokenRevealed[row.id];
                  return (
                    <div key={row.id} className="flex min-w-0 flex-col gap-2 border-t border-foreground/10 pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="break-all font-medium">{row.label || "Untitled access token"}</p>
                        <p className="break-all font-mono text-xs text-muted-foreground">
                          {shown ?? row.preview}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Created {fmtWhen(row.created_at)} · Last used {fmtWhen(row.last_used_at ?? undefined)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" size="sm" variant="outline" onClick={() => revealToken(row).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                          {shown ? <EyeOffIcon /> : <EyeIcon />}
                          {shown ? "Hide" : "Reveal"}
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => copyToken(row).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                          <CopyIcon />
                          Copy
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => { setFormError(""); setRotateTarget(row); }}>
                          <RefreshCwIcon />
                          Replace
                        </Button>
                        <Button type="button" size="sm" variant="destructive" onClick={() => removeToken(row).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
                          <Trash2Icon />
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="flex flex-col gap-3 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="history-action">Action</Label>
              <Select value={historyFilter} onValueChange={setHistoryFilter}>
                <SelectTrigger id="history-action" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  <SelectItem value="create">Create</SelectItem>
                  <SelectItem value="update">Update</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="refresh">Replace</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {historyGroups.length === 0 ? (
            <EmptyNote>No changes for this project.</EmptyNote>
          ) : (
            historyGroups.map((group) => (
              <Card key={group.action}>
                <CardHeader>
                  <CardTitle>{actionLabel(group.action)}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {group.rows.map((row, index) => (
                    <div key={`${row.at}-${row.name}-${row.action}-${index}`} className="flex min-w-0 flex-col gap-1 border-t border-foreground/10 pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="break-all font-medium">{row.name}</p>
                        <p className="text-xs text-muted-foreground">{row.project}</p>
                      </div>
                      <Badge variant="outline">{fmtWhen(row.at)}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit secret" : "Add secret"}</DialogTitle>
            <DialogDescription>
              Values are encrypted before they are stored.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={saveSingle}>
            <div className="space-y-1.5">
              <Label htmlFor="connection-project">Project</Label>
              <Input id="connection-project" value={formProject} onChange={(event) => setFormProject(event.target.value)} disabled={Boolean(editing)} required />
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
              <Label htmlFor="connection-value">{editing ? "New value" : "Value"}</Label>
              {editing ? (
                <p className="text-xs text-muted-foreground">
                  Stored value: <span className="font-mono">{currentPreview || "hidden"}</span>. Enter a new value to replace it.
                </p>
              ) : null}
              <Input
                id="connection-value"
                type="password"
                value={value}
                placeholder={editing ? currentPreview || "A value is already stored" : ""}
                onChange={(event) => setValue(event.target.value)}
                autoComplete="off"
                required
              />
            </div>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
            <DialogFooter>
              <Button type="submit" disabled={busy}>{editing ? "Save changes" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkOpen}
        onOpenChange={(open) => {
          setBulkOpen(open);
          if (!open) {
            setPaste("");
            setFormError("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import .env</DialogTitle>
            <DialogDescription>
              Comments starting with # are skipped. MASTER_KEY is not saved.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Textarea
              id="page-bulk-paste"
              className="min-h-40 font-mono"
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
              placeholder={"SUPABASE_URL=https://xyz.supabase.co\nSUPABASE_SECRET_KEY=...\n# MASTER_KEY is skipped"}
              aria-label="Environment text"
            />
            {"error" in parsed && paste.trim() ? (
              <p className="text-sm text-destructive">{parsed.error}</p>
            ) : null}
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
            {preview.length ? (
              <>
                <div className="flex max-h-48 flex-col gap-2 overflow-auto md:hidden">
                  {preview.map((row, index) => (
                    <PreviewCard key={`${row.name}-${index}`} row={row} />
                  ))}
                </div>
                <div className="hidden max-h-48 overflow-auto md:block">
                  <PreviewTable preview={preview} />
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setPaste("")}>
              Clear
            </Button>
            <Button
              type="button"
              disabled={busy || "error" in parsed || !preview.some((row) => row.status !== "Invalid")}
              onClick={() => saveBulk()}
            >
              Save secrets
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={tokenOpen}
        onOpenChange={(open) => {
          setTokenOpen(open);
          if (!open) {
            setIssuedToken(null);
            setFormError("");
          }
        }}
      >
        <DialogContent>
          {issuedToken ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy your access token</DialogTitle>
                <DialogDescription>
                  Put this access token in the other app. You can reveal it again from this page.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <Input readOnly value={issuedToken} aria-label="Access token" className="font-mono" />
                <pre className="overflow-auto rounded-lg bg-muted/40 p-3 text-xs break-all whitespace-pre-wrap">
                  Authorization: Bearer {issuedToken}
                </pre>
                <DialogFooter>
                  <Button type="button" onClick={() => copyIssuedToken().catch((err: unknown) => setFormError(err instanceof Error ? err.message : String(err)))}>
                    <CopyIcon />
                    Copy
                  </Button>
                </DialogFooter>
                {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>New access token</DialogTitle>
                <DialogDescription>
                  This access token can read every secret in the project, including secrets inherited from linked projects.
                </DialogDescription>
              </DialogHeader>
              <form className="grid gap-3" onSubmit={createToken}>
                <div className="space-y-1.5">
                  <Label htmlFor="token-project">Project</Label>
                  <Input id="token-project" value={tokenProject} onChange={(event) => setTokenProject(event.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="token-label">Label</Label>
                  <Input id="token-label" value={tokenLabel} onChange={(event) => setTokenLabel(event.target.value)} placeholder="Production app" />
                </div>
                {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
                <DialogFooter>
                  <Button type="submit" disabled={busy}>Create access token</Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={rotateTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setRotateTarget(null);
            setFormError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace this access token?</DialogTitle>
            <DialogDescription>
              {rotateTarget?.label || rotateTarget?.preview || "This access token"} will stop working immediately. Apps using the old access token will get Unauthorized.
            </DialogDescription>
          </DialogHeader>
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setRotateTarget(null); setFormError(""); }}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => confirmRotate()}>
              Replace access token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PreviewCard({ row }: { row: PreviewRow }) {
  return (
    <article className="flex min-w-0 flex-col gap-1 rounded-lg bg-muted/40 p-2">
      <p className="break-all font-mono text-xs">{row.name || "—"}</p>
      <p className="break-all font-mono text-xs text-muted-foreground">{maskValue(row.value)}</p>
      <div>
        <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
        {row.reason ? <span className="ml-2 text-xs text-muted-foreground">{row.reason}</span> : null}
      </div>
    </article>
  );
}

function PreviewTable({ preview }: { preview: PreviewRow[] }) {
  return (
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
  );
}

function actionLabel(action: HistoryRow["action"]): string {
  if (action === "create") return "Create";
  if (action === "update") return "Update";
  if (action === "delete") return "Delete";
  return "Replace";
}

function ProjectField({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Project</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((projectName) => (
            <SelectItem key={projectName} value={projectName}>
              {projectName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-card px-3 py-6 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
      {children}
    </p>
  );
}
