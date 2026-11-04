import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { distributionLicenses } from "../../scripts/distribution-licenses.ts";

const config = defineConfig({
	envDir: "../..",
	server: { allowedHosts: ["server.tail68bf0c.ts.net"] },
	cacheDir:
		process.env.ECAD_PERF_MODE === "development"
			? "../../node_modules/.vite-performance"
			: undefined,
	resolve: { tsconfigPaths: true },
	// Only the Gerber archive worker imports fflate, and the dev dependency scan
	// does not follow workers; without this the first ZIP import reloads the page.
	optimizeDeps: { include: ["@ecad/core > fflate"] },
	ssr: { noExternal: [/^@tanstack\//] },
	plugins: [
		tailwindcss(),
		tanstackStart({ spa: { enabled: true, maskPath: "/" } }),
		...(process.env.VERCEL ? [nitro()] : []),
		viteReact(),
		distributionLicenses("web"),
	],
});

export default config;
