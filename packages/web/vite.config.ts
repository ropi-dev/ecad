import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import { distributionLicenses } from "../../scripts/distribution-licenses.ts";

const envDir = fileURLToPath(new URL("../..", import.meta.url));

const config = defineConfig(({ mode }) => ({
	envDir,
	server: {
		// Comma-separated extra hostnames for the dev and preview servers.
		allowedHosts: (loadEnv(mode, envDir, "ECAD_").ECAD_ALLOWED_HOSTS ?? "")
			.split(",")
			.map((host) => host.trim())
			.filter(Boolean),
	},
	cacheDir:
		process.env.ECAD_PERF_MODE === "development"
			? "../../node_modules/.vite-performance"
			: undefined,
	resolve: { tsconfigPaths: true },
	ssr: { noExternal: [/^@tanstack\//] },
	plugins: [
		tailwindcss(),
		tanstackStart({ spa: { enabled: true, maskPath: "/" } }),
		...(process.env.VERCEL ? [nitro()] : []),
		viteReact(),
		distributionLicenses("web"),
	],
}));

export default config;
