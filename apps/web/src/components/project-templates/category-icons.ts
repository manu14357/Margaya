import {
  Building2,
  ChartColumn,
  CodeXml,
  Coins,
  HandHeart,
  Handshake,
  Headset,
  LifeBuoy,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  Megaphone,
  Monitor,
  Palette,
  Scale,
  Settings2,
  User,
  Users,
} from "lucide-react";

/**
 * The gallery's category rail icons, keyed by category id (the files in
 * plans/create-flow-and-templates/03-templates/categories/).
 */
export const categoryIcons = {
  analytics: ChartColumn,
  "customer-service": Headset,
  design: Palette,
  facilities: Building2,
  finance: Coins,
  "human-resources": Users,
  it: Monitor,
  legal: Scale,
  marketing: Megaphone,
  nonprofit: HandHeart,
  operations: Settings2,
  personal: User,
  "product-management": Lightbulb,
  sales: Handshake,
  "service-management": LifeBuoy,
  "software-development": CodeXml,
  "work-management": ListChecks,
} as const satisfies Record<string, LucideIcon>;

export type TemplateCategoryId = keyof typeof categoryIcons;

export function categoryIcon(id: string): LucideIcon {
  return categoryIcons[id as TemplateCategoryId] ?? ListChecks;
}
