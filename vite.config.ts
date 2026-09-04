import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "frontend",
  publicDir: false,
  plugins: [react(), tailwindcss()],
  build: { outDir: "../public", emptyOutDir: true },
});
