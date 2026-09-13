import { HTTPException } from "hono/http-exception";
import { PAGE_ICON_NAMES } from "../icons";
import { isValidLogo, PAGE_MESSAGES } from "../rules";
import type { PageLogoKind } from "../types";

/**
 * The logo pair of a request, or undefined when it names neither part.
 * Both parts must be sent together, as an emoji, an icon of the catalog or
 * null (no logo); anything else is a 400.
 */
export function readLogo(input: {
  logoKind?: PageLogoKind | null;
  logoValue?: string | null;
}): { logoKind: PageLogoKind | null; logoValue: string | null } | undefined {
  if (input.logoKind === undefined && input.logoValue === undefined) {
    return undefined;
  }
  const logoKind = input.logoKind ?? null;
  const logoValue = input.logoValue ?? null;
  if (
    input.logoKind === undefined ||
    input.logoValue === undefined ||
    !isValidLogo(logoKind, logoValue, PAGE_ICON_NAMES)
  ) {
    throw new HTTPException(400, { message: PAGE_MESSAGES.invalidLogo });
  }
  return { logoKind, logoValue };
}
