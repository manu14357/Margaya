import type { BlogAuthor } from "./types";

// Posts are written and reviewed by the people who build Margaya, so the
// byline names the team rather than an individual.
const all: BlogAuthor[] = [
  {
    id: "margaya-team",
    name: "Margaya team",
    role: "The people who build Margaya",
    avatar: "/favicon.svg",
    url: "https://github.com/manu14357/Margaya",
  },
];

export const authorList = all;

export const authors: Record<string, BlogAuthor> = Object.fromEntries(
  all.map((author) => [author.id, author]),
);
