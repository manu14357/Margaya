import { copyToClipboard } from "./copy-to-clipboard";
import { toast } from "./toast";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Copies a task key (WEB-12) and says whether it worked. */
export async function copyTaskKey(key: string, t: Translate) {
  if (await copyToClipboard(key)) {
    toast.success(t("tasks:taskKey.copied", { key }));
  } else {
    toast.error(t("tasks:taskKey.clipboardError"));
  }
}

/** Copies a task link (see taskUrl) and says whether it worked. */
export async function copyTaskLink(url: string, t: Translate) {
  if (await copyToClipboard(url)) {
    toast.success(t("tasks:contextMenu.copyLinkSuccess"));
  } else {
    toast.error(t("tasks:taskKey.clipboardError"));
  }
}
