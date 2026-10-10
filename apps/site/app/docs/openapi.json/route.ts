import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-static";

// The committed OpenAPI document the API reference is rendered from.
export function GET() {
  const document = fs.readFileSync(
    path.join(process.cwd(), "..", "docs", "openapi.json"),
    "utf8",
  );
  return new Response(document, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
