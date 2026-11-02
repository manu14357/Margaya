export const DEFAULT_SOURCE_CODE_URL = "https://github.com/manu14357/Margaya";

/**
 * Where people using this instance can get its source code, which the
 * AGPL-3.0 requires a modified, network-facing copy to offer. An instance
 * running changed code points MARGAYA_SOURCE_URL at its own repository;
 * unset, invalid or non-HTTP(S) values use the official repository.
 */
export function sourceCodeUrl(value = process.env.MARGAYA_SOURCE_URL): string {
  const raw = value?.trim();
  if (!raw) return DEFAULT_SOURCE_CODE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return DEFAULT_SOURCE_CODE_URL;
    }
    return url.toString();
  } catch {
    return DEFAULT_SOURCE_CODE_URL;
  }
}
