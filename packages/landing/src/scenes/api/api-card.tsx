"use client";

import { ArrowUpRight, Check, Copy } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type LandingCopy, useLandingCopy } from "../../copy";
import { cn } from "../../lib/cn";
import { LandingLink, useLandingLinks } from "../../links";

type ApiCopy = LandingCopy["demo"]["api"];

/** Quotes text for a single-quoted shell string. */
function shellSafe(text: string) {
  return text.replaceAll("'", "'\\''");
}

/**
 * The request, as in the API reference: `POST /api/task/{projectId}` with
 * an API key as a Bearer token. The body is the create-task schema's
 * required fields (title, description, priority, status).
 */
export function createTaskCurl(copy: ApiCopy) {
  const body = JSON.stringify(
    {
      title: copy.taskTitle,
      description: "",
      priority: "high",
      status: "to-do",
    },
    null,
    2,
  );
  return [
    `curl -X POST ${copy.host}/api/task/$PROJECT_ID \\`,
    `  -H "Authorization: Bearer $MARGAYA_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${shellSafe(body.replaceAll("\n", "\n  "))}'`,
  ].join("\n");
}

/** Light syntax tones for the snippet: flags, strings and variables. */
function highlight(code: string): ReactNode[] {
  const pattern = /("[^"\n]*"|\$[A-Z_]+|(?<=\s)-[A-Za-z]\b|\bcurl\b)/g;
  const parts = code.split(pattern);
  return parts.map((part, index) => {
    const key = `${index}-${part.length}`;
    if (part === "curl") {
      return (
        <span key={key} className="font-semibold text-foreground">
          {part}
        </span>
      );
    }
    if (part.startsWith('"')) {
      return (
        <span key={key} className="text-success-foreground">
          {part}
        </span>
      );
    }
    if (part.startsWith("$")) {
      return (
        <span key={key} className="text-info-foreground">
          {part}
        </span>
      );
    }
    if (/^-[A-Za-z]$/.test(part)) {
      return (
        <span key={key} className="text-warning-foreground">
          {part}
        </span>
      );
    }
    return part;
  });
}

/** A copyable curl snippet that creates a task through the REST API. */
export function ApiDemo({ className }: { className?: string }) {
  const landing = useLandingCopy();
  const links = useLandingLinks();
  const copy = landing.demo.api;
  const code = createTaskCurl(copy);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be denied; the snippet stays selectable.
    }
  };

  return (
    <figure className={cn("m-0 flex w-full flex-col", className)}>
      <p className="sr-only">{landing.scenes.api.description}</p>
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-black/5 shadow-xl dark:shadow-black/30">
        <div className="flex h-11 items-center gap-2 border-border border-b px-4">
          <span className="rounded-md bg-success/10 px-1.5 py-0.5 font-mono font-semibold text-[11px] text-success-foreground">
            POST
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">
            /api/task/{"{projectId}"}
          </span>
          <button
            type="button"
            onClick={copyCode}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 font-medium text-muted-foreground text-xs outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copied ? (
              <Check aria-hidden className="size-3.5" />
            ) : (
              <Copy aria-hidden className="size-3.5" />
            )}
            <span aria-live="polite">{copied ? copy.copied : copy.copy}</span>
          </button>
        </div>
        <p className="px-4 pt-3 font-medium text-foreground text-sm">
          {copy.title}
        </p>
        <pre className="m-0 flex-1 overflow-x-auto px-4 pt-2 pb-4 font-mono text-[12.5px] text-muted-foreground leading-relaxed">
          <code>{highlight(code)}</code>
        </pre>
        <div className="flex flex-wrap items-center justify-between gap-2 border-border border-t px-4 py-2.5 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            {copy.response}
          </span>
          <LandingLink
            href={links.apiReference}
            className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
          >
            {copy.reference}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </LandingLink>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-muted-foreground text-sm">
        {landing.scenes.api.caption}
      </figcaption>
    </figure>
  );
}
