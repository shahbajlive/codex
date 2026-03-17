import type { CodexTransport, JsonRpcError, TransportStatus } from "./transport";
import { TransportRequestError } from "./transport";
import type { JsonRpcId } from "./transport";
import type { RpcNotification } from "./protocol";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type WebSocketLike = {
  addEventListener(type: "open" | "close" | "error" | "message", listener: EventListener): void;
  removeEventListener(type: "open" | "close" | "error" | "message", listener: EventListener): void;
  send(data: string): void;
  close(): void;
};

type MessageEventLike = Event & { data?: string };

type CloseEventLike = Event;

export type WsFactory = (url: string) => WebSocketLike;

export class AppServerWsTransport implements CodexTransport {
  private socket: WebSocketLike | null = null;
  private readonly notifications = new Set<(notification: RpcNotification) => void>();
  private readonly statusListeners = new Set<(status: TransportStatus) => void>();
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextId = 1;
  private status: TransportStatus = "idle";

  constructor(
    private readonly url: string,
    private readonly wsFactory: WsFactory = (socketUrl) => new WebSocket(socketUrl),
  ) {}

  async connect(): Promise<void> {
    if (this.socket) {
      return;
    }

    this.setStatus("connecting");

    await new Promise<void>((resolve, reject) => {
      const socket = this.wsFactory(this.url);
      this.socket = socket;

      const cleanup = () => {
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
      };

      const handleOpen = () => {
        cleanup();
        this.setStatus("connected");
        resolve();
      };

      const handleError = () => {
        cleanup();
        this.socket = null;
        this.setStatus("disconnected");
        reject(new Error(`Failed to connect to ${this.url}`));
      };

      socket.addEventListener("open", handleOpen as EventListener);
      socket.addEventListener("error", handleError as EventListener);
      socket.addEventListener("close", this.handleClose as EventListener);
      socket.addEventListener("message", this.handleMessage as EventListener);
    });
  }

  disconnect(): void {
    if (!this.socket) {
      return;
    }
    this.socket.close();
    this.resetSocket();
  }

  async request<TResponse>(method: string, params: unknown): Promise<TResponse> {
    const socket = this.requireSocket();
    const id = this.nextId++;

    const promise = new Promise<TResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  notify(method: string, params?: unknown): void {
    this.requireSocket().send(JSON.stringify({ method, params }));
  }

  onNotification(listener: (notification: RpcNotification) => void): () => void {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onStatusChange(listener: (status: TransportStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private readonly handleClose = (_event: CloseEventLike) => {
    this.rejectPending(new Error("Connection closed"));
    this.resetSocket();
  };

  private readonly handleMessage = (event: MessageEventLike) => {
    const raw = event.data;
    if (typeof raw !== "string" || raw.length === 0) {
      return;
    }

    const payload = JSON.parse(raw) as {
      id?: JsonRpcId;
      result?: unknown;
      error?: JsonRpcError;
      method?: string;
      params?: unknown;
    };

    if (typeof payload.method === "string") {
      const notification = {
        method: payload.method,
        params: payload.params,
      } satisfies RpcNotification;
      for (const listener of this.notifications) {
        listener(notification);
      }
      return;
    }

    if (typeof payload.id !== "number") {
      return;
    }

    const pending = this.pending.get(payload.id);
    if (!pending) {
      return;
    }

    this.pending.delete(payload.id);

    if (payload.error) {
      pending.reject(new TransportRequestError(payload.error));
      return;
    }

    pending.resolve(payload.result);
  };

  private rejectPending(error: Error) {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private requireSocket(): WebSocketLike {
    if (!this.socket || this.status !== "connected") {
      throw new Error("Transport is not connected");
    }
    return this.socket;
  }

  private resetSocket() {
    if (this.socket) {
      this.socket.removeEventListener("close", this.handleClose as EventListener);
      this.socket.removeEventListener("message", this.handleMessage as EventListener);
    }
    this.socket = null;
    this.setStatus("disconnected");
  }

  private setStatus(status: TransportStatus) {
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}
