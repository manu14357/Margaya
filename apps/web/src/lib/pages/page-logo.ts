import type { LucideIcon } from "lucide-react";
import { FileText } from "lucide-react";
import projectIcons from "@/constants/project-icons";

export type ResolvedPageLogo =
  | { kind: "emoji"; emoji: string }
  | { kind: "icon"; Icon: LucideIcon; name: string };

export const DEFAULT_PAGE_ICON = FileText;

export function isPageIconName(
  name: string,
): name is keyof typeof projectIcons {
  return Object.hasOwn(projectIcons, name);
}

/** An emoji, a project-catalog icon, or the default page icon. */
export function resolvePageLogo(
  logoKind: string | null | undefined,
  logoValue: string | null | undefined,
): ResolvedPageLogo {
  if (logoKind === "emoji" && logoValue) {
    return { kind: "emoji", emoji: logoValue };
  }
  if (logoKind === "icon" && logoValue && isPageIconName(logoValue)) {
    return { kind: "icon", Icon: projectIcons[logoValue], name: logoValue };
  }
  return { kind: "icon", Icon: DEFAULT_PAGE_ICON, name: "FileText" };
}

/** The lucide icon, for places that can't show an emoji (favorites). */
export function pageLogoIcon(
  logoKind: string | null | undefined,
  logoValue: string | null | undefined,
): LucideIcon {
  const logo = resolvePageLogo(logoKind, logoValue);
  return logo.kind === "icon" ? logo.Icon : DEFAULT_PAGE_ICON;
}
