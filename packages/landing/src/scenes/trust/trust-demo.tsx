"use client";

import { cn } from "../../lib/cn";
import { AuditLogDemo } from "../audit-log/audit-log-scene";
import { TrashDemo } from "../trash/trash-scene";

/** The safety pair: the audit log, then trash restore. */
export function TrustDemo({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-10", className)}>
      <AuditLogDemo />
      <TrashDemo />
    </div>
  );
}
