import { Loader2, Upload } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";

type ImportDropZoneProps = {
  /** The file input's `accept` list. */
  accept: string;
  hint: string;
  buttonLabel: string;
  onFile: (file: File) => void;
  /** Called when something without a file is dropped. */
  onEmptyDrop?: () => void;
  isBusy?: boolean;
  disabled?: boolean;
};

/** The import dialogs' drag-and-drop area with a file picker button. */
export function ImportDropZone({
  accept,
  hint,
  buttonLabel,
  onFile,
  onEmptyDrop,
  isBusy = false,
  disabled = false,
}: ImportDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled) return;
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
    else onEmptyDrop?.();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFile(file);
    // The same file can be picked again after an error.
    event.target.value = "";
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the button inside is the accessible way to pick a file
    <div
      className="rounded-lg border-2 border-dashed border-border bg-muted/60 p-8 text-center transition-colors hover:border-ring"
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
    >
      <div className="flex flex-col items-center justify-center gap-2">
        <Upload className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{hint}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || isBusy}
        >
          {isBusy && <Loader2 className="animate-spin" />}
          {buttonLabel}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          className="hidden"
        />
      </div>
    </div>
  );
}

export default ImportDropZone;
