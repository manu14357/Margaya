import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CaptureImage } from "@/lib/ai/capture-media";

/** Small previews of captured or pasted images, each removable. */
export default function CaptureThumbnails({
  images,
  onRemove,
  removeLabel,
}: {
  images: readonly CaptureImage[];
  onRemove: (id: string) => void;
  removeLabel: (name: string) => string;
}) {
  if (images.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {images.map((image) => (
        <li key={image.id} className="relative">
          <img
            src={image.url}
            alt={image.name}
            className="h-20 w-28 rounded-md border object-cover"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            className="absolute top-1 right-1 bg-background"
            aria-label={removeLabel(image.name)}
            onClick={() => onRemove(image.id)}
          >
            <X />
          </Button>
        </li>
      ))}
    </ul>
  );
}
