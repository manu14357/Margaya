import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
} from "react";
import { DEFAULT_LABELS, type FilePreviewLabels } from "./labels";

export type PreviewTheme = "light" | "dark";

export type PreviewContextValue = {
  labels: FilePreviewLabels;
  theme: PreviewTheme;
  /** 0 for the host's file, 1 for a file inside an archive, and so on. */
  depth: number;
  onDownload?: () => void;
  onOpenExternal?: () => void;
  toolbarEnd?: ReactNode;
  /** The preview's outermost element: full screen targets it. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** False only outside any preview, so a nested one knows its depth. */
  inside: boolean;
};

const fallbackRoot: RefObject<HTMLDivElement | null> = { current: null };

export const PreviewContext = createContext<PreviewContextValue>({
  labels: DEFAULT_LABELS,
  theme: "light",
  depth: 0,
  rootRef: fallbackRoot,
  inside: false,
});

export function usePreview(): PreviewContextValue {
  return useContext(PreviewContext);
}
