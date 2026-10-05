import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { editorMcpApi } from "./editor-mcp-api.ts";

export default defineConfig({
	publicDir: "packages/web/public",
	resolve: {
		alias: {
			"#/": `${fileURLToPath(new URL("../../packages/core/src/", import.meta.url))}`,
			"#web/": `${fileURLToPath(new URL("../../packages/web/src/", import.meta.url))}`,
		},
	},
	// Keep fixture dependency optimization separate from the running app.
	cacheDir: "node_modules/.vite-browser-tests",
	plugins: [tailwindcss(), editorMcpApi()],
	// Renderer regression tests load these modules through page.evaluate imports.
	optimizeDeps: { include: ["three/webgpu", "three/tsl"] },
});
