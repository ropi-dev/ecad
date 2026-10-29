import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
const port = Number(process.env.ECAD_PERF_PORT ?? 4175);
const development = process.env.ECAD_PERF_MODE === "development";
export default defineConfig({
	testDir: ".",
	testMatch: ["app.spec.ts", "desktop-storage.spec.ts", "cli.spec.ts"],
	outputDir: "../../perf-artifacts/results",
	workers: 1,
	fullyParallel: false,
	repeatEach: Number(process.env.ECAD_PERF_RUNS ?? 3),
	retries: 0,
	timeout: 120_000,
	expect: { timeout: 30_000 },
	reporter: [
		["list"],
		["./reporter.ts"],
		["html", { outputFolder: "perf-artifacts/html", open: "never" }],
	],
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		viewport: { width: 1280, height: 800 },
		trace: "retain-on-failure",
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
		command: development
			? `pnpm run dev:web --host 127.0.0.1 --port ${port} --strictPort`
			: `pnpm run preview --host 127.0.0.1 --port ${port} --strictPort`,
		url: `http://127.0.0.1:${port}/projects`,
		reuseExistingServer: false,
		timeout: 60_000,
	},
});
