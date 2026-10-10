import {
  type Cell,
  type Comparison,
  cellMark,
  cellNote,
  compareAreas,
  compareFeatures,
  type FeatureKey,
} from "@/lib/comparisons";
import { cn } from "@/lib/utils";
import { MarkIcon } from "./mark";

const featureKeys = Object.keys(compareFeatures) as FeatureKey[];

const groups = compareAreas.map((area) => ({
  ...area,
  keys: featureKeys.filter((key) => compareFeatures[key].area === area.id),
}));

function CellBody({ cell, strong }: { cell: Cell; strong?: boolean }) {
  const note = cellNote(cell);
  return (
    <div className="flex items-start gap-2.5">
      <MarkIcon mark={cellMark(cell)} className="mt-px" />
      {note ? (
        <span
          className={cn(
            "text-sm leading-snug",
            strong ? "text-foreground/85" : "text-muted-foreground",
          )}
        >
          {note}
        </span>
      ) : null}
    </div>
  );
}

export function CompareLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-muted-foreground">
      {(["yes", "partial", "no"] as const).map((mark) => (
        <li key={mark}>
          <MarkIcon mark={mark} showLabel />
        </li>
      ))}
    </ul>
  );
}

/**
 * The full comparison as a real table from `md` up, and as stacked cards on
 * small screens. Only one of the two is displayed at a time, and `display:
 * none` keeps the hidden one out of the accessibility tree.
 */
export function CompareTable({ data }: { data: Comparison }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border md:block">
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">
            Feature comparison of Margaya and {data.competitor}
          </caption>
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[33%]" />
            <col className="w-[33%]" />
          </colgroup>
          <thead>
            <tr className="border-border border-b">
              <th scope="col" className="px-5 py-4 font-medium text-sm">
                <span className="sr-only">Feature</span>
              </th>
              <th
                scope="col"
                className="bg-sidebar px-5 py-4 font-medium text-sm"
              >
                Margaya
              </th>
              <th
                scope="col"
                className="px-5 py-4 font-medium text-muted-foreground text-sm"
              >
                {data.competitor}
              </th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.id}>
              <tr className="border-border border-b bg-muted/40">
                <th
                  scope="colgroup"
                  colSpan={3}
                  className="px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide"
                >
                  {group.title}
                </th>
              </tr>
              {group.keys.map((key) => (
                <tr
                  key={key}
                  className="border-border/60 border-b last:border-border"
                >
                  <th
                    scope="row"
                    className="px-5 py-3.5 align-top font-normal text-foreground/90 text-sm"
                  >
                    {compareFeatures[key].label}
                  </th>
                  <td className="bg-sidebar px-5 py-3.5 align-top">
                    <CellBody cell={compareFeatures[key].margaya} strong />
                  </td>
                  <td className="px-5 py-3.5 align-top">
                    <CellBody cell={data.them[key]} />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <div className="space-y-8 md:hidden">
        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`compare-m-${group.id}`}>
            <h3
              id={`compare-m-${group.id}`}
              className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
            >
              {group.title}
            </h3>
            <ul className="mt-3 space-y-2.5">
              {group.keys.map((key) => (
                <li
                  key={key}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <p className="font-medium text-sm">
                    {compareFeatures[key].label}
                  </p>
                  <dl className="mt-2.5 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-sidebar p-2.5">
                      <dt className="mb-1.5 font-medium text-xs">Margaya</dt>
                      <dd>
                        <CellBody cell={compareFeatures[key].margaya} strong />
                      </dd>
                    </div>
                    <div className="p-2.5">
                      <dt className="mb-1.5 font-medium text-muted-foreground text-xs">
                        {data.competitor}
                      </dt>
                      <dd>
                        <CellBody cell={data.them[key]} />
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
