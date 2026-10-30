import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { createCircuitComponent, instantiateCircuitPart } from "@ecad/drawing-core/circuit/parts.ts";
import { arrangeCircuitGraph } from "@ecad/drawing-core/circuit/graph.ts";
import { readFile } from "node:fs/promises";
import { closeProjectFiles, openProjectFiles } from "../browser/project-files";
import { generateDefaultSymbols } from "@ecad/default-symbols";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { resolve } from "node:path";
import type { AppPerformance } from "#/performance/browser.ts";
import { pthGerber } from "../fixtures/pth-gerber";
import { drawingPoint, selectSymbolAttribute, selectSymbolParent } from "../browser/symbol-items";
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
const ready = async (page: Page) => {
	await page.mouse.move(900, 50);
	await page.waitForFunction(
		() =>
			window.__ecadPerformance?.snapshot().metrics["app.ready"]?.count === 1,
	);
};

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
	return page.evaluate(
		({ start, name }) => {
			const duration = performance.now() - start;
			window.__ecadPerformance!.record(
				"scenario.interaction",
				duration,
				{ name },
				start,
			);
			return duration;
		},
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
		for (const path of ["/", "/editor", "/gerber", "/step"]) {
			await page.goto(`http://127.0.0.1:4175${path}?perf=1`);
			await ready(page);
		}
		await page.goto("http://127.0.0.1:4175/projects?perf=1");
		await ready(page);
		await expect(
			page.getByLabel("Workspace instructions", { exact: true }),
		).toBeVisible();
		await (await openProjectFiles(page))
			.getByLabel("Add Gerber files")
			.setInputFiles({
				name: "PTH.gbr",
				mimeType: "text/plain",
				buffer: Buffer.from(pthGerber(1, false)),
			});
		await (await openProjectFiles(page)).getByRole("link", { name: "Open PTH.gbr", exact: true }).click();
		await expect
			.poll(
				async () => (await report(page)).metrics["import.gerber"]?.count ?? 0,
			)
			.toBeGreaterThan(0);
		await (await openProjectFiles(page)).getByRole("link", { name: "Workspace home", exact: true }).click();
		await (await openProjectFiles(page))
			.getByLabel("Add STEP files")
			.setInputFiles(
				resolve(
					"node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp",
				),
			);
		await (await openProjectFiles(page))
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
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();
	await expect(page.getByRole("link", { name: "Workspace home", exact: true, includeHidden: true })).toHaveAttribute("title", "Untitled");
	await expect(page.getByRole("button", { name: "Add file", exact: true, includeHidden: true })).toBeEnabled();
	const names = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const result = [];
		for await (const name of root.keys()) if (name.startsWith("Untitled-")) result.push(name);
		return result;
	});
	expect(names).toHaveLength(1);
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
	await openProjectFiles(page);
	await expect(page.getByRole("row")).toHaveCount(51);
	for (let i = 0; i < 3; i++) {
		await interaction(page, "files.next", async () => {
			await page.getByRole("button", { name: "Next files" }).click();
			await expect(
				page.getByText(`file-${48 + i * 50}.gbr`, { exact: true }),
			).toBeVisible();
		});
	}

	const value = await report(page);
	await interaction(page, "files.search", async () => {
		await page.getByLabel("Search project files").fill("file-9999.gbr");
		await expect(page.getByText("file-9999.gbr", { exact: true })).toBeVisible();
		await expect(page.getByRole("row")).toHaveCount(2);
	});
	await page.getByRole("button", { name: "Clear file search" }).click();
	await interaction(page, "files.filter", async () => {
		await page.getByRole("group", { name: "File types" }).getByRole("button", { name: /^Gerber/ }).click();
		await expect(page.getByText("file-0.gbr", { exact: true })).toBeVisible();
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
	await expect(
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();
	await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
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
		.toBeGreaterThan(0);
	await (await openProjectFiles(page)).getByRole("link", { name: "Workspace home", exact: true }).click();
	await (await openProjectFiles(page)).getByLabel("Add Gerber files").setInputFiles({
		name: "PTH.gbr",
		mimeType: "text/plain",
		buffer: Buffer.from(pthGerber(2000, false)),
	});
	await (await openProjectFiles(page)).getByRole("link", { name: "Open PTH.gbr", exact: true }).click();
	await expect
		.poll(async () => (await report(page)).metrics["import.gerber"]?.count ?? 0)
		.toBeGreaterThan(0);
	await expect(page.getByTestId("viewer-message")).toHaveCount(0);
	await (await openProjectFiles(page)).getByRole("link", { name: "Workspace home", exact: true }).click();
	await (await openProjectFiles(page))
		.getByLabel("Add STEP files")
		.setInputFiles(
			resolve(
				"node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp",
			),
		);
	await (await openProjectFiles(page)).getByRole("link", { name: "Open cube.stp", exact: true }).click();
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
 await (await openProjectFiles(page)).getByRole("button", { name: "Project actions", exact: true }).click();
 await page.getByRole("menuitem", { name: "Symbol libraries...", exact: true }).click();
 const user = page.getByRole("group", { name: "User libraries", exact: true });
 await expect(user.getByRole("checkbox")).toHaveCount(11);
 await interaction(page, "library.disable", async () => {
  await user.getByRole("checkbox", { name: "user 0", exact: true }).uncheck();
  await expect(user.getByRole("checkbox", { name: "user 0", exact: true })).toBeEnabled();
 });
 await page.getByRole("button", { name: "Done", exact: true }).click();
 await (await openProjectFiles(page)).getByRole("link", { name: "Schematic editor", exact: true }).click();
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

for (const [scenario, names] of [
	["default-symbols", ["Inductor", "LED", "NPN transistor", "P-channel MOSFET", "Transformer", "8-pin connector"]],
	["microcontroller-symbols", ["RP2040", "RP2350A", "RP2350B"]],
] as const) {
	test(scenario, async ({ page }, testInfo) => {
		await page.goto("/editor?perf=1");
		await ready(page);
		const canvas = page.locator("canvas");
		await expect(canvas).toBeVisible();
		for (const [index, name] of names.entries()) {
			await interaction(page, "symbol.picker", async () => {
				await page.getByRole("button", { name: "Symbols", exact: true }).click();
				await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(generateDefaultSymbols().length);
				await expect(page.getByRole("button", { name: "Insert Resistor", exact: true }).locator("svg")).toHaveCount(1);
				await expect(page.getByRole("button", { name: "Insert RP2350B", exact: true }).locator("svg")).toHaveCount(0);
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
		await finish(page, testInfo, scenario, {
			interactionP95Ms: metric(value, "scenario.interaction")!,
			thumbnailP95Ms: metric(value, "symbol.thumbnail")!,
		});
	});
}

test("editor-symbol-rotate", async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
	const canvas = page.locator("canvas");
	const box = (await canvas.boundingBox())!;
	await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
	const center = page.getByRole("spinbutton", { name: "Center X", exact: true });
	const originalCenter = await center.inputValue();
	for (let repeat = 0; repeat < 3; repeat++) {
		for (const [key, angle] of [["r", 90], ["Shift+r", 0]] as const) {
			await interaction(page, "symbol.rotate", async () => {
				await page.keyboard.press(key);
				await page.waitForFunction(
					(angle) => document.querySelector<HTMLInputElement>('input[aria-label="Angle"]')?.getAttribute("data-committed-value") === String(angle),
					angle,
					{ polling: "raf" },
				);
				await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
			});
		}
	}
	await expect(center).toHaveValue(originalCenter);
	const value = await report(page);
	await finish(page, testInfo, "editor-symbol-rotate", {
		interactionP95Ms: metric(value, "scenario.interaction")!,
	});
});

test("editor-symbol-duplicate", async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	const source = { x: bounds.x + bounds.width * 0.35, y: bounds.y + bounds.height * 0.5 };
	await page.mouse.click(source.x, source.y);
	await expect(page.getByRole("textbox", { name: "Reference", exact: true })).toHaveValue("R1");
	for (let repeat = 0; repeat < 3; repeat++) {
		await interaction(page, "symbol.duplicate", async () => {
			await page.keyboard.down("Alt");
			await page.mouse.move(source.x, source.y);
			await page.mouse.down();
			await page.mouse.move(source.x + 80 + repeat * 40, source.y + 60, { steps: 4 });
			await page.mouse.up();
			await page.keyboard.up("Alt");
			await page.waitForFunction(
				(reference) => document.querySelector<HTMLInputElement>('input[aria-label="Reference"]')?.value === reference,
				`R${repeat + 2}`,
				{ polling: "raf" },
			);
		});
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-symbol-duplicate", {
		interactionP95Ms: metric(value, "scenario.interaction")!,
	});
});

test("editor-wire-crossings", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async () => {
		const shapes = [0, 1].flatMap((axis) => Array.from({ length: 20 }, (_, index) => ({
			id: axis * 20 + index + 1, kind: "wire",
			x: axis ? index * 6 - 57 : 0, y: axis ? 0 : index * 6 - 57,
			width: 126, height: 0.254, lineWidth: 0.254, rotation: axis * Math.PI / 2,
		})));
		const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Crossing fixture", { create: true });
		for (const [name, content] of [
			[".ecadprj", 'format = "ecad-project"\nversion = 1\nname = "Crossing fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n'],
			["drawing.ecaddraw", JSON.stringify({ shapes })],
		]) {
			const writer = await (await directory.getFileHandle(name, { create: true })).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Crossing fixture");
	});
	await page.goto("/editor?perf=1");
	await ready(page);
	const canvas = page.locator("canvas");
	await expect(canvas).toBeVisible();
	await expect.poll(async () => (await report(page)).metrics["editor.wire-crossings"]?.count ?? 0).toBeGreaterThan(0);
	const bounds = (await canvas.boundingBox())!;
	for (let repeat = 0; repeat < 3; repeat++) {
		await interaction(page, "crossings.select-all", async () => {
			await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.2);
			await page.mouse.down();
			await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.8);
			await page.mouse.up();
			await expect(page.getByText("Selected shapes", { exact: true })).toBeVisible();
		});
		await page.getByRole("button", { name: "Clear selection", exact: true }).click();
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-wire-crossings", {
		interactionP95Ms: metric(value, "scenario.interaction")!,
		crossingsP95Ms: metric(value, "editor.wire-crossings")!,
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

test("editor-pin-leads", async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	await (await toolbarButton(page, "Pin")).click();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	await canvas.click({ position: { x: bounds.width * 0.4, y: bounds.height / 2 } });
	await expect(page.getByRole("spinbutton", { name: "Lead length", exact: true })).toHaveValue("2");
	for (const [label, value] of [["Name", "Signal"], ["Number", "1"]]) {
		await page.getByRole("textbox", { name: label, exact: true }).fill(value);
		await page.getByRole("textbox", { name: label, exact: true }).press("Enter");
	}
	for (let repeat = 0; repeat < 3; repeat++) {
		for (const [label, value] of [["Lead length", 3 + repeat], ["Angle", 90 * (repeat + 1)], ["Center X", 5 + repeat]] as const) {
			await interaction(page, "pin.edit-lead", async () => {
				const input = page.getByRole("spinbutton", { name: label, exact: true });
				await input.fill(String(value));
				await input.press("Enter");
				await page.waitForFunction(({ label, value }) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.getAttribute("data-committed-value") === String(value), { label, value });
			});
		}
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-pin-leads", { interactionP95Ms: metric(value, "scenario.interaction")! });
});

for (const scenario of ["editor-pin-labels", "editor-pin-visibility"] as const) {
	test(scenario, async ({ page }, testInfo) => {
		await page.goto("/projects?perf=1");
		await ready(page);
		await expect(page.getByLabel("Workspace instructions", { exact: true })).toBeVisible();
		const symbol = {
			format: "ecad-symbol", version: 1, units: "mm", id: "labeled-package", name: "Labeled package", description: "", prefix: "U", value: "",
			shapes: Array.from({ length: 128 }, (_, index) => ({ kind: "pin", name: `Signal ${index + 1}`, number: String(index + 1).padStart(3, "0"), x: index < 64 ? -20 : 20, y: (index % 64) * 4 - 128 })),
		};
		await expect((await openProjectFiles(page)).getByLabel("Add symbol files")).toBeEnabled();
		await (await openProjectFiles(page)).getByLabel("Add symbol files").setInputFiles({ name: "labeled.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(symbol)) });
		await (await openProjectFiles(page)).getByRole("link", { name: "Open labeled-package.ecadsym", exact: true }).click();
		await editorReady(page, "Symbol editor · Labeled package");
		await (await toolbarButton(page, "Pin")).click();
		const canvas = page.locator("canvas");
		const bounds = (await canvas.boundingBox())!;
		await canvas.click({ position: { x: bounds.width * 0.4, y: bounds.height / 2 } });
		if (scenario === "editor-pin-visibility") {
			for (const [label, value] of [["Name", "RUN"], ["Number", "26"]]) {
				await page.getByRole("textbox", { name: label, exact: true }).fill(value);
				await page.getByRole("textbox", { name: label, exact: true }).press("Enter");
			}
			for (let repeat = 0; repeat < 3; repeat++) {
				for (const label of ["Show name", "Show number"]) {
					await interaction(page, "pin.edit-visibility", async () => {
						const before = (await report(page)).metrics["renderer.frame"]?.count ?? 0;
						const input = page.getByRole("checkbox", { name: label, exact: true });
						await input.setChecked(repeat % 2 === 1);
						await expect(input).toBeChecked({ checked: repeat % 2 === 1 });
						await page.waitForFunction((before) => (window.__ecadPerformance!.snapshot().metrics["renderer.frame"]?.count ?? 0) > before, before);
					});
				}
			}
		} else for (let repeat = 0; repeat < 3; repeat++) {
			await interaction(page, "pin.edit-labels", async () => {
				const before = (await report(page)).metrics["renderer.frame"]?.count ?? 0;
				for (const [label, value] of [["Name", `VCC${repeat}`], ["Number", `A${repeat + 1}`]]) {
					await page.getByRole("textbox", { name: label, exact: true }).fill(value);
					await page.getByRole("textbox", { name: label, exact: true }).press("Enter");
				}
				await page.waitForFunction((before) => (window.__ecadPerformance!.snapshot().metrics["renderer.frame"]?.count ?? 0) > before, before);
			});
		}
		const value = await report(page);
		await finish(page, testInfo, scenario, {
			interactionP95Ms: metric(value, "scenario.interaction")!,
		});
	});
}

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

test("editor-line-styles", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async () => {
		const kinds = ["rectangle", "circle", "triangle", "line"];
		const styles = ["dashed", "dotted", "dash-dot", "dash-dot-dot"];
		const shapes = Array.from({ length: 100 }, (_, index) => ({
			id: index + 1, kind: kinds[index % kinds.length],
			x: -90 + (index % 10) * 20, y: -54 + Math.floor(index / 10) * 12,
			width: 12, height: kinds[index % kinds.length] === "circle" ? 12 : 8,
			rotation: 0, lineWidth: 0.4, lineStyle: styles[Math.floor(index / 4) % styles.length],
		}));
		const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Line style fixture", { create: true });
		for (const [name, content] of [
			[".ecadprj", 'format = "ecad-project"\nversion = 1\nname = "Line style fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n'],
			["drawing.ecaddraw", JSON.stringify({ shapes })],
		]) {
			const writer = await (await directory.getFileHandle(name, { create: true })).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Line style fixture");
	});
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect.poll(async () => (await report(page)).metrics["editor.line-style-geometry"]?.count ?? 0).toBeGreaterThan(0);
	const bounds = (await page.locator("canvas").boundingBox())!;
	await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.8);
	await page.mouse.up();
	await expect(page.getByText("Selected shapes", { exact: true })).toBeVisible();
	const select = page.getByRole("combobox", { name: "Line style", exact: true });
	for (const style of ["dashed", "dotted", "dash-dot-dot"]) {
		await interaction(page, "line-style.change", async () => {
			await select.selectOption(style);
			await page.waitForFunction((style) => document.querySelector<HTMLSelectElement>('select[aria-label="Line style"]')?.value === style, style);
			await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		});
	}
	await expect.poll(async () => page.evaluate(async () => {
		const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Line style fixture");
		const manifest = await (await directory.getFileHandle(".ecadprj")).getFile();
		const path = (await manifest.text()).match(/^drawing\s*=\s*"([^"]+)"/m)![1].split("/");
		const name = path.pop()!;
		let folder = directory;
		for (const segment of path) folder = await folder.getDirectoryHandle(segment);
		const file = await (await folder.getFileHandle(name)).getFile();
		return JSON.parse(await file.text()).shapes.every((shape: { lineStyle: string }) => shape.lineStyle === "dash-dot-dot");
	})).toBe(true);
	const interactionP95Ms = metric(await report(page), "scenario.interaction")!;
	await page.reload();
	await ready(page);
	await expect.poll(async () => (await report(page)).metrics["editor.line-style-geometry"]?.count ?? 0).toBeGreaterThan(0);
	const value = await report(page);
	await finish(page, testInfo, "editor-line-styles", {
		interactionP95Ms,
		styleGeometryP95Ms: metric(value, "editor.line-style-geometry")!,
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
						.symbolLibraries[0].source.symbols[0].shapes.length === count,
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
	await expect((await openProjectFiles(page)).getByLabel("Add symbol files")).toBeEnabled();
	const symbol = {
		format: "ecad-symbol", version: 1, units: "mm", id: "editable-package", name: "Editable package", description: "", prefix: "U", value: "",
		shapes: Array.from({ length: 128 }, (_, index) => ({ kind: "pin", name: `Pin ${index + 1}`, x: index < 64 ? -10 : 10, y: (index % 64) - 32 })),
	};
	await (await openProjectFiles(page)).getByLabel("Add symbol files").setInputFiles({ name: "package.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(symbol)) });
	for (let repeat = 0; repeat < 3; repeat++) {
		await (await openProjectFiles(page)).getByRole("link", { name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/, exact: true }).click();
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
		if (repeat < 2) await (await openProjectFiles(page)).getByRole("link", { name: "Workspace home", exact: true }).click();
	}
	const value = await report(page);
	await finish(page, testInfo, "editor-symbol-attributes", {
		interactionP95Ms: percentile(value.events.filter((event) => event.name === "scenario.interaction").map((event) => event.duration)),
	});
});

test("editor-symbol-file", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await expect(page.getByLabel("Workspace instructions", { exact: true })).toBeVisible();
	const symbol = {
		format: "ecad-symbol", version: 1, units: "mm", id: "editable-package", name: "Editable package", description: "", prefix: "U", value: "",
		shapes: Array.from({ length: 128 }, (_, index) => ({ kind: "pin", name: `Pin ${index + 1}`, x: index < 64 ? -10 : 10, y: (index % 64) - 32 })),
	};
	await expect((await openProjectFiles(page)).getByLabel("Add symbol files")).toBeEnabled();
	await (await openProjectFiles(page)).getByLabel("Add symbol files").setInputFiles({ name: "package.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(symbol)) });
	const coldOpenMs = await interaction(page, "editor.open-symbol-cold", async () => {
		await (await openProjectFiles(page)).getByRole("link", { name: "Open editable-package.ecadsym", exact: true }).click();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · Editable package");
		await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
		await expect(page.getByTestId("viewport-grid").locator("mask")).toHaveCount(0);
	});
	await (await openProjectFiles(page)).getByRole("link", { name: "Workspace home", exact: true }).click();
	const timings: number[] = [];
	for (let repeat = 0; repeat < 3; repeat++) {
		timings.push(await interaction(page, "editor.open-symbol", async () => {
			await (await openProjectFiles(page)).getByRole("link", { name: "Open editable-package.ecadsym", exact: true }).click();
			await expect(page.getByRole("heading", { level: 1 })).toHaveText("Symbol editor · Editable package");
			await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
			await expect(page.getByTestId("viewport-grid").locator("mask")).toHaveCount(0);
		}));
		await (await openProjectFiles(page)).getByRole("link", { name: "Workspace home", exact: true }).click();
		timings.push(await interaction(page, "editor.open-schematic", async () => {
			await (await openProjectFiles(page)).getByRole("link", { name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/, exact: true }).click();
			await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
			await expect(page.getByTestId("viewport-grid").locator("mask")).toHaveCount(1);
		}));
		if (repeat < 2) await (await openProjectFiles(page)).getByRole("link", { name: "Workspace home", exact: true }).click();
	}
	await finish(page, testInfo, "editor-symbol-file", {
		coldOpenMs,
		interactionP95Ms: percentile(timings),
	});
});

test("project-file-sidebar", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await expect((await openProjectFiles(page)).getByRole("button", { name: "Add file", exact: true })).toBeEnabled();
	await page.evaluate(async () => {
		const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(localStorage.getItem("ecad.active-project")!);
		const handle = await directory.getFileHandle(".ecadprj");
		const manifest = (await (await handle.getFile()).text()).replace(/^assets\s*=\s*\[\s*\]\s*$/m, "");
		const writer = await handle.createWritable();
		await writer.write(manifest + Array.from({ length: 10000 }, (_, index) => `\n[[assets]]\npath = "assets/file-${index}.gbr"\nname = "file-${index}.gbr"\nkind = "gerber"\n`).join(""));
		await writer.close();
	});
	await page.reload();
	await ready(page);
	expect(await page.getByRole("alert").count()).toBe(0);
	const sidebar = await openProjectFiles(page);
	await expect(sidebar.getByLabel("Add symbol files")).toBeEnabled();
	await sidebar.getByLabel("Add symbol files").setInputFiles({ name: "package.ecadsym", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
		format: "ecad-symbol", version: 1, units: "mm", id: "sidebar-package", name: "Sidebar package", description: "", prefix: "U", value: "",
		shapes: Array.from({ length: 128 }, (_, index) => ({ kind: "pin", name: `Pin ${index + 1}`, x: index < 64 ? -10 : 10, y: (index % 64) - 32 })),
	})) });
	await sidebar.evaluate(element => { element.setAttribute("data-test-identity", "persistent"); });
	for (let repeat = 0; repeat < 3; repeat++) {
		await sidebar.getByLabel("Search project files").fill("sidebar-package");
		await interaction(page, "sidebar.open-symbol", async () => {
			await sidebar.getByRole("link", { name: "Open sidebar-package.ecadsym", exact: true }).click();
			await editorReady(page, "Symbol editor · Sidebar package");
		});
		await expect(sidebar).toHaveAttribute("data-test-identity", "persistent");
		await expect(sidebar.getByLabel("Search project files")).toHaveValue("sidebar-package");
		await sidebar.getByRole("button", { name: "Clear file search" }).click();
		await interaction(page, "sidebar.open-drawing", async () => {
			await sidebar.getByRole("link", { name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/, exact: true }).click();
			await page.waitForFunction(() => document.querySelector("h1")?.textContent?.startsWith("Schematic editor") && document.querySelector<HTMLButtonElement>('button[aria-label="Select"]')?.disabled === false, undefined, { polling: "raf" });
		});
		await expect(page.getByRole("tree", { name: "Drawing items" })).toHaveCount(0);
	}
	await closeProjectFiles(page);
	await page.mouse.move(900, 400);
	const railNavigationTimes: number[] = [];
	for (let repeat = 0; repeat < 3; repeat++) {
		await openProjectFiles(page);
		await sidebar.getByRole("link", { name: "STEP viewer", exact: true }).click();
		railNavigationTimes.push(await interaction(page, "sidebar.rail-navigation", async () => {
			await sidebar.getByRole("link", { name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/, exact: true }).click();
			await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('button[aria-label="Select"]')?.disabled === false, undefined, { polling: "raf" });
		}));
		await page.mouse.move(900, 400);
		await expect(sidebar).toHaveAttribute("data-open", "false");
		expect((await page.locator("canvas").boundingBox())!.x).toBe(0);
	}
	const hoverRevealMs = await interaction(page, "sidebar.reveal", async () => { await openProjectFiles(page); });
	const menuOpenTimes: number[] = [];
	for (let repeat = 0; repeat < 3; repeat++) {
		menuOpenTimes.push(await interaction(page, "sidebar.add-file-menu", async () => {
			await sidebar.getByRole("button", { name: "Add file", exact: true }).click();
			await page.waitForFunction(() => document.querySelectorAll('[role="menu"] [role="menuitem"]').length >= 3, undefined, { polling: "raf" });
		}));
		await page.keyboard.press("Escape");
		await expect(sidebar.getByRole("button", { name: "Add file", exact: true })).toBeFocused();
	}
	const pinTimes: number[] = [];
	for (let repeat = 0; repeat < 3; repeat++) {
		pinTimes.push(await interaction(page, "sidebar.pin", async () => {
			await sidebar.getByRole("button", { name: "Pin sidebar", exact: true }).click();
			await page.waitForFunction(() => document.querySelector("canvas")?.getBoundingClientRect().x === 256, undefined, { polling: "raf" });
		}));
		await page.mouse.move(900, 400);
		await expect(sidebar).toHaveAttribute("data-open", "true");
		if (repeat === 2) await page.screenshot({ path: "perf-artifacts/sidebar-pinned-performance.png" });
		await sidebar.getByRole("button", { name: "Compact sidebar", exact: true }).click();
		await page.waitForFunction(() => document.querySelector("canvas")?.getBoundingClientRect().x === 0, undefined, { polling: "raf" });
	}
	await page.screenshot({ path: "perf-artifacts/sidebar-layout-performance.png" });
	await page.setViewportSize({ width: 390, height: 844 });
	await closeProjectFiles(page);
	await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
	await page.getByRole("button", { name: "Show project files" }).click();
	await page.screenshot({ path: "perf-artifacts/sidebar-layout-performance-mobile.png" });
	await closeProjectFiles(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.getByRole("button", { name: "Show project files" }).click();
	const value = await report(page);
	await finish(page, testInfo, "project-file-sidebar", { pinMs: percentile(pinTimes), hoverRevealMs, railNavigationMs: percentile(railNavigationTimes), menuOpenMs: percentile(menuOpenTimes), interactionP95Ms: metric(value, "scenario.interaction")! });
});

test("project-new-drawing", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await expect(page.getByLabel("Workspace instructions", { exact: true })).toBeVisible();
	const createMs = await interaction(page, "drawing.create", async () => {
		await (await openProjectFiles(page)).getByRole("button", { name: "Add file", exact: true }).click();
		await page.getByRole("menuitem", { name: "New drawing", exact: true }).click();
		await page.getByLabel("Drawing name", { exact: true }).fill("Power stage");
		await page.getByRole("button", { name: "Create drawing", exact: true }).click();
		await page.waitForFunction(() => document.querySelector("h1")?.textContent?.startsWith("Schematic editor · Power stage") && document.querySelector<HTMLButtonElement>('button[aria-label="Select"]')?.disabled === false, undefined, { polling: "raf", timeout: 30_000 });
	});
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(710, 400);
	await page.mouse.up();
	await expect.poll(async () => (await report(page)).metrics["project.save"]?.count ?? 0).toBeGreaterThan(1);
	await page.goto("/projects?perf=1");
	await ready(page);
	const switchTimes: number[] = [];
	for (let repeat = 0; repeat < 3; repeat++) {
		const sidebar = await openProjectFiles(page);
		switchTimes.push(await interaction(page, "drawing.reopen", async () => {
			await sidebar.getByRole("link", { name: "Open Power stage.ecaddraw", exact: true }).click();
			await page.waitForFunction(() => document.querySelector("h1")?.textContent?.startsWith("Schematic editor · Power stage") && document.querySelector<HTMLButtonElement>('button[aria-label="Select"]')?.disabled === false, undefined, { polling: "raf" });
		}));
		await sidebar.getByRole("link", { name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/, exact: true }).click();
		await page.waitForFunction(() => document.querySelector("h1")?.textContent?.startsWith("Schematic editor · A3") && document.querySelector<HTMLButtonElement>('button[aria-label="Select"]')?.disabled === false, undefined, { polling: "raf" });
	}
	await finish(page, testInfo, "project-new-drawing", { createMs, interactionP95Ms: percentile(switchTimes) });
});

test("project-new-symbol", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await expect(page.getByLabel("Workspace instructions", { exact: true })).toBeVisible();
	await interaction(page, "symbol.create", async () => {
		await (await openProjectFiles(page)).getByRole("button", { name: "Add file", exact: true }).click();
		await page.getByRole("menuitem", { name: "New symbol", exact: true }).click();
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
	await expect.poll(async () => (await report(page)).metrics["project.save"]?.count ?? 0).toBeGreaterThan(1);
	await (await openProjectFiles(page)).getByRole("link", { name: "Workspace home", exact: true }).click();
	await (await openProjectFiles(page)).getByRole("link", { name: "Open new-part.ecadsym", exact: true }).click();
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
 await expect(page.getByLabel("Workspace instructions", { exact: true })).toBeVisible();
 const child = {
  format: "ecad-symbol", version: 1, units: "mm", id: "reference-child", name: "Reference child", description: "", prefix: "U", value: "",
  shapes: Array.from({ length: 16 }, (_, index) => ({ kind: "pin", name: `Pin ${index + 1}`, x: index < 8 ? -5 : 5, y: (index % 8) - 4 })),
 };
 const parent = {
  ...child, id: "reference-parent", name: "Reference parent",
  shapes: Array.from({ length: 4 }, (_, index) => ({ kind: "symbol", library: { scope: "project", id: "project-symbols" }, definitionId: child.id, x: index * 15 - 22.5, y: 0 })),
 };
 await expect((await openProjectFiles(page)).getByLabel("Add symbol files")).toBeEnabled();
 await (await openProjectFiles(page)).getByLabel("Add symbol files").setInputFiles([child, parent].map(file => ({ name: `${file.id}.ecadsym`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) })));
 await (await openProjectFiles(page)).getByRole("link", { name: /^(?:Open Drawing|Open Untitled\.ecaddraw)$/, exact: true }).click();
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
  const directory = await root.getDirectoryHandle(localStorage.getItem("ecad.active-project")!);
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
  await (await openProjectFiles(page)).getByRole("link", { name: "Workspace home", exact: true }).click();
  await interaction(page, "reference.open-nested", async () => {
   await (await openProjectFiles(page)).getByRole("link", { name: "Open reference-parent.ecadsym", exact: true }).click();
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

for (const connectionKind of ["wire", "pin"] as const) test(`editor-${connectionKind}-junction`, async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async () => {
		const shapes = Array.from({ length: 200 }, (_, index) => ({
			id: index + 1, kind: "wire", x: 80 + index % 10 * 6,
			y: 60 + Math.floor(index / 10) * 3, width: 4, height: 0.254,
			lineWidth: 0.254, rotation: 0,
		}));
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle("Junction fixture", { create: true });
		for (const [name, content] of [
			[".ecadprj", 'format = "ecad-project"\nversion = 1\nname = "Junction fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n'],
			["drawing.ecaddraw", JSON.stringify({ shapes })],
		]) {
			const writer = await (await directory.getFileHandle(name, { create: true })).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Junction fixture");
	});
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(page.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	const start = { x: bounds.width * 0.25, y: bounds.height * 0.6 };
	const end = { x: bounds.width * 0.55, y: start.y };
	const branch = { x: bounds.width * 0.4, y: bounds.height * 0.4 };
	await (await toolbarButton(page, "Pin")).click();
	await canvas.click({ position: start });
	await canvas.click({ position: start });
	await canvas.click({ position: end });
	await page.keyboard.press("Enter");
	if (connectionKind === "wire") {
		await (await toolbarButton(page, "Pin")).click();
		await canvas.click({ position: branch });
	}
	for (let repeat = 0; repeat < 3; repeat++) {
		if (connectionKind === "wire") {
			await canvas.click({ position: branch });
			await expect(page.locator('[data-tool="wire"]')).toBeAttached();
		} else await (await toolbarButton(page, "Pin")).click();
		await interaction(page, `${connectionKind}.join-segment`, async () => {
			await canvas.click({ position: { x: branch.x, y: start.y } });
			await page.waitForFunction(() => document.querySelector('[data-tool="select"]'));
		});
		if (repeat < 2) await (await toolbarButton(page, "Undo")).click();
	}
	await expect.poll(async () => page.evaluate(async () => {
		let directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Junction fixture");
		const manifest = await (await directory.getFileHandle(".ecadprj")).getFile();
		const path = (await manifest.text()).match(/^drawing\s*=\s*"([^"]+)"/m)![1].split("/");
		const name = path.pop()!;
		for (const part of path) directory = await directory.getDirectoryHandle(part);
		const file = await (await directory.getFileHandle(name)).getFile();
		return JSON.parse(await file.text()).shapes.length;
	})).toBe(connectionKind === "wire" ? 205 : 204);
	const value = await report(page);
	await finish(page, testInfo, `editor-${connectionKind}-junction`, {
		interactionP95Ms: metric(value, "scenario.interaction")!,
		normalizationP95Ms: metric(value, "editor.wire-normalize")!,
	});
});

test("editor-symbol-text", async ({ page }, testInfo) => {
 await page.goto("/editor?perf=1");
 await ready(page);
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
 const canvas = page.locator("canvas");
 const box = (await canvas.boundingBox())!;
 await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
 const center = page.getByRole("spinbutton", { name: "Center X", exact: true });
 const initialCenter = await center.inputValue();
 for (let repeat = 0; repeat < 3; repeat++) {
  for (const attribute of ["Reference", "Value"]) {
   await selectSymbolAttribute(page, attribute.toLowerCase());
   await interaction(page, "symbol.text-position", async () => {
    const input = page.getByRole("spinbutton", { name: "Anchor X", exact: true });
    await input.fill(String(10 + repeat * 5));
    await input.press("Tab");
    await page.waitForFunction(({ expected }) => document.querySelector<HTMLInputElement>('input[aria-label="Anchor X"]')?.getAttribute("data-committed-value") === String(expected),
     { attribute, expected: 10 + repeat * 5 }, { polling: "raf" });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

   });
   await selectSymbolParent(page);
   await expect(center).toHaveValue(initialCenter);
  }
 }
 const value = await report(page);
 await finish(page, testInfo, "editor-symbol-text", { interactionP95Ms: metric(value, "scenario.interaction")! });
});


test("editor-component-move", async ({ page }, testInfo) => {
	const { createSymbol, symbolDefinitions } = await import(
		"#/drawing/symbols.ts"
	);
	const { drawShape } = await import("#/drawing/shapes.ts");
	const shapes = [
		...Array.from({ length: 200 }, (_, index) =>
			drawShape(
				index + 1,
				"wire",
				{ x: 80 + (index % 10) * 6, y: 60 + Math.floor(index / 10) * 3 },
				{ x: 84 + (index % 10) * 6, y: 60 + Math.floor(index / 10) * 3 },
			),
		),
		createSymbol(201, symbolDefinitions[0], { x: 0, y: 0 }),
		drawShape(202, "wire", { x: 3, y: 0 }, { x: 40, y: 0 }),
		drawShape(203, "pin", { x: -3, y: 0 }, { x: -3, y: 0 }),
	];
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async (shapes) => {
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle("Component movement", {
			create: true,
		});
		for (const [name, content] of [
			[
				".ecadprj",
				'format = "ecad-project"\nversion = 1\nname = "Component movement"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
			],
			["drawing.ecaddraw", JSON.stringify({ shapes })],
		]) {
			const writer = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Component movement");
	}, shapes);
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	const source = {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2,
	};
	for (let repeat = 0; repeat < 3; repeat++) {
		await interaction(page, "component.move-connected", async () => {
			await page.mouse.move(source.x, source.y);
			await page.mouse.down();
			await page.mouse.move(source.x + 40, source.y - 60, { steps: 4 });
			await page.mouse.up();
			await page.waitForFunction(
				() => {
					const value = document
						.querySelector<HTMLInputElement>('input[aria-label="Center X"]')
						?.getAttribute("data-committed-value");
					return value !== null && value !== undefined && Number(value) > 0;
				},
				undefined,
				{ polling: "raf" },
			);
		});
		if (repeat < 2) await (await toolbarButton(page, "Undo")).click();
	}
	await expect
		.poll(async () =>
			page.evaluate(async () => {
				const directory = await (
					await navigator.storage.getDirectory()
				).getDirectoryHandle("Component movement");
				const manifest = await (
					await directory.getFileHandle(".ecadprj")
				).getFile();
				const path = (await manifest.text())
					.match(/^drawing\s*=\s*"([^"]+)"/m)![1]
					.split("/");
				let current = directory;
				const name = path.pop()!;
				for (const part of path)
					current = await current.getDirectoryHandle(part);
				return JSON.parse(
					await (await (await current.getFileHandle(name)).getFile()).text(),
				).shapes.length;
			}),
		)
		.toBe(207);
	const value = await report(page);
	await finish(page, testInfo, "editor-component-move", {
		interactionP95Ms: metric(value, "scenario.interaction")!,
		normalizationP95Ms: metric(value, "editor.wire-normalize")!,
	});
});


test("editor-text-alignment", async ({ page }, testInfo) => {
 await page.addInitScript(() => {
 const file = { format: "ecad-symbol", version: 1, units: "mm", id: "alignment-connector", name: "Alignment connector", description: "", prefix: "J", value: "", shapes: [
 { kind: "rectangle", x: 0, y: 0, width: 40, height: 30 },
 ...Array.from({ length: 12 }, (_, index) => ({ kind: "text", text: `Terminal ${index + 1}`, fontSize: 1.3, width: 8, height: 2, x: -15 + (index % 4) * 10, y: 10 - Math.floor(index / 4) * 10, horizontalAlign: "left", verticalAlign: "top" })),
 ] };
 localStorage.setItem("ecad.user-config.v1", JSON.stringify({ version: 1, symbolLibraries: [{ id: "builtin", name: "Built-in symbols", enabled: true, source: { kind: "builtin" } }, { id: "alignment", name: "Alignment", enabled: true, source: { kind: "embedded", symbols: [file] } }] }));
 });
 await page.goto("/editor?perf=1");
 await ready(page);
 const canvas = page.locator("canvas");
 const box = (await canvas.boundingBox())!;
 for (const x of [0.3, 0.6]) {
 await interaction(page, "symbol.text-placement", async () => {
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Alignment connector", exact: true }).click();
 await canvas.click({ position: { x: box.width * x, y: box.height * 0.7 } });
 await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
 });
 }
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Resistor", exact: true }).click();
 await canvas.click({ position: { x: box.width * 0.4, y: box.height * 0.5 } });
 const center = await page.getByRole("spinbutton", { name: "Center X", exact: true }).inputValue();
 await selectSymbolAttribute(page, "reference");
 for (const [horizontal, vertical] of [["left", "top"], ["center", "middle"], ["right", "bottom"]]) {
  await interaction(page, "symbol.text-alignment", async () => {
   await page.getByRole("combobox", { name: "Text horizontal alignment", exact: true }).selectOption(horizontal);
   await page.getByRole("combobox", { name: "Text vertical alignment", exact: true }).selectOption(vertical);
   await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  });
 }
 await selectSymbolParent(page);
 await expect(page.getByRole("spinbutton", { name: "Center X", exact: true })).toHaveValue(center);
 await (await toolbarButton(page, "Text")).click();
 await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.5 } });
 const content = page.getByRole("textbox", { name: "Text content", exact: true });
 await content.fill("Supply voltage\n3.3 V");
 await content.press("Tab");
 for (const [horizontal, vertical] of [["left", "top"], ["center", "middle"], ["right", "bottom"]]) {
  await interaction(page, "text.alignment", async () => {
   await page.getByRole("combobox", { name: "Text horizontal alignment", exact: true }).selectOption(horizontal);
   await page.getByRole("combobox", { name: "Text vertical alignment", exact: true }).selectOption(vertical);
   await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  });
 }
 const value = await report(page);
 await finish(page, testInfo, "editor-text-alignment", { interactionP95Ms: metric(value, "scenario.interaction")! });
});

test("editor-symbol-children", async ({ page }, testInfo) => {
 await page.addInitScript(() => {
  const file = { format: "ecad-symbol", version: 1, units: "mm", id: "hierarchy-part", name: "Hierarchy part", description: "", prefix: "U", value: "", shapes: [
   { kind: "rectangle", x: 0, y: 0, width: 40, height: 160, locked: false },
   { kind: "text", text: "Controller", x: 0, y: 0, width: 15, height: 3, fontSize: 2 },
   ...Array.from({ length: 128 }, (_, index) => ({ kind: "pin", x: index < 64 ? -20 : 20, y: (index % 64 - 32) * 2.54, name: `Signal ${index + 1}`, number: String(index + 1), locked: false })),
  ] };
  localStorage.setItem("ecad.user-config.v1", JSON.stringify({ version: 1, symbolLibraries: [{ id: "hierarchy", name: "Hierarchy", enabled: true, source: { kind: "embedded", symbols: [file] } }] }));
 });
 await page.goto("/editor?perf=1");
 await ready(page);
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Hierarchy part", exact: true }).click();
 const canvas = page.locator("canvas");
 const box = (await canvas.boundingBox())!;
 await canvas.click({ position: { x: box.width * 0.45, y: box.height * 0.5 } });
 const center = await page.getByRole("spinbutton", { name: "Center X", exact: true }).inputValue();
 const parent = { x: Number(center), y: Number(await page.getByRole("spinbutton", { name: "Center Y", exact: true }).inputValue()) };
 const children = [{ kind: "rectangle", x: 0, y: 0, label: "Center X" }, { kind: "text", x: 0, y: 0, label: "Anchor X" }, { kind: "pin", x: -20, y: 0, label: "Center X" }];
 for (let repeat = 0; repeat < 3; repeat++) {
  for (const child of children) {
   await interaction(page, "symbol.child-edit", async () => {
    const point = await drawingPoint(page, { x: parent.x + child.x + (child.kind === "rectangle" ? 10 : 0), y: parent.y + child.y + (child.kind === "rectangle" ? 30 : 0) });
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    if (child.kind === "pin") {
     await page.mouse.move(point.x + 4, point.y); await page.mouse.move(point.x, point.y);
    }
    await page.mouse.up();
    await expect(page.getByTestId("symbol-child-selection")).toBeVisible();
    const { label } = child;
    const input = page.getByRole("spinbutton", { name: label, exact: true });
    const value = child.kind === "pin" ? -20 + repeat : 5 + repeat;
    await input.fill(String(value)); await input.press("Tab");
    child.x = value;
    await page.waitForFunction(({ label, value }) => document.querySelector(`input[aria-label="${label}"]`)?.getAttribute("data-committed-value") === String(value), { label, value }, { polling: "raf" });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
   });
   await selectSymbolParent(page);
   await expect(page.getByRole("spinbutton", { name: "Center X", exact: true })).toHaveValue(center);
  }
 }
 const value = await report(page);
 await finish(page, testInfo, "editor-symbol-children", { interactionP95Ms: metric(value, "scenario.interaction")! });
});

test("editor-item-locks", async ({ page }, testInfo) => {
 await page.addInitScript(() => {
  const file = { format: "ecad-symbol", version: 1, units: "mm", id: "lock-part", name: "Lock part", description: "", prefix: "U", value: "", shapes: [
   { kind: "rectangle", x: 0, y: 0, width: 40, height: 160 },
   { kind: "text", text: "Controller", x: 0, y: 0, width: 15, height: 3, fontSize: 2 },
   ...Array.from({ length: 128 }, (_, index) => ({ kind: "pin", x: index < 64 ? -20 : 20, y: (index % 64 - 32) * 2.54, name: `Signal ${index + 1}`, number: String(index + 1), locked: index === 0 })),
  ] };
  localStorage.setItem("ecad.user-config.v1", JSON.stringify({ version: 1, symbolLibraries: [{ id: "locks", name: "Locks", enabled: true, source: { kind: "embedded", symbols: [file] } }] }));
 });
 await page.goto("/editor?perf=1");
 await ready(page);
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Lock part", exact: true }).click();
 const canvas = page.locator("canvas");
 const box = (await canvas.boundingBox())!;
 const position = { x: box.width * 0.45, y: box.height * 0.5 };
 await canvas.click({ position });
 await expect(page.getByTestId("symbol-child-selection")).toHaveCount(0);
 for (let repeat = 0; repeat < 3; repeat++) {
  await interaction(page, "symbol.lock", async () => {
   if (repeat === 1) await page.getByRole("checkbox", { name: "Locked", exact: true }).click();
   else await page.getByRole("button", { name: "Lock selection", exact: true }).click();
   await page.waitForFunction(() => !document.querySelector('[aria-label="Selection attributes"]'), undefined, { polling: "raf" });
  });
  await interaction(page, "symbol.select-locked", async () => {
   await page.getByRole("button", { name: "Select locked items", exact: true }).click();
   await canvas.click({ position });
   await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('button[aria-label="Unlock selection"]')?.disabled === false, undefined, { polling: "raf" });
  });
  await interaction(page, "symbol.unlock", async () => {
   if (repeat === 1) await page.getByRole("checkbox", { name: "Locked", exact: true }).uncheck();
   else await page.getByRole("button", { name: "Unlock selection", exact: true }).click();
   await page.getByRole("button", { name: "Select locked items", exact: true }).click();
   await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('button[aria-label="Lock selection"]')?.disabled === false, undefined, { polling: "raf" });
  });
 }
 const value = await report(page);
 await finish(page, testInfo, "editor-item-locks", { interactionP95Ms: metric(value, "scenario.interaction")! });
});

