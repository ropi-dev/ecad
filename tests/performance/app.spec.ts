import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { resolve } from "node:path";
import type { AppPerformance } from "#/performance/browser.ts";
import { pthGerber } from "../fixtures/pth-gerber";
import { toolbarButton } from "../browser/toolbar";
import { budgets, type Scenario } from "./budgets.ts";

type Report = ReturnType<AppPerformance["snapshot"]>;
const report = (page: Page) =>
	page.evaluate(() => window.__ecadPerformance!.snapshot());
const percentile = (values: number[], percent = 0.95) =>
	[...values].sort((a, b) => a - b)[
		Math.max(0, Math.ceil(values.length * percent) - 1)
	] ?? 0;
const metric = (value: Report, name: string) => value.metrics[name]?.p95;
const ready = async (page: Page) =>
	page.waitForFunction(
		() =>
			window.__ecadPerformance?.snapshot().metrics["app.ready"]?.count === 1,
	);

async function interaction(
	page: Page,
	name: string,
	action: () => Promise<void>,
) {
	await page.evaluate((name) => {
		window.__ecadPerformance!.record("scenario.start", 0, { name });
	}, name);
	const start = await page.evaluate(() => performance.now());
	await action();
	await page.evaluate(
		({ start, name }) =>
			window.__ecadPerformance!.record(
				"scenario.interaction",
				performance.now() - start,
				{ name },
				start,
			),
		{ start, name },
	);
}

async function finish(
	page: Page,
	testInfo: TestInfo,
	scenario: Scenario,
	extra: Record<string, number> = {},
) {
	await page.waitForTimeout(750);
	const value = await report(page);
	const metrics: Record<string, number> = {
		startupMs: metric(value, "app.ready")!,
		scriptBytes: value.resources.scriptBytes,
		domNodes: value.domNodes,
		...(value.heapBytes === null ? {} : { heapBytes: value.heapBytes }),
		...(value.environment.supportedEntryTypes.includes("longtask")
			? { blockingMs: value.metrics["browser.blocking-time"]?.total ?? 0 }
			: {}),
		...(metric(value, "browser.event-loop-delay") === undefined
			? {}
			: { eventLoopP95Ms: metric(value, "browser.event-loop-delay")! }),
		...(metric(value, "navigation.ready") === undefined
			? {}
			: { navigationP95Ms: metric(value, "navigation.ready")! }),
		...(metric(value, "renderer.frame") === undefined
			? {}
			: { frameP95Ms: metric(value, "renderer.frame")! }),
		...(metric(value, "import.gerber") === undefined
			? {}
			: { importGerberMs: metric(value, "import.gerber")! }),
		...(metric(value, "import.step") === undefined
			? {}
			: { importStepMs: metric(value, "import.step")! }),
		...extra,
	};
	await testInfo.attach("performance", {
		body: JSON.stringify({ scenario, metrics, report: value }),
		contentType: "application/json",
	});
	for (const [name, maximum] of Object.entries(budgets[scenario])) {
		expect(metrics[name], `${scenario}.${name} must be measured`).toBeDefined();
		expect(
			Number.isFinite(metrics[name]),
			`${scenario}.${name} must be finite`,
		).toBe(true);
		if (name === "domNodes")
			expect(
				metrics[name],
				`${scenario}.${name} budget ${maximum}`,
			).toBeLessThanOrEqual(maximum);
	}
	if (value.mode === "development")
		expect(
			Object.keys(value.metrics).some((name) => name.startsWith("react.")),
		).toBe(true);
	expect(value.events.length).toBeLessThanOrEqual(512);
}

