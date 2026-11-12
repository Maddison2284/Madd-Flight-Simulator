import { UserButton, useAuth, useUser } from "@clerk/react";
import { AuthPanel } from "./AuthPanel";
import { useEffect, useState } from "react";
import { ADMIN_EMAIL } from "./billing";
import { useEntitlement } from "./entitlement-client";

type CodeRow = {
  code: string;
  type: "lifetime" | "days";
  days?: number;
  maxRedemptions: number;
  used: number;
  createdAt: number;
  createdBy: string;
};

export function AdminPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const entitlement = useEntitlement();
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [error, setError] = useState("");
  const [type, setType] = useState<"lifetime" | "days">("lifetime");
  const [days, setDays] = useState(30);
  const [maxRedemptions, setMaxRedemptions] = useState(10);
  const email = user?.primaryEmailAddress?.emailAddress || "";
  const isAdmin = entitlement.state?.isAdmin || email.toLowerCase() === ADMIN_EMAIL;

  const load = async () => {
    setError("");
    try {
      const data = await entitlement.withToken<{ codes: CodeRow[] }>("/api/admin/codes");
      setCodes(data.codes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load codes.");
    }
  };

  useEffect(() => {
    if (isSignedIn && isAdmin) void load();
  }, [isSignedIn, isAdmin]);

  return (
    <main className="admin-page" data-admin="true">
      <header>
        <a className="brand" href="/">
          <img className="brand-logo" src="/brand/logo-dark.png" alt="MADD FLIGHT" width="216" height="34" />
        </a>
        <div className="top-right">{isSignedIn && <UserButton />}</div>
      </header>
      <section className="panel dispatch admin-panel">
        <div className="eyebrow">
          ADMIN <span>{ADMIN_EMAIL}</span>
        </div>
        <h1>Access codes</h1>
        {!isLoaded ? (
          <p>Loading…</p>
        ) : !isSignedIn ? (
          <AuthPanel />
        ) : !isAdmin ? (
          <p>This page is limited to {ADMIN_EMAIL}.</p>
        ) : (
          <>
            <p className="intro">
              Create shareable codes for lifetime or timed Madd-Flight Pro access.
            </p>
            <form
              className="admin-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                try {
                  const created = await entitlement.withToken<{ code: CodeRow }>(
                    "/api/admin/codes",
                    {
                      method: "POST",
                      body: JSON.stringify({ type, days, maxRedemptions }),
                    },
                  );
                  setCodes((rows) => [created.code, ...rows.filter((r) => r.code !== created.code.code)]);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not create the code.");
                }
              }}
            >
              <label>
                Type
                <select value={type} onChange={(e) => setType(e.target.value as "lifetime" | "days")}>
                  <option value="lifetime">Lifetime</option>
                  <option value="days">Number of days</option>
                </select>
              </label>
              {type === "days" && (
                <label>
                  Days
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  />
                </label>
              )}
              <label>
                Max redemptions
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={maxRedemptions}
                  onChange={(e) => setMaxRedemptions(Number(e.target.value))}
                />
              </label>
              <button className="launch" type="submit">
                Create code ↗
              </button>
            </form>
            {error && <p className="paywall-error">{error}</p>}
            <div className="code-list">
              {codes.map((row) => (
                <div key={row.code} className="code-row">
                  <strong>{row.code}</strong>
                  <span>
                    {row.type === "lifetime" ? "Lifetime" : `${row.days} days`} · {row.used}/
                    {row.maxRedemptions} used
                  </span>
                  <small>Created by {row.createdBy}</small>
                </div>
              ))}
              {codes.length === 0 && <p className="hint">No codes yet.</p>}
            </div>
            <p className="panel-foot">
              <a href="/">← Back to Madd Flight</a>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
