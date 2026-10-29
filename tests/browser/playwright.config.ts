import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const port = Number(process.env.ECAD_BROWSER_PORT ?? 4174);
export default defineConfig({
	testDir: ".",
	testMatch: "*.spec.ts",
	workers: 2,
	fullyParallel: true,
	projects: [
		{
			name: "chromium",
			testIgnore: "renderer.spec.ts",
		},
		{
			name: "renderer",
			workers: 1,
			testMatch: "renderer.spec.ts",
			// Use a display for the software WebGPU swap chain on Linux CI.
			use: { headless: !process.env.CI },
		},
	],
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		screenshot: "only-on-failure",
		launchOptions: {
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
			args: [
				"--enable-unsafe-webgpu",
				// ANGLE and WebGPU must share the same software Vulkan driver.
				"--use-webgpu-adapter=swiftshader",
				"--use-angle=vulkan",
				"--use-vulkan=swiftshader",
				"--enable-features=Vulkan,VulkanFromANGLE",
				"--disable-vulkan-surface",
			],
		},
	},
	webServer: {
		cwd: fileURLToPath(new URL("../../", import.meta.url)),
		command: `pnpm exec vite --config tests/browser/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
		url: `http://127.0.0.1:${port}/tests/browser/renderer.html`,
		stdout: "pipe",
		reuseExistingServer: !process.env.CI,
	},
});
