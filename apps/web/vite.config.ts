import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Vite logs EPIPE / ECONNRESET proxy errors as [vite] http proxy error.
// These are benign — they fire when the browser cancels an in-flight request
// (page navigation, HMR reload, fast refresh). Silence them so they don't
// pollute the terminal; every other error still surfaces normally.
const silenceProxyEpipe: Plugin = {
    name: "silence-proxy-epipe",
    configureServer(server) {
        const original = server.config.logger.error.bind(server.config.logger);
        server.config.logger.error = (msg, opts) => {
            const code = (
                opts?.error as NodeJS.ErrnoException | null | undefined
            )?.code;
            if (code === "EPIPE" || code === "ECONNRESET") return;
            original(msg, opts);
        };
    },
};

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss(), silenceProxyEpipe],
    server: {
        proxy: {
            "/api": {
                target: "http://localhost:3001",
                // Simulate Authentik reverse-proxy headers in local dev.
                // In production these are injected by the Authentik proxy itself.
                headers: {
                    "x-authentik-username": "dev",
                    "x-authentik-email": "dev@localhost",
                    "x-authentik-name": "Dev User",
                },
            },
        },
    },
});
