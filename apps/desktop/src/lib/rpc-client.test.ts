import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RpcClient,
  type RpcProcessFactory,
  type RpcProcessHandlers,
  type RpcWritableProcess
} from "./rpc-client";

class FakeProcessFactory implements RpcProcessFactory {
  private handlers: RpcProcessHandlers | undefined;
  private startCount = 0;
  private failNextStart: Error | undefined;
  private failNextWrite: Error | undefined;

  async start(handlers: RpcProcessHandlers): Promise<RpcWritableProcess> {
    this.handlers = handlers;
    this.startCount += 1;
    if (this.failNextStart) {
      const error = this.failNextStart;
      this.failNextStart = undefined;
      throw error;
    }

    return {
      write: async () => {
        if (!this.failNextWrite) return;
        const error = this.failNextWrite;
        this.failNextWrite = undefined;
        throw error;
      }
    };
  }

  async started(expected = 1): Promise<void> {
    await vi.waitFor(() => expect(this.startCount).toBe(expected));
  }

  stdout(chunk: string): void {
    this.handlers?.stdout(chunk);
  }

  close(payload: { code: number | null; signal: number | null }): void {
    this.handlers?.close(payload);
  }

  error(message: string): void {
    this.handlers?.error(message);
  }

  failStartup(message: string): void {
    this.failNextStart = new Error(message);
  }

  failWrite(message: string): void {
    this.failNextWrite = new Error(message);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RpcClient", () => {
  it("keeps an explicitly non-expiring request pending beyond the default timeout", async () => {
    vi.useFakeTimers();
    const factory = new FakeProcessFactory();
    const client = new RpcClient(factory, 50);
    const pending = client.call<string>("sendPrompt", undefined, { timeoutMs: false });
    const settled = vi.fn();
    void pending.then(settled);
    await factory.started();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).not.toHaveBeenCalled();

    factory.stdout('{"id":1,"result":"completed"}\n');
    await expect(pending).resolves.toBe("completed");
  });

  it("rejects invalid agent events and reports an observable protocol failure", async () => {
    const factory = new FakeProcessFactory();
    const client = new RpcClient(factory, 1_000);
    const eventListener = vi.fn();
    const lifecycleListener = vi.fn();
    client.subscribe(eventListener);
    client.subscribeLifecycle(lifecycleListener);
    const pending = client.call("ping");
    await factory.started();

    factory.stdout(
      '{"type":"agent:message_delta","sessionId":"session-1","apiKey":"secret-not-observable"}\n'
    );
    await expect(pending).rejects.toThrow("protocolo RPC inv\u00e1lido");
    expect(eventListener).not.toHaveBeenCalled();
    expect(lifecycleListener).toHaveBeenCalledWith({
      type: "protocol:error",
      message: "El servidor del agente envi\u00f3 una respuesta RPC inv\u00e1lida"
    });
    expect(JSON.stringify(lifecycleListener.mock.calls)).not.toContain("secret-not-observable");
  });

  it("publishes process lifecycle without leaking request parameters", async () => {
    const factory = new FakeProcessFactory();
    const client = new RpcClient(factory, 1_000);
    const lifecycleListener = vi.fn();
    client.subscribeLifecycle(lifecycleListener);
    const pending = client.call("setApiKey", { apiKey: "sk-lifecycle-secret" });
    await factory.started();

    factory.close({ code: 1, signal: null });

    await expect(pending).rejects.toThrow();
    expect(lifecycleListener).toHaveBeenCalledWith({ type: "process:started" });
    expect(lifecycleListener).toHaveBeenCalledWith({
      type: "process:stopped",
      message: "El servidor del agente se cerr\u00f3"
    });
    expect(JSON.stringify(lifecycleListener.mock.calls)).not.toContain("sk-lifecycle-secret");
  });

  it("resolves a response framed across stdout chunks", async () => {
    const factory = new FakeProcessFactory();
    const client = new RpcClient(factory, 1_000);
    const pending = client.call<string>("ping");
    await factory.started();

    factory.stdout('{"id":1,"result":"o');
    factory.stdout('k"}\n');

    await expect(pending).resolves.toBe("ok");
  });

  it("resolves multiple responses received in one stdout chunk", async () => {
    const factory = new FakeProcessFactory();
    const client = new RpcClient(factory, 1_000);
    const first = client.call<string>("first");
    const second = client.call<string>("second");
    await factory.started();

    factory.stdout('{"id":1,"result":"one"}\n{"id":2,"result":"two"}\n');

    await expect(first).resolves.toBe("one");
    await expect(second).resolves.toBe("two");
  });

