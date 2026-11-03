import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { expect, type Page, test } from "@playwright/test";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { toolbarButton } from "./toolbar";

async function drawWithTimersPaused(page: Page) {
	await (await toolbarButton(page, "Rectangle")).click();
	await page.clock.install();
	await page.clock.pauseAt(new Date(Date.now() + 100));
	await page.mouse.move(600, 300);
	await page.mouse.down();
	await page.mouse.move(710, 400);
	await page.mouse.up();
}

test("schematic edits persist while timers are paused", async ({ page }) => {
	await page.goto("/tests/browser/projects.html");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await closeProjectFiles(page);
	await expect(page.locator("canvas")).toBeVisible();
	await drawWithTimersPaused(page);
	await expect
		.poll(async () => {
			return page.evaluate(async () => {
				const modulePath = "/packages/web/src/projects/storage.ts";
				const { createWebProjectStorage } = await import(modulePath);
				return (await createWebProjectStorage().load())?.shapes.length;
			});
		})
		.toBe(1);
	await page.clock.resume();
});

test("user-library symbol edits persist while timers are paused", async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			"ecad.user-config.v1",
			JSON.stringify({
				version: 1,
				symbolLibraries: [
					{
						id: "user",
						name: "User",
						enabled: true,
						source: {
							kind: "embedded",
							symbols: [
								{
									format: "ecad-symbol",
									version: 1,
									units: "mm",
									id: "user-part",
									name: "User part",
									description: "",
									prefix: "U",
									value: "",
									shapes: [
										{ kind: "rectangle", x: 0, y: 0, width: 10, height: 6 },
									],
								},
							],
						},
					},
				],
			}),
		);
	});
	await page.goto("/tests/browser/projects.html");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await closeProjectFiles(page);
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert User part", exact: true })
		.click();
	await page.locator("canvas").click({ position: { x: 500, y: 300 } });
	await page.getByRole("button", { name: "Edit symbol", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Symbol editor · User part",
	);
	await drawWithTimersPaused(page);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(localStorage.getItem("ecad.user-config.v1")!)
						.symbolLibraries[0].source.symbols[0].shapes.length,
			),
		)
		.toBe(2);
	await page.clock.resume();
	await page.screenshot({ path: "/tmp/ecad-immediate-save-symbol.png" });
});

test("opening a project with legacy net labels does not save repeatedly", async ({
	page,
}) => {
	const original = createCircuit("Untitled", "pcb-main");
	const file = structuredClone(original);
	const symbol = (id: string) =>
		symbolDefinitions.find((definition) => definition.id === id)!;
	const resistor = componentFromSymbol(symbol("resistor"), []);
	const capacitor = componentFromSymbol(symbol("capacitor"), [resistor]);
	file.circuit.components = [resistor, capacitor];
	file.circuit.nets = [
		{
			id: "signal",
			names: ["SIGNAL"],
			pinIds: [resistor.pins[0].id, capacitor.pins[1].id],
		},
		{
			id: "unnamed",
			names: [],
			pinIds: [resistor.pins[1].id, capacitor.pins[0].id],
		},
	];
	const linked = synchronizePcb(file, [], original, symbolDefinitions);
	// Labels saved before the legacy migration was removed: a 5 × 2 label at
	// font size 1 on a named net, and an `N_<id>` label on an unnamed net.
	const shapes = linked.shapes.map((shape) => {
		if (shape.kind !== "text" || shape.electrical !== "net") return shape;
		const { circuitNet: _binding, ...label } = shape;
		return label.text === "SIGNAL"
			? { ...label, fontSize: 1, width: 5, height: 2 }
			: { ...label, text: "N_unnamed" };
	});
	expect(
		shapes.filter((shape) => shape.kind === "text").map((shape) => shape.text),
	).toEqual(["SIGNAL", "SIGNAL", "N_unnamed", "N_unnamed"]);
	await page.goto("/tests/browser/projects.html");
	await expect(page.locator("#project-document")).toContainText(
		'"name":"Untitled"',
	);
	await page.evaluate(
		async ({ file, shapes }) => {
			const path = "/packages/web/src/projects/storage.ts";
			const { createWebProjectStorage } = await import(path);
			const storage = createWebProjectStorage();
			const project = await storage.load();
			await storage.save(project.directory, {
				shapes,
				symbols: [],
				circuits: [file],
			});
		},
		{ file: linked.file, shapes },
	);
	await page.addInitScript(() => {
		const state = window as typeof window & { projectSaves: number };
		state.projectSaves = 0;
		const original = FileSystemFileHandle.prototype.createWritable;
		FileSystemFileHandle.prototype.createWritable = function (...args) {
			if (this.name === ".ecadprj") state.projectSaves++;
			return original.apply(this, args);
		};
	});
	await page.reload();
	const document = async () =>
		JSON.parse((await page.locator("#project-document").textContent())!);
	await expect
		.poll(async () =>
			(await document()).shapes
				.filter((shape: { kind: string }) => shape.kind === "text")
				.map((shape: { text: string }) => shape.text),
		)
		.toEqual(["SIGNAL", "SIGNAL", "N_unnamed", "N_unnamed"]);
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await closeProjectFiles(page);
	await expect(page.locator("canvas")).toBeVisible();
	// The removed effect saved on every project update, so each save scheduled
	// the next one within milliseconds of loading.
	await page.waitForTimeout(1_000);
	expect(
		await page.evaluate(
			() => (window as typeof window & { projectSaves: number }).projectSaves,
		),
	).toBe(0);
	expect((await document()).dirty).toBe(false);
});
