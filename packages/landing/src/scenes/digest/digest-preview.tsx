"use client";

import { useLandingCopy } from "../../copy";
import { cn } from "../../lib/cn";
import { LandingLogo } from "../../lib/logo";

/**
 * A still preview of the notification digest email, after the template in
 * packages/email: the workspace box with due and overdue tasks, new
 * mentions and the unread count, then the inbox button and the footer.
 */
export function DigestPreview({ className }: { className?: string }) {
  const copy = useLandingCopy();
  const { digest, shell } = copy.demo;
  const tasks = [
    { ...digest.tasks.redirect, overdue: true },
    { ...digest.tasks.webhooks, overdue: false },
    { ...digest.tasks.release, overdue: false },
  ];
  return (
    <figure className={cn("m-0 w-full", className)}>
      <p className="sr-only">{copy.scenes.digest.description}</p>
      <div
        aria-hidden
        className="overflow-hidden rounded-xl border border-border bg-background font-sans text-foreground text-sm shadow-xs"
      >
        <div className="flex items-center gap-2 border-border border-b bg-muted/50 px-4 py-2.5 text-xs">
          <span className="font-medium">{digest.from}</span>
          <span className="text-muted-foreground">·</span>
          <span className="min-w-0 truncate text-muted-foreground">
            {digest.subject}
          </span>
        </div>
        <div className="space-y-3 p-5">
          <LandingLogo />
          <div className="space-y-1">
            <p className="font-semibold text-lg leading-snug">{digest.title}</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {digest.subtitle}
            </p>
          </div>
          <div className="rounded-[10px] border border-border px-3.5 py-3">
            <p className="font-semibold text-base">{shell.workspace}</p>
            <p className="mt-2.5 font-semibold text-sm">{digest.dueHeading}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {tasks.map((task) => (
                <li key={task.title} className="leading-snug">
                  {"• "}
                  <span className="underline decoration-border underline-offset-2">
                    {task.title}
                  </span>
                  <span
                    className={
                      task.overdue
                        ? "text-destructive-foreground"
                        : "text-muted-foreground"
                    }
                  >
                    {` · ${task.overdue ? digest.overdue : digest.due} ${task.due} · ${task.project}`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 font-semibold text-sm">
              {digest.mentionsHeading}
            </p>
            <ul className="mt-1 space-y-1 text-sm">
              {Object.values(digest.mentions).map((mention) => (
                <li key={mention}>
                  {"• "}
                  {mention}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-muted-foreground text-sm">
              {digest.unread}
            </p>
            <span className="mt-3 inline-flex h-8 items-center rounded-lg bg-primary px-3 font-medium text-primary-foreground text-xs">
              {digest.openInbox}
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            <span className="underline underline-offset-2">
              {digest.manage}
            </span>
            {" · "}
            {digest.footer}
          </p>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-muted-foreground text-sm">
        {copy.scenes.digest.caption}
      </figcaption>
    </figure>
  );
}
