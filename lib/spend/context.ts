import { AsyncLocalStorage } from "node:async_hooks";

export interface SpendFrame {
  timeoutMs: number;
  maxRetries: number;
  retries: number;
  noteRetry: (count: number) => void;
}

const storage = new AsyncLocalStorage<SpendFrame>();

export function spendFrame(): SpendFrame | null {
  return storage.getStore() ?? null;
}

export function runWithSpend<T>(frame: SpendFrame, fn: () => Promise<T>): Promise<T> {
  return storage.run(frame, fn);
}
