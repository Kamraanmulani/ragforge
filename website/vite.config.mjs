import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, server/dev.mjs runs Vite as middleware inside the Express app, so /api is same-origin
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
});
