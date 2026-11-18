import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import { distributionLicenses } from "../../scripts/distribution-licenses.ts";
import { SECURITY_HEADERS, WORKER_CSP } from "./src/security-headers.ts";

const envDir = fileURLToPath(new URL("../..", import.meta.url));

const POSTHOG_HOST = "https://eu.i.posthog.com";
const ingestProxy = {
	"/ingest": {
		target: POSTHOG_HOST,
		changeOrigin: true,
		rewrite: (path: string) => path.replace(/^\/ingest/, ""),
	},
};
const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);

const config = defineConfig(({ mode }) => ({
	envDir,
	define: commit
		? { "import.meta.env.VITE_APP_VERSION": JSON.stringify(commit) }
		: {},
	server: {
		proxy: ingestProxy,
		// Comma-separated extra hostnames for the dev and preview servers.
		allowedHosts: (loadEnv(mode, envDir, "ECAD_").ECAD_ALLOWED_HOSTS ?? "")
			.split(",")
			.map((host) => host.trim())
			.filter(Boolean),
	},
	preview: { proxy: ingestProxy },
	cacheDir:
		process.env.ECAD_PERF_MODE === "development"
			? "../../node_modules/.vite-performance"
			: undefined,
	resolve: { tsconfigPaths: true },
	// Only the Gerber archive worker imports fflate, and the dev dependency scan
	// does not follow workers; without this the first ZIP import reloads the page.
	optimizeDeps: { include: ["@ecad/core > fflate"] },
	worker: { format: "es" },
	ssr: { noExternal: [/^@tanstack\//] },
	plugins: [
		tailwindcss(),
		tanstackStart({ spa: { enabled: true, maskPath: "/" } }),
		...(process.env.VERCEL
			? [
					nitro({
						// A CSP header only
						// governs documents and workers, so under /assets it reaches
						// just the bundled workers.
						routeRules: {
							"/**": { headers: SECURITY_HEADERS },
							"/ingest/**": { proxy: `${POSTHOG_HOST}/**` },
							"/assets/**": {
								headers: { "Content-Security-Policy": WORKER_CSP },
							},
						},
					}),
				]
			: []),
		viteReact(),
		distributionLicenses("web"),
	],
}));

export default config;
