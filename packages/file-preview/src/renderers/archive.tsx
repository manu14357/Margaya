import { ArrowLeft, ArrowUp, File as FileIcon, Folder } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { FileCard, IconButton, TextButton, Toolbar } from "../components/ui";
import { usePreview } from "../context";
import { FilePreview } from "../file-preview";
import { formatLabel } from "../labels";
import { formatBytes, ZIP_LIMITS } from "../limits";
import type { PreviewSource, RendererProps } from "../types";
import {
  extractZipEntry,
  listZip,
  type ZipEntry,
  ZipError,
  zipEntryRefusal,
} from "../zip";

type FolderNode = { folders: string[]; files: ZipEntry[] };

/** Entries grouped by folder path ("" is the root), folders implied too. */
function buildTree(entries: ZipEntry[]): Map<string, FolderNode> {
  const tree = new Map<string, FolderNode>();
  const folder = (path: string) => {
    let node = tree.get(path);
    if (!node) {
      node = { folders: [], files: [] };
      tree.set(path, node);
      if (path) {
        const parent = path.includes("/")
          ? path.slice(0, path.lastIndexOf("/"))
          : "";
        folder(parent).folders.push(path);
      }
    }
    return node;
  };
  folder("");
  for (const entry of entries) {
    const path = entry.path.replace(/\/$/, "");
    if (!path) continue;
    if (entry.directory) {
      folder(path);
      continue;
    }
    const parent = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "";
    folder(parent).files.push(entry);
  }
  for (const node of tree.values()) {
    node.folders.sort((a, b) => a.localeCompare(b));
    node.files.sort((a, b) => a.name.localeCompare(b.name));
  }
  return tree;
}

const dateFormat =
  typeof Intl !== "undefined"
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

