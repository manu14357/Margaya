import { FileText, Globe, MessageSquare, SquareCheck } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { type Components } from "react-markdown";
import BarChart from "@/components/charts/bar-chart";
import DonutChart from "@/components/charts/donut-chart";
import LineChart from "@/components/charts/line-chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { AskSource, AskSourceKind } from "@/fetchers/ai/ask";
import {
  CHART_SLOT_COLORS,
  SINGLE_SERIES_COLOR,
} from "@/lib/charts/series-colors";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { type AskBlock, type AskChartSpec, splitAskAnswer } from "./ask-blocks";
import {
  CITE_HREF_PREFIX,
  citationLabel,
  linkCitations,
} from "./ask-citations";

const KIND_ICONS: Record<AskSourceKind, typeof SquareCheck> = {
  task: SquareCheck,
  page: FileText,
  comment: MessageSquare,
  web: Globe,
};

/**
 * An in-app link: plain clicks navigate in place, modified ones open a tab.
 * A web search result always opens in a new tab, without an opener.
 */
export function SourceLink({
  source,
  onOpen,
  className,
  children,
  label,
}: {
  source: AskSource;
  onOpen: (url: string) => void;
  className?: string;
  children: React.ReactNode;
  label?: string;
}) {
  if (source.kind === "web") {
    return (
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={className}
        aria-label={label}
        title={source.title}
      >
        {children}
      </a>
    );
  }
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onOpen(source.url);
  };
  return (
    <a
      href={source.url}
      onClick={open}
      className={className}
      aria-label={label}
      title={source.title}
    >
      {children}
    </a>
  );
}

/** A citation as a small chip: icon plus task key, page title or task. */
export function CitationChip({
  source,
  onOpen,
}: {
  source: AskSource;
  onOpen: (url: string) => void;
}) {
  const { t } = useTranslation();
  const Icon = KIND_ICONS[source.kind];
  const label =
    source.kind === "comment"
      ? t("ai:ask.commentOn", { key: citationLabel(source) })
      : citationLabel(source);
  return (
    <SourceLink
      source={source}
      onOpen={onOpen}
      label={t("ai:ask.openSource", { title: source.title })}
      className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted px-1.5 py-px align-baseline font-medium text-foreground text-xs no-underline! hover:border-ring/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </SourceLink>
  );
}

// Bars lie down when there are many or their labels are long, so the
// labels stay readable in the narrow panel.
const MAX_VERTICAL_BARS = 6;
const MAX_VERTICAL_LABEL_CHARS = 12;

/** A ```chart block from the answer, drawn with the app's own charts. */
export function AskChart({ chart }: { chart: AskChartSpec }) {
  const { t } = useTranslation();
  const ariaLabel = t("ai:ask.chartLabel", { title: chart.title });
  const seriesLabel = chart.unit ?? chart.title;
  const labelOf = (key: string) => chart.data[Number(key)]?.label ?? key;
  let drawing: ReactNode;
  if (chart.type === "donut") {
    const total = chart.data.reduce((sum, point) => sum + point.value, 0);
    drawing = (
      <DonutChart
        size={150}
        ariaLabel={ariaLabel}
        slices={chart.data.map((point, index) => ({
          key: String(index),
          label: point.label,
          value: point.value,
          color: CHART_SLOT_COLORS[index % CHART_SLOT_COLORS.length],
        }))}
        centerLabel={
          <span className="flex flex-col leading-tight">
            <span className="tabular-nums">{formatNumber(total)}</span>
            {chart.unit && (
              <span className="font-normal text-muted-foreground text-xs">
                {chart.unit}
              </span>
            )}
          </span>
        }
      />
    );
  } else if (chart.type === "line") {
    drawing = (
      <LineChart
        height={180}
        ariaLabel={ariaLabel}
        labels={chart.data.map((point) => point.label)}
        showLegend={Boolean(chart.series)}
        series={
          chart.series
            ? chart.series.map((item, index) => ({
                key: String(index),
                label: item.name,
                color: CHART_SLOT_COLORS[index % CHART_SLOT_COLORS.length],
                values: item.values,
              }))
            : [
                {
                  key: "value",
                  label: seriesLabel,
                  color: SINGLE_SERIES_COLOR,
                  values: chart.data.map((point) => point.value),
                },
              ]
        }
      />
    );
  } else if (chart.series) {
    // Several series as bars: one stack per label, a legend per series.
    const series = chart.series;
    drawing = (
      <BarChart
        height={180}
        orientation={
          chart.data.length > MAX_VERTICAL_BARS ? "horizontal" : "vertical"
        }
        ariaLabel={ariaLabel}
        stacked
        showLegend
        data={chart.data.map((point, index) => ({
          key: String(index),
          value: point.value,
          cells: Object.fromEntries(
            series.map((item, seriesIndex) => [
              String(seriesIndex),
              item.values[index] ?? 0,
            ]),
          ),
        }))}
        series={series.map((item, index) => ({
          key: String(index),
          label: item.name,
          color: CHART_SLOT_COLORS[index % CHART_SLOT_COLORS.length],
        }))}
        categoryLabel={(key) => (
          <span className="truncate">{labelOf(key)}</span>
        )}
        tooltipTitle={labelOf}
      />
    );
  } else {
    const horizontal =
      chart.data.length > MAX_VERTICAL_BARS ||
      chart.data.some((point) => point.label.length > MAX_VERTICAL_LABEL_CHARS);
    drawing = (
      <BarChart
        height={180}
        orientation={horizontal ? "horizontal" : "vertical"}
        ariaLabel={ariaLabel}
        showLegend={false}
        data={chart.data.map((point, index) => ({
          key: String(index),
          value: point.value,
        }))}
        series={[
          { key: "value", label: seriesLabel, color: SINGLE_SERIES_COLOR },
        ]}
        categoryLabel={(key) => (
          <span className="truncate">{labelOf(key)}</span>
        )}
        tooltipTitle={labelOf}
      />
    );
  }
  return (
    <figure className="my-2 min-w-0 rounded-lg border bg-card p-3">
      {chart.title && (
        <figcaption className="mb-2 font-medium text-xs">
          {chart.title}
        </figcaption>
      )}
      {drawing}
    </figure>
  );
}