  it("delivers agent events only while a subscription is active", async () => {
    const factory = new FakeProcessFactory();
    const client = new RpcClient(factory, 1_000);
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    const pending = client.call("ping");
    await factory.started();

    factory.stdout(
      '{"type":"agent:message_delta","sessionId":"session-1","messageId":"msg-1","delta":"hello"}\n'
    );
    unsubscribe();
    factory.stdout(
      '{"type":"agent:message_delta","sessionId":"session-1","messageId":"msg-1","delta":"ignored"}\n'
    );
    factory.stdout('{"id":1,"result":null}\n');

    await expect(pending).resolves.toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "agent:message_delta",
      sessionId: "session-1",
      messageId: "msg-1",
      delta: "hello"
    });
  });

  it("rejects pending requests on process close and restarts on the next call", async () => {
    const factory = new FakeProcessFactory();
    const client = new RpcClient(factory, 1_000);
    const first = client.call("first");
    await factory.started();

    factory.close({ code: 1, signal: null });

    await expect(first).rejects.toThrow("El servidor del agente se cerró");

    const second = client.call<string>("second");
    await factory.started(2);
    factory.stdout('{"id":2,"result":"restarted"}\n');

    await expect(second).resolves.toBe("restarted");
  });

  it("rejects every pending request when the process reports an error", async () => {
    const factory = new FakeProcessFactory();
    const client = new RpcClient(factory, 1_000);
    const first = client.call("first");
    const second = client.call("second");
    await factory.started();

    factory.error("sidecar failed");

    await expect(first).rejects.toThrow("sidecar failed");
    await expect(second).rejects.toThrow("sidecar failed");
  });

  it("times out and removes a request that never receives a response", async () => {
    vi.useFakeTimers();
    const factory = new FakeProcessFactory();
    const client = new RpcClient(factory, 50);
    const pending = client.call("slow");
    await factory.started();
    const timedOut = expect(pending).rejects.toThrow("Tiempo de espera agotado");

    await vi.advanceTimersByTimeAsync(50);

    await timedOut;
    factory.stdout('{"id":1,"result":"late"}\n');

    const next = client.call<string>("next");
    await Promise.resolve();
    factory.stdout('{"id":2,"result":"still-running"}\n');
    await expect(next).resolves.toBe("still-running");
  });

  it.each([
    ["invalid JSON", "not-json\n"],
    ["an envelope without an id", '{"result":"orphan"}\n'],
    ["an unknown response id", '{"id":99,"result":"orphan"}\n']
  ])("stops and rejects a non-expiring mutation after %s", async (_case, line) => {
    const factory = new FakeProcessFactory();
    const client = new RpcClient(factory, 1_000);
    const lifecycleListener = vi.fn();
    client.subscribeLifecycle(lifecycleListener);
    const pending = client.call(
      "saveProviderSettings",
      { apiKey: "secret-not-observable" },
      { timeoutMs: false }
    );
    const rejected = expect(pending).rejects.toThrow("protocolo RPC inv\u00e1lido");
    await factory.started();

    factory.stdout(line);

    await rejected;
    expect(lifecycleListener).toHaveBeenCalledWith({
      type: "protocol:error",
      message: "El servidor del agente envi\u00f3 una respuesta RPC inv\u00e1lida"
    });
    expect(JSON.stringify(lifecycleListener.mock.calls)).not.toContain("secret-not-observable");
  });

  it("treats a duplicate response id as a protocol failure and rejects other pending work", async () => {
    const factory = new FakeProcessFactory();
    const client = new RpcClient(factory, 1_000);
    const first = client.call<string>("first");
    await factory.started();
    factory.stdout('{"id":1,"result":"done"}\n');
    await expect(first).resolves.toBe("done");
    const second = client.call("second", undefined, { timeoutMs: false });
    const rejected = expect(second).rejects.toThrow("protocolo RPC inv\u00e1lido");
    await Promise.resolve();

    factory.stdout('{"id":1,"result":"duplicate"}\n');

    await rejected;
  });

  it("rejects pending requests after a failed write and starts cleanly on the next call", async () => {
    const factory = new FakeProcessFactory();
    factory.failWrite("stdin unavailable");
    const client = new RpcClient(factory, 1_000);
    const failed = client.call("first");
    await factory.started();

    await expect(failed).rejects.toThrow("stdin unavailable");

    const recovered = client.call<string>("second");
    await factory.started(2);
    factory.stdout('{"id":2,"result":"recovered"}\n');

    await expect(recovered).resolves.toBe("recovered");
  });

  it("retries startup after a failed spawn", async () => {
    const factory = new FakeProcessFactory();
    factory.failStartup("spawn denied");
    const client = new RpcClient(factory, 1_000);

    await expect(client.call("first")).rejects.toThrow("spawn denied");

    const recovered = client.call<string>("second");
    await factory.started(2);
    factory.stdout('{"id":1,"result":"recovered"}\n');

    await expect(recovered).resolves.toBe("recovered");
  });
});
