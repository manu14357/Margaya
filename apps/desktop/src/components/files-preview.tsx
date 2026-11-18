import {
  DEFAULT_LABELS,
  FilePreview,
  type FilePreviewLabels,
  type PreviewSource,
} from "@margaya/file-preview";
import "@margaya/file-preview/styles.css";
import { useEffect, useMemo, useState } from "react";
import { type FileEntry, filesApi } from "../lib/files-api";
import { isStreamed } from "../lib/files-model";
import { useT } from "../lib/i18n";

/** Light or dark, following the system as the rest of the window does. */
export function useSystemTheme(): "light" | "dark" {
  const query =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  const [dark, setDark] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [query]);
  return dark ? "dark" : "light";
}

/** The preview's copy in the window's language (`files.viewer.*`). */
export function usePreviewLabels(): Partial<FilePreviewLabels> {
  const t = useT();
  return useMemo(() => {
    const labels: Partial<Record<keyof FilePreviewLabels, string>> = {};
    for (const key of Object.keys(DEFAULT_LABELS) as Array<
      keyof FilePreviewLabels
    >) {
      const path = `files.viewer.${key}`;
      const text = t(path);
      if (text !== path) labels[key] = text;
    }
    // A local file's "Download" is "Save a copy…" (files_save_copy).
    labels.download = t("files.saveCopy");
    return labels;
  }, [t]);
}

/**
 * The source the shared preview reads: the file's bytes through the core
 * (which checks the path again), or for audio and video a streaming
 * address only this window may use. The preview gets bytes or a media
 * address, never the path itself.
 */
export function usePreviewSource(entry: FileEntry): PreviewSource | null {
  const streamed = isStreamed(entry.name);
  const [url, setUrl] = useState<string | null>(null);
  const { path, name, size, modified } = entry;

  useEffect(() => {
    if (!streamed) return;
    let live = true;
    setUrl(null);
    filesApi
      .streamUrl(path)
      .then((address) => {
        if (live) setUrl(address);
      })
      .catch(() => {
        if (live) setUrl("");
      });
    return () => {
      live = false;
    };
  }, [streamed, path]);

  // `modified` is in the deps so a changed file reloads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  return useMemo(() => {
    if (streamed) {
      if (url === null) return null;
      return { name, size: size ?? undefined, url };
    }
    return {
      name,
      size: size ?? undefined,
      load: () => filesApi.read(path),
    };
  }, [streamed, url, name, size, path, modified]);
}

export function FilesPreviewPanel({
  entry,
  expanded,
  onToggleExpand,
  onClose,
  onOpenExternal,
  onSaveCopy,
}: {
  entry: FileEntry;
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  onOpenExternal: () => void;
  onSaveCopy: () => void;
}) {
  const t = useT();
  const theme = useSystemTheme();
  const labels = usePreviewLabels();
  const source = usePreviewSource(entry);

  const tools = (
    <>
      <button
        type="button"
        className="files-icon-button"
        aria-label={
          expanded ? t("files.collapsePreview") : t("files.expandPreview")
        }
        title={expanded ? t("files.collapsePreview") : t("files.expandPreview")}
        aria-pressed={expanded}
        onClick={onToggleExpand}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {expanded ? (
            <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
          ) : (
            <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
          )}
        </svg>
      </button>
      <button
        type="button"
        className="files-icon-button"
        aria-label={t("files.closePreview")}
        title={t("files.closePreview")}
        onClick={onClose}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </>
  );

  return (
    <div className="files-preview-body">
      {source ? (
        <FilePreview
          key={entry.path}
          source={source}
          labels={labels}
          theme={theme}
          onDownload={onSaveCopy}
          onOpenExternal={onOpenExternal}
          toolbarEnd={tools}
          className="files-preview-view"
        />
      ) : (
        <div className="files-preview-loading">
          <div className="files-preview-tools">{tools}</div>
          <p role="status">{t("files.loading")}</p>
        </div>
      )}
    </div>
  );
}
