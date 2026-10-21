import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: "*.spec.ts",
	workers: 1,
	projects: [
		{
			name: "chromium",
			testIgnore: "renderer.spec.ts",
		},
		{
			name: "renderer",
			testMatch: "renderer.spec.ts",
			// Use a display for the software WebGPU swap chain on Linux CI.
			use: { headless: !process.env.CI },
		},
	],
	use: {
		baseURL: "http://127.0.0.1:4174",
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
		command:
			"npx vite --config tests/browser/vite.config.ts --host 127.0.0.1 --port 4174 --strictPort",
		url: "http://127.0.0.1:4174/tests/browser/renderer.html",
		stdout: "pipe",
		reuseExistingServer: !process.env.CI,
	},
});
