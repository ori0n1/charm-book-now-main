import { AsyncLocalStorage } from 'node:async_hooks';

type RequestContext = { waitUntil?: (promise: Promise<unknown>) => void };
const requestContext = new AsyncLocalStorage<RequestContext>();

export function withRequestBackground<T>(context: unknown, run: () => Promise<T>): Promise<T> {
  return requestContext.run((context ?? {}) as RequestContext, run);
}

export function deferRequestBackground(promise: Promise<unknown>): boolean {
  const context = requestContext.getStore();
  if (!context?.waitUntil) return false;
  context.waitUntil(promise);
  return true;
}
