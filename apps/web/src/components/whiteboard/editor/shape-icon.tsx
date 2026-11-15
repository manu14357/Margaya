import { pathOpsToSvg, shapeOutline } from "@margaya/whiteboard";
import { cn } from "@/lib/cn";
import { defaultShapeSize } from "./shapes";
import { isClassicShape, type ShapeChoice } from "./tools";

// Small outline icons for the shape library on a 24-unit grid, so they sit
// next to the toolbar's other icons. Library shapes use the board's own
// outlines, so an icon always looks like what it draws.

const CLASSIC_PATHS: Record<"rectangle" | "ellipse" | "diamond", string> = {
  rectangle:
    "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  ellipse: "M3 12a9 7 0 1 0 18 0a9 7 0 1 0-18 0z",
  diamond: "M12 3l9 9-9 9-9-9z",
};

/** Room for the outline inside the 24-unit icon. */
const ICON_BOX = 18;

const paths = new Map<ShapeChoice, string>();

/** The icon's path: the shape's default proportions, centred in the grid. */
export function shapeIconPath(shape: ShapeChoice): string {
  if (isClassicShape(shape)) return CLASSIC_PATHS[shape];
  const cached = paths.get(shape);
  if (cached) return cached;
  const size = defaultShapeSize(shape);
  const scale = ICON_BOX / Math.max(size.width, size.height);
  const width = size.width * scale;
  const height = size.height * scale;
  const dx = (24 - width) / 2;
  const dy = (24 - height) / 2;
  const ops = shapeOutline(shape, width, height).map((op) => {
    const moved: (string | number)[] = [op[0]];
    for (let index = 1; index < op.length; index++) {
      const value = op[index] as number;
      moved.push(Math.round((value + (index % 2 === 1 ? dx : dy)) * 100) / 100);
    }
    return moved as unknown as typeof op;
  });
  const path = pathOpsToSvg(ops);
  paths.set(shape, path);
  return path;
}

export function ShapeIcon({
  shape,
  className,
}: {
  shape: ShapeChoice;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      data-shape={shape}
    >
      <path d={shapeIconPath(shape)} />
    </svg>
  );
}
