import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { editorMcpApi } from "./editor-mcp-api.ts";

export default defineConfig({
	publicDir: "packages/web/public",
	resolve: { tsconfigPaths: true },
	// Keep fixture dependency optimization separate from the running app.
	cacheDir: "node_modules/.vite-browser-tests",
	// The Gerber archive worker is the only fflate importer, and the dependency
	// scan does not follow workers; a late discovery reloads the page mid-test.
	optimizeDeps: { include: ["@ecad/core > fflate"] },
	// Test and benchmark output must not reload pages during a run.
	server: { watch: { ignored: ["**/perf-artifacts/**"] } },
	plugins: [tailwindcss(), editorMcpApi()],
});
