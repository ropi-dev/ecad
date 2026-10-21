import { generateDefaultSymbols } from "@ecad/default-symbols";
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

// Check timed endpoints each frame so assertion retry delays do not inflate them.
async function editorReady(page: Page, title: string) {
	await page.waitForFunction(
		(title) =>
			document.querySelector("h1")?.textContent === title &&
			document.querySelector<HTMLButtonElement>(
				'button[aria-label="Select"]',
			)?.disabled === false,
		title,
		{ polling: "raf", timeout: 30_000 },
	);
}

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
	await interaction(page, "files.search", async () => {
		await page.getByLabel("Search project files").fill("file-9999.gbr");
		await expect(page.getByText("file-9999.gbr", { exact: true })).toBeVisible();
		await expect(page.getByRole("row")).toHaveCount(2);
	});
	await page.getByRole("button", { name: "Clear file search" }).click();
	await interaction(page, "files.filter", async () => {
		await page.getByRole("group", { name: "File types" }).getByRole("button", { name: /^Gerber/ }).click();
		await expect(page.getByText("1–50 of 10000 files", { exact: true })).toBeVisible();
	});
	const fileInteractions = await report(page);
	await finish(page, testInfo, "projects-large", {
		interactionP95Ms: percentile(
			value.events
				.filter((event) => event.name === "scenario.interaction")
				.map((event) => event.duration),
		),
		searchMs: fileInteractions.events.find((event) => event.data?.name === "files.search" && event.name === "scenario.interaction")!.duration,
		filterMs: fileInteractions.events.find((event) => event.data?.name === "files.filter" && event.name === "scenario.interaction")!.duration,
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
  await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(380 + generateDefaultSymbols().length);
 });
 await interaction(page, "library.search", async () => {
  const search = page.getByRole("searchbox", { name: "Search symbols" });
  await expect(search).toBeFocused();
  await search.fill("project point 9-19");
  await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(1);
  await search.fill("");
  await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(380 + generateDefaultSymbols().length);
 });
 const value = await report(page);
 await finish(page, testInfo, "symbol-libraries", {
  libraryLoadMs: metric(value, "symbol-library.load")!,
  libraryResolveMs: metric(value, "symbol-library.resolve")!,
  interactionP95Ms: metric(value, "scenario.interaction")!,
 });
});

test("default-symbols", async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	const canvas = page.locator("canvas");
	await expect(canvas).toBeVisible();
	for (const [index, name] of ["Inductor", "LED", "NPN transistor", "P-channel MOSFET", "Transformer", "8-pin connector"].entries()) {
		await interaction(page, "symbol.picker", async () => {
			await page.getByRole("button", { name: "Symbols", exact: true }).click();
			await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(generateDefaultSymbols().length);
			await expect(page.getByRole("region", { name: "Diodes", exact: true }).getByRole("button", { name: "Insert LED", exact: true })).toBeVisible();
			await expect(page.getByRole("region", { name: "Transistors", exact: true }).getByRole("button", { name: "Insert NPN transistor", exact: true })).toBeVisible();
		});
		await interaction(page, "symbol.search", async () => {
			const search = page.getByRole("searchbox", { name: "Search symbols" });
			await expect(search).toBeFocused();
			await search.fill(name);
			await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(1);
		});
		await interaction(page, "symbol.place", async () => {
			await page.getByRole("button", { name: `Insert ${name}`, exact: true }).click();
			const bounds = (await canvas.boundingBox())!;
			await canvas.click({ position: { x: bounds.width * (0.25 + (index % 3) * 0.2), y: bounds.height * (0.35 + Math.floor(index / 3) * 0.25) } });
			await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(name);
		});
	}
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	const value = await report(page);
	await finish(page, testInfo, "default-symbols", {
		interactionP95Ms: metric(value, "scenario.interaction")!,
	});
});

