import { useState, type FormEvent } from "react";
import { useDoer } from "@doer/core";

export function AuthForm() {
  const { auth } = useDoer();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    setBusy(true);
    setError(null);
    const res =
      mode === "signin"
        ? await auth.signIn.email({ email, password })
        : await auth.signUp.email({ email, password, name: String(f.get("name")) });
    setBusy(false);
    if (res.error) setError(res.error.message ?? "Something went wrong");
  }

  const input = "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3">
        <h1 className="text-2xl font-semibold">Doer</h1>
        {mode === "signup" && <input name="name" placeholder="Name" required className={input} />}
        <input name="email" type="email" placeholder="Email" required className={input} />
        <input name="password" type="password" placeholder="Password" required minLength={8} className={input} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="w-full rounded-md bg-neutral-900 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">
          {mode === "signin" ? "Sign in" : "Create account"}
        </button>
        <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-sm text-neutral-500 underline">
          {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
