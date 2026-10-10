import { notFound } from "next/navigation";
import { LANDING_COPY_LOADERS } from "@/lib/landing-locales";

// Each translated `landing` namespace becomes a static JSON file at
// /landing-copy/<locale>.json, which the landing pages fetch when a visitor
// picks a language. English is bundled with the pages, so it has no file.
export const dynamic = "force-static";
export const dynamicParams = false;

type Params = { file: string };

export function generateStaticParams(): Params[] {
  return Object.keys(LANDING_COPY_LOADERS).map((locale) => ({
    file: `${locale}.json`,
  }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<Params> },
) {
  const { file } = await params;
  const load = LANDING_COPY_LOADERS[file.replace(/\.json$/, "")];
  if (!file.endsWith(".json") || !load) notFound();
  const messages = await load();
  return Response.json(messages.default.landing);
}
