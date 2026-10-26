import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const config = defineConfig({
	envDir: "../..",
	cacheDir:
		process.env.ECAD_PERF_MODE === "development"
			? "../../node_modules/.vite-performance"
			: undefined,
	resolve: { tsconfigPaths: true },
	plugins: [
		devtools(),
		tailwindcss(),
		tanstackStart({ spa: { enabled: true, maskPath: "/projects" } }),
		viteReact(),
	],
});

export default config;
