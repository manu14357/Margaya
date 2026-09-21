import { copyToClipboard } from "./copy-to-clipboard";
import { toast } from "./toast";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The branch pattern when no Git integration sets one. */
export const DEFAULT_BRANCH_PATTERN = "{slug}-{number}";

function slugify(text: string | undefined): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/**
 * A task's branch name from an integration's pattern (`{slug}`, `{number}`,
 * `{title}`), or null while the project slug or task number is unknown.
 */
export function taskBranchName(
  pattern: string,
  projectSlug: string | undefined,
  taskNumber: number | null | undefined,
  taskTitle: string | undefined,
): string | null {
  if (!projectSlug || !taskNumber) return null;
  return pattern
    .replace("{slug}", projectSlug.toLowerCase())
    .replace("{number}", taskNumber.toString())
    .replace("{title}", slugify(taskTitle));
}

/** Copies a task's branch name and says whether it worked. */
export async function copyTaskBranch(branchName: string, t: Translate) {
  if (await copyToClipboard(branchName)) {
    toast.success(t("tasks:properties.branchCopied", { branch: branchName }));
  } else {
    toast.error(t("tasks:taskKey.clipboardError"));
  }
}
