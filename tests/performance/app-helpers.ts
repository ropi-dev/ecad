import { arrangeCircuitGraph } from "@ecad/drawing-core/circuit/graph.ts";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { expect, type Page, type TestInfo } from "@playwright/test";
import type { AppPerformance } from "#/performance/browser.ts";
import { openProjectFiles } from "../browser/project-files";
import { toolbarButton } from "../browser/toolbar";
import { createTestComponent } from "../fixtures/circuit.ts";
import { required } from "../helpers/required.ts";
import { budgets, type Scenario } from "./budgets.ts";

export type Report = ReturnType<AppPerformance["snapshot"]>;

export const report = (page: Page) =>
	page.evaluate(() =>
		(
			window.__ecadPerformance ??
			(() => {
				throw new Error("Expected a value");
			})()
		).snapshot(),
	);

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

/** Counts the shapes in a project's saved drawing, or returns null while a save is replacing it. */
/**
 * Reads the project's saved drawing shapes from OPFS. Returns `null` when the
 * read races an autosave that replaces or removes the file.
 */
export function savedShapes<Shape = Record<string, unknown>>(
	page: Page,
	project: string,
) {
	return page.evaluate(async (project) => {
		try {
			let directory = await (
				await navigator.storage.getDirectory()
			).getDirectoryHandle(project);
			const manifest = await (
				await directory.getFileHandle(".ecadprj")
			).getFile();
			const path = (await manifest.text())
				.match(/^drawing\s*=\s*"([^"]+)"/m)?.[1]
				.split("/");
			const name = path?.pop();
			if (!path || !name) return null;
			for (const part of path)
				directory = await directory.getDirectoryHandle(part);
			const file = await (await directory.getFileHandle(name)).getFile();
			return JSON.parse(await file.text()).shapes as Shape[];
		} catch (error) {
			if (
				error instanceof DOMException &&
				(error.name === "NotFoundError" || error.name === "NotReadableError")
			)
				return null;
			throw error;
		}
	}, project);
}

export async function savedShapeCount(page: Page, project: string) {
	return (await savedShapes(page, project))?.length ?? null;
}

/** Undoes the last edit from the history popover, then closes the popover so it cannot swallow the next canvas press. */
export async function undo(page: Page) {
	await (await toolbarButton(page, "Undo")).click();
	await expect(
		page.getByRole("button", { name: "Redo", exact: true }),
	).toBeEnabled();
	const history = page.getByRole("button", {
		name: "History tools",
		exact: true,
	});
	await history.click();
	await expect(history).toHaveAttribute("aria-expanded", "false");
}

export const saveCount = async (page: Page) =>
	(await report(page)).metrics["project.save"]?.count ?? 0;

/**
 * Waits until autosave has written the edits made after `before` (a
 * `saveCount` reading) and no further save follows. A save that lands during
 * a canvas drag cancels the drag, so let saves finish between gestures.
 */
export async function saved(page: Page, before: number) {
	await expect
		.poll(
			async () => {
				const count = await saveCount(page);
				if (count <= before) return false;
				await page.waitForTimeout(500);
				return (await saveCount(page)) === count;
			},
			{ timeout: 30_000 },
		)
		.toBe(true);
}

/**
 * Moves the pointer onto the canvas and waits for the page to go idle, as a
 * user pointing before a gesture would. Canvas hit tests use the shapes from
 * the last render, so a press that beats a pending render misses its target.
 */
export async function pointAt(page: Page, point: { x: number; y: number }) {
	await page.mouse.move(point.x, point.y);
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() =>
					requestAnimationFrame(() =>
						requestIdleCallback(() => resolve(), { timeout: 2000 }),
					),
				),
			),
	);
}

/** Waits until an attribute input commits a number. Distances commit in millimetres. */
export async function committed(page: Page, label: string, expected: number) {
	await page.waitForFunction(
		({ label, expected }) =>
			Math.abs(
				Number(
					document
						.querySelector(`input[aria-label="${label}"]`)
						?.getAttribute("data-committed-value") ?? Number.NaN,
				) - expected,
			) < 1e-6,
		{ label, expected },
		{ polling: "raf" },
	);
}

export async function interaction(
	page: Page,
	name: string,
	action: () => Promise<void>,
) {
	await page.evaluate((name) => {
		(
			window.__ecadPerformance ??
			(() => {
				throw new Error("Expected a value");
			})()
		).record("scenario.start", 0, { name });
	}, name);
	const start = await page.evaluate(() => performance.now());
	await action();
	return page.evaluate(
		({ start, name }) => {
			const duration = performance.now() - start;
			(
				window.__ecadPerformance ??
				(() => {
					throw new Error("Expected a value");
				})()
			).record("scenario.interaction", duration, { name }, start);
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
		startupMs: required(metric(value, "app.ready")),
		scriptBytes: value.resources.scriptBytes,
		domNodes: value.domNodes,
		...(value.heapBytes === null ? {} : { heapBytes: value.heapBytes }),
		...(value.environment.supportedEntryTypes.includes("longtask")
			? { blockingMs: value.metrics["browser.blocking-time"]?.total ?? 0 }
			: {}),
		...(metric(value, "browser.event-loop-delay") === undefined
			? {}
			: {
					eventLoopP95Ms: required(metric(value, "browser.event-loop-delay")),
				}),
		...(metric(value, "navigation.ready") === undefined
			? {}
			: { navigationP95Ms: required(metric(value, "navigation.ready")) }),
		...(metric(value, "renderer.frame") === undefined
			? {}
			: { frameP95Ms: required(metric(value, "renderer.frame")) }),
		...(metric(value, "import.gerber") === undefined
			? {}
			: { importGerberMs: required(metric(value, "import.gerber")) }),
		...(metric(value, "import.step") === undefined
			? {}
			: { importStepMs: required(metric(value, "import.step")) }),
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
			'format = "ecad-project"\nversion = 1\nname = "Component fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\nassets = []\n[[circuits]]\ncircuit = "drawing.ecaddraw"\n',
		);
		await write(
			"drawing.ecaddraw",
			JSON.stringify({
				shapes: [],
				circuit: file.circuit,
				circuitId: file.circuit.id,
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
		localStorage.setItem("ecad.active-project", "Component fixture");
	}, file);
	await page.reload();
	await ready(page);
	await (await openProjectFiles(page))
		.getByRole("link", {
			name: "Open Component workload.ecaddraw in circuit view",
			exact: true,
		})
		.click();
	await expect(
		page.getByRole("button", { name: "Components", exact: true }),
	).toBeEnabled();
}
