import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig({
	envDir: "../..",
	server: { allowedHosts: ["server.tail68bf0c.ts.net"] },
	cacheDir:
		process.env.ECAD_PERF_MODE === "development"
			? "../../node_modules/.vite-performance"
			: undefined,
	resolve: { tsconfigPaths: true },
	ssr: { noExternal: [/^@tanstack\//] },
	plugins: [
		devtools(),
		tailwindcss(),
		tanstackStart({ spa: { enabled: true, maskPath: "/" } }),
		...(process.env.VERCEL ? [nitro()] : []),
		viteReact(),
	],
});

export default config;
