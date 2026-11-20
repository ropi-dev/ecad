import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { distributionLicenses } from "../../scripts/distribution-licenses.ts";

export default defineConfig({
	base: "./",
	plugins: [tailwindcss(), solid(), distributionLicenses("desktop")],
	resolve: { tsconfigPaths: true },
	// Only the Gerber archive worker imports fflate, and the dev dependency scan
	// does not follow workers; without this the first ZIP import reloads the page.
	optimizeDeps: { include: ["@ecad/core > fflate"] },
	worker: { format: "es" },
	server: { host: "127.0.0.1", port: 3001 },
	build: { outDir: "dist/renderer", emptyOutDir: true },
});
