import type { RpcNotification } from "./protocol";

export type JsonRpcId = number;

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export interface CodexTransport {
  connect(): Promise<void>;
  disconnect(): void;
  request<TResponse>(method: string, params: unknown): Promise<TResponse>;
  notify(method: string, params?: unknown): void;
  onNotification(listener: (notification: RpcNotification) => void): () => void;
  onStatusChange(listener: (status: TransportStatus) => void): () => void;
}

export type TransportStatus = "idle" | "connecting" | "connected" | "disconnected";

export class TransportRequestError extends Error {
  readonly rpcError: JsonRpcError;

  constructor(rpcError: JsonRpcError) {
    super(rpcError.message);
    this.name = "TransportRequestError";
    this.rpcError = rpcError;
  }
}
