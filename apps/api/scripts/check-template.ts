// Checks built-in project templates against every rule the API enforces, in
// all 20 locales. Usage (from the repo root):
//
//   pnpm --filter @margaya/api exec tsx scripts/check-template.ts <id> [<id>...]
//   pnpm --filter @margaya/api exec tsx scripts/check-template.ts --all
//
// A template is read straight from src/project-template/definitions/<id>.ts
// and its text from locales/<id>.json (when present), so it can be checked
// before it is registered in the generated indexes. Exit code 1 on errors.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The checker never touches a database; keep any accidental import lazy.
process.env.DATABASE_URL ??= "postgresql://template-check@127.0.0.1:1/none";

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/project-template",
);

type Fragment = Record<string, Record<string, unknown>>;

function flatten(tree: unknown, prefix = ""): string[] {
  if (typeof tree === "string") return [prefix];
  if (!tree || typeof tree !== "object") return [];
  return Object.entries(tree as Record<string, unknown>).flatMap(
    ([key, value]) => flatten(value, prefix ? `${prefix}.${key}` : key),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const ids = args.includes("--all")
    ? readdirSync(join(root, "definitions"))
        .filter((file) => file.endsWith(".ts") && file !== "index.ts")
        .map((file) => file.slice(0, -3))
        .sort()
    : args.filter((arg) => !arg.startsWith("--"));
  if (ids.length === 0) {
    console.error("Usage: check-template.ts <id> [<id>...] | --all");
    process.exit(2);
  }

  const { validateTemplate } = await import(
    pathToFileURL(join(root, "validate.ts")).href
  );
  const text = await import(pathToFileURL(join(root, "text.ts")).href);
  const { LOCALE_FRAGMENTS } = await import(
    pathToFileURL(join(root, "locales/index.ts")).href
  );
  const { TEMPLATE_DEFINITIONS } = await import(
    pathToFileURL(join(root, "definitions/index.ts")).href
  );
  const { textKeysOf } = await import(
    pathToFileURL(join(root, "resolve.ts")).href
  );
  const registered = new Set(
    (TEMPLATE_DEFINITIONS as { id: string }[]).map((template) => template.id),
  );

  let failed = 0;
  for (const id of ids) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const file = join(root, "definitions", `${id}.ts`);
    if (!existsSync(file)) {
      console.log(`\n✗ ${id}: no file definitions/${id}.ts`);
      failed += 1;
      continue;
    }
    const definition = (await import(pathToFileURL(file).href)).default;
    if (!definition || definition.id !== id) {
      errors.push(
        `definitions/${id}.ts must default-export a template with id "${id}"`,
      );
    }

    // The template's own fragment, checked for shape and merged on top.
    const fragmentFile = join(root, "locales", `${id}.json`);
    const fragments = [...LOCALE_FRAGMENTS];
    if (existsSync(fragmentFile)) {
      let fragment: Fragment | null = null;
      try {
        fragment = JSON.parse(readFileSync(fragmentFile, "utf8")) as Fragment;
      } catch (caught) {
        errors.push(`locales/${id}.json is not valid JSON: ${caught}`);
      }
      if (fragment) {
        fragments.push(fragment);
        const locales = Object.keys(fragment);
        for (const locale of text.APP_LOCALES as string[]) {
          if (!locales.includes(locale))
            errors.push(`locales/${id}.json has no "${locale}"`);
        }
        for (const locale of locales) {
          if (!(text.APP_LOCALES as string[]).includes(locale)) {
            errors.push(`locales/${id}.json: unknown locale "${locale}"`);
          }
          for (const top of Object.keys(fragment[locale] ?? {})) {
            if (top !== "catalog" && top !== "content") {
              errors.push(
                `locales/${id}.json (${locale}): only "catalog" and "content" belong here, not "${top}"`,
              );
            }
          }
          for (const [top, tree] of Object.entries(fragment[locale] ?? {})) {
            for (const key of Object.keys(
              (tree as Record<string, unknown>) ?? {},
            )) {
              if (key !== id) {
                errors.push(
                  `locales/${id}.json (${locale}): ${top}.${key} belongs to another template`,
                );
              }
            }
          }
        }
        if (definition && fragment["en-US"]) {
          const used = new Set(textKeysOf(definition) as string[]);
          for (const path of flatten(fragment["en-US"])) {
            if (!used.has(`projectTemplates:${path}`)) {
              warnings.push(
                `unused text projectTemplates:${path} in locales/${id}.json`,
              );
            }
          }
          const english = new Set(flatten(fragment["en-US"]));
          for (const locale of locales) {
            if (locale === "en-US") continue;
            const keys = flatten(fragment[locale]);
            for (const key of keys) {
              if (!english.has(key))
                errors.push(`locales/${id}.json (${locale}): extra key ${key}`);
            }
            const englishTree = fragment["en-US"];
            const sameAsEnglish = keys.filter((key) => {
              const value = (path: string, tree: unknown): unknown =>
                path
                  .split(".")
                  .reduce<unknown>(
                    (node, part) =>
                      node && typeof node === "object"
                        ? (node as Record<string, unknown>)[part]
                        : undefined,
                    tree,
                  );
              const translated = value(key, fragment?.[locale]);
              return (
                typeof translated === "string" &&
                translated.length > 12 &&
                translated === value(key, englishTree)
              );
            });
            for (const key of sameAsEnglish) {
              warnings.push(
                `${locale}: ${key} is identical to en-US (translate it)`,
              );
            }
          }
        }
      }
    }

    if (!registered.has(id)) {
      warnings.push(
        "not registered yet: run `pnpm --filter @margaya/api exec tsx scripts/generate-template-index.ts`",
      );
    }

    if (definition) {
      const source = text.createTextSource(
        text.withFragments(text.i18nTrees(), fragments),
      );
      for (const issue of validateTemplate(definition, source)) {
        const line = `${issue.locale ? `[${issue.locale}] ` : ""}${issue.path}: ${issue.message}`;
        (issue.severity === "error" ? errors : warnings).push(line);
      }
    }

    const unique = (list: string[]) => [...new Set(list)];
    if (errors.length === 0) {
      console.log(
        `\n✓ ${id}: passes in ${(text.APP_LOCALES as string[]).length} locales`,
      );
    } else {
      failed += 1;
      console.log(`\n✗ ${id}: ${unique(errors).length} error(s)`);
      for (const line of unique(errors).slice(0, 200))
        console.log(`  error   ${line}`);
      if (unique(errors).length > 200) console.log("  ... (first 200 shown)");
    }
    for (const line of unique(warnings).slice(0, 50))
      console.log(`  warning ${line}`);
  }
  console.log(`\n${ids.length - failed} of ${ids.length} template(s) passed.`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
