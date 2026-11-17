import { Search } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
} from "react";
import { usePreview } from "../context";
import { formatLabel } from "../labels";
import { formatBytes } from "../limits";
import { FindBar, stepIndex, useFindShortcut } from "./find-bar";
import { findInLines, type LineToken, LineView } from "./line-view";
import { IconButton, Notice, Toolbar } from "./ui";

/**
 * Lines of text with find, line numbers and the truncation notice: the
 * body of the text, code and source views.
 */
export function TextDocument({
  lines,
  tokens,
  label,
  truncatedAt,
  notices,
  tools,
  foreground,
  background,
}: {
  lines: string[];
  tokens?: LineToken[][] | null;
  label: string;
  /** Bytes read when the file was cut short. */
  truncatedAt?: number;
  notices?: ReactNode;
  /** Extra controls before Find. */
  tools?: ReactNode;
  foreground?: string;
  background?: string;
}) {
  const { labels, rootRef } = usePreview();
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(-1);
  const deferredQuery = useDeferredValue(query);
  const hits = useMemo(
    () => (finding ? findInLines(lines, deferredQuery.trim()) : []),
    [finding, lines, deferredQuery],
  );
  const openFind = useCallback(() => setFinding(true), []);
  useFindShortcut(rootRef, openFind);

  const onQuery = (next: string) => {
    setQuery(next);
    setCurrent(next.trim() ? 0 : -1);
  };
  const shown = hits.length === 0 ? -1 : Math.min(current, hits.length - 1);

  return (
    <>
      <Toolbar>
        {tools}
        {finding ? (
          <FindBar
            query={query}
            onQuery={onQuery}
            total={hits.length}
            current={shown}
            busy={query !== deferredQuery}
            onStep={(direction) =>
              setCurrent((index) => stepIndex(index, hits.length, direction))
            }
            onClose={() => {
              setFinding(false);
              setQuery("");
              setCurrent(-1);
            }}
          />
        ) : (
          <IconButton label={labels.find} onClick={openFind}>
            <Search aria-hidden="true" />
          </IconButton>
        )}
      </Toolbar>
      {truncatedAt !== undefined ? (
        <Notice>
          {formatLabel(labels.truncated, { size: formatBytes(truncatedAt) })}
        </Notice>
      ) : null}
      {notices}
      <LineView
        lines={lines}
        tokens={tokens}
        label={label}
        hits={hits}
        current={shown}
        foreground={foreground}
        background={background}
      />
    </>
  );
}