test("editor-pin-heavy", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async () => {
		const pins = Array.from({ length: 2000 }, (_, index) => ({
			id: index + 1, kind: "pin", name: "", x: (index % 50) * 6 - 150,
			y: Math.floor(index / 50) * 6 + 20, width: 0.508, height: 0.508,
			lineWidth: 0.254, rotation: 0,
		}));
		const wires = pins.slice(0, 1000).map((pin, index) => ({
			id: 2001 + index, kind: "wire", x: pin.x + 1, y: pin.y,
			width: 2, height: 0.254, lineWidth: 0.254, rotation: 0,
		}));
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle("Pin fixture", { create: true });
		for (const [name, content] of [
			[".ecadprj", 'format = "ecad-project"\nversion = 1\nname = "Pin fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n'],
			["drawing.ecaddraw", JSON.stringify({ shapes: [...pins, ...wires] })],
		]) {
			const writer = await (await directory.getFileHandle(name, { create: true })).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Pin fixture");
	});
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	for (let repeat = 0; repeat < 5; repeat++) {
		await interaction(page, "pin-heavy.empty-click", async () => {
			await canvas.click({ position: { x: bounds.width * 0.85 + repeat * 10, y: bounds.height * 0.75 } });
			await page.waitForFunction(() => document.activeElement?.tagName === "CANVAS");
			await expect(page.getByRole("button", { name: "Clear selection", exact: true })).toHaveCount(0);
		});
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-pin-heavy", {
		interactionP95Ms: metric(value, "scenario.interaction")!,
	});
});

test("editor-pin-wire", async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await (await toolbarButton(page, "Pin")).click();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	const pin = { x: bounds.width * 0.4, y: bounds.height / 2 };
	await canvas.click({ position: pin });
	await expect(page.locator('[data-tool="select"]')).toBeAttached();
	for (let repeat = 0; repeat < 3; repeat++) {
		await interaction(page, "pin.start-wire", async () => {
			await canvas.click({ position: pin });
			await page.waitForFunction(() => document.querySelector('[data-tool="wire"]'));
		});
		await canvas.click({ position: { x: pin.x + 80, y: pin.y } });
		await page.keyboard.press("Enter");
		await expect(page.locator('[data-tool="select"]')).toBeAttached();
		await expect(page.getByRole("spinbutton", { name: "Length", exact: true })).toBeVisible();
		await (await toolbarButton(page, "Undo")).click();
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-pin-wire", {
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

test("editor-user-symbol", async ({ page }, testInfo) => {
	const symbol = {
		format: "ecad-symbol", version: 1, units: "mm", id: "user-package", name: "User package", description: "", prefix: "U", value: "",
		shapes: Array.from({ length: 128 }, (_, index) => ({ kind: "pin", name: `Pin ${index + 1}`, x: index < 64 ? -10 : 10, y: (index % 64) - 32 })),
	};
	await page.addInitScript((symbol) => {
		localStorage.setItem("ecad.user-config.v1", JSON.stringify({ version: 1, symbolLibraries: [{ id: "user", name: "User", enabled: true, source: { kind: "embedded", symbols: [symbol] } }] }));
	}, symbol);
	await page.goto("/editor?perf=1");
	await ready(page);
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page.getByRole("button", { name: "Insert User package", exact: true }).click();
	const bounds = (await page.locator("canvas").boundingBox())!;
	await page.locator("canvas").click({ position: { x: bounds.width * 0.4, y: bounds.height / 2 } });
	for (let repeat = 0; repeat < 3; repeat++) {
		await interaction(page, "symbol.open-user-definition", async () => {
			await page.getByRole("button", { name: "Edit symbol", exact: true }).click();
			await editorReady(page, "Symbol editor · User package");
		});
		await interaction(page, "symbol.save-user-definition", async () => {
			await (await toolbarButton(page, "Rectangle")).click();
			await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.3);
			await page.mouse.down();
			await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.4);
			await page.mouse.up();
			await page.waitForFunction(
				(count) =>
					JSON.parse(localStorage.getItem("ecad.user-config.v1")!)
						.symbolLibraries[0].source.symbols[0].shapes.length === count &&
					document.querySelector("header output")?.textContent === "Saved",
				129 + repeat,
				{ polling: "raf", timeout: 30_000 },
			);
		});
		await page.getByRole("button", { name: "Back to schematic", exact: true }).click();
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-user-symbol", {
		interactionP95Ms: percentile(value.events.filter((event) => event.name === "scenario.interaction").map((event) => event.duration)),
	});
});