function saveBytes(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * A ZIP's contents as folders and files with sizes and dates. A file opens
 * in a nested preview, within the zip-bomb limits.
 */
export default function ArchiveRenderer({ source, bytes }: RendererProps) {
  const preview = usePreview();
  const { labels, depth } = preview;
  const data = bytes ?? new Uint8Array();
  const listing = useMemo(() => {
    try {
      return { entries: listZip(data), error: null };
    } catch (error) {
      return { entries: [] as ZipEntry[], error: error as Error };
    }
  }, [data]);
  const tree = useMemo(() => buildTree(listing.entries), [listing.entries]);
  const [path, setPath] = useState("");
  const [open, setOpen] = useState<ZipEntry | null>(null);
  const spent = useRef(0);

  const extract = useCallback(
    async (entry: ZipEntry) => {
      const refusal = zipEntryRefusal(entry, spent.current);
      if (refusal) throw refusal;
      spent.current += entry.size;
      return extractZipEntry(data, entry);
    },
    [data],
  );

  const nested = useMemo<PreviewSource | null>(() => {
    if (!open) return null;
    return {
      name: open.name,
      size: open.size,
      load: async () => {
        const entryBytes = await extract(open);
        return entryBytes.buffer.slice(
          entryBytes.byteOffset,
          entryBytes.byteOffset + entryBytes.byteLength,
        ) as ArrayBuffer;
      },
    };
  }, [open, extract]);

  if (depth >= ZIP_LIMITS.maxDepth) {
    return (
      <FileCard
        name={source.name}
        size={source.size}
        message={formatLabel(labels.archiveTooDeep, {
          depth: ZIP_LIMITS.maxDepth,
        })}
      />
    );
  }
  if (listing.error) {
    const tooMany =
      listing.error instanceof ZipError && listing.error.reason === "too-many";
    if (tooMany) {
      return (
        <FileCard
          name={source.name}
          size={source.size}
          message={formatLabel(labels.archiveTooMany, {
            count: ZIP_LIMITS.maxEntries,
          })}
        />
      );
    }
    throw listing.error;
  }

  if (open && nested) {
    // Encrypted, unsupported or bomb-like entries never reach the loader.
    const refusal = zipEntryRefusal(open, 0);
    return (
      <div className="mfp-fill">
        <div className="mfp-subbar">
          <TextButton onClick={() => setOpen(null)}>
            <ArrowLeft className="mfp-flip-rtl" aria-hidden="true" />
            {labels.archiveBack}
          </TextButton>
          <span className="mfp-subbar-path" title={open.path}>
            {open.path}
          </span>
        </div>
        {refusal ? (
          <FileCard
            name={open.name}
            size={open.size}
            message={
              refusal.reason === "encrypted"
                ? labels.archiveEncrypted
                : refusal.reason === "unsupported"
                  ? labels.noPreview
                  : labels.archiveEntryTooLarge
            }
          />
        ) : (
          <FilePreview
            source={nested}
            labels={labels}
            theme={preview.theme}
            onDownload={() => {
              void extractZipEntry(data, open).then((entryBytes) =>
                saveBytes(entryBytes, open.name),
              );
            }}
            className="mfp-nested"
          />
        )}
      </div>
    );
  }

  const folder = tree.get(path) ?? { folders: [], files: [] };
  const crumbs = path ? path.split("/") : [];
  const fileCount = listing.entries.filter((entry) => !entry.directory).length;

  return (
    <>
      <Toolbar>
        <IconButton
          label={labels.archiveUp}
          disabled={!path}
          onClick={() =>
            setPath(
              path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
            )
          }
        >
          <ArrowUp aria-hidden="true" />
        </IconButton>
        <nav className="mfp-crumbs" aria-label={labels.archiveRoot}>
          <button
            type="button"
            className="mfp-crumb"
            onClick={() => setPath("")}
          >
            {labels.archiveRoot}
          </button>
          {crumbs.map((crumb, index) => {
            const target = crumbs.slice(0, index + 1).join("/");
            return (
              <span key={target} className="mfp-crumb-item">
                <span aria-hidden="true">/</span>
                <button
                  type="button"
                  className="mfp-crumb"
                  aria-current={
                    index === crumbs.length - 1 ? "location" : undefined
                  }
                  onClick={() => setPath(target)}
                >
                  {crumb}
                </button>
              </span>
            );
          })}
        </nav>
        <span className="mfp-toolbar-text">
          {formatLabel(labels.archiveItems, { count: fileCount })}
        </span>
      </Toolbar>
      <section
        className="mfp-scroll mfp-archive"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the listing scrolls from the keyboard
        tabIndex={0}
        aria-label={source.name}
      >
        <table className="mfp-table">
          <thead>
            <tr>
              <th scope="col">{labels.archiveName}</th>
              <th scope="col" className="mfp-num">
                {labels.archiveSize}
              </th>
              <th scope="col">{labels.archiveModified}</th>
            </tr>
          </thead>
          <tbody>
            {folder.folders.map((child) => (
              <tr key={`d:${child}`} className="mfp-row">
                <td>
                  <button
                    type="button"
                    className="mfp-row-button"
                    onClick={() => setPath(child)}
                  >
                    <Folder className="mfp-row-icon" aria-hidden="true" />
                    <span className="mfp-truncate">
                      {child.slice(child.lastIndexOf("/") + 1)}
                    </span>
                  </button>
                </td>
                <td className="mfp-num mfp-muted">—</td>
                <td className="mfp-muted" />
              </tr>
            ))}
            {folder.files.map((entry) => (
              <tr key={`f:${entry.path}`} className="mfp-row">
                <td>
                  <button
                    type="button"
                    className="mfp-row-button"
                    onClick={() => setOpen(entry)}
                  >
                    <FileIcon className="mfp-row-icon" aria-hidden="true" />
                    <span className="mfp-truncate">{entry.name}</span>
                  </button>
                </td>
                <td className="mfp-num mfp-muted">{formatBytes(entry.size)}</td>
                <td className="mfp-muted">
                  {entry.modified && dateFormat
                    ? dateFormat.format(entry.modified)
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