test.beforeAll(async ({ browser }) => {
	if (process.env.ECAD_PERF_MODE !== "development") return;
	const page = await browser.newPage();
	try {
		for (const path of ["/projects", "/editor", "/", "/step"]) {
			await page.goto(`http://127.0.0.1:4175${path}?perf=1`);
			await ready(page);
		}
		await page.goto("http://127.0.0.1:4175/projects?perf=1");
		await ready(page);
		await page.getByLabel("Project name", { exact: true }).fill("Warmup");
		await page
			.getByRole("button", { name: "Create project", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "Warmup", exact: true }),
		).toBeVisible();
		await page
			.getByLabel("Add Gerber files")
			.setInputFiles({
				name: "PTH.gbr",
				mimeType: "text/plain",
				buffer: Buffer.from(pthGerber(1, false)),
			});
		await page.getByRole("link", { name: "Open PTH.gbr", exact: true }).click();
		await expect
			.poll(
				async () => (await report(page)).metrics["import.gerber"]?.count ?? 0,
			)
			.toBeGreaterThan(0);
		await page.getByRole("link", { name: "Projects", exact: true }).click();
		await page
			.getByLabel("Add STEP files")
			.setInputFiles(
				resolve(
					"node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp",
				),
			);
		await page
			.getByRole("link", { name: "Open cube.stp", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Fit model", exact: true }),
		).toBeEnabled();
		await page.waitForTimeout(750);
	} finally {
		await page.close();
	}
});

test.beforeEach(async ({ page }) => {
	const session = await page.context().newCDPSession(page);
	await session.send("Network.enable");
	await session.send("Network.setCacheDisabled", { cacheDisabled: true });
	await session.send("Emulation.setCPUThrottlingRate", {
		rate: Number(process.env.ECAD_PERF_CPU ?? 4),
	});
});

test("projects-empty", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await expect(
		page.getByRole("heading", { name: "No project open" }),
	).toBeVisible();
	await finish(page, testInfo, "projects-empty");
});

test("projects-large", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle("Performance fixture", {
			create: true,
		});
		const manifest =
			'format = "ecad-project"\nversion = 1\nname = "Performance fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n' +
			Array.from(
				{ length: 10000 },
				(_, index) =>
					`\n[[assets]]\npath = "assets/file-${index}.gbr"\nname = "file-${index}.gbr"\nkind = "gerber"\n`,
			).join("");
		for (const [name, content] of [
			[".ecadprj", manifest],
			["drawing.ecaddraw", '{"shapes":[]}'],
		]) {
			const stream = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await stream.write(content);
			await stream.close();
		}
		localStorage.setItem("ecad.active-project", "Performance fixture");
	});
	await page.reload();
	await ready(page);
	await expect(page.getByRole("row")).toHaveCount(51);
	for (let i = 0; i < 3; i++) {
		await interaction(page, "files.next", async () => {
			await page.getByRole("button", { name: "Next files" }).click();
			await expect(
				page.getByText(`${51 + i * 50}–${100 + i * 50} of 10002 files`, {
					exact: true,
				}),
			).toBeVisible();
		});
	}
	await interaction(page, "project.name", async () => {
		await page
			.getByLabel("Project name", { exact: true })
			.fill("Another project");
		await expect(page.getByLabel("Project name", { exact: true })).toHaveValue(
			"Another project",
		);
	});
	const value = await report(page);
	await finish(page, testInfo, "projects-large", {
		interactionP95Ms: percentile(
			value.events
				.filter((event) => event.name === "scenario.interaction")
				.map((event) => event.duration),
		),
	});
});

