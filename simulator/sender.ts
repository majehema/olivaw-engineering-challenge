import type { IngestSummary } from "../src/application/ingestion-service.ts";
import type { TelemetryInput } from "../src/domain/telemetry.ts";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type SenderOptions = {
  serverUrl: string;
  /** Oldest batches are dropped beyond this, so a long outage cannot exhaust memory. */
  maxPendingBatches: number;
  timeoutMs?: number;
  fetch?: Fetch;
  log: (line: string) => void;
};

export type SenderStats = {
  accepted: number;
  late: number;
  duplicates: number;
  rejected: number;
  failedRequests: number;
  droppedBatches: number;
};

// At-least-once delivery: a batch stays queued until the server confirms it,
// and is retried in order on the next flush. This is safe because the server's
// ingestion is idempotent.
export class Sender {
  readonly stats: SenderStats = { accepted: 0, late: 0, duplicates: 0, rejected: 0, failedRequests: 0, droppedBatches: 0 };
  private readonly options: Required<SenderOptions>;
  private readonly pending: TelemetryInput[][] = [];
  private flushing = false;
  private reachable = true;

  constructor({ timeoutMs = 5_000, fetch: fetchFn = fetch, ...options }: SenderOptions) {
    this.options = { timeoutMs, fetch: fetchFn, ...options };
  }

  get pendingBatches(): number {
    return this.pending.length;
  }

  enqueue(batches: readonly TelemetryInput[][]): void {
    this.pending.push(...batches);
    while (this.pending.length > this.options.maxPendingBatches) {
      this.pending.shift();
      this.stats.droppedBatches++;
    }
  }

  /** Sends pending batches in order and stops at the first failure. Never runs twice at once. */
  async flush(): Promise<void> {
    // Ticks keep coming while a slow request is in flight; overlapping flushes would send batches twice.
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (let batch = this.pending[0]; batch !== undefined; batch = this.pending[0]) {
        if (!(await this.post(batch))) return;
        this.pending.shift();
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Returns false when the batch should be retried later. */
  private async post(batch: TelemetryInput[]): Promise<boolean> {
    const { serverUrl, timeoutMs, fetch: fetchFn, log } = this.options;
    let response: Response;
    try {
      response = await fetchFn(`${serverUrl}/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return this.failed(`server unreachable (${(error as Error).message})`);
    }

    if (response.ok) {
      const summary = (await response.json()) as IngestSummary;
      this.stats.accepted += summary.accepted;
      this.stats.late += summary.late;
      this.stats.duplicates += summary.duplicates;
      this.stats.rejected += summary.rejected.length;
      if (!this.reachable) log(`server reachable again, sending ${this.pending.length} queued batches`);
      this.reachable = true;
      return true;
    }
    // A 4xx means the batch itself is wrong: retrying it would fail forever.
    if (response.status < 500) {
      log(`dropping batch rejected with ${response.status}: ${await response.text()}`);
      this.stats.droppedBatches++;
      return true;
    }
    return this.failed(`server error ${response.status}`);
  }

  private failed(reason: string): false {
    this.stats.failedRequests++;
    // Log the transition only, not every failed tick.
    if (this.reachable) this.options.log(`${reason}; queueing batches and retrying`);
    this.reachable = false;
    return false;
  }
}
