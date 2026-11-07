import "server-only";
import { json, coreMode } from "@/lib/core";
import type { SpendOperation } from "@/lib/spend/catalog";
import { runWithSpend, spendFrame, type SpendFrame } from "@/lib/spend/context";
import {
  findReplay,
  insertEntry,
  jobRef,
  ledgerAvailable,
  newSpendId,
  reserve,
  saveReplay,
  settle,
  type SpendEntry,
} from "@/lib/spend/ledger";
import { providerForMode, quoteCall, readSpendLimits, type SpendBlock } from "@/lib/spend/policy";
import { generationSwitch, idempotencyKey, userMayGenerate } from "./generation-policy";
import { currentUser, isUser, requireUser } from "./http";
import type { PublicUser } from "./types";

export type GenerationTicket = {
  user: PublicUser;
  key: string | null;
  entryId: string;
  requestId: string;
  release: () => void;
};

const inflight = { n: 0 };

function deny(status: number, code: SpendBlock, error: string): Response {
  return json({ error, code }, status);
}

function blankEntry(partial: Pick<SpendEntry, "userId" | "operation" | "provider" | "status"> & Partial<SpendEntry>): SpendEntry {
  const now = new Date().toISOString();
  return {
    id: newSpendId(),
    requestId: partial.requestId ?? `req_${newSpendId()}`,
    attempt: partial.attempt ?? 1,
    jobRef: partial.jobRef ?? null,
    userId: partial.userId,
    operation: partial.operation,
    provider: partial.provider,
    model: partial.model ?? null,
    status: partial.status,
    block: partial.block ?? null,
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    thinkingTokens: null,
    imageCount: null,
    audioSeconds: null,
    videoSeconds: null,
    estimatedMinor: partial.estimatedMinor ?? null,
    reportedMinor: null,
    currency: partial.currency ?? null,
    priceVersion: partial.priceVersion ?? null,
    origin: process.env.ANIMINDLY_SPEND_ORIGIN === "test" ? "test" : "live",
    idempotencyKey: partial.idempotencyKey ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

async function remember(userId: string, key: string | null, status: number, code: string): Promise<void> {
  if (!key) return;
  await saveReplay(userId, key, status, code);
}

/**
 * Authorize a paid call. Returns a ticket only after a reservation.
 * A Response means the provider must not be called.
 */
export async function beginGeneration(req: Request, operation: SpendOperation): Promise<GenerationTicket | Response> {
  if (!(await ledgerAvailable())) return deny(503, "ledger", "Livro de gastos indisponível");
  const limits = readSpendLimits();
  if (!limits.ok) return deny(503, "unavailable", "Geração indisponível");
  const switched = generationSwitch();
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const parsedKey = idempotencyKey(req.headers.get("idempotency-key"));
  if ("error" in parsedKey) return json({ error: "Idempotency-Key inválida" }, 400);
  if (parsedKey.key) {
    const again = await findReplay(actor.id, parsedKey.key);
    if (again) return json({ error: "Pedido já registrado", code: again.code, replay: true }, again.status);
  }
  const requestId = `req_${newSpendId()}`;
  const block = async (status: number, code: SpendBlock, error: string, provider: string) => {
    const entry = blankEntry({
      userId: actor.id,
      operation,
      provider,
      status: "blocked",
      block: code,
      requestId,
      idempotencyKey: parsedKey.key,
    });
    await insertEntry(entry);
    await remember(actor.id, parsedKey.key, status, code);
    return deny(status, code, error);
  };
  if (switched.state !== "on") return block(403, "disabled", "Geração desligada", "none");
  if (!userMayGenerate(actor)) return block(403, "unapproved", "Esta conta ainda não pode gerar", "none");
  const mode = coreMode();
  const named = providerForMode(mode);
  const price = quoteCall(limits.limits, operation, named.provider, named.model);
  if (!price) return block(403, "price_unavailable", "Preço desta chamada não está publicado", named.provider);
  if (limits.limits.concurrency !== null && inflight.n >= limits.limits.concurrency) {
    return block(429, "busy", "Geração ocupada", named.provider);
  }
  const entry = blankEntry({
    userId: actor.id,
    operation,
    provider: price.provider,
    model: price.model,
    status: "reserved",
    requestId,
    estimatedMinor: price.minor,
    currency: price.currency,
    priceVersion: limits.limits.prices.version,
    idempotencyKey: parsedKey.key,
  });
  const held = await reserve({
    entry,
    globalLimit: limits.limits.budgetMinor,
    userLimit: limits.limits.userMinor,
    ratePerMin: limits.limits.ratePerMin,
  });
  if (!held.ok) {
    const status = held.block === "rate" ? 429 : 403;
    const error = held.block === "rate" ? "Limite de chamadas por minuto" : "Orçamento de geração esgotado";
    await insertEntry(blankEntry({
      userId: actor.id,
      operation,
      provider: named.provider,
      model: price.model,
      status: "blocked",
      block: held.block,
      requestId,
      estimatedMinor: null,
      currency: price.currency,
      priceVersion: limits.limits.prices.version,
      idempotencyKey: parsedKey.key,
    }));
    await remember(actor.id, parsedKey.key, status, held.block);
    return deny(status, held.block, error);
  }
  inflight.n += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    inflight.n = Math.max(0, inflight.n - 1);
  };
  return { user: actor, key: parsedKey.key, entryId: entry.id, requestId, release };
}

function usageFrom(text: string): Partial<SpendEntry> {
  try {
    const body = JSON.parse(text) as {
      usage?: { inputTokens?: unknown; outputTokens?: unknown; cachedTokens?: unknown; thinkingTokens?: unknown };
      model?: unknown;
      id?: unknown;
    };
    const usage = body.usage as
      | {
          inputTokens?: unknown;
          outputTokens?: unknown;
          cachedTokens?: unknown;
          thinkingTokens?: unknown;
          imageCount?: unknown;
          audioSeconds?: unknown;
          videoSeconds?: unknown;
        }
      | undefined;
    const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const reported = (body as { reportedMinor?: unknown }).reportedMinor;
    return {
      inputTokens: numberOrNull(usage?.inputTokens),
      outputTokens: numberOrNull(usage?.outputTokens),
      cachedTokens: numberOrNull(usage?.cachedTokens),
      thinkingTokens: numberOrNull(usage?.thinkingTokens),
      imageCount: numberOrNull(usage?.imageCount),
      audioSeconds: numberOrNull(usage?.audioSeconds),
      videoSeconds: numberOrNull(usage?.videoSeconds),
      reportedMinor: typeof reported === "number" && Number.isInteger(reported) && reported >= 0 ? reported : null,
      model: typeof body.model === "string" && /^[A-Za-z0-9._:-]{1,80}$/.test(body.model) ? body.model : undefined,
      jobRef: jobRef(typeof body.id === "string" ? body.id : null),
    };
  } catch {
    return {};
  }
}

export async function finishGeneration(ticket: GenerationTicket, response: Response): Promise<Response> {
  const frame = spendFrame();
  const started = frame?.retries ?? 0;
  try {
    const text = await response.clone().text();
    const usage = usageFrom(text);
    const status = response.status;
    const waive = response.headers.get("x-animind-spend") === "waive";
    const next = waive ? "failed" : status >= 200 && status < 300 ? (status === 202 ? "uncertain" : "succeeded") : status === 504 ? "timeout" : "failed";
    await settle(ticket.entryId, {
      status: next,
      latencyMs: null,
      ...usage,
      block: waive ? "local-fallback" : status === 504 ? "timeout" : started > 0 ? "retry" : null,
    });
    const code = next === "succeeded" || next === "uncertain" ? "accepted" : "failed";
    await remember(ticket.user.id, ticket.key, status, code);
    const headers = new Headers(response.headers);
    headers.delete("x-animind-spend");
    return new Response(text, { status, headers });
  } finally {
    ticket.release();
  }
}

export async function withSpend<T>(ticket: GenerationTicket, fn: () => Promise<T>): Promise<T> {
  const limits = readSpendLimits();
  const frame: SpendFrame = {
    timeoutMs: limits.ok ? limits.limits.timeoutMs : 1,
    maxRetries: limits.ok ? limits.limits.maxRetries : 0,
    retries: 0,
    noteRetry(count) {
      frame.retries = count;
    },
  };
  return runWithSpend(frame, fn);
}

export async function guardedGeneration(req: Request, operation: SpendOperation, perform: () => Promise<Response>): Promise<Response> {
  const gate = await beginGeneration(req, operation);
  if (gate instanceof Response) return gate;
  try {
    const response = await withSpend(gate, perform);
    return await finishGeneration(gate, response);
  } catch {
    await settle(gate.entryId, { status: "timeout", block: "timeout" });
    await remember(gate.user.id, gate.key, 504, "timeout");
    return deny(504, "timeout", "Tempo esgotado");
  } finally {
    gate.release();
  }
}

/** Local catalogs only, unless this caller could open a paid reservation right now. */
export async function generationCallerMayUseCore(): Promise<boolean> {
  if (!(await ledgerAvailable())) return false;
  const limits = readSpendLimits();
  if (!limits.ok) return false;
  if (generationSwitch().state !== "on") return false;
  const user = await currentUser();
  if (!user || !userMayGenerate(user)) return false;
  const named = providerForMode(coreMode());
  return quoteCall(limits.limits, "voice", named.provider, named.model) !== null && quoteCall(limits.limits, "tone", named.provider, named.model) !== null;
}