test("editor-box", async ({ page }, testInfo) => {
 await page.goto("/editor?perf=1");
 await ready(page);
 await page.getByRole("button", { name: "Symbols", exact: true }).click();
 await page.getByRole("button", { name: "Insert Box", exact: true }).click();
 const canvas = page.locator("canvas");
 const bounds = (await canvas.boundingBox())!;
 await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
 const selectParent = () => selectSymbolParent(page);
 for (let repeat = 0; repeat < 3; repeat++) {
  await selectParent();
  await interaction(page, "box.dimensions", async () => {
   for (const [name, value] of [["Width", 32 + repeat * 4], ["Height", 20 + repeat * 2]] as const) {
    const input = page.getByRole("spinbutton", { name, exact: true });
    await input.fill(String(value)); await input.press("Tab");
    await page.waitForFunction(({ name, value }) => document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)?.getAttribute("data-committed-value") === String(value), { name, value }, { polling: "raf" });
   }
  });
  await selectParent();
  await expect(page.getByTestId("resize-handle")).toHaveCount(8);
  const handle = (await page.locator('[data-testid="resize-handle"][data-handle="1,1"]').boundingBox())!;
  const before = Number(await page.getByRole("spinbutton", { name: "Width", exact: true }).inputValue());
  await interaction(page, "box.resize", async () => {
   await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
   await page.mouse.down();
   await page.mouse.move(handle.x + 25, handle.y - 15, { steps: 3 });
   await page.mouse.up();
   await page.waitForFunction(before => Number(document.querySelector<HTMLInputElement>('input[aria-label="Width"]')?.getAttribute("data-committed-value")) > before, before, { polling: "raf" });
  });
  await interaction(page, "box.border", async () => {
   await page.getByRole("combobox", { name: "Line style", exact: true }).selectOption(repeat % 2 ? "dotted" : "dashed");
   const input = page.getByRole("spinbutton", { name: "Line width", exact: true });
   await input.fill(String(0.4 + repeat * 0.1)); await input.press("Tab");
   await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  });
  const textAnchor = (await page.locator('[data-anchor-id="1:text:2"]').boundingBox())!;
  await page.mouse.click(textAnchor.x + textAnchor.width / 2 + 5, textAnchor.y + textAnchor.height / 2 + 5);
  await expect(page.getByTestId("symbol-child-selection")).toBeVisible();
  await interaction(page, "box.text", async () => {
   const content = page.getByRole("textbox", { name: "Text content", exact: true });
   await content.fill(`Power supply ${repeat + 1}\n3.3 V`); await content.press("Tab");
   await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  });
 }
 const value = await report(page);
 await finish(page, testInfo, "editor-box", { interactionP95Ms: metric(value, "scenario.interaction")! });
});