test("editor-imports", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page
		.getByLabel("Project name", { exact: true })
		.fill("Performance board");
	await page
		.getByRole("button", { name: "Create project", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Performance board", exact: true }),
	).toBeVisible();
	await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
	await expect(page.locator("canvas")).toBeVisible();
	await expect
		.poll(
			async () => (await report(page)).metrics["renderer.frame"]?.count ?? 0,
		)
		.toBeGreaterThan(0);
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(710, 400);
	await page.mouse.up();
	await expect
		.poll(async () => (await report(page)).metrics["project.save"]?.count ?? 0)
		.toBeGreaterThan(1);
	await page.getByRole("link", { name: "Projects", exact: true }).click();
	await page.getByLabel("Add Gerber files").setInputFiles({
		name: "PTH.gbr",
		mimeType: "text/plain",
		buffer: Buffer.from(pthGerber(2000, false)),
	});
	await page.getByRole("link", { name: "Open PTH.gbr", exact: true }).click();
	await expect
		.poll(async () => (await report(page)).metrics["import.gerber"]?.count ?? 0)
		.toBeGreaterThan(0);
	await expect(page.getByTestId("viewer-message")).toHaveCount(0);
	await page.getByRole("link", { name: "Projects", exact: true }).click();
	await page
		.getByLabel("Add STEP files")
		.setInputFiles(
			resolve(
				"node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp",
			),
		);
	await page.getByRole("link", { name: "Open cube.stp", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Fit model", exact: true }),
	).toBeEnabled();
	await expect(page.getByRole("alert")).toHaveCount(0);
	await finish(page, testInfo, "editor-imports");
});

test("symbol-libraries", async ({ page }, testInfo) => {
 await page.goto("/projects?perf=1");
 await ready(page);
 await page.evaluate(async () => {
  const libraries = (scope: string) => Array.from({ length: 10 }, (_, libraryIndex) => ({
   id: `${scope}-${libraryIndex}`, name: `${scope} ${libraryIndex}`, enabled: true,
   source: { kind: "embedded", symbols: Array.from({ length: 20 }, (_, symbolIndex) => ({
    format: "ecad-symbol", version: 1, units: "mm", id: `${scope}-${libraryIndex}-${symbolIndex}`,
    name: `${scope} point ${libraryIndex}-${symbolIndex}`, description: "Test point", prefix: "TP", value: "",
    shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }],
   })) },
  }));
  localStorage.setItem("ecad.user-config.v1", JSON.stringify({ version: 1, symbolLibraries: [
   { id: "builtin", name: "Built-in symbols", enabled: true, source: { kind: "builtin" } }, ...libraries("user"),
  ] }));
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("Library fixture", { create: true });
  for (const [name, content] of [
   [".ecadprj", 'format = "ecad-project"\nversion = 1\nname = "Library fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n'],
   ["drawing.ecaddraw", JSON.stringify({ shapes: [], symbolLibraries: libraries("project") })],
  ]) {
   const writer = await (await directory.getFileHandle(name, { create: true })).createWritable();
   await writer.write(content); await writer.close();
  }
  localStorage.setItem("ecad.active-project", "Library fixture");
 });
 await page.reload();
 await ready(page);
 await page.getByText("Symbol libraries", { exact: true }).click();
 const user = page.getByRole("group", { name: "User libraries", exact: true });
 await expect(user.getByRole("checkbox")).toHaveCount(11);
 await interaction(page, "library.disable", async () => {
  await user.getByRole("checkbox", { name: "user 0", exact: true }).uncheck();
  await expect(user.getByRole("checkbox", { name: "user 0", exact: true })).toBeEnabled();
 });
 await page.getByRole("link", { name: "Schematic editor", exact: true }).click();
 await interaction(page, "library.picker", async () => {
  await page.getByRole("button", { name: "Symbols", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(383);
 });
 const value = await report(page);
 await finish(page, testInfo, "symbol-libraries", {
  libraryLoadMs: metric(value, "symbol-library.load")!,
  libraryResolveMs: metric(value, "symbol-library.resolve")!,
  interactionP95Ms: metric(value, "scenario.interaction")!,
 });
});

test("editor-toolbar", async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(
		page.getByRole("button", { name: "Shapes", exact: true }),
	).toBeEnabled();
	for (let repeat = 0; repeat < 3; repeat++) {
		for (const label of [
			"Shapes",
			"Connections",
			"History tools",
			"View tools",
		]) {
			await interaction(page, "toolbar.open", async () => {
				await page.getByRole("button", { name: label, exact: true }).click();
				await expect(
					page.getByRole("toolbar", { name: `${label} toolbar`, exact: true }),
				).toBeVisible();
			});
		}
		await interaction(page, "toolbar.choose", async () => {
			await (await toolbarButton(page, "Rectangle")).click();
			await expect(page.locator('[data-tool="rectangle"]')).toBeAttached();
		});
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "Select", exact: true }).click();
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-toolbar", {
		interactionP95Ms: percentile(
			value.events
				.filter((event) => event.name === "scenario.interaction")
				.map((event) => event.duration),
		),
	});
});
