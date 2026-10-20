import { useTranslation } from "react-i18next";
import type { BriefFacts } from "@/fetchers/ai/brief";
import { formatDateMedium } from "@/lib/format";

/**
 * The computed facts a brief was written from, and what changed since the
 * last shared brief. These numbers come from Margaya, never from the model.
 */
export default function BriefFactsSummary({ facts }: { facts: BriefFacts }) {
  const { t } = useTranslation();
  const c = facts.counts;
  const previous = facts.previous;
  const forecast = facts.forecast;
  const p85 = forecast?.status === "ok" ? forecast.p85 : null;
  const risks = facts.risks.reduce((sum, risk) => sum + risk.total, 0);

  const rows: [string, string][] = [
    [
      t("ai:brief.facts.progress"),
      t("ai:brief.facts.progressValue", {
        percent: facts.percent,
        completed: c.completed,
        total: c.total - c.cancelled,
      }),
    ],
    [
      previous
        ? t("ai:brief.facts.sinceLast", {
            date: formatDateMedium(previous.sharedAt),
          })
        : t("ai:brief.facts.sinceDays"),
      t("ai:brief.facts.changes", {
        completed: facts.completed.total,
        added: facts.added.total,
        removed: facts.removed.total,
      }),
    ],
    [
      t("ai:brief.facts.forecast"),
      p85
        ? t("ai:brief.facts.forecastValue", { date: formatDateMedium(p85) })
        : forecast?.status === "complete"
          ? t("ai:brief.facts.forecastDone")
          : t("ai:brief.facts.forecastNone"),
    ],
    [t("ai:brief.facts.risks"), String(risks)],
  ];
  if (previous) {
    rows.push([
      t("ai:brief.facts.diff"),
      [
        t("ai:brief.facts.progressDiff", {
          before: previous.percent,
          now: facts.percent,
        }),
        previous.forecastP85 && p85 && previous.forecastP85 !== p85
          ? t("ai:brief.facts.forecastDiff", {
              before: formatDateMedium(previous.forecastP85),
              now: formatDateMedium(p85),
            })
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    ]);
  }

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
