// DEV-ONLY test double for @clerk/react, used solely by harness/app/vite.config.ts
// to drive the real src/main.tsx in headless tests. Never part of the production build.
import type { ReactNode } from "react";
export const ClerkProvider = ({ children }: { children: ReactNode }) => <>{children}</>;
const auth = { isLoaded: true, isSignedIn: true, userId: "user_test", getToken: async () => "test-token", signOut: async () => {} };
export const useAuth = () => auth;
const user = { isLoaded: true, isSignedIn: true, user: { primaryEmailAddress: { emailAddress: "pilot@example.com" } } };
export const useUser = () => user;
// Same box structure and avatar size as Clerk's real UserButton, so layout
// checks see a real-size avatar in the top-right row.
const Btn = ({ children }: { children?: ReactNode }) => (
  <div className="mock-user-button cl-rootBox cl-userButton-root" style={{ display: "flex" }}>
    <button className="cl-userButtonTrigger" aria-label="Open user menu" style={{ display: "flex", alignItems: "center", padding: "6px 14px" }}>
      <span className="cl-userButtonBox cl-avatarBox" style={{ width: 28, height: 28, borderRadius: 14, background: "#7b5cff", display: "block" }} />
    </button>
    {children}
  </div>
);
const Action = ({ label, onClick }: { label: string; onClick?: () => void }) => <button className="mock-user-action" onClick={onClick}>{label}</button>;
export const UserButton = Object.assign(Btn, { MenuItems: (_p: { children?: ReactNode }) => null, Action, Link: Action });
export const SignIn = () => <div>mock sign in</div>;
export const SignUp = SignIn;
