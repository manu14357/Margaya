import {
  Download,
  Ellipsis,
  ExternalLink,
  File as FileIcon,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePreview } from "../context";
import { fileExtension } from "../detect";
import { formatBytes } from "../limits";

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> & {
  label: string;
  children: ReactNode;
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

/** A square toolbar button; its label is both the name and the tooltip. */
export function IconButton({
  label,
  children,
  pressed,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`mfp-btn mfp-btn-icon${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
      {/* Shown only when the button sits in the toolbar's More menu. */}
      <span className="mfp-btn-label" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

type TextButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary";
  pressed?: boolean;
};

export function TextButton({
  variant = "default",
  pressed,
  className,
  type = "button",
  ...rest
}: TextButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={`mfp-btn mfp-btn-text${variant === "primary" ? " mfp-btn-primary" : ""}${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}

export function Separator() {
  return <span className="mfp-sep" aria-hidden="true" />;
}

/**
 * The preview's tool row: a renderer's own controls first, then whatever
 * the host put at the end, always on one line. `more` holds the controls
 * that matter least: inline while they fit, behind a "More" button when the
 * row gets too narrow (a side panel, a phone). Nothing renders when the row
 * would be empty.
 */
export function Toolbar({
  children,
  more,
}: {
  children?: ReactNode;
  more?: ReactNode;
}) {
  const { labels, toolbarEnd } = usePreview();
  const rowRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  // The start's width with every control inline, measured when it overflowed.
  const needed = useRef(0);
  const hasMore = Boolean(more);

  const fitRow = useCallback(() => {
    const start = startRef.current;
    if (!start || !hasMore) return;
    setCollapsed((current) => {
      if (!current) {
        if (start.scrollWidth > start.clientWidth + 1) {
          needed.current = start.scrollWidth;
          return true;
        }
        return false;
      }
      // Expanded, the More button's room goes to the start again.
      const room = start.clientWidth + (moreRef.current?.offsetWidth ?? 0);
      return room < needed.current;
    });
  }, [hasMore]);

  // After every render (a control may have grown) and on every resize.
  useLayoutEffect(fitRow);
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fitRow());
    observer.observe(row);
    return () => observer.disconnect();
  }, [fitRow]);

  const shown = open && collapsed;
  useEffect(() => {
    if (!shown) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    // Into the menu, so the keyboard carries on from the first tool.
    moreRef.current
      ?.querySelector<HTMLElement>(".mfp-more-panel button:not(:disabled)")
      ?.focus();
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [shown]);

  // Escape closes the open menu only, not a dialog around the preview.
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !shown) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  };

  if (!children && !more && !toolbarEnd) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled row of tool buttons, not a form, so no fieldset
    <div
      ref={rowRef}
      className="mfp-toolbar"
      role="group"
      aria-label={labels.toolbar}
    >
      <div ref={startRef} className="mfp-toolbar-start">
        {children}
        {more && !collapsed ? more : null}
      </div>
      {more && collapsed ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the open menu; the buttons are the controls
        <div ref={moreRef} className="mfp-more" onKeyDown={onMenuKeyDown}>
          <IconButton
            ref={buttonRef}
            label={labels.more}
            aria-haspopup="true"
            aria-expanded={shown}
            onClick={() => setOpen((value) => !value)}
          >
            <Ellipsis aria-hidden="true" />
          </IconButton>
          {shown ? (
            // biome-ignore lint/a11y/useSemanticElements: a labelled pop-up group of tool buttons, not a form, so no fieldset
            // biome-ignore lint/a11y/useKeyWithClickEvents: only clicks on its buttons count, and those come from the keyboard too
            <div
              className="mfp-more-panel"
              role="group"
              aria-label={labels.more}
              // A choice closes the menu, as a menu would.
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button")) {
                  setOpen(false);
                }
              }}
            >
              {more}
            </div>
          ) : null}
        </div>
      ) : null}
      {toolbarEnd ? <div className="mfp-toolbar-end">{toolbarEnd}</div> : null}
    </div>
  );
}

/** A one-line note above the content: truncation, plain-text fallback. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="mfp-notice" role="note">
      {children}
    </p>
  );
}

export function LoadingState() {
  const { labels } = usePreview();
  return (
    <div className="mfp-state" role="status" aria-live="polite">
      <LoaderCircle className="mfp-spin" aria-hidden="true" />
      <span className="mfp-state-text">{labels.loading}</span>
    </div>
  );
}

function FileActions() {
  const { labels, onDownload, onOpenExternal } = usePreview();
  if (!onDownload && !onOpenExternal) return null;
  return (
    <div className="mfp-state-actions">
      {onDownload ? (
        <TextButton variant="primary" onClick={onDownload}>
          <Download aria-hidden="true" />
          {labels.download}
        </TextButton>
      ) : null}
      {onOpenExternal ? (
        <TextButton onClick={onOpenExternal}>
          <ExternalLink aria-hidden="true" />
          {labels.openExternal}
        </TextButton>
      ) : null}
    </div>
  );
}

/**
 * The file card: its name, type and size, a message, and Download / Open
 * when the host offers them. Used for unsupported, too-large and failed
 * files alike.
 */
export function FileCard({
  name,
  size,
  title,
  message,
  tone = "neutral",
}: {
  name: string;
  size?: number;
  title?: string;
  message: string;
  tone?: "neutral" | "error";
}) {
  const extension = fileExtension(name);
  const details = [
    extension ? extension.toUpperCase() : null,
    size !== undefined && size > 0 ? formatBytes(size) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="mfp-state">
      <div className="mfp-card" role={tone === "error" ? "alert" : undefined}>
        <span className="mfp-card-icon" aria-hidden="true">
          {tone === "error" ? <TriangleAlert /> : <FileIcon />}
          {extension && tone !== "error" ? (
            <span className="mfp-card-ext">{extension.slice(0, 4)}</span>
          ) : null}
        </span>
        <div className="mfp-card-meta">
          <p className="mfp-card-name" title={name}>
            {name}
          </p>
          {details ? <p className="mfp-card-details">{details}</p> : null}
        </div>
        {title ? <p className="mfp-card-title">{title}</p> : null}
        <p className="mfp-card-message">{message}</p>
        <FileActions />
      </div>
    </div>
  );
}

export function ErrorState({ name, size }: { name: string; size?: number }) {
  const { labels } = usePreview();
  return (
    <FileCard
      name={name}
      size={size}
      tone="error"
      title={labels.errorTitle}
      message={labels.errorBody}
    />
  );
}
