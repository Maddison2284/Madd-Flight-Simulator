import { useState } from "react";
import type { EntitlementState } from "./entitlement-client";

export const NO_REFUNDS =
  "No refunds; cancel anytime, access continues until the end of the billing period.";

export function formatAccessDate(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Short status for the header chip and account menu. */
export function subscriptionSummary(state: EntitlementState | null): string {
  if (!state || !state.entitled) return "";
  if (state.reason === "admin") return "Admin · free access";
  if (state.lifetime) return "Lifetime access";
  const until = formatAccessDate(state.periodEnd);
  if (state.plan === "comp") return `Free access until ${until}`;
  if (state.cancelAtPeriodEnd) return `Active until ${until}`;
  return `Pro · renews ${until}`;
}

export function BillingPanel({
  state,
  onClose,
  onCancel,
  onResume,
  busy,
  error,
  message,
}: {
  state: EntitlementState | null;
  onClose: () => void;
  onCancel: () => void;
  onResume: () => void;
  busy: boolean;
  error: string;
  message: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const until = formatAccessDate(state?.periodEnd);
  const planName =
    state?.plan === "pro-year" ? "Madd-Flight Pro · yearly ($29.99/yr)" : state?.plan === "pro-month" ? "Madd-Flight Pro · monthly ($4.99/mo)" : state?.plan === "comp" ? "Free access (code)" : "No active plan";
  return (
    <div className="paywall-backdrop" role="presentation" onClick={onClose}>
      <section
        className="paywall panel billing-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Subscription"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="eyebrow">YOUR SUBSCRIPTION</div>
        <h2>{planName}</h2>
        {state?.lifetime ? (
          <p>Lifetime access. Nothing to renew or cancel.</p>
        ) : state?.cancelAtPeriodEnd ? (
          <p data-billing-status="cancelling">
            <strong>Cancelled · active until {until}.</strong> It will not renew. You keep full
            access until then.
          </p>
        ) : state?.hasSubscription && state.entitled ? (
          <p data-billing-status="active">Active · renews automatically on {until}.</p>
        ) : state?.entitled && state.plan === "comp" ? (
          <p>Free access until {until}.</p>
        ) : (
          <p>No active subscription.</p>
        )}
        {state?.hasSubscription && state.entitled && !state.lifetime && (
          <div className="billing-actions">
            {state.cancelAtPeriodEnd ? (
              <button type="button" className="launch" disabled={busy} onClick={onResume}>
                Resume subscription
              </button>
            ) : confirming ? (
              <>
                <p className="billing-confirm">
                  Cancel Madd-Flight Pro? You keep access until {until}, then it ends. No refunds
                  for the current period.
                </p>
                <button type="button" className="danger" disabled={busy} onClick={() => { setConfirming(false); onCancel(); }}>
                  Yes, cancel at period end
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
                  Keep subscription
                </button>
              </>
            ) : (
              <button type="button" className="danger" disabled={busy} onClick={() => setConfirming(true)}>
                Cancel subscription
              </button>
            )}
          </div>
        )}
        {message && <p className="billing-message" role="status">{message}</p>}
        {error && (
          <p className="paywall-error" role="alert">
            {error}
          </p>
        )}
        <p className="hint">
          {NO_REFUNDS} Billing is handled by Stripe. See the <a href="/terms">Terms</a> and{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </section>
    </div>
  );
}
