import type { IntakeItem } from "@/types/intake";

/**
 * Who sent a request: the member, else the email or form sender's name or
 * address (#8), else the fallback ("Someone").
 */
export function intakeSubmitterName(
  item: Pick<IntakeItem, "submittedBy" | "externalSubmitter">,
  fallback: string,
): string {
  return (
    item.submittedBy?.name ||
    item.externalSubmitter?.name ||
    item.externalSubmitter?.email ||
    fallback
  );
}
