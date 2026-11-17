import type { CategoryId, TextKey } from "./types";

// Gallery categories in display order. Names and descriptions are the shared
// projectTemplates:categories.<id>.* keys; icons are project icon catalog
// names (apps/web/src/constants/project-icons.ts).

export type CategoryDef = {
  id: CategoryId;
  icon: string;
  name: TextKey;
  description: TextKey;
};

function category(id: CategoryId, icon: string): CategoryDef {
  return {
    id,
    icon,
    name: `projectTemplates:categories.${id}.name`,
    description: `projectTemplates:categories.${id}.description`,
  };
}

export const CATEGORIES: readonly CategoryDef[] = [
  category("software-development", "Code"),
  category("service-management", "MessageSquare"),
  category("work-management", "FolderKanban"),
  category("product-management", "Lightbulb"),
  category("marketing", "Radio"),
  category("design", "Palette"),
  category("it", "CircuitBoard"),
  category("customer-service", "Smile"),
  category("human-resources", "Users"),
  category("finance", "Wallet"),
  category("legal", "ScrollText"),
  category("sales", "Target"),
  category("operations", "Cog"),
  category("facilities", "Building2"),
  category("analytics", "PieChart"),
  category("nonprofit", "Heart"),
  category("personal", "User"),
];