test("kicad-import", async ({ page }, testInfo) => {
    await page.goto("/projects?perf=1");
    await ready(page);
    await expect(page.getByLabel("Workspace instructions", { exact: true })).toBeVisible();
    const sidebar = await openProjectFiles(page);
    await sidebar.getByLabel("Add KiCad schematic files").setInputFiles({name:"broken.kicad_sch",mimeType:"text/plain",buffer:Buffer.from("(broken")});
    await expect(page.getByRole("alert")).toContainText("Incomplete KiCad");
    const elapsed = await interaction(page, "kicad-import", async () => {
        await sidebar.getByLabel("Add KiCad schematic files").setInputFiles(resolve("tests/fixtures/kicad/RPI-RP2350A-MINIMAL_R4-S1.kicad_sch"));
        await expect(page.getByRole("button", {name:"Download import report",exact:true})).toBeVisible();
        await expect(page.getByRole("heading", {name:/Schematic editor .* RPI-RP2350A-MINIMAL_R4-S1/})).toBeVisible();
        await page.waitForFunction(() => (window.__ecadPerformance?.snapshot().metrics["renderer.frame"]?.count??0)>0);
    });
    const download = page.waitForEvent("download");
    await page.getByRole("button", {name:"Download import report",exact:true}).click();
    expect((await download).suggestedFilename()).toBe("kicad-import-report.json");
    await page.screenshot({path:resolve("perf-artifacts/kicad-import-report.png")});
    await page.getByRole("button", {name:"Dismiss import report",exact:true}).click();
    await page.keyboard.press("F6");
    await page.screenshot({path:resolve("perf-artifacts/kicad-import-schematic.png")});
    const value = await report(page);
    await finish(page,testInfo,"kicad-import",{importMs:metric(value,"import.kicad")!,interactionP95Ms:elapsed});
    await page.reload();
    await (await openProjectFiles(page)).getByRole("link", {name:"Open RPI-RP2350A-MINIMAL_R4-S1.ecaddraw",exact:true}).click();
    await expect(page.getByRole("heading", {name:/Schematic editor .* RPI-RP2350A-MINIMAL_R4-S1/})).toBeVisible();
});

