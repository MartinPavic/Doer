import { useState, type FormEvent } from "react";
import { useDoer } from "@doer/core";

const input =
  "w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg outline-none transition " +
  "focus:border-accent focus:ring-4 focus:ring-accent/20";

export function AuthForm() {
  const { auth } = useDoer();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    setBusy(true);
    setError(null);
    const res = signup
      ? await auth.signUp.email({ email, password, name: String(f.get("name")) })
      : await auth.signIn.email({ email, password });
    setBusy(false);
    if (res.error) setError(res.error.message ?? "Something went wrong");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(600px circle at 20% 10%, var(--glow-1), transparent 60%), radial-gradient(500px circle at 85% 90%, var(--glow-2), transparent 60%)",
        }}
      />
      <form
        onSubmit={submit}
        className="relative w-full max-w-sm space-y-4 rounded-3xl border border-line bg-surface/80 p-8 shadow-2xl shadow-black/5 backdrop-blur"
      >
        <div className="mb-5 space-y-4">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-accent text-lg font-bold text-accent-fg">
            ✓
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{signup ? "Create your account" : "Welcome back"}</h1>
            <p className="text-sm text-muted">{signup ? "Start tracking your day with Doer." : "Sign in to continue to Doer."}</p>
          </div>
        </div>

        {signup && <input name="name" placeholder="Name" autoComplete="name" required className={input} />}
        <input name="email" type="email" placeholder="Email" autoComplete="email" required className={input} />
        <input
          name="password"
          type="password"
          placeholder="Password (min. 8 characters)"
          autoComplete={signup ? "new-password" : "current-password"}
          required
          minLength={8}
          className={input}
        />
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        <button
          disabled={busy}
          className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-fg shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
        >
          {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
        </button>
        <p className="text-center text-sm text-muted">
          {signup ? "Already have an account?" : "New to Doer?"}{" "}
          <button
            type="button"
            onClick={() => { setMode(signup ? "signin" : "signup"); setError(null); }}
            className="font-medium text-accent hover:underline"
          >
            {signup ? "Sign in" : "Create an account"}
          </button>
        </p>
      </form>
    </div>
  );
}
