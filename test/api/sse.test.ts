import { describe, expect, it, vi } from "vitest";
import { SseConnection, type SseSink } from "../../src/api/sse.ts";

/** A fake response that records what was written and lets the test set how much is still buffered. */
function fakeSink() {
  const sink = {
    chunks: [] as string[],
    writableLength: 0,
    ended: false,
    write(chunk: string) {
      sink.chunks.push(chunk);
      return true;
    },
    end() {
      sink.ended = true;
    },
  };
  return sink;
}

const connect = (sink: ReturnType<typeof fakeSink>, onClose = vi.fn()) =>
  new SseConnection(sink as unknown as SseSink, 100, onClose);

describe("SseConnection", () => {
  it("writes events in the Server-Sent Events format", () => {
    const sink = fakeSink();

    connect(sink).send("robot.updated", { robotId: "r1", note: "line one\nline two" });

    expect(sink.chunks).toEqual(['event: robot.updated\ndata: {"robotId":"r1","note":"line one\\nline two"}\n\n']);
  });

  it("writes comments for heartbeats", () => {
    const sink = fakeSink();

    connect(sink).comment("heartbeat");

    expect(sink.chunks).toEqual([": heartbeat\n\n"]);
  });

  it("closes a client that stops reading once too much is buffered", () => {
    const sink = fakeSink();
    const onClose = vi.fn();
    const connection = connect(sink, onClose);

    sink.writableLength = 101;
    connection.send("robot.updated", {});
    connection.send("robot.updated", {});

    expect(connection.isClosed).toBe(true);
    expect(sink.ended).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(sink.chunks).toHaveLength(1);
  });

  it("runs the close callback only once", () => {
    const onClose = vi.fn();
    const connection = connect(fakeSink(), onClose);

    connection.close();
    connection.close();

    expect(onClose).toHaveBeenCalledOnce();
  });
});
