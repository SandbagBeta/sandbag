/**
 * Per-stage time and memory (lane guide: log peak usage). These go to the
 * private job row (ADR 003 "Budgets"), never into the public report.
 */
export interface StageMetric {
  stage: string;
  ms: number;
  /** Resident set size after the stage. */
  rssMB: number;
}

export interface QcMetrics {
  stages: StageMetric[];
  totalMs: number;
  /** Process-lifetime peak RSS (an upper bound for this job). */
  peakRssMB: number;
}

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

export class StageTimer {
  private readonly started = performance.now();
  readonly stages: StageMetric[] = [];

  async run<T>(stage: string, fn: () => T | Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.stages.push({
        stage,
        ms: Math.round(performance.now() - t0),
        rssMB: mb(process.memoryUsage.rss()),
      });
    }
  }

  done(): QcMetrics {
    return {
      stages: this.stages,
      totalMs: Math.round(performance.now() - this.started),
      // resourceUsage().maxRSS is in kilobytes.
      peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
    };
  }
}

/** One line per job, e.g. for the worker's log or a debug run. */
export function formatMetrics(m: QcMetrics): string {
  const stages = m.stages.map((s) => `${s.stage} ${s.ms}ms`).join(" · ");
  return `${stages} | total ${m.totalMs}ms, peak RSS ${m.peakRssMB} MB`;
}