test("editor-symbol-attributes", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.getByLabel("Project name", { exact: true }).fill("Symbol attributes");
	await page.getByRole("button", { name: "Create project", exact: true }).click();
	await expect(page.getByLabel("Add symbol files")).toBeEnabled();
	const symbol = {
		format: "ecad-symbol", version: 1, units: "mm", id: "editable-package", name: "Editable package", description: "", prefix: "U", value: "",
		shapes: Array.from({ length: 128 }, (_, index) => ({ kind: "pin", name: `Pin ${index + 1}`, x: index < 64 ? -10 : 10, y: (index % 64) - 32 })),
	};
	await page.getByLabel("Add symbol files").setInputFiles({ name: "package.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(symbol)) });
	for (let repeat = 0; repeat < 3; repeat++) {
		await page.getByRole("link", { name: "Open Drawing", exact: true }).click();
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		await page.getByRole("button", { name: "Insert Editable package", exact: true }).click();
		const bounds = (await page.locator("canvas").boundingBox())!;
		await page.locator("canvas").click({ position: { x: bounds.width * 0.4, y: bounds.height / 2 } });
		await interaction(page, "symbol.open-definition", async () => {
			await page.getByRole("button", { name: "Edit symbol", exact: true }).click();
			await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · Editable package");
			await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
			await expect(page.getByTestId("viewport-grid").locator("mask")).toHaveCount(0);
		});
		if (repeat < 2) await page.getByRole("link", { name: "Projects", exact: true }).click();
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-symbol-attributes", {
		interactionP95Ms: percentile(value.events.filter((event) => event.name === "scenario.interaction").map((event) => event.duration)),
	});
});

