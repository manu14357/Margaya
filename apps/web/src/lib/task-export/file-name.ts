/**
 * The file name in a Content-Disposition header: the UTF-8 `filename*` form
 * first, then the plain `filename`. Cross-origin deployments don't expose
 * the header, so callers pass the row's own file name as the fallback.
 */
export function fileNameFromDisposition(
  header: string | null | undefined,
  fallback: string,
): string {
  if (header) {
    const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
    if (extended) {
      try {
        const decoded = decodeURIComponent(extended[1].trim());
        if (decoded) return decoded;
      } catch {
        // A malformed escape falls through to the plain name.
      }
    }
    const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/.exec(header);
    const name = (plain?.[1] ?? plain?.[2])?.trim();
    if (name) return name;
  }
  return fallback;
}
