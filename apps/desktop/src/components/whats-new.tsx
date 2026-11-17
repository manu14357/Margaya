import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useT } from "../lib/i18n";
import { api, type ReleaseNotes } from "../lib/ipc";

/** Settings' "What's new" button asks the launcher to show the notes. */
export const SHOW_WHATS_NEW_EVENT = "margaya:show-whats-new";

export function showWhatsNew() {
  window.dispatchEvent(new CustomEvent(SHOW_WHATS_NEW_EVENT));
}

type Notes =
  | { state: "loading"; version: string }
  | { state: "ready"; notes: ReleaseNotes };

/**
 * "Updated to vX.Y.Z" with the release notes, at the top of the launcher:
 * after an update, and from Settings. The notes arrive from the core as plain
 * text blocks and render as text, never as HTML; without them, a link to the
 * release page remains.
 */
export function WhatsNew() {
  const t = useT();
  const titleId = useId();
  const [notes, setNotes] = useState<Notes | null>(null);
  const [pending, setPending] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  const open = useCallback((version: string) => {
    setNotes({ state: "loading", version });
    api
      .releaseNotes(version)
      .then((loaded) => setNotes({ state: "ready", notes: loaded }))
      .catch(() =>
        setNotes({
          state: "ready",
          notes: { version, url: "", blocks: [] },
        }),
      );
  }, []);

  useEffect(() => {
    api
      .whatsNewState()
      .then((state) => {
        if (state.pending) {
          setPending(true);
          open(state.version);
        }
      })
      // An older core: nothing to show.
      .catch(() => {});
    const onShow = () => {
      api
        .whatsNewState()
        .then((state) => open(state.version))
        .catch(() => {});
    };
    window.addEventListener(SHOW_WHATS_NEW_EVENT, onShow);
    return () => window.removeEventListener(SHOW_WHATS_NEW_EVENT, onShow);
  }, [open]);

  useEffect(() => {
    if (notes) sectionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [notes]);

  if (!notes) return null;

  const version =
    notes.state === "loading" ? notes.version : notes.notes.version;
  const close = () => {
    setNotes(null);
    if (pending) {
      setPending(false);
      void api.dismissWhatsNew().catch(() => {});
    }
  };

  return (
    <section
      ref={sectionRef}
      className="card whats-new"
      aria-labelledby={titleId}
    >
      <h2 id={titleId}>{t("whatsNew.title", { version })}</h2>
      {notes.state === "loading" ? (
        <p className="settings-hint" role="status">
          {t("whatsNew.loading")}
        </p>
      ) : notes.notes.blocks.length > 0 ? (
        <div className="release-notes">
          {notes.notes.blocks.map((block, index) => {
            const key = `${index}-${block.kind}`;
            if (block.kind === "heading")
              return <h3 key={key}>{block.text}</h3>;
            if (block.kind === "item")
              return (
                <p
                  key={key}
                  className="release-note-item"
                  data-depth={block.depth}
                >
                  {block.text}
                </p>
              );
            return <p key={key}>{block.text}</p>;
          })}
        </div>
      ) : (
        <p className="settings-hint">{t("whatsNew.unavailable")}</p>
      )}
      <div className="row end gap">
        {notes.state === "ready" && notes.notes.url ? (
          <button
            type="button"
            className="button"
            onClick={() =>
              void api.openExternal(notes.notes.url).catch(() => {})
            }
          >
            {t("whatsNew.openRelease")}
          </button>
        ) : null}
        <button type="button" className="button primary" onClick={close}>
          {t("whatsNew.close")}
        </button>
      </div>
    </section>
  );
}
