import { useState } from "react";
import { cn } from "@/lib/utils";

type ExpandableTextProps = {
  text: string;
  /** Max visible lines when collapsed (default 4). */
  lines?: number;
  /** Also collapse when char count exceeds this (default 220). */
  maxChars?: number;
  className?: string;
  empty?: string;
};

export function ExpandableText({
  text,
  lines = 4,
  maxChars = 220,
  className,
  empty,
}: ExpandableTextProps) {
  const [open, setOpen] = useState(false);
  const value = text.trim();

  if (!value) {
    return empty ? (
      <p className={cn("text-muted-foreground", className)}>{empty}</p>
    ) : null;
  }

  const needsToggle =
    value.length > maxChars || value.split(/\n/).length > lines;

  return (
    <div className="min-w-0">
      <p
        className={cn(
          "whitespace-pre-wrap text-[15px] leading-relaxed break-words",
          !open && needsToggle && "overflow-hidden",
          className,
        )}
        style={
          !open && needsToggle
            ? {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: lines,
              }
            : undefined
        }
      >
        {value}
      </p>
      {needsToggle ? (
        <button
          type="button"
          className="mt-1 text-sm font-medium text-primary hover:underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "See less" : "See more"}
        </button>
      ) : null}
    </div>
  );
}
