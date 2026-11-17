import {
  Component,
  type ReactNode,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ErrorState, FileCard, LoadingState, Toolbar } from "./components/ui";
import { PreviewContext, type PreviewContextValue } from "./context";
import { type DetectedFile, detectFileType } from "./detect";
import { type FilePreviewLabels, formatLabel, resolveLabels } from "./labels";
import { formatBytes, PREVIEW_LIMITS } from "./limits";
import { PreviewTooLargeError, readSource } from "./load";
import { deliveryOf, getPreviewRenderer } from "./registry";
import type { PreviewSource, RendererProps } from "./types";

export type FilePreviewProps = {
  source: PreviewSource;
  /** Translated strings; missing ones fall back to English. */
  labels?: Partial<FilePreviewLabels>;
  theme?: "light" | "dark";
  /** Offered on the file card and in error states. */
  onDownload?: () => void;
  /** Offered beside Download on the file card. */
  onOpenExternal?: () => void;
  /** Host controls placed at the end of the preview's toolbar. */
  toolbarEnd?: ReactNode;
  className?: string;
};

type DataState =
  | { status: "loading" }
  | { status: "ready"; url?: string; bytes?: Uint8Array; truncated: boolean }
  | { status: "error" }
  | { status: "too-large" }
  | { status: "no-source" };

/** Changes when the file does; a new `load` closure alone doesn't reload. */
function sourceKey(source: PreviewSource): string {
  return JSON.stringify([
    source.url ?? null,
    source.name,
    source.size ?? null,
    source.mimeType ?? null,
    Boolean(source.load),
  ]);
}

function tooLargeUpFront(source: PreviewSource, file: DetectedFile): boolean {
  const limit = PREVIEW_LIMITS[file.kind];
  return (
    source.size !== undefined && source.size > limit.maxBytes && !limit.truncate
  );
}

/**
 * Reads the file the way its kind needs: "url" kinds straight from the
 * address (or from a blob of `load()`'s bytes), "bytes" kinds through
 * `readSource` within their size limit. Aborts on unmount and revokes any
 * object URL it made.
 */
function useFileData(source: PreviewSource, file: DetectedFile): DataState {
  const delivery = deliveryOf(file.kind);
  const direct = delivery === "url" && Boolean(source.url) && !source.load;
  const [state, setState] = useState<DataState>(() => {
    if (delivery === "none") return { status: "no-source" };
    if (!source.url && !source.load) return { status: "no-source" };
    if (tooLargeUpFront(source, file)) return { status: "too-large" };
    if (direct) return { status: "ready", url: source.url, truncated: false };
    return { status: "loading" };
  });
  // The latest source, read when the effect runs; its key (the caller's
  // `key`) is what restarts this hook.
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per mount; FilePreview remounts this on a new file
  useEffect(() => {
    if (state.status !== "loading") return;
    const current = sourceRef.current;
    const controller = new AbortController();
    const limit = PREVIEW_LIMITS[file.kind];
    let objectUrl: string | null = null;
    readSource(current, controller.signal, limit)
      .then(({ bytes, truncated }) => {
        if (controller.signal.aborted) return;
        if (delivery === "url") {
          objectUrl = URL.createObjectURL(
            new Blob([bytes as BlobPart], {
              type: current.mimeType || "",
            }),
          );
          setState({ status: "ready", url: objectUrl, truncated: false });
        } else {
          setState({ status: "ready", bytes, truncated });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof PreviewTooLargeError) {
          setState({ status: "too-large" });
        } else {
          console.warn("file preview: could not read the file", error);
          setState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  return state;
}

class RendererBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("file preview: the file could not be shown", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function PreviewBody({
  source,
  file,
}: {
  source: PreviewSource;
  file: DetectedFile;
}) {
  const { labels } = useContext(PreviewContext);
  const entry = getPreviewRenderer(file.kind);
  // Fetch the renderer's code while the file downloads.
  useEffect(() => {
    void entry?.preload().catch(() => {});
  }, [entry]);
  const state = useFileData(source, file);

  const card = (message: string) => (
    <>
      <Toolbar />
      <FileCard name={source.name} size={source.size} message={message} />
    </>
  );

  if (!entry || state.status === "no-source") return card(labels.noPreview);
  if (state.status === "too-large") {
    return card(
      formatLabel(labels.tooLarge, {
        size: formatBytes(PREVIEW_LIMITS[file.kind].maxBytes),
      }),
    );
  }
  const failed = (
    <>
      <Toolbar />
      <ErrorState name={source.name} size={source.size} />
    </>
  );
  if (state.status === "error") return failed;
  if (state.status === "loading") {
    return (
      <>
        <Toolbar />
        <LoadingState />
      </>
    );
  }
  const Renderer = entry.Component;
  const props: RendererProps = {
    source,
    file,
    url: state.url,
    bytes: state.bytes,
    truncated: state.truncated,
  };
  return (
    <RendererBoundary fallback={failed}>
      <Suspense
        fallback={
          <>
            <Toolbar />
            <LoadingState />
          </>
        }
      >
        <Renderer {...props} />
      </Suspense>
    </RendererBoundary>
  );
}

/**
 * Previews one file: PDFs, documents, spreadsheets, slides,
 * pictures, code, archives, 3D models, video and audio. Each format's
 * renderer and library load only when a file of that format opens.
 * Unsupported, too large or damaged files get a card with the file's
 * details and the host's Download / Open actions.
 */
export function FilePreview({
  source,
  labels,
  theme = "light",
  onDownload,
  onOpenExternal,
  toolbarEnd,
  className,
}: FilePreviewProps) {
  const parent = useContext(PreviewContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const resolved = useMemo(() => resolveLabels(labels), [labels]);
  const file = useMemo(
    () => detectFileType({ name: source.name, mimeType: source.mimeType }),
    [source.name, source.mimeType],
  );
  const value = useMemo<PreviewContextValue>(
    () => ({
      labels: resolved,
      theme,
      depth: parent.inside ? parent.depth + 1 : 0,
      onDownload,
      onOpenExternal,
      toolbarEnd,
      rootRef,
      inside: true,
    }),
    [
      resolved,
      theme,
      parent.inside,
      parent.depth,
      onDownload,
      onOpenExternal,
      toolbarEnd,
    ],
  );
  return (
    <PreviewContext.Provider value={value}>
      <div
        ref={rootRef}
        className={`mfp-root${className ? ` ${className}` : ""}`}
        data-theme={theme}
        data-kind={file.kind}
      >
        <PreviewBody key={sourceKey(source)} source={source} file={file} />
      </div>
    </PreviewContext.Provider>
  );
}
