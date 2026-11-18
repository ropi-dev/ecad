import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import { distributionLicenses } from "../../scripts/distribution-licenses.ts";
import { SECURITY_HEADERS, WORKER_CSP } from "./src/security-headers.ts";

const envDir = fileURLToPath(new URL("../..", import.meta.url));
const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);

const config = defineConfig(({ mode }) => {
	const workspaceEnv = loadEnv(mode, envDir, "");
	const packageEnv = loadEnv(mode, ".", "");
	const posthogToken =
		process.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN ||
		packageEnv.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN ||
		workspaceEnv.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
	const posthogHost =
		process.env.VITE_PUBLIC_POSTHOG_HOST ||
		packageEnv.VITE_PUBLIC_POSTHOG_HOST ||
		workspaceEnv.VITE_PUBLIC_POSTHOG_HOST;
	const proxy: Record<
		string,
		{
			target: string;
			changeOrigin: boolean;
			rewrite: (path: string) => string;
		}
	> = posthogHost
		? {
				"/ingest/static": {
					target: posthogHost.replace(
						".i.posthog.com",
						"-assets.i.posthog.com",
					),
					changeOrigin: true,
					rewrite: (path: string) => path.replace(/^\/ingest/, ""),
				},
				"/ingest/array": {
					target: posthogHost.replace(
						".i.posthog.com",
						"-assets.i.posthog.com",
					),
					changeOrigin: true,
					rewrite: (path: string) => path.replace(/^\/ingest/, ""),
				},
				"/ingest": {
					target: posthogHost,
					changeOrigin: true,
					rewrite: (path: string) => path.replace(/^\/ingest/, ""),
				},
			}
		: {};

	return {
		envDir,
		define: {
			...(commit
				? { "import.meta.env.VITE_APP_VERSION": JSON.stringify(commit) }
				: {}),
			...(posthogToken
				? {
						"import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN":
							JSON.stringify(posthogToken),
					}
				: {}),
			...(posthogHost
				? {
						"import.meta.env.VITE_PUBLIC_POSTHOG_HOST":
							JSON.stringify(posthogHost),
					}
				: {}),
		},
		server: {
			proxy,
			// Comma-separated extra hostnames for the dev and preview servers.
			allowedHosts: (workspaceEnv.ECAD_ALLOWED_HOSTS ?? "")
				.split(",")
				.map((host) => host.trim())
				.filter(Boolean),
		},
		preview: { proxy },
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
								...(posthogHost
									? {
											"/ingest/static/**": {
												proxy: `${posthogHost.replace(
													".i.posthog.com",
													"-assets.i.posthog.com",
												)}/static/**`,
											},
											"/ingest/array/**": {
												proxy: `${posthogHost.replace(
													".i.posthog.com",
													"-assets.i.posthog.com",
												)}/array/**`,
											},
											"/ingest/**": { proxy: `${posthogHost}/**` },
										}
									: {}),
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
	};
});

export default config;