test("editor-named-nets", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async () => {
		const shapes = [
			...Array.from({ length: 346 }, (_, index) => ({ id: index + 1, kind: "wire", x: (index % 20) * 15 - 145, y: Math.floor(index / 20) * 8 - 68, width: 10, height: 0.2, lineWidth: 0.2, rotation: 0 })),
			...Array.from({ length: 94 }, (_, index) => ({ id: 347 + index, kind: "text", electrical: index % 2 ? "net" : "supply", text: `NET${index % 20}`, x: (index % 20) * 15 - 150, y: Math.floor(index / 20) * 8 - 68, width: 8, height: 2, fontSize: 1.5, lineWidth: 0.2, rotation: 0, horizontalAlign: "left", verticalAlign: "bottom" })),
		];
		const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("Named nets", { create: true });
		for (const [name, content] of [
			[".ecadprj", 'format = "ecad-project"\nversion = 1\nname = "Named nets"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n'],
			["drawing.ecaddraw", JSON.stringify({ shapes })],
		]) {
			const writer = await (await directory.getFileHandle(name, { create: true })).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Named nets");
	});
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(page.getByTestId("text-anchor")).toHaveCount(94);
	await (await toolbarButton(page, "Supply label")).click();
	const canvas = page.locator("canvas");
	const bounds = (await canvas.boundingBox())!;
	await canvas.click({ position: { x: bounds.width * 0.4, y: bounds.height * 0.3 } });
	for (let repeat = 0; repeat < 3; repeat++) {
		await interaction(page, "net-label.rename", async () => {
			await page.getByRole("textbox", { name: "Net name", exact: true }).fill(`+3V${repeat}`);
			await page.getByRole("textbox", { name: "Net name", exact: true }).press("Tab");
			await expect(page.getByRole("textbox", { name: "Net name", exact: true })).toHaveValue(`+3V${repeat}`);
			await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		});
	}
	await expect(page.getByTestId("text-anchor")).toHaveCount(95);
	await page.screenshot({ path: "artifacts/named-nets-workload.png", fullPage: true });
	const interactionP95Ms = metric(await report(page), "scenario.interaction")!;
	await finish(page, testInfo, "editor-named-nets", { interactionP95Ms });
});

