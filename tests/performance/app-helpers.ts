import type { AppPerformance } from "#/performance/browser.ts";
import { arrangeCircuitGraph } from "@ecad/drawing-core/circuit/graph.ts";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { openProjectFiles } from "../browser/project-files";
import { createTestComponent } from "../fixtures/circuit.ts";
import { budgets, type Scenario } from "./budgets.ts";

export type Report = ReturnType<AppPerformance["snapshot"]>;

export const report = (page: Page) =>
	page.evaluate(() => window.__ecadPerformance!.snapshot());

export const percentile = (values: number[], percent = 0.95) =>
	[...values].sort((a, b) => a - b)[
		Math.max(0, Math.ceil(values.length * percent) - 1)
	] ?? 0;

export const metric = (value: Report, name: string) => value.metrics[name]?.p95;

export const ready = async (page: Page) => {
	await page.mouse.move(900, 50);
	await page.waitForFunction(
		() =>
			window.__ecadPerformance?.snapshot().metrics["app.ready"]?.count === 1,
	);
};

export async function editorReady(page: Page, title: string) {
	await page.waitForFunction(
		(title) =>
			document.querySelector("h1")?.textContent === title &&
			document.querySelector<HTMLButtonElement>('button[aria-label="Select"]')
				?.disabled === false,
		title,
		{ polling: "raf", timeout: 30_000 },
	);
}

export async function interaction(
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

export async function finish(
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

export async function openCircuitWorkload(page: Page, connected = true) {
	const file = createCircuit("Circuit workload");
	for (let index = 0; index < 32; index++)
		file.circuit.components.push(
			createTestComponent("resistor", file.circuit.components),
		);
	file.circuit.nets.push({
		id: "ground",
		names: ["GND"],
		pinIds: file.circuit.components.map((component) => component.pins[0].id),
	});
	for (let index = 0; index < 32; index += 2)
		file.circuit.nets.push({
			id: `signal-${index}`,
			names: [`SIGNAL_${index}`],
			pinIds: [
				file.circuit.components[index].pins[1].id,
				file.circuit.components[index + 1].pins[1].id,
			],
		});
	if (!connected) file.circuit.nets = [];
	file.graph.positions = arrangeCircuitGraph(file);
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async (file) => {
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle("Circuit performance", {
			create: true,
		});
		const write = async (path: string, value: unknown) => {
			const writable = await (
				await directory.getFileHandle(path, { create: true })
			).createWritable();
			await writable.write(JSON.stringify(value));
			await writable.close();
		};
		await write("drawing.ecaddraw", {
			shapes: [],
			circuit: file.circuit,
			circuitId: file.circuit.id,
		});
		const writable = await (
			await directory.getFileHandle(".ecadprj", { create: true })
		).createWritable();
		await writable.write(
			'format = "ecad-project"\nversion = 1\nname = "Circuit performance"\ndrawing = "drawing.ecaddraw"\nsymbols = []\nassets = []\n[[circuits]]\ncircuit = "drawing.ecaddraw"\n',
		);
		await writable.close();
		localStorage.setItem("ecad.active-project", "Circuit performance");
	}, file);
	await page.reload();
	await ready(page);
	const sidebar = await openProjectFiles(page);
	const openMs = await interaction(page, "circuit-open", async () => {
		await sidebar
			.getByRole("link", {
				name: "Open Circuit workload.ecaddraw in circuit view",
				exact: true,
			})
			.click();
		await page.waitForFunction(
			() =>
				document.querySelector('[aria-label="Circuit connections graph"]') &&
				document.querySelectorAll(".circuit-component").length === 32,
			undefined,
			{ polling: "raf" },
		);
	});
	return openMs;
}

export async function openComponentWorkload(
	page: Page,
	file = createCircuit("Component workload"),
) {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async (file) => {
		const root = await navigator.storage.getDirectory();
		const directory = await root.getDirectoryHandle("Component fixture", {
			create: true,
		});
		const write = async (path: string, content: string) => {
			const writer = await (
				await directory.getFileHandle(path, { create: true })
			).createWritable();
			await writer.write(content);
			await writer.close();
		};
		const symbols = Array.from({ length: 100 }, (_, index) => ({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: index === 0 ? "device-128" : `device-${index}`,
			name: index === 0 ? "128-pin device" : `Device ${index}`,
			description: "",
			prefix: "U",
			value: "",
			shapes: Array.from({ length: index === 0 ? 128 : 2 }, (_, pin) => ({
				kind: "pin",
				number: String(pin + 1),
				name: `P${pin + 1}`,
				x: 0,
				y: pin * 1.27,
				length: 2,
			})),
		}));
		await write(
			".ecadprj",
			'format = "ecad-project"\nversion = 1\nname = "Component fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\nassets = []\n[[circuits]]\ncircuit = "circuit.ecadcircuit"\ngraph = "layout.ecadgraph"\n',
		);
		await write(
			"drawing.ecaddraw",
			JSON.stringify({
				shapes: [],
				symbolLibraries: [
					{
						id: "components",
						name: "Components",
						enabled: true,
						source: { kind: "embedded", symbols },
					},
				],
			}),
		);
		await write("circuit.ecadcircuit", JSON.stringify(file.circuit));
		await write("layout.ecadgraph", JSON.stringify(file.graph));
		localStorage.setItem("ecad.active-project", "Component fixture");
	}, file);
	await page.reload();
	await ready(page);
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Component workload", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Components", exact: true }),
	).toBeEnabled();
}
