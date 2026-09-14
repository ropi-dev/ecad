import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: "*.spec.ts",
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:4174",
		launchOptions: {
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
			args: [
				"--enable-unsafe-webgpu",
				"--use-angle=swiftshader",
				"--enable-features=Vulkan",
				"--disable-vulkan-surface",
			],
		},
	},
	webServer: {
		cwd: fileURLToPath(new URL("../../", import.meta.url)),
		command:
			"npx vite --config tests/browser/vite.config.ts --port 4174 --strictPort",
		url: "http://127.0.0.1:4174/tests/browser/renderer.html",
		reuseExistingServer: !process.env.CI,
	},
});
