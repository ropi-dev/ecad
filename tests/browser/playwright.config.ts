import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

import { prepareArtifacts } from "../../scripts/development/artifacts.ts";

prepareArtifacts();

const port = Number(process.env.ECAD_BROWSER_PORT ?? 4174);
export default defineConfig({
	testDir: ".",
	testMatch: "*.spec.ts",
	workers: 2,
	fullyParallel: true,
	projects: [{ name: "chromium" }],
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		storageState: {
			cookies: [],
			origins: [
				{
					origin: new URL(`http://127.0.0.1:${port}`).origin,
					localStorage: [
						{
							name: "ecad.settings.v1",
							value: JSON.stringify({ version: 1, antialiasing: "off" }),
						},
					],
				},
			],
		},
		screenshot: "only-on-failure",
		launchOptions: {
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
			args: [
				// Render WebGL through ANGLE on SwiftShader's software Vulkan driver.
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
		url: `http://127.0.0.1:${port}/tests/browser/editor.html`,
		stdout: "pipe",
		reuseExistingServer: false,
	},
});
