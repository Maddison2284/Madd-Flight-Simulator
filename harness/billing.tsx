// Dev-only harness: BillingPanel states. ?s=active|cancelling
import "../src/style.css";
import { createRoot } from "react-dom/client";
import { BillingPanel } from "../src/BillingPanel";
const s = new URLSearchParams(location.search).get("s") || "active";
const state: any = { entitled: true, reason: "subscription", plan: "pro-month", periodEnd: Date.UTC(2026, 11, 11), lifetime: false, trialRemainingMs: 300000, trialUsedMs: 0, cancelAtPeriodEnd: s === "cancelling", hasSubscription: true, userId: "u", email: "a@b.c", isAdmin: false, token: null };
createRoot(document.getElementById("root")!).render(
  <BillingPanel state={state} busy={false} error="" message={s === "cancelling" ? "Subscription cancelled. No refunds; your access continues until December 10, 2026." : ""} onClose={() => {}} onCancel={() => {}} onResume={() => {}} />,
);
(window as any).ready = true;
