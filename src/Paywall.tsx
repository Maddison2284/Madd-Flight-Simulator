import { useState } from "react";
import type { EntitlementState } from "./entitlement-client";

export function formatTrialClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Paywall({
  open,
  state,
  busy,
  error,
  onCheckout,
  onRestore,
  onRedeem,
  onSignIn,
  signedIn,
}: {
  open: boolean;
  state: EntitlementState | null;
  busy: boolean;
  error: string;
  onCheckout: (priceId: "month" | "year") => void;
  onRestore: (email: string) => void;
  onRedeem: (code: string) => void;
  onSignIn: () => void;
  signedIn: boolean;
}) {
  const [email, setEmail] = useState(state?.email || "");
  const [code, setCode] = useState("");
  if (!open) return null;
  return (
    <div className="paywall-backdrop" role="presentation">
      <section className="paywall panel" role="dialog" aria-modal="true" aria-label="Madd-Flight Pro">
        <img className="modal-logo" src="/brand/logo-dark.png" alt="MADD FLIGHT" width="240" height="38" />
        <div className="eyebrow">
          MADD-FLIGHT PRO <span>UNLOCK GOOGLE 3D</span>
        </div>
        <h2>{signedIn ? "Your free test flight has ended." : "Sign in to fly."}</h2>
        <p>
          {signedIn
            ? "Subscribe to keep flying Google Photorealistic 3D, or enter an access code. Free scenery stays visible from the planner."
            : "Create a free Clerk account to start a 5-minute Google 3D test flight. After that, Madd-Flight Pro keeps you in the air."}
        </p>
        {!signedIn ? (
          <button className="launch" type="button" onClick={onSignIn}>
            Sign in / sign up to fly ↗
          </button>
        ) : (
          <>
            <div className="paywall-plans">
              <button
                type="button"
                className="plan"
                disabled={busy}
                onClick={() => onCheckout("month")}
              >
                <strong>$4.99</strong>
                <span>per month</span>
                <em>Madd-Flight Pro</em>
              </button>
              <button
                type="button"
                className="plan featured"
                disabled={busy}
                onClick={() => onCheckout("year")}
              >
                <strong>$29.99</strong>
                <span>per year</span>
                <em>Best value</em>
              </button>
            </div>
            <form
              className="paywall-form"
              onSubmit={(e) => {
                e.preventDefault();
                onRestore(email);
              }}
            >
              <label>
                Restore purchase
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="Email on the Stripe receipt"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <button type="submit" disabled={busy}>
                Restore
              </button>
            </form>
            <form
              className="paywall-form"
              onSubmit={(e) => {
                e.preventDefault();
                onRedeem(code);
              }}
            >
              <label>
                Access code
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="MADD-XXXX-XXXX-XXXX"
                  autoCapitalize="characters"
                  required
                />
              </label>
              <button type="submit" disabled={busy}>
                Redeem
              </button>
            </form>
          </>
        )}
        {error && (
          <p className="paywall-error" role="alert">
            {error}
          </p>
        )}
        <p className="hint">
          Payments are processed by Stripe (Madd Shopping). No charge is made until you confirm
          checkout.
        </p>
      </section>
    </div>
  );
}
