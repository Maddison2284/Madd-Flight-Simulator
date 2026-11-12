import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import base from "../../vite.config";
// DEV-ONLY: the real app with Clerk swapped for a test double. Not used by `pnpm run build`.
export default defineConfig({
  ...base,
  root: fileURLToPath(new URL("../..", import.meta.url)),
  resolve: { alias: { "@clerk/react": fileURLToPath(new URL("./clerk-mock.tsx", import.meta.url)) } },
  server: { port: 5209, strictPort: true },
});