test("editor-symbol-file", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.getByLabel("Project name", { exact: true }).fill("Symbol editing");
	await page.getByRole("button", { name: "Create project", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Symbol editing", exact: true })).toBeVisible();
	const symbol = {
		format: "ecad-symbol", version: 1, units: "mm", id: "editable-package", name: "Editable package", description: "", prefix: "U", value: "",
		shapes: Array.from({ length: 128 }, (_, index) => ({ kind: "pin", name: `Pin ${index + 1}`, x: index < 64 ? -10 : 10, y: (index % 64) - 32 })),
	};
	await expect(page.getByLabel("Add symbol files")).toBeEnabled();
	await page.getByLabel("Add symbol files").setInputFiles({ name: "package.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(symbol)) });
	for (let repeat = 0; repeat < 3; repeat++) {
		await interaction(page, "editor.open-symbol", async () => {
			await page.getByRole("link", { name: "Open editable-package.ecadsym", exact: true }).click();
			await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · Editable package");
			await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
			await expect(page.getByTestId("viewport-grid").locator("mask")).toHaveCount(0);
		});
		await page.getByRole("link", { name: "Projects", exact: true }).click();
		await interaction(page, "editor.open-schematic", async () => {
			await page.getByRole("link", { name: "Open Drawing", exact: true }).click();
			await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
			await expect(page.getByTestId("viewport-grid").locator("mask")).toHaveCount(1);
		});
		if (repeat < 2) await page.getByRole("link", { name: "Projects", exact: true }).click();
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-symbol-file", {
		interactionP95Ms: percentile(value.events.filter((event) => event.name === "scenario.interaction").map((event) => event.duration)),
	});
});

test("project-new-symbol", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.getByLabel("Project name", { exact: true }).fill("New symbol workflow");
	await page.getByRole("button", { name: "Create project", exact: true }).click();
	await expect(page.getByRole("heading", { name: "New symbol workflow", exact: true })).toBeVisible();
	await interaction(page, "symbol.create", async () => {
		await page.getByRole("button", { name: "New symbol", exact: true }).click();
		await page.waitForFunction(
			() => document.querySelector('[role="dialog"] input') !== null,
			undefined,
			{ polling: "raf", timeout: 30_000 },
		);
		await page.getByLabel("Symbol name", { exact: true }).fill("New part");
		await page.getByRole("button", { name: "Create symbol", exact: true }).click();
		await editorReady(page, "Symbol editor · New part");
	});
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(710, 400);
	await page.mouse.up();
	await expect.poll(async () => (await report(page)).metrics["project.save"]?.count ?? 0).toBeGreaterThan(2);
	await page.getByRole("link", { name: "Projects", exact: true }).click();
	await page.getByRole("link", { name: "Open new-part.ecadsym", exact: true }).click();
	await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
	await expect(page.getByTestId("viewport-grid").locator("mask")).toHaveCount(0);
	const value = await report(page);
	await finish(page, testInfo, "project-new-symbol", {
		createMs: value.events.find((event) => event.name === "scenario.interaction" && event.data?.name === "symbol.create")!.duration,
	});
});

test("symbol-references", async ({ page }, testInfo) => {
 await page.goto("/projects?perf=1");
 await ready(page);
 await page.getByLabel("Project name", { exact: true }).fill("Symbol references");
 await page.getByRole("button", { name: "Create project", exact: true }).click();
 const child = {
  format: "ecad-symbol", version: 1, units: "mm", id: "reference-child", name: "Reference child", description: "", prefix: "U", value: "",
  shapes: Array.from({ length: 16 }, (_, index) => ({ kind: "pin", name: `Pin ${index + 1}`, x: index < 8 ? -5 : 5, y: (index % 8) - 4 })),
 };
 const parent = {
  ...child, id: "reference-parent", name: "Reference parent",
  shapes: Array.from({ length: 4 }, (_, index) => ({ kind: "symbol", library: { scope: "project", id: "project-symbols" }, definitionId: child.id, x: index * 15 - 22.5, y: 0 })),
 };
 await expect(page.getByLabel("Add symbol files")).toBeEnabled();
 await page.getByLabel("Add symbol files").setInputFiles([child, parent].map(file => ({ name: `${file.id}.ecadsym`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) })));
 await page.getByRole("link", { name: "Open Drawing", exact: true }).click();
 await interaction(page, "reference.place", async () => {
  await page.getByRole("button", { name: "Symbols", exact: true }).click();
  await page.getByRole("button", { name: "Insert Reference parent", exact: true }).click();
  const bounds = (await page.locator("canvas").boundingBox())!;
  await page.locator("canvas").click({ position: { x: bounds.width * 0.4, y: bounds.height / 2 } });
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Reference parent");
 });
 await expect.poll(async () => (await report(page)).events.some(
  event => event.name === "project.save" && event.status === "ok" && event.data?.shapes === 1,
 )).toBe(true);
 await expect.poll(async () => page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("Symbol references");
  const manifest = await (await directory.getFileHandle(".ecadprj")).getFile();
  const path = (await manifest.text()).match(/drawing = "([^"]+)"/)![1].split("/");
  const name = path.pop()!;
  let folder = directory;
  for (const part of path) folder = await folder.getDirectoryHandle(part);
  const drawing = JSON.parse(await (await (await folder.getFileHandle(name)).getFile()).text());
  return drawing.shapes.length === 1 && drawing.shapes[0].library.id === "project-symbols" && !("children" in drawing.shapes[0]) && !("texts" in drawing.shapes[0]);
 })).toBe(true);
 await page.goto("/editor?perf=1");
 await ready(page);
 for (let repeat = 0; repeat < 3; repeat++) {
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await interaction(page, "reference.open-nested", async () => {
   await page.getByRole("link", { name: "Open reference-parent.ecadsym", exact: true }).click();
   await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · Reference parent");
   await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
   await expect(page.getByRole("alert")).toHaveCount(0);
  });
 }
 const value = await report(page);
 await finish(page, testInfo, "symbol-references", {
  interactionP95Ms: metric(value, "scenario.interaction")!,
  resolveP95Ms: metric(value, "drawing.resolve-symbols")!,
 });
});
