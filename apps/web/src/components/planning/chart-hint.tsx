/** Stands in for a burn chart, at its height, and says why it is missing. */
export default function ChartHint({
  children,
  height,
}: {
  children: string;
  height: number;
}) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed px-4 text-center text-muted-foreground text-xs"
      style={{ height }}
    >
      {children}
    </div>
  );
}