test("schematic-export", async ({ page }, testInfo) => {
	const content = await readFile(
		"tests/fixtures/rp2350a-reference/drawing.ecaddraw",
		"utf8",
	);
	await page.goto("/editor?perf=1");
	await ready(page);
	await page.evaluate(async (content) => {
		const directory = await (
			await navigator.storage.getDirectory()
		).getDirectoryHandle("Export fixture", { create: true });
		for (const [name, data] of [
			[
				".ecadprj",
				'format = "ecad-project"\nversion = 1\nname = "Export fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
			],
			["drawing.ecaddraw", content],
		]) {
			const writer = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await writer.write(data);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Export fixture");
	}, content);
	await page.reload();
	await ready(page);
	const button = page.getByRole("button", {
		name: "Export drawing",
		exact: true,
	});
	await expect(button).toBeEnabled();
	await button.click();
	const dialog = page.getByRole("dialog", { name: "Export drawing" });
	for (const format of ["svg", "png"]) {
		await dialog
			.getByRole("combobox", { name: "Format", exact: true })
			.selectOption(format);
		const download = page.waitForEvent("download");
		await dialog.getByRole("button", { name: "Download", exact: true }).click();
		await download;
		await expect(
			dialog.getByRole("button", { name: "Download", exact: true }),
		).toBeEnabled();
	}
	const value = await report(page);
	await finish(page, testInfo, "schematic-export", {
		exportSvgMs: metric(value, "drawing.export-svg")!,
		exportPngMs: metric(value, "drawing.export")!,
	});
});


async function openCircuitWorkload(page: Page, connected = true) {
 const file = createCircuit("Circuit workload");
 for (let index = 0; index < 32; index++) file.circuit.components.push(createCircuitComponent("resistor", file.circuit.components));
 file.circuit.nets.push({id:"ground", names:["GND"], pinIds: file.circuit.components.map(component => component.pins[0].id)});
 for (let index = 0; index < 32; index += 2) file.circuit.nets.push({id:`signal-${index}`, names:[`SIGNAL_${index}`], pinIds:[file.circuit.components[index].pins[1].id, file.circuit.components[index+1].pins[1].id]});
 if (!connected) file.circuit.nets = [];
 file.graph.positions = arrangeCircuitGraph(file);
 await page.goto("/projects?perf=1");
 await ready(page);
 await page.evaluate(async (file) => {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("Circuit performance", {create:true});
  const write = async (path: string, value: unknown) => { const writable = await (await directory.getFileHandle(path,{create:true})).createWritable(); await writable.write(JSON.stringify(value)); await writable.close(); };
  await write("drawing.ecaddraw",{shapes:[]});
  await write("circuit.ecadcircuit",file.circuit);
  await write("layout.ecadgraph",file.graph);
  const writable = await (await directory.getFileHandle(".ecadprj", {create:true})).createWritable();
  await writable.write('format = "ecad-project"\nversion = 1\nname = "Circuit performance"\ndrawing = "drawing.ecaddraw"\nsymbols = []\nassets = []\n[[circuits]]\ncircuit = "circuit.ecadcircuit"\ngraph = "layout.ecadgraph"\n'); await writable.close();
  localStorage.setItem("ecad.active-project","Circuit performance");
 }, file);
 await page.reload(); await ready(page);
 const sidebar = await openProjectFiles(page);
 const openMs = await interaction(page,"circuit-open",async () => {
  await sidebar.getByRole("link",{name:"Open Circuit workload.ecadcircuit",exact:true}).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Circuit connections graph"]') && document.querySelectorAll('.circuit-component').length === 32, undefined, {polling:"raf"});
 });
 return openMs;
}

test("circuit-graph", async ({ page }, testInfo) => {
 const openMs = await openCircuitWorkload(page);
 const times: number[] = [];
 const component = page.getByRole("button",{name:"Select component R1",exact:true});
 for (let index=0;index<3;index++) {
  const before = await component.locator("xpath=../..").getAttribute("transform");
  times.push(await interaction(page,"circuit-move",async () => {
   await component.focus(); await component.press("ArrowRight");
   await expect(component.locator("xpath=../..")).not.toHaveAttribute("transform",before!);
  }));
 }
 await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
 const value = await report(page);
 await finish(page,testInfo,"circuit-graph",{openMs, interactionP95Ms:percentile(times),graphP95Ms:metric(value,"circuit.graph")!,editP95Ms:metric(value,"circuit.edit")!});
});

test("circuit-untangle", async ({page},testInfo)=>{
 await openCircuitWorkload(page);
 await closeProjectFiles(page);
 const times:number[]=[];
 for(let index=0;index<3;index++) {
  const headers=await page.locator(".circuit-node-handle button").evaluateAll(elements=>elements.map(element=>{const box=element.getBoundingClientRect();return {label:element.getAttribute("aria-label")!,x:box.x,y:box.y,width:box.width,height:box.height};}).sort((a,b)=>a.y-b.y||a.x-b.x));
  const [source,target]=headers;
  await page.mouse.move(source.x+source.width/2,source.y+source.height/4);await page.mouse.down();
  await page.mouse.move(target.x+source.width/2,target.y+source.height/4,{steps:6});await page.mouse.up();
  times.push(await interaction(page,"circuit.untangle-ui",async()=>{
   await page.getByRole("button",{name:"Untangle",exact:true}).click();
   await page.waitForFunction(()=>{
    const boxes=Array.from(document.querySelectorAll(".circuit-component-body"),element=>element.getBoundingClientRect());
    return boxes.every((box,a)=>boxes.every((other,b)=>a===b||!(box.x<other.right&&box.right>other.x&&box.y<other.bottom&&box.bottom>other.y)));
   },undefined,{polling:"raf"});
  }));
 }
 await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
 const value=await report(page);
 await finish(page,testInfo,"circuit-untangle",{interactionP95Ms:percentile(times),untangleP95Ms:metric(value,"circuit.untangle")!,graphP95Ms:metric(value,"circuit.graph")!});
});

test("circuit-grid-snap", async ({ page }, testInfo) => {
 await openCircuitWorkload(page);
 await closeProjectFiles(page);
 const header = page.getByRole("button",{name:"Select component R1",exact:true});
 const node = header.locator("xpath=../..");
 const times: number[] = [];
 for (let index = 0; index < 3; index++) {
  const box = await header.boundingBox();
  if (!box) throw new Error("Missing component header.");
  const original = await node.getAttribute("transform");
  times.push(await interaction(page,"circuit.snap-drag",async () => {
   await page.mouse.move(box.x + box.width / 2, box.y + box.height / 4);
   await page.mouse.down();
   await page.mouse.move(box.x + box.width / 2 + 37, box.y + box.height / 4 + 23, {steps:6});
   await page.mouse.up();
   await expect(node).not.toHaveAttribute("transform",original!);
  }));
  await page.keyboard.press("Control+z");
  await expect(node).toHaveAttribute("transform",original!);
 }
 await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
 const value = await report(page);
 await finish(page,testInfo,"circuit-grid-snap",{interactionP95Ms:percentile(times),graphP95Ms:metric(value,"circuit.graph")!,editP95Ms:metric(value,"circuit.edit")!});
});

test("circuit-connect", async ({ page }, testInfo) => {
 await openCircuitWorkload(page);
 await closeProjectFiles(page);
 const times: number[] = [];
 for (let index = 0; index < 3; index++) {
  const source = await page.getByRole("button", {name:"Pin R1.2",exact:true}).locator("circle").boundingBox();
  const target = await page.getByRole("button", {name:"Pin R2.1",exact:true}).locator("circle").boundingBox();
  if (!source || !target) throw new Error("Missing connection terminals.");
  times.push(await interaction(page,"circuit.connect-drag",async () => {
   await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
   await page.mouse.down();
   await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {steps:6});
   await expect(page.locator("[data-connection-preview]")).toBeVisible();
   await page.mouse.up();
   await page.waitForFunction(() => document.querySelectorAll(".circuit-net").length === 16 && !document.querySelector("[data-connection-preview]"), undefined, {polling:"raf"});
  }));
  await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".circuit-net")).toHaveCount(17);
 }
 const value = await report(page);
 await finish(page,testInfo,"circuit-connect",{interactionP95Ms:percentile(times),graphP95Ms:metric(value,"circuit.graph")!,editP95Ms:metric(value,"circuit.edit")!});
});

