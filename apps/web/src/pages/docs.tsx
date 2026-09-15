import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function slugify(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[|:/]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function Heading({
  as: Tag,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"h1"> & {
  as: "h1" | "h2" | "h3" | "h4";
}) {
  const text = String(children ?? "");
  const id = props.id || slugify(text);
  return (
    <Tag id={id} className={className} {...props}>
      {children}
    </Tag>
  );
}

export function DocsPage() {
  const [md, setMd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/docs/api.md")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setMd(text);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>API</CardTitle>
          <a
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/docs/api.md"
            target="_blank"
            rel="noreferrer"
          >
            Raw .md
          </a>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : md == null ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <article className="docs-md">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children, ...props }) => (
                    <Heading as="h1" {...props}>
                      {children}
                    </Heading>
                  ),
                  h2: ({ children, ...props }) => (
                    <Heading as="h2" {...props}>
                      {children}
                    </Heading>
                  ),
                  h3: ({ children, ...props }) => (
                    <Heading as="h3" {...props}>
                      {children}
                    </Heading>
                  ),
                  h4: ({ children, ...props }) => (
                    <Heading as="h4" {...props}>
                      {children}
                    </Heading>
                  ),
                  a: ({ className, href, children, ...props }) => (
                    <a
                      href={href}
                      className={cn(
                        "font-medium text-primary underline-offset-3 hover:underline",
                        className,
                      )}
                      {...props}
                    >
                      {children}
                    </a>
                  ),
                  code: ({ className, children, ...props }) => {
                    const isBlock = Boolean(className?.includes("language-"));
                    if (isBlock) {
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code
                        className={cn(
                          "rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]",
                          className,
                        )}
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {md}
              </ReactMarkdown>
            </article>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
