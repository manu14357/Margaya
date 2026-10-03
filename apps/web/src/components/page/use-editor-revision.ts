import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";

/**
 * A counter that moves when the editor's document changes, at most once per
 * `throttleMs`, so panels that read the document re-render as people type.
 */
export function useEditorRevision(editor: Editor | null, throttleMs = 150) {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setRevision((value) => value + 1);
      }, throttleMs);
    };
    setRevision((value) => value + 1);
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [editor, throttleMs]);

  return revision;
}
