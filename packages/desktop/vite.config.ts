import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	plugins: [tailwindcss(), react()],
	resolve: { tsconfigPaths: true },
	server: { host: "127.0.0.1", port: 3001 },
	build: { outDir: "dist/renderer", emptyOutDir: true },
});
