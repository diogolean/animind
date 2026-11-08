import "server-only";
import { json, coreMode } from "@/lib/core";
import type { SpendOperation } from "@/lib/spend/catalog";
import { runWithSpend, spendFrame, type SpendFrame } from "@/lib/spend/context";
import {
  attachUsage,
  bodyHash,
  findReplay,
  insertEntry,
  jobRef,
  ledgerAvailable,
  newSpendId,
  reserve,
  reserveMore,
  saveReplay,
  settle,
  type SpendEntry,
} from "@/lib/spend/ledger";
import { providerForMode, quoteCall, readSpendLimits, requestOverCap, type SpendBlock, type SpendLimits } from "@/lib/spend/policy";
import { generationSwitch, idempotencyKey, userMayGenerate } from "./generation-policy";
import { currentUser, isUser, requireUser } from "./http";
import { rememberOwned } from "./owned";
import type { PublicUser } from "./types";
import { readModel, readProvider, readReportedMinor, readToken } from "../spend/usage-report";

export type GenerationTicket = {
  user: PublicUser;
  key: string | null;
  entryId: string;
  requestId: string;
  bodyHash: string;
  limits: SpendLimits;
  priceMinor: number;
  release: () => void;
};

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
    latencyMs: partial.latencyMs ?? null,
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

async function remember(userId: string, key: string | null, status: number, code: string, hash: string): Promise<void> {
  if (!key) return;
  await saveReplay(userId, key, status, code, hash);
}

/**
 * Authorize a paid call. Returns a ticket only after a reservation.
 * A Response means the provider must not be called.
 */
export async function beginGeneration(req: Request, operation: SpendOperation, hash = ""): Promise<GenerationTicket | Response> {
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
    if (again) {
      if (again.bodyHash !== hash) return json({ error: "Idempotency-Key already used for a different request", code: "idempotency_conflict" }, 409);
      return json({ error: "Pedido já registrado", code: again.code, replay: true }, again.status);
    }
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
    await remember(actor.id, parsedKey.key, status, code, hash);
    return deny(status, code, error);
  };
  if (switched.state !== "on") return block(403, "disabled", "Geração desligada", "none");
  if (!userMayGenerate(actor)) return block(403, "unapproved", "Esta conta ainda não pode gerar", "none");
  const mode = coreMode();
  const named = providerForMode(mode);
  const price = quoteCall(limits.limits, operation, named.provider, named.model);
  if (!price) return block(403, "price_unavailable", "Preço desta chamada não está publicado", named.provider);
  let asked: unknown = null;
  if (hash) {
    try {
      asked = JSON.parse(await req.clone().text());
    } catch {
      asked = null;
    }
  }
  if (requestOverCap(asked, limits.limits)) return block(400, "over_cap", "Pedido acima do limite configurado", named.provider);
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
    concurrency: limits.limits.concurrency,
  });
  if (!held.ok) {
    const status = held.block === "budget" ? 403 : 429;
    const error = held.block === "rate" ? "Limite de chamadas por minuto" : held.block === "busy" ? "Geração ocupada" : "Orçamento de geração esgotado";
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
    await remember(actor.id, parsedKey.key, status, held.block, hash);
    return deny(status, held.block, error);
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
  };
  return {
    user: actor,
    key: parsedKey.key,
    entryId: entry.id,
    requestId,
    bodyHash: hash,
    limits: limits.limits,
    priceMinor: price.minor,
    release,
  };
}

