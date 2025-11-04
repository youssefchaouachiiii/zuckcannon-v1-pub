import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    https: {
      key: fs.readFileSync(path.resolve(__dirname, "../key.pem")),
      cert: fs.readFileSync(path.resolve(__dirname, "../cert.pem")),
    },
    proxy: {
      "/api": {
        target: "https://127.0.0.1:6969",
        changeOrigin: true,
        secure: false, // Allow self-signed certificates
      },
      "/auth": {
        target: "https://127.0.0.1:6969",
        changeOrigin: true,
        secure: false, // Allow self-signed certificates
      },
      "/data": {
        target: "https://127.0.0.1:6969",
        changeOrigin: true,
        secure: false, // Allow self-signed certificates
      },
    },
  },
  build: {
    outDir: "../public-react",
    emptyOutDir: true,
  },
});
