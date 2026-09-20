import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	plugins: [tailwindcss()],
	// Renderer regression tests load these modules through page.evaluate imports.
	optimizeDeps: { include: ["three/webgpu", "three/tsl"] },
});
