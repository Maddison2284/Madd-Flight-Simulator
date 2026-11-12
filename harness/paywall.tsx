// Dev-only harness: the real Paywall component + CSS in its signed-in state.
import "../src/style.css";
import { createRoot } from "react-dom/client";
import { Paywall } from "../src/Paywall";
createRoot(document.getElementById("root")!).render(
  <Paywall open signedIn state={null} busy={false} error="" onCheckout={() => {}} onRestore={() => {}} onRedeem={() => {}} onSignIn={() => {}} />,
);
(window as any).ready = true;
