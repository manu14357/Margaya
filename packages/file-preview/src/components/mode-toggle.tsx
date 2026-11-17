import { Code, Eye } from "lucide-react";
import { usePreview } from "../context";
import { TextButton } from "./ui";

/** Rendered page or its source: markdown and HTML. */
export function ModeToggle({
  source,
  onChange,
}: {
  source: boolean;
  onChange: (source: boolean) => void;
}) {
  const { labels } = usePreview();
  return (
    <div className="mfp-segmented">
      <TextButton pressed={!source} onClick={() => onChange(false)}>
        <Eye aria-hidden="true" />
        {labels.viewRendered}
      </TextButton>
      <TextButton pressed={source} onClick={() => onChange(true)}>
        <Code aria-hidden="true" />
        {labels.viewSource}
      </TextButton>
    </div>
  );
}
