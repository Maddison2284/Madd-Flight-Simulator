// DEV-ONLY test double for @clerk/react, used solely by harness/app/vite.config.ts
// to drive the real src/main.tsx in headless tests. Never part of the production build.
import type { ReactNode } from "react";
export const ClerkProvider = ({ children }: { children: ReactNode }) => <>{children}</>;
const auth = { isLoaded: true, isSignedIn: true, userId: "user_test", getToken: async () => "test-token", signOut: async () => {} };
export const useAuth = () => auth;
const user = { isLoaded: true, isSignedIn: true, user: { primaryEmailAddress: { emailAddress: "pilot@example.com" } } };
export const useUser = () => user;
const Btn = ({ children }: { children?: ReactNode }) => <div className="mock-user-button">{children}</div>;
const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
const Action = ({ label, onClick }: { label: string; onClick?: () => void }) => <button className="mock-user-action" onClick={onClick}>{label}</button>;
export const UserButton = Object.assign(Btn, { MenuItems: Pass, Action, Link: Action });
export const SignIn = () => <div>mock sign in</div>;
export const SignUp = SignIn;
