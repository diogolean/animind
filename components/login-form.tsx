"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

function nextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/characters";
  return value;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível entrar");
      router.push(nextPath(params.get("next")));
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-16">
      <form onSubmit={submit} className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/20 sm:p-8">
        <h1 className="text-2xl font-medium tracking-tight">Entrar</h1>
        <p className="mt-2 text-sm text-muted-foreground">A biblioteca de personagens fica na sua conta.</p>
        <label className="mt-8 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground" htmlFor="login-email">
          E-mail
        </label>
        <input
          id="login-email"
          data-testid="login-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-white/30"
        />
        <label className="mt-5 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground" htmlFor="login-password">
          Senha
        </label>
        <input
          id="login-password"
          data-testid="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-white/30"
        />
        {error ? (
          <p data-testid="login-error" className="mt-4 text-sm text-red-400">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          data-testid="login-submit"
          disabled={pending}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-medium text-black disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Entrar
        </button>
      </form>
    </div>
  );
}
