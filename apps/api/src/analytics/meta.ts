import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { estimatePointTable, estimateTable } from "../database/schema";
import type { TaskReadDatabase } from "../task/bounded-read";
import { type QueryContext, textArray } from "../task-query/context";
import { MetaStore } from "../task-query/hydrate";
import { LABEL_NAME_PREFIX } from "../task-query/keys/label";
import {
  type AnalyticsDimension,
  ESTIMATE_KEY_TYPES,
  NONE_KEY,
} from "./dimensions";
import {
  type EstimateKeyMeta,
  type OrderLookup,
  parseEstimateKey,
} from "./order";
import type { AnalyticsMeta } from "./response";
import { projectsMeta } from "./scope";

// Display data for the keys a chart returns, loaded in batches through the
// task query engine's meta store (users are workspace members, never with
// emails; label colors follow the workspace label). At most one statement
// per kind of key, whatever the number of keys.

const metaPoint = alias(estimatePointTable, "analytics_meta_point");
const metaEstimate = alias(estimateTable, "analytics_meta_estimate");

type EstimateType = (typeof ESTIMATE_KEY_TYPES)[number];

function isEstimateType(value: string): value is EstimateType {
  return (ESTIMATE_KEY_TYPES as readonly string[]).includes(value);
}

/**
 * Estimate keys with their lowest position across the scope's active
 * systems (the category order). The key is built by the same SQL as the
 * chart's, so numbers match exactly.
 */
async function loadEstimateKeys(
  tx: TaskReadDatabase,
  context: QueryContext,
  keys: readonly string[],
): Promise<Map<string, EstimateKeyMeta>> {
  const result = new Map<string, EstimateKeyMeta>();
  const projectIds = context.featureProjectIds.estimates;
  if (keys.length === 0 || projectIds.length === 0) return result;
  const { rows } = await tx.execute<{ key: string; position: number }>(sql`
    select key, min(position)::int as position from (
      select ${metaEstimate.type} || ':' || (case
        when ${metaEstimate.type} in ('points', 'time') and ${metaPoint.numericValue} is not null
          then ${metaPoint.numericValue}::text
        else ${metaPoint.value}
      end) as key, ${metaPoint.position} as position
      from ${estimatePointTable} as ${sql.identifier("analytics_meta_point")}
      inner join ${estimateTable} as ${sql.identifier("analytics_meta_estimate")}
        on ${metaEstimate.id} = ${metaPoint.estimateId}
      where ${metaEstimate.projectId} = any(${textArray(projectIds)})
        and ${metaEstimate.isActive}
    ) as estimate_keys
    where key = any(${textArray(keys)})
    group by key`);
  for (const row of rows) {
    const parsed = parseEstimateKey(row.key);
    if (!parsed || !isEstimateType(parsed.type)) continue;
    result.set(row.key, {
      key: row.key,
      type: parsed.type,
      value: parsed.value,
      position: Number(row.position),
    });
  }
  return result;
}

/** What ordering and meta need about the keys of some dimensions. */
export class ChartMeta {
  readonly store: MetaStore;
  estimates = new Map<string, EstimateKeyMeta>();

  constructor(
    private readonly tx: TaskReadDatabase,
    readonly context: QueryContext,
  ) {
    this.store = new MetaStore(tx, context);
  }

  get lookup(): OrderLookup {
    const { store } = this;
    return {
      context: store.context,
      users: store.users,
      cycles: store.cycles,
      modules: store.modules,
      points: store.points,
      estimates: this.estimates,
    };
  }

  /** Loads what the keys of each dimension need (one statement per kind). */
  async load(
    entries: ReadonlyArray<{ dimension: AnalyticsDimension; keys: string[] }>,
  ): Promise<void> {
    const wanted = (kinds: AnalyticsDimension[]) =>
      entries
        .filter((entry) => kinds.includes(entry.dimension))
        .flatMap((entry) => entry.keys.filter((key) => key !== NONE_KEY));
    await this.store.loadUsers(wanted(["assignee", "createdBy"]));
    await this.store.loadCycles(wanted(["cycle"]));
    await this.store.loadModules(wanted(["module"]));
    await this.store.loadLabels(wanted(["label"]), LABEL_NAME_PREFIX);
    const estimateKeys = wanted(["estimate"]);
    if (estimateKeys.length > 0) {
      this.estimates = await loadEstimateKeys(
        this.tx,
        this.context,
        estimateKeys,
      );
    }
  }

  /** Meta for exactly the returned keys of each dimension. */
  build(
    entries: ReadonlyArray<{ dimension: AnalyticsDimension; keys: string[] }>,
  ): AnalyticsMeta {
    const keysOf = (kinds: AnalyticsDimension[]) => [
      ...new Set(
        entries
          .filter((entry) => kinds.includes(entry.dimension))
          .flatMap((entry) => entry.keys),
      ),
    ];
    const { store, context } = this;
    const pick = <T>(keys: string[], map: ReadonlyMap<string, T>) =>
      keys.flatMap((key) => {
        const found = map.get(key);
        return found ? [found] : [];
      });

    const statusKeys = new Set(keysOf(["status"]));
    const columns = (context.projects.length === 1 ? context.projects : [])
      .flatMap((project) => project.columns)
      .filter((column) => statusKeys.has(column.slug))
      .map(({ slug, name, icon, group, position }) => ({
        slug,
        name,
        icon,
        group,
        position,
      }));

    return {
      users: pick(keysOf(["assignee", "createdBy"]), store.users).map(
        ({ id, name, image }) => ({ id, name, image }),
      ),
      projects: projectsMeta(context, keysOf(["project"])),
      columns,
      labels: pick(keysOf(["label"]), store.labels).map(
        ({ key, name, color }) => ({ key, name, color }),
      ),
      cycles: pick(keysOf(["cycle"]), store.cycles).map((cycle) => ({
        id: cycle.id,
        projectId: cycle.projectId,
        name: cycle.name,
        status: cycle.status,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
      })),
      modules: pick(keysOf(["module"]), store.modules).map((found) => ({
        id: found.id,
        projectId: found.projectId,
        name: found.name,
        status: found.status,
      })),
      estimates: pick(keysOf(["estimate"]), this.estimates).map(
        ({ key, type, value }) => ({ key, type, value }),
      ),
      // The context holds exactly the charted fields, of scope projects.
      customFields: [...(context.displayFields ?? [])]
        .map(([id, field]) => ({ id, name: field.name, type: field.type }))
        .sort(
          (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        ),
    };
  }
}