function usageFrom(text: string): Partial<SpendEntry> {
  try {
    const body = JSON.parse(text) as {
      usage?: {
        inputTokens?: unknown;
        outputTokens?: unknown;
        cachedTokens?: unknown;
        thinkingTokens?: unknown;
        imageCount?: unknown;
        audioSeconds?: unknown;
        videoSeconds?: unknown;
      };
      model?: unknown;
      provider?: unknown;
      reportedMinor?: unknown;
      id?: unknown;
    };
    const usage = body.usage;
    const provider = readProvider(body.provider);
    const model = readModel(body.model);
    return {
      inputTokens: readToken(usage?.inputTokens),
      outputTokens: readToken(usage?.outputTokens),
      cachedTokens: readToken(usage?.cachedTokens),
      thinkingTokens: readToken(usage?.thinkingTokens),
      imageCount: readToken(usage?.imageCount),
      audioSeconds: readToken(usage?.audioSeconds),
      videoSeconds: readToken(usage?.videoSeconds),
      reportedMinor: readReportedMinor(body.reportedMinor),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
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
    for (const key of Object.keys(usage) as (keyof typeof usage)[]) {
      if (usage[key] === undefined) delete usage[key];
    }
    const status = response.status;
    if (status >= 200 && status < 300) {
      try {
        await rememberOwned(ticket.user.id, text);
      } catch {
        // A failed record leaves the id unbound, so a later read is 404. The provider response still settles.
      }
    }
    const waive = response.headers.get("x-animind-spend") === "waive";
    const over = usageOverCap(usage, ticket.limits);
    const next = waive ? "failed" : status === 504 || status === 202 ? "uncertain" : status >= 200 && status < 300 ? "succeeded" : "failed";
    await settle(ticket.entryId, {
      status: next,
      latencyMs: null,
      ...usage,
      block: waive ? "local-fallback" : status === 504 ? "timeout" : over ? "over_cap" : started > 0 ? "retry" : null,
    });
    const code = next === "succeeded" || next === "uncertain" ? "accepted" : "failed";
    await remember(ticket.user.id, ticket.key, status, code, ticket.bodyHash);
    const headers = new Headers(response.headers);
    headers.delete("x-animind-spend");
    return new Response(text, { status, headers });
  } finally {
    ticket.release();
  }
}

export async function withSpend<T>(ticket: GenerationTicket, fn: () => Promise<T>): Promise<T> {
  const limits = ticket.limits;
  const frame: SpendFrame = {
    timeoutMs: limits.timeoutMs,
    maxRetries: limits.maxRetries,
    retries: 0,
    userId: ticket.user.id,
    requestId: ticket.requestId,
    noteRetry(count) {
      frame.retries = count;
    },
    async allowRetry() {
      const more = await reserveMore(ticket.entryId, ticket.priceMinor, limits.budgetMinor, limits.userMinor, limits.ratePerMin);
      return more.ok;
    },
  };
  return runWithSpend(frame, fn);
}

export async function guardedGeneration(req: Request, operation: SpendOperation, perform: () => Promise<Response>): Promise<Response> {
  const hash = bodyHash(await req.clone().text().catch(() => ""));
  const gate = await beginGeneration(req, operation, hash);
  if (gate instanceof Response) return gate;
  try {
    const response = await withSpend(gate, perform);
    return await finishGeneration(gate, response);
  } catch {
    await settle(gate.entryId, { status: "uncertain", block: "timeout" });
    await remember(gate.user.id, gate.key, 504, "timeout", gate.bodyHash);
    return deny(504, "timeout", "Tempo esgotado");
  } finally {
    gate.release();
  }
}

/**
 * Auth-only read. No reservation, no retry, no invented tokens.
 * A job payload can fill a missing usage report once.
 */
export async function guardedRead(req: Request, operation: "job" | "file", perform: (actor: PublicUser) => Promise<Response>): Promise<Response> {
  const actor = await requireUser();
  if (!isUser(actor)) return actor;
  const started = Date.now();
  const response = await perform(actor);
  if (operation === "job") {
    try {
      const body = JSON.parse(await response.clone().text()) as {
        id?: unknown;
        usage?: Record<string, unknown>;
        reportedMinor?: unknown;
        model?: unknown;
        provider?: unknown;
      };
      const ref = jobRef(typeof body.id === "string" ? body.id : null);
      if (ref) {
        const provider = readProvider(body.provider);
        const model = readModel(body.model);
        await attachUsage(ref, {
          inputTokens: readToken(body.usage?.inputTokens),
          outputTokens: readToken(body.usage?.outputTokens),
          cachedTokens: readToken(body.usage?.cachedTokens),
          thinkingTokens: readToken(body.usage?.thinkingTokens),
          imageCount: readToken(body.usage?.imageCount),
          audioSeconds: readToken(body.usage?.audioSeconds),
          videoSeconds: readToken(body.usage?.videoSeconds),
          reportedMinor: readReportedMinor(body.reportedMinor),
          ...(provider ? { provider } : {}),
          ...(model ? { model } : {}),
        });
      }
    } catch {
      // A non-JSON job body is still a read. Nothing is billed.
    }
  }
  if (await ledgerAvailable()) {
    await insertEntry(blankEntry({
      userId: actor.id,
      operation,
      provider: "none",
      status: "read" as SpendEntry["status"],
      block: "unbilled",
      latencyMs: Date.now() - started,
      estimatedMinor: null,
      reportedMinor: null,
    }));
  }
  return response;
}

function usageOverCap(usage: Partial<SpendEntry>, limits: SpendLimits): boolean {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const thinking = usage.thinkingTokens ?? 0;
  if (usage.inputTokens !== null && usage.inputTokens !== undefined && input > limits.maxInputTokens) return true;
  if (usage.outputTokens !== null && usage.outputTokens !== undefined && output > limits.maxOutputTokens) return true;
  if ((usage.inputTokens !== null || usage.outputTokens !== null) && input + output + thinking > limits.maxTotalTokens) return true;
  if (usage.imageCount !== null && usage.imageCount !== undefined && usage.imageCount > limits.maxImages) return true;
  if (usage.audioSeconds !== null && usage.audioSeconds !== undefined && usage.audioSeconds > limits.maxAudioSeconds) return true;
  if (usage.videoSeconds !== null && usage.videoSeconds !== undefined && usage.videoSeconds > limits.maxVideoSeconds) return true;
  return false;
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
