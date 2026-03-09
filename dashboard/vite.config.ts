import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/dashboard/",
  build: {
    outDir: "dist",
  },
  server: {
    port: 4201,
    proxy: {
      "/api": "http://localhost:4200",
      "/ws": {
        target: "ws://localhost:4200",
        ws: true,
      },
    },
  },
});
