import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useState } from "react";
import type { Entitlement } from "./billing";

export type EntitlementState = Entitlement & {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  token: string | null;
};

const TOKEN_KEY = "maddflight-unlock-token";

export async function api<T>(
  path: string,
  token: string | null,
  init?: RequestInit & { debugSecret?: string },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.debugSecret) headers.set("X-Maddflight-Debug", init.debugSecret);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function useEntitlement() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [state, setState] = useState<EntitlementState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isLoaded || !isSignedIn) {
      setState(null);
      return null;
    }
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const data = await api<EntitlementState>("/api/entitlement", token);
      setState(data);
      try {
        if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
        else localStorage.removeItem(TOKEN_KEY);
      } catch {}
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load subscription status.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const withToken = useCallback(
    async <T,>(path: string, init?: RequestInit & { debugSecret?: string }) => {
      const token = await getToken();
      const data = await api<T>(path, token, init);
      if (data && typeof data === "object" && "trialRemainingMs" in data) {
        const next = data as unknown as EntitlementState;
        setState(next);
        const tokenValue = next.token;
        try {
          if (tokenValue) localStorage.setItem(TOKEN_KEY, tokenValue);
        } catch {}
      }
      return data;
    },
    [getToken],
  );

  const canFly = Boolean(state && (state.entitled || state.trialRemainingMs > 0));

  return { isLoaded, isSignedIn, state, error, loading, refresh, withToken, canFly };
}
