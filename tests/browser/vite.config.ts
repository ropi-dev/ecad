import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { editorMcpApi } from "./editor-mcp-api.ts";

export default defineConfig({
	publicDir: "packages/web/public",
	resolve: { tsconfigPaths: true },
	// Keep fixture dependency optimization separate from the running app.
	cacheDir: "node_modules/.vite-browser-tests",
	plugins: [tailwindcss(), editorMcpApi()],
	// Renderer regression tests load these modules through page.evaluate imports.
	optimizeDeps: { include: ["three/webgpu", "three/tsl"] },
});
