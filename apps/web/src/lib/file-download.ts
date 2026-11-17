// Downloads a file straight from its link, without opening the preview.

import { externalHref } from "@/lib/desktop";
import { fileDownloadUrl } from "@/lib/file-preview";

export type FileDownloadLinkProps = {
  href: string;
  download: string;
  target?: "_blank";
  rel?: string;
};

/**
 * The attributes of an `<a>` that downloads `url` as `name`, the same way
 * the preview's Download does. This server's assets take `download=1` and
 * answer with an attachment, so the page stays put (the desktop app saves
 * it as its own download); a file elsewhere may refuse a download, so it
 * opens beside the page instead.
 */
export function fileDownloadLinkProps(
  url: string,
  name: string,
  win: Window = window,
): FileDownloadLinkProps {
  const href = fileDownloadUrl(url);
  return externalHref(href, win)
    ? { href, download: name, target: "_blank", rel: "noopener noreferrer" }
    : { href, download: name };
}
