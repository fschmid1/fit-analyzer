import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";

const BUILD_TIME = new Date().toISOString();
let gitCommit = process.env.GIT_COMMIT?.trim();
if (!gitCommit) {
	try {
		gitCommit = execSync("git rev-parse --short HEAD", {
			encoding: "utf8",
			cwd: process.cwd(),
		}).trim();
	} catch {
		// git not available — leave as "unknown"
	}
}
if (!gitCommit) {
	gitCommit = "unknown";
}
const GIT_COMMIT = gitCommit;

// Vite logs EPIPE / ECONNRESET proxy errors as [vite] http proxy error.
// These are benign — they fire when the browser cancels an in-flight request
// (page navigation, HMR reload, fast refresh). Silence them so they don't
// pollute the terminal; every other error still surfaces normally.
const silenceProxyEpipe: Plugin = {
	name: "silence-proxy-epipe",
	configureServer(server) {
		const original = server.config.logger.error.bind(server.config.logger);
		server.config.logger.error = (msg, opts) => {
			const code = (opts?.error as NodeJS.ErrnoException | null | undefined)
				?.code;
			if (code === "EPIPE" || code === "ECONNRESET") return;
			original(msg, opts);
		};
	},
};

// https://vitejs.dev/config/
export default defineConfig({
	define: {
		"import.meta.env.VITE_BUILD_TIME": JSON.stringify(BUILD_TIME),
		"import.meta.env.VITE_GIT_COMMIT": JSON.stringify(GIT_COMMIT),
	},
	plugins: [react(), tailwindcss(), silenceProxyEpipe],
	server: {
		host: "0.0.0.0",
		proxy: {
			"/api": {
				target: "http://localhost:3001",
				// Simulate Authentik reverse-proxy headers in local dev.
				// In production these are injected by the Authentik proxy itself.
				headers: {
					"x-authentik-username": "accounts@festech.de",
					"x-authentik-email": "accounts@festech.de",
					"x-authentik-name": "Felix",
				},
			},
		},
	},
});
