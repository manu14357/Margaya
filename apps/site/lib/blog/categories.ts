import type { BlogCategory } from "./types";

const all: BlogCategory[] = [
  {
    slug: "alternatives",
    name: "Alternatives",
    description:
      "Side-by-side looks at the tools teams weigh up when a tracker stops fitting: what each one is good at, where it strains, and how to move.",
  },
  {
    slug: "evergreens",
    name: "Evergreens",
    description:
      "Longer reads on picking, running and paying for the software a team plans its work in.",
  },
  {
    slug: "product",
    name: "Product",
    description:
      "How Margaya features work, why they work that way, and how to get the most out of them.",
  },
  {
    slug: "updates",
    name: "Updates",
    description: "Release notes and news from the Margaya project.",
  },
];

export const categoryList = all;

export const categories: Record<string, BlogCategory> = Object.fromEntries(
  all.map((category) => [category.slug, category]),
);
