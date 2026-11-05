import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

import { prepareArtifacts } from "../../scripts/development/artifacts.ts";

// Smoke tests against the production builds: the web app served by
// `vite preview` and the desktop app in Electron. The web build runs as part
// of the server command; build the desktop app first with
// `pnpm run build:desktop`.

const artifacts = prepareArtifacts();
const port = Number(process.env.ECAD_SMOKE_PORT ?? 4176);
export default defineConfig({
	testDir: ".",
	outputDir: join(artifacts, "smoke-results"),
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	reporter: [["list"]],
	use: {
		viewport: { width: 1280, height: 800 },
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "web",
			testMatch: "web.spec.ts",
			use: {
				baseURL: `http://127.0.0.1:${port}`,
				launchOptions: {
					executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
					args: [
						"--use-angle=vulkan",
						"--use-vulkan=swiftshader",
						"--enable-features=Vulkan,VulkanFromANGLE",
						"--disable-vulkan-surface",
					],
				},
			},
		},
		{ name: "desktop", testMatch: "desktop.spec.ts" },
	],
	webServer: {
		cwd: fileURLToPath(new URL("../../", import.meta.url)),
		command: `pnpm run build:web && pnpm run preview --host 127.0.0.1 --port ${port} --strictPort`,
		url: `http://127.0.0.1:${port}/`,
		timeout: 240_000,
		reuseExistingServer: false,
	},
});
