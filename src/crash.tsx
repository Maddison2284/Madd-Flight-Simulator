import { Component, type ReactNode } from "react";

/** Last few errors, bounded (for support / tests: window.__mfErrors). */
const errors: string[] = [];
export function recordError(err: unknown) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  errors.push(`${new Date().toISOString()} ${msg}`.slice(0, 300));
  if (errors.length > 20) errors.splice(0, errors.length - 20);
}
if (typeof window !== "undefined") {
  (window as unknown as { __mfErrors?: string[] }).__mfErrors = errors;
  window.addEventListener("error", (e) => recordError(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => recordError(e.reason));
}

/** Friendly full-screen recover panel instead of a blank or frozen screen. */
export function CrashScreen({ kind, onResume }: { kind: "render" | "context" | "app"; onResume?: () => void }) {
  const text =
    kind === "context"
      ? "Your device paused the 3D graphics (usually to free up memory)."
      : kind === "render"
        ? "The 3D view hit a snag."
        : "Something went wrong.";
  return (
    <div className="crash-screen" role="alertdialog" aria-label="Recover flight">
      <div>
        <strong>{text}</strong>
        <p>Tap below to get flying again.</p>
        <div className="crash-actions">
          {onResume && <button onClick={onResume}>Try again</button>}
          <button className="primary" onClick={() => window.location.reload()}>
            Reload Madd-Flight
          </button>
        </div>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    recordError(err);
  }
  render() {
    return this.state.failed ? <CrashScreen kind="app" /> : this.props.children;
  }
}