test("circuit-net-editing", async ({ page }, testInfo) => {
 await openCircuitWorkload(page, false);
 await closeProjectFiles(page);
 const canvas = page.getByLabel("Circuit connections graph", {exact:true});
 const times: number[] = [];
 times.push(await interaction(page,"circuit.add-net",async () => {
  await page.getByRole("button", {name:"Add net",exact:true}).click();
  await canvas.click({position:{x:200,y:350}});
  await page.getByRole("textbox", {name:"Net name",exact:true}).fill("GND");
  await page.getByRole("textbox", {name:"Net name",exact:true}).press("Enter");
  await expect(page.getByRole("button", {name:"Net GND",exact:true})).toBeVisible();
 }));
 for (let index = 0; index < 3; index++) {
  const source = await page.getByRole("button", {name:`Pin R${index + 1}.1`,exact:true}).locator("circle").boundingBox();
  const target = await page.getByRole("button", {name:"Net GND",exact:true}).locator("circle").boundingBox();
  if (!source || !target) throw new Error("Missing ground connection targets.");
  times.push(await interaction(page,"circuit.connect-to-net",async () => {
   await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
   await page.mouse.down();
   await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {steps:6});
   await page.mouse.up();
   await expect(page.locator(".circuit-connection")).toHaveCount(index + 1);
  }));
 }
 for (let index = 0; index < 3; index++) {
  times.push(await interaction(page,"circuit.delete-membership",async () => {
   await page.getByRole("button", {name:`Connection R${index + 1}.1`,exact:true}).press("Enter");
   await page.keyboard.press("Delete");
   await expect(page.locator(".circuit-connection")).toHaveCount(2 - index);
  }));
 }
 await expect(page.getByRole("button", {name:"Net GND",exact:true})).toBeVisible();
 await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
 const value = await report(page);
 await finish(page,testInfo,"circuit-net-editing",{interactionP95Ms:percentile(times),graphP95Ms:metric(value,"circuit.graph")!,editP95Ms:metric(value,"circuit.edit")!});
});


