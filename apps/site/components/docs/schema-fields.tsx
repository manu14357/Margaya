import { renderInlineMarkdown } from "@/lib/docs/markdown";
import {
  type JsonSchema,
  resolveSchema,
  type SchemaField,
  schemaConstraints,
  schemaFields,
  schemaTypeLabel,
  schemaVariants,
} from "@/lib/docs/openapi";

// Nested objects past this depth are named by type only, which keeps
// self-referencing schemas (filter trees, task parents) finite.
const MAX_DEPTH = 5;

function Description({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div
      className="docs-field-description"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: descriptions come from the committed OpenAPI document, rendered at build time.
      dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(text) }}
    />
  );
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function NestedFields({
  schema,
  depth,
  seen,
}: {
  schema: JsonSchema;
  depth: number;
  seen: Set<string>;
}) {
  if (depth >= MAX_DEPTH) return null;
  const ref = schema.$ref ?? resolveSchema(schema).items?.$ref;
  if (ref && seen.has(ref)) return null;
  const nextSeen = ref ? new Set(seen).add(ref) : seen;

  const fields = schemaFields(schema);
  const variants = fields ? [] : schemaVariants(schema);
  if (!fields && variants.length === 0) return null;

  return (
    <details className="docs-field-children">
      <summary>
        {fields ? "Show child attributes" : `Show ${variants.length} options`}
      </summary>
      {fields ? (
        <FieldList fields={fields} depth={depth + 1} seen={nextSeen} />
      ) : (
        variants.map((variant, index) => (
          <div
            // Variants have no stable identity beyond their order.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={index}
            className="docs-field-variant"
          >
            <p className="docs-field-variant-title">
              Option {index + 1}: <span>{schemaTypeLabel(variant)}</span>
            </p>
            <FieldList
              fields={schemaFields(variant) ?? []}
              depth={depth + 1}
              seen={nextSeen}
            />
          </div>
        ))
      )}
    </details>
  );
}

export function FieldList({
  fields,
  depth = 0,
  seen = new Set<string>(),
}: {
  fields: (SchemaField & { description?: string; location?: string })[];
  depth?: number;
  seen?: Set<string>;
}) {
  return (
    <ul className="docs-fields">
      {fields.map((field) => {
        const target = resolveSchema(field.schema);
        const description =
          field.description ||
          field.schema.description ||
          target.description ||
          "";
        const values = target.enum ?? resolveSchema(target.items ?? {}).enum;
        const constraints = schemaConstraints(field.schema);
        return (
          <li key={field.name} className="docs-field">
            <div className="docs-field-head">
              <code className="docs-field-name">{field.name}</code>
              <span className="docs-field-type">
                {schemaTypeLabel(field.schema)}
              </span>
              {field.location ? (
                <span className="docs-field-meta">{field.location}</span>
              ) : null}
              {field.required ? (
                <span className="docs-field-required">required</span>
              ) : null}
              {target.deprecated ? (
                <span className="docs-field-meta">deprecated</span>
              ) : null}
              {constraints.map((constraint) => (
                <span key={constraint} className="docs-field-meta">
                  {constraint}
                </span>
              ))}
            </div>
            <Description text={description} />
            {values?.length ? (
              <p className="docs-field-values">
                Allowed values:{" "}
                {values.map((value, index) => (
                  <span key={formatValue(value)}>
                    {index > 0 ? ", " : null}
                    <code>{formatValue(value)}</code>
                  </span>
                ))}
              </p>
            ) : null}
            {target.default !== undefined ? (
              <p className="docs-field-values">
                Default: <code>{formatValue(target.default)}</code>
              </p>
            ) : null}
            <NestedFields schema={field.schema} depth={depth} seen={seen} />
          </li>
        );
      })}
    </ul>
  );
}

/** A request or response body: its fields, options, or bare type. */
export function SchemaBody({ schema }: { schema: JsonSchema }) {
  const fields = schemaFields(schema);
  const label = schemaTypeLabel(schema);
  if (fields) {
    const isArray = label.endsWith("[]");
    return (
      <>
        {isArray ? (
          <p className="docs-schema-note">
            An array of <code>{label.slice(0, -2)}</code> objects.
          </p>
        ) : null}
        <FieldList
          fields={fields}
          seen={schema.$ref ? new Set([schema.$ref]) : new Set()}
        />
      </>
    );
  }
  const variants = schemaVariants(schema);
  if (variants.length > 0) {
    return (
      <>
        {variants.map((variant, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: variants are ordered alternatives without ids.
            key={index}
            className="docs-field-variant"
          >
            <p className="docs-field-variant-title">
              Option {index + 1}: <span>{schemaTypeLabel(variant)}</span>
            </p>
            <FieldList fields={schemaFields(variant) ?? []} />
          </div>
        ))}
      </>
    );
  }
  return (
    <p className="docs-schema-note">
      <code>{label}</code>
    </p>
  );
}
