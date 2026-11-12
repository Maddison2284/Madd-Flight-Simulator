import { useEffect, useRef, useState } from "react";
import { SignIn } from "@clerk/react";

/** Clerk hash routes: sign-in steps, the combined sign-up steps under
 * create/ (create, create/verify-email-address, create/continue,
 * create/sso-callback), and the OAuth return at sso-callback. */
export const CLERK_HASH = /^#\/(\?.*fallback_redirect_url|sso-callback|create|factor-one|factor-two|verify|continue|reset-password|choose|forgot-password|protect-check)/;
const SIGN_UP_HASH = /^#\/create/;

export function isClerkHashRoute(hash = window.location.hash): boolean {
  return CLERK_HASH.test(hash) || hasAuthError();
}

/** Set by the Worker when Clerk rejects a Google return (/?auth_error=google). */
export function hasAuthError(): boolean {
  return new URLSearchParams(window.location.search).get("auth_error") === "google";
}

export function clearClerkHash() {
  if (window.location.hash) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

const AUTH_EVENT = "maddflight-auth-mode";
/** Put the in-page Clerk box on its sign-in or sign-up start screen. */
export function openAuth(mode: "signIn" | "signUp") {
  const base = window.location.pathname + window.location.search;
  history.replaceState(null, "", mode === "signUp" ? `${base}#/create` : base);
  window.dispatchEvent(new Event(AUTH_EVENT));
}

/** The one Clerk SignIn (with combined sign-up, all in-page via hash
 * routing) the app mounts. If Clerk renders nothing for a stale step (e.g.
 * #/create/verify-email-address after a reload or an expired flow), restart
 * at the matching first step instead of leaving an empty box. */
export function AuthPanel() {
  const host = useRef<HTMLDivElement>(null);
  const [epoch, setEpoch] = useState(0);
  const [authError] = useState(() => {
    const failed = hasAuthError();
    if (failed) {
      const q = new URLSearchParams(window.location.search);
      q.delete("auth_error");
      const qs = q.toString();
      history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "") + window.location.hash);
    }
    return failed;
  });
  const [signUp, setSignUp] = useState(() => SIGN_UP_HASH.test(window.location.hash));
  useEffect(() => {
    const sync = () => setSignUp(SIGN_UP_HASH.test(window.location.hash));
    const remount = () => {
      sync();
      setEpoch((n) => n + 1);
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener(AUTH_EVENT, remount);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener(AUTH_EVENT, remount);
    };
  }, []);
  // Clerk's own "Already have an account? Sign in" link navigates to the
  // provider signInUrl (a full page load that closes the box). Keep it in-page.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest(".cl-footerActionLink");
      if (link && SIGN_UP_HASH.test(window.location.hash)) {
        e.preventDefault();
        e.stopPropagation();
        openAuth("signIn");
      }
    };
    el.addEventListener("click", onClick, true);
    return () => el.removeEventListener("click", onClick, true);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const el = host.current;
      const hasUi = el?.querySelector(".cl-cardBox, .cl-card, .cl-spinner");
      const hash = window.location.hash;
      // Never interrupt an OAuth return or Clerk's bot check, including the
      // sign-up variants (#/create/sso-callback, #/create/protect-check).
      const busy = /sso-callback|protect-check|verify|continue/.test(hash);
      if (!hasUi && hash && !busy && hash !== "#/create") {
        const wasSignUp = SIGN_UP_HASH.test(hash);
        openAuth(wasSignUp ? "signUp" : "signIn");
      }
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [epoch]);
  const here = window.location.origin + window.location.pathname;
  return (
    <div ref={host} className="auth-panel">
      {authError && (
        <p className="auth-error" role="alert">
          Google sign-in failed, please try again.
        </p>
      )}
      <SignIn
        key={epoch}
        routing="hash"
        withSignUp
        fallbackRedirectUrl={here}
        signUpFallbackRedirectUrl={here}
      />
      {/* Clerk's own sign-up card already has "Already have an account? Sign in". */}
      {!signUp && (
        <p className="auth-switch">
          New here?{" "}
          <button type="button" onClick={() => openAuth("signUp")}>
            Create an account
          </button>
        </p>
      )}
      <p className="auth-legal">
        By continuing you agree to the{" "}
        <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and{" "}
        <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
      </p>
    </div>
  );
}
