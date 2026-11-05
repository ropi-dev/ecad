import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const port = Number(process.env.ECAD_PERF_PORT ?? 4175);
const development = process.env.ECAD_PERF_MODE === "development";
// Traces and the HTML report add work to every timed test, so they are opt-in.
const trace = process.env.ECAD_PERF_TRACE === "1";
const html = process.env.ECAD_PERF_HTML === "1";
export default defineConfig({
	testDir: ".",
	testMatch: "*.spec.ts",
	outputDir: "../../perf-artifacts/results",
	workers: 1,
	fullyParallel: false,
	repeatEach: Number(process.env.ECAD_PERF_RUNS ?? 3),
	retries: 0,
	// Fail fast: a stale locator should fail in seconds, not at the test timeout.
	// Long scenarios such as editor-selection-drag set their own test timeout.
	timeout: 60_000,
	expect: { timeout: 15_000 },
	reporter: [
		["list"],
		["./reporter.ts"],
		...(html
			? ([
					["html", { outputFolder: "perf-artifacts/html", open: "never" }],
				] as const)
			: []),
	],
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		viewport: { width: 1280, height: 800 },
		actionTimeout: 10_000,
		navigationTimeout: 15_000,
		trace: trace ? "retain-on-failure" : "off",
		launchOptions: {
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
			args: [
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
