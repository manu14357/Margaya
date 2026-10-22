import type { Metadata } from "next";
import "./docs.css";

export const metadata: Metadata = {
  title: {
    template: "%s | Margaya Docs",
    default: "Margaya Docs",
  },
};

export default function DocsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
