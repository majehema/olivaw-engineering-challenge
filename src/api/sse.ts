import type { ServerResponse } from "node:http";

/** The part of an HTTP response an SSE connection writes to. */
export type SseSink = Pick<ServerResponse, "write" | "end" | "writableLength">;

// Writes the Server-Sent Events wire format:
// https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
export class SseConnection {
  private readonly sink: SseSink;
  private readonly maxBufferedBytes: number;
  private readonly onClose: () => void;
  private closed = false;

  constructor(sink: SseSink, maxBufferedBytes: number, onClose: () => void) {
    this.sink = sink;
    this.maxBufferedBytes = maxBufferedBytes;
    this.onClose = onClose;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // JSON.stringify escapes newlines, so the payload always fits on one `data:` line.
  send(event: string, data: unknown): void {
    this.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** Comment line: ignored by clients, keeps proxies from closing an idle connection. */
  comment(text: string): void {
    this.write(`: ${text}\n\n`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.sink.end();
    this.onClose();
  }

  private write(chunk: string): void {
    if (this.closed) return;
    this.sink.write(chunk);
    // A client that stops reading makes the buffer grow without limit. Drop it:
    // EventSource reconnects on its own and receives a fresh snapshot.
    if (this.sink.writableLength > this.maxBufferedBytes) this.close();
  }
}