/** A chart still streaming (a skeleton) or one that can't be drawn. */
function ChartPlaceholder({ pending }: { pending: boolean }) {
  const { t } = useTranslation();
  if (pending) {
    return (
      <Skeleton
        role="status"
        aria-label={t("ai:ask.chartLoading")}
        className="my-2 h-40 w-full rounded-lg"
      />
    );
  }
  return (
    <p className="my-2 rounded-md border border-dashed px-3 py-2 text-muted-foreground text-xs">
      {t("ai:ask.chartInvalid")}
    </p>
  );
}

const NUMERIC_CELL = /^[-+]?[\d.,\s]+%?$/;

function AskTable({
  header,
  rows,
  components,
}: {
  header: string[];
  rows: string[][];
  components: Components;
}) {
  // Cells are inline Markdown (bold, links, citation chips); no paragraphs.
  const inline: Components = { ...components, p: ({ children }) => children };
  const cell = (text: string) => (
    <ReactMarkdown components={inline}>{text}</ReactMarkdown>
  );
  return (
    <div className="my-2 max-w-full overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-muted/50">
          <tr>
            {header.map((text, index) => (
              <th
                // biome-ignore lint/suspicious/noArrayIndexKey: columns have no identity
                key={index}
                scope="col"
                className="border-b px-2 py-1.5 text-start font-medium"
              >
                {cell(text)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity
            <tr key={rowIndex} className="border-b last:border-0">
              {row.map((text, index) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns have no identity
                  key={index}
                  className={cn(
                    "px-2 py-1.5 align-top",
                    NUMERIC_CELL.test(text) && "text-end tabular-nums",
                  )}
                >
                  {cell(text)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * An Ask answer: Markdown (raw HTML is never rendered) with known citation
 * tokens drawn as chips that open their task, page or comment, ```chart
 * blocks drawn as interactive charts and pipe tables as tables.
 */
export function AskAnswer({
  text,
  sources,
  onOpen,
  className,
}: {
  text: string;
  sources: ReadonlyMap<string, AskSource>;
  onOpen: (url: string) => void;
  className?: string;
}) {
  const { blocks, cited } = useMemo(() => {
    const cited: AskSource[] = [];
    const link = (piece: string) =>
      linkCitations(piece, sources, cited).markdown;
    const blocks = splitAskAnswer(text).map((block): AskBlock => {
      if (block.kind === "markdown")
        return { ...block, text: link(block.text) };
      if (block.kind === "table") {
        return {
          ...block,
          header: block.header.map(link),
          rows: block.rows.map((row) => row.map(link)),
        };
      }
      return block;
    });
    return { blocks, cited };
  }, [text, sources]);
  const components = useMemo<Components>(
    () => ({
      a: ({ node: _node, href, children, ...props }) => {
        if (href?.startsWith(CITE_HREF_PREFIX)) {
          const source = cited[Number(href.slice(CITE_HREF_PREFIX.length))];
          if (source) return <CitationChip source={source} onOpen={onOpen} />;
          return <span>{children}</span>;
        }
        return (
          <a
            {...props}
            href={href}
            className="underline underline-offset-2"
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {children}
          </a>
        );
      },
    }),
    [cited, onOpen],
  );
  return (
    <div
      className={cn(
        "min-w-0 break-words text-sm leading-relaxed [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:font-semibold [&_h1]:text-base [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:font-semibold [&_h2]:text-sm [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-medium [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:my-1.5 [&_strong]:font-semibold [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:ps-5 [&>*:first-child]:mt-0",
        className,
      )}
    >
      {blocks.map((block, index) => {
        // Blocks keep their order while the answer streams.
        const key = `${block.kind}-${index}`;
        if (block.kind === "chart") {
          return block.chart ? (
            <AskChart key={key} chart={block.chart} />
          ) : (
            <ChartPlaceholder key={key} pending={block.pending} />
          );
        }
        if (block.kind === "table") {
          return (
            <AskTable
              key={key}
              header={block.header}
              rows={block.rows}
              components={components}
            />
          );
        }
        return (
          <ReactMarkdown key={key} components={components}>
            {block.text}
          </ReactMarkdown>
        );
      })}
    </div>
  );
}
