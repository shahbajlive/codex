import { describe, expect, it } from "vitest";
import { AppServerWsTransport } from "./app-server-ws-transport";

class FakeSocket {
  sent: string[] = [];
  listeners = new Map<string, EventListener[]>();

  addEventListener(type: string, listener: EventListener) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: EventListener) {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      existing.filter((entry) => entry !== listener),
    );
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.emit("close", new Event("close"));
  }

  emit(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("AppServerWsTransport", () => {
  it("correlates requests to responses", async () => {
    const socket = new FakeSocket();
    const transport = new AppServerWsTransport("ws://example.test", () => socket);
    const connected = transport.connect();
    socket.emit("open", new Event("open"));
    await connected;

    const responsePromise = transport.request<{ ok: boolean }>("thread/list", {});
    expect(JSON.parse(socket.sent[0])).toMatchObject({ method: "thread/list", id: 1 });

    socket.emit(
      "message",
      Object.assign(new Event("message"), {
        data: JSON.stringify({ id: 1, result: { ok: true } }),
      }),
    );

    await expect(responsePromise).resolves.toEqual({ ok: true });
  });

  it("routes notifications to listeners", async () => {
    const socket = new FakeSocket();
    const transport = new AppServerWsTransport("ws://example.test", () => socket);
    const connected = transport.connect();
    socket.emit("open", new Event("open"));
    await connected;

    const seen: string[] = [];
    transport.onNotification((notification) => {
      seen.push(notification.method);
    });

    socket.emit(
      "message",
      Object.assign(new Event("message"), {
        data: JSON.stringify({ method: "turn/completed", params: { threadId: "thr_1" } }),
      }),
    );

    expect(seen).toEqual(["turn/completed"]);
  });

  it("rejects pending requests when the socket closes", async () => {
    const socket = new FakeSocket();
    const transport = new AppServerWsTransport("ws://example.test", () => socket);
    const connected = transport.connect();
    socket.emit("open", new Event("open"));
    await connected;

    const responsePromise = transport.request("thread/read", {});
    socket.emit("close", new Event("close"));

    await expect(responsePromise).rejects.toThrow("Connection closed");
  });
});