async function openComponentWorkload(page: Page, file = createCircuit("Component workload")) {
 await page.goto("/projects?perf=1");await ready(page);
 await page.evaluate(async file => {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("Component fixture",{create:true});
  const write = async (path:string,content:string) => {const writer = await (await directory.getFileHandle(path,{create:true})).createWritable();await writer.write(content);await writer.close();};
  const symbols = Array.from({length:100},(_,index) => ({format:"ecad-symbol",version:1,units:"mm",id:index===0?"device-128":`device-${index}`,name:index===0?"128-pin device":`Device ${index}`,description:"",prefix:"U",value:"",shapes:Array.from({length:index===0?128:2},(_,pin)=>({kind:"pin",number:String(pin+1),name:`P${pin+1}`,x:0,y:pin*1.27,length:2}))}));
  await write(".ecadprj",'format = "ecad-project"\nversion = 1\nname = "Component fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\nassets = []\n[[circuits]]\ncircuit = "circuit.ecadcircuit"\ngraph = "layout.ecadgraph"\n');
  await write("drawing.ecaddraw",JSON.stringify({shapes:[],symbolLibraries:[{id:"components",name:"Components",enabled:true,source:{kind:"embedded",symbols}}]}));
  await write("circuit.ecadcircuit",JSON.stringify(file.circuit));await write("layout.ecadgraph",JSON.stringify(file.graph));
  localStorage.setItem("ecad.active-project","Component fixture");
 },file);
 await page.reload();await ready(page);
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Component workload",exact:true}).click();
 await expect(page.getByRole("button",{name:"Components",exact:true})).toBeEnabled();
}

