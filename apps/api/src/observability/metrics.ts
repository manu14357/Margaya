// A small in-process metrics registry that renders the Prometheus text
// exposition format (version 0.0.4), which Prometheus and OpenMetrics
// scrapers read. It covers the three types the API needs, so
// no client library is required.
//
// Labels must come from bounded sets (route templates, job names, status
// codes). Never label by user, workspace, task or any other id.

type Labels = Record<string, string>;

const NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function escapeHelp(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

function labelKey(labelNames: readonly string[], labels: Labels): string {
  return labelNames.map((name) => labels[name] ?? "").join("\u0000");
}

function renderLabels(
  labelNames: readonly string[],
  values: readonly string[],
  extra?: [string, string],
): string {
  const pairs = labelNames.map(
    (name, index) => `${name}="${escapeLabelValue(values[index] ?? "")}"`,
  );
  if (extra) pairs.push(`${extra[0]}="${escapeLabelValue(extra[1])}"`);
  return pairs.length > 0 ? `{${pairs.join(",")}}` : "";
}

function formatNumber(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Inf";
  if (value === Number.NEGATIVE_INFINITY) return "-Inf";
  return String(value);
}

// One family can't grow without bound even if a caller passes a bad label.
const MAX_SERIES_PER_METRIC = 2_000;

type Metric = {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram";
  render(): string[];
};

abstract class LabelledMetric<T> implements Metric {
  abstract type: Metric["type"];
  protected series = new Map<string, { values: string[]; data: T }>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[] = [],
  ) {
    if (!NAME.test(name)) throw new Error(`Invalid metric name: ${name}`);
  }

  protected entry(labels: Labels, create: () => T): T | null {
    const key = labelKey(this.labelNames, labels);
    const existing = this.series.get(key);
    if (existing) return existing.data;
    if (this.series.size >= MAX_SERIES_PER_METRIC) return null;
    const data = create();
    this.series.set(key, {
      values: this.labelNames.map((name) => labels[name] ?? ""),
      data,
    });
    return data;
  }

  reset(): void {
    this.series.clear();
  }

  abstract render(): string[];
}

export class Counter extends LabelledMetric<{ value: number }> {
  type = "counter" as const;

  inc(labels: Labels = {}, amount = 1): void {
    if (!(amount >= 0) || !Number.isFinite(amount)) return;
    const data = this.entry(labels, () => ({ value: 0 }));
    if (data) data.value += amount;
  }

  /** For totals the runtime keeps itself, such as CPU seconds. */
  setTotal(labels: Labels, value: number): void {
    if (!(value >= 0) || !Number.isFinite(value)) return;
    const data = this.entry(labels, () => ({ value: 0 }));
    if (data) data.value = value;
  }

  get(labels: Labels = {}): number {
    return this.series.get(labelKey(this.labelNames, labels))?.data.value ?? 0;
  }

  render(): string[] {
    return [...this.series.values()].map(
      ({ values, data }) =>
        `${this.name}${renderLabels(this.labelNames, values)} ${formatNumber(data.value)}`,
    );
  }
}

export class Gauge extends LabelledMetric<{ value: number }> {
  type = "gauge" as const;

  set(labels: Labels, value: number): void {
    const data = this.entry(labels, () => ({ value: 0 }));
    if (data) data.value = value;
  }

  get(labels: Labels = {}): number | undefined {
    return this.series.get(labelKey(this.labelNames, labels))?.data.value;
  }

  render(): string[] {
    return [...this.series.values()].map(
      ({ values, data }) =>
        `${this.name}${renderLabels(this.labelNames, values)} ${formatNumber(data.value)}`,
    );
  }
}

type HistogramData = { buckets: number[]; sum: number; count: number };

export class Histogram extends LabelledMetric<HistogramData> {
  type = "histogram" as const;

  constructor(
    name: string,
    help: string,
    labelNames: readonly string[],
    readonly bounds: readonly number[],
  ) {
    super(name, help, labelNames);
  }

  observe(labels: Labels, value: number): void {
    if (!Number.isFinite(value)) return;
    const data = this.entry(labels, () => ({
      buckets: this.bounds.map(() => 0),
      sum: 0,
      count: 0,
    }));
    if (!data) return;
    data.sum += value;
    data.count += 1;
    for (let index = 0; index < this.bounds.length; index += 1) {
      if (value <= (this.bounds[index] ?? 0)) {
        data.buckets[index] = (data.buckets[index] ?? 0) + 1;
      }
    }
  }

  get(labels: Labels = {}): HistogramData | undefined {
    return this.series.get(labelKey(this.labelNames, labels))?.data;
  }

  render(): string[] {
    const lines: string[] = [];
    for (const { values, data } of this.series.values()) {
      this.bounds.forEach((bound, index) => {
        lines.push(
          `${this.name}_bucket${renderLabels(this.labelNames, values, ["le", formatNumber(bound)])} ${data.buckets[index]}`,
        );
      });
      lines.push(
        `${this.name}_bucket${renderLabels(this.labelNames, values, ["le", "+Inf"])} ${data.count}`,
      );
      lines.push(
        `${this.name}_sum${renderLabels(this.labelNames, values)} ${formatNumber(data.sum)}`,
      );
      lines.push(
        `${this.name}_count${renderLabels(this.labelNames, values)} ${data.count}`,
      );
    }
    return lines;
  }
}

/** Values read at scrape time (pool sizes, queue backlogs, process stats). */
export type Collector = () => Promise<void> | void;

export class Registry {
  private metrics = new Map<string, Metric>();
  private collectors: Collector[] = [];

  register<T extends Metric>(metric: T): T {
    const existing = this.metrics.get(metric.name);
    if (existing) return existing as T;
    this.metrics.set(metric.name, metric);
    return metric;
  }

  counter(name: string, help: string, labelNames: readonly string[] = []) {
    return this.register(new Counter(name, help, labelNames));
  }

  gauge(name: string, help: string, labelNames: readonly string[] = []) {
    return this.register(new Gauge(name, help, labelNames));
  }

  histogram(
    name: string,
    help: string,
    labelNames: readonly string[],
    bounds: readonly number[],
  ) {
    return this.register(new Histogram(name, help, labelNames, bounds));
  }

  addCollector(collector: Collector): void {
    this.collectors.push(collector);
  }

  /** Runs every collector, then renders the whole registry. */
  async render(): Promise<string> {
    await Promise.allSettled(
      this.collectors.map(async (collect) => {
        try {
          await collect();
        } catch (error) {
          console.error(
            "Metrics collector failed:",
            error instanceof Error ? error.message : error,
          );
        }
      }),
    );
    const lines: string[] = [];
    for (const metric of this.metrics.values()) {
      const samples = metric.render();
      if (samples.length === 0) continue;
      lines.push(`# HELP ${metric.name} ${escapeHelp(metric.help)}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      lines.push(...samples);
    }
    return `${lines.join("\n")}\n`;
  }
}

export const PROMETHEUS_CONTENT_TYPE =
  "text/plain; version=0.0.4; charset=utf-8";
