/**
 * Which tabs of a row fit beside a "More" menu. Tabs keep their order; the
 * selected tab always stays in the row (the tabs before it make room), and
 * the rest wait in "More".
 *
 * `widths` are the tabs' widths in row order, `available` the row's width and
 * `moreWidth` the "More" button's. Returns the indexes that go into "More";
 * empty when everything fits (or nothing was measured yet).
 */
export function overflowingTabs({
  widths,
  available,
  moreWidth,
  activeIndex,
}: {
  widths: readonly number[];
  available: number;
  moreWidth: number;
  activeIndex: number;
}): number[] {
  if (available <= 0 || widths.length === 0) return [];
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= available + 0.5) return [];

  const room = available - moreWidth;
  const active = widths[activeIndex] ?? 0;
  const kept = new Set<number>();
  let used = activeIndex >= 0 ? active : 0;
  if (activeIndex >= 0) kept.add(activeIndex);
  for (let index = 0; index < widths.length; index++) {
    if (index === activeIndex) continue;
    if (used + widths[index] > room) break;
    kept.add(index);
    used += widths[index];
  }
  return widths.flatMap((_, index) => (kept.has(index) ? [] : [index]));
}