test("circuit-components", async ({page}, testInfo) => {
 await openComponentWorkload(page);
 const times:number[]=[];
 for (const [index,name] of ["Resistor","Resistor","128-pin device"].entries()) {
  times.push(await interaction(page,"circuit.place-symbol",async()=>{
   await page.getByRole("button",{name:"Components",exact:true}).click();
   await page.getByRole("searchbox",{name:"Search components",exact:true}).fill(name);
   await expect(page.getByRole("button",{name:`Place ${name}`,exact:true}).locator("svg").first()).toBeVisible();
   await page.getByRole("button",{name:`Place ${name}`,exact:true}).click();
   await page.getByLabel("Circuit connections graph",{exact:true}).click({position:{x:250+index*150,y:300}});
   await page.waitForFunction(count=>document.querySelectorAll('.circuit-component').length===count && document.querySelector(".circuit-editor")?.getAttribute("data-pending-changes")==="false",index+1,{polling:"raf"});
  }));
 }
 await page.getByRole("button",{name:"Fit graph",exact:true}).click();
 const value=await report(page);
 await finish(page,testInfo,"circuit-components",{interactionP95Ms:percentile(times),graphP95Ms:metric(value,"circuit.graph")!,componentP95Ms:metric(value,"circuit.component-from-symbol")!,thumbnailP95Ms:metric(value,"symbol.thumbnail")!,libraryResolveMs:metric(value,"symbol-library.resolve")!});
});

test("circuit-collapse", async ({page}, testInfo) => {
 const file = createCircuit("Component workload");
 const device = instantiateCircuitPart({id:"device",name:"128-pin device",prefix:"U",value:"",pins:Array.from({length:128},(_,index)=>({number:String(index+1),name:`P${index+1}`}))},[]);
 file.circuit.components.push(device);
 for (let index=0;index<2;index++) file.circuit.components.push(createCircuitComponent("resistor",file.circuit.components));
 file.circuit.nets.push({id:"signal-a",names:["SIGNAL_A"],pinIds:[device.pins[0].id,file.circuit.components[1].pins[0].id]},{id:"signal-b",names:["SIGNAL_B"],pinIds:[device.pins[99].id,file.circuit.components[2].pins[0].id]});
 file.graph.positions = [{id:device.id,kind:"component",x:60,y:60},{id:file.circuit.components[1].id,kind:"component",x:500,y:60},{id:file.circuit.components[2].id,kind:"component",x:500,y:260},{id:"signal-a",kind:"net",x:360,y:140},{id:"signal-b",kind:"net",x:360,y:340}];
 await openComponentWorkload(page,file);
 await closeProjectFiles(page);
 const times:number[]=[];
 for (let index=0;index<3;index++) {
  times.push(await interaction(page,"circuit.collapse",async()=>{
   await page.getByRole("button",{name:"Collapse U1",exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll(".circuit-pin").length===4 && document.querySelectorAll(".circuit-collapsed-anchor").length>0,undefined,{polling:"raf"});
  }));
  times.push(await interaction(page,"circuit.expand",async()=>{
   await page.getByRole("button",{name:"Expand U1",exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll(".circuit-pin").length===132,undefined,{polling:"raf"});
  }));
 }
 await expect(page.locator(".circuit-connection")).toHaveCount(4);
 await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
 const value=await report(page);
 await finish(page,testInfo,"circuit-collapse",{interactionP95Ms:percentile(times),graphP95Ms:metric(value,"circuit.graph")!,editP95Ms:metric(value,"circuit.edit")!});
});

test("circuit-auto-names", async ({page},testInfo)=>{
 await openCircuitWorkload(page,false);
 await closeProjectFiles(page);
 const times:number[]=[];
 for(let index=1;index<=5;index+=2) {
  const label=`R${index}.1 / R${index+1}.1`;
  const from=await page.getByRole("button",{name:`Pin R${index}.1`,exact:true}).locator("circle").boundingBox();
  const to=await page.getByRole("button",{name:`Pin R${index+1}.1`,exact:true}).locator("circle").boundingBox();
  if(!from||!to) throw new Error("Missing terminals.");
  times.push(await interaction(page,"circuit.auto-name",async()=>{
   await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
   await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:6});await page.mouse.up();
   await expect(page.getByRole("button",{name:`Net ${label}`,exact:true})).toBeVisible();
  }));
  await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".circuit-net")).toHaveCount(0);
 }
 const value=await report(page);
 await finish(page,testInfo,"circuit-auto-names",{interactionP95Ms:percentile(times),graphP95Ms:metric(value,"circuit.graph")!,editP95Ms:metric(value,"circuit.edit")!});
});

test("circuit-keyboard-placement",async({page},testInfo)=>{
 await openCircuitWorkload(page,false);
 await closeProjectFiles(page);
 const canvas=page.getByLabel("Circuit connections graph",{exact:true});
 const times:number[]=[];
 for(let index=1;index<=3;index++) {
  times.push(await interaction(page,"circuit.keyboard-placement",async()=>{
   await page.getByRole("button",{name:"Components",exact:true}).press("Enter");
   await page.getByRole("searchbox",{name:"Search components",exact:true}).fill("Resistor");
   await page.keyboard.press("Tab");
   await page.getByRole("button",{name:"Place Resistor",exact:true}).press("Enter");
   await expect(canvas).toBeFocused();
   await page.keyboard.press("ArrowRight");await page.keyboard.press("Enter");
   await expect(page.locator(".circuit-component")).toHaveCount(32+index);
   await page.getByRole("button",{name:"Add net",exact:true}).press("Enter");
   await expect(canvas).toBeFocused();
   await page.keyboard.press("Shift+ArrowLeft");await page.keyboard.press("Enter");
   await expect(page.getByRole("textbox",{name:"Net name",exact:true})).toBeFocused();
   await page.keyboard.press("Escape");
   await expect(page.locator(".circuit-net")).toHaveCount(1);
   await page.keyboard.press("Control+z");
   await expect(page.locator(".circuit-net")).toHaveCount(0);
  }));
 }
 await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
 const value=await report(page);
 await finish(page,testInfo,"circuit-keyboard-placement",{interactionP95Ms:percentile(times),graphP95Ms:metric(value,"circuit.graph")!,editP95Ms:metric(value,"circuit.edit")!});
});

test("pcb-linked-documents", async ({page}, testInfo) => {
 await openCircuitWorkload(page);
 await closeProjectFiles(page);
 const times:number[]=[];
 times.push(await interaction(page,"pcb-add-component",async()=>{
  await page.getByRole("button",{name:"Components",exact:true}).click();
  await page.getByRole("searchbox",{name:"Search components",exact:true}).fill("Resistor");
  await page.getByRole("button",{name:"Place Resistor",exact:true}).click();
  await page.getByLabel("Circuit connections graph",{exact:true}).click({position:{x:350,y:250}});
  await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes", "false");
 }));
 times.push(await interaction(page,"pcb-open-schematic",async()=>{
  await (await openProjectFiles(page)).getByRole("link",{name:"Open Circuit workload.ecaddraw",exact:true}).click();
  await closeProjectFiles(page);
  await expect(page.getByRole("button",{name:"Symbols",exact:true})).toBeVisible();
 }));
 const value=await report(page);
 await finish(page,testInfo,"pcb-linked-documents",{interactionP95Ms:percentile(times),syncP95Ms:metric(value,"pcb.synchronize")!});
});

test("editor-net-symbols", async ({ page }, testInfo) => {
	await page.goto("/editor?perf=1");
	await ready(page);
	for (const name of ["Ground", "VDD"]) {
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		await page.getByRole("searchbox", { name: "Search symbols" }).fill(name);
		await page.getByRole("button", { name: `Insert ${name}`, exact: true }).click();
		const canvas = page.locator("canvas");
		const bounds = (await canvas.boundingBox())!;
		await canvas.click({ position: { x: bounds.width * (name === "Ground" ? 0.35 : 0.55), y: bounds.height * 0.45 } });
		await expect(page.getByRole("checkbox", { name: "Net symbol", exact: true })).toBeChecked();
		await expect(page.getByRole("textbox", { name: "Reference", exact: true })).toHaveCount(0);
		await expect(page.getByRole("textbox", { name: "Value", exact: true })).toHaveCount(0);
		const netName = page.getByRole("textbox", { name: "Name", exact: true });
		await expect(netName).toHaveValue(name === "Ground" ? "GND" : "VDD");
		await interaction(page, "net-symbol.rename", async () => {
			await netName.fill("+3V3");
			await netName.press("Tab");
			await expect(netName).toHaveAttribute("data-committed-value", "+3V3");
		});
		await interaction(page, "net-symbol.role", async () => {
			await page.getByRole("checkbox", { name: "Net symbol", exact: true }).uncheck();
			await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("+3V3");
			await page.getByRole("checkbox", { name: "Net symbol", exact: true }).check();
			await expect(netName).toHaveValue("+3V3");
		});
	}
	await page.screenshot({ path: "/tmp/ecad-net-symbols/interface.png" });
	await finish(page, testInfo, "editor-net-symbols", { interactionP95Ms: metric(await report(page), "scenario.interaction")! });
});
