import { resolve } from "node:path";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { expect, type Page, test } from "@playwright/test";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { libraryDefinitions } from "#/drawing/symbol-file.ts";
import { persistDrawingShapes } from "#/drawing/symbol-persistence.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { captureArtifacts } from "./artifacts";
import {
	closeProjectFiles,
	openProjectActions,
	openProjectFiles,
} from "./project-files";
import { toolbarButton } from "./toolbar";

const documentState = async (page: Page) =>
	JSON.parse((await page.locator("#project-document").textContent()) ?? "{}");

async function screenshot(page: Page, name: string) {
	if (captureArtifacts)
		await page.screenshot({
			path: resolve("/tmp/ecad-browser-artifacts", test.info().testId, name),
		});
}

async function openSchematic(page: Page) {
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Schematic editor", exact: true })
		.click();
	await closeProjectFiles(page);
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
}

async function drawRectangle(page: Page, offset = 0) {
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(600 + offset, 300 + offset);
	await page.mouse.down();
	await page.mouse.move(800 + offset, 450 + offset);
	await page.mouse.up();
}

async function editProjectFile(
	page: Page,
	path: string,
	change: string,
	kind: "append" | "json",
) {
	await page.evaluate(
		async ({ path, change, kind }) => {
			const name = localStorage.getItem("ecad.active-project");
			if (!name) throw new Error("No project is open.");
			let directory = await (
				await navigator.storage.getDirectory()
			).getDirectoryHandle(name);
			const parts = path.split("/");
			const filename = parts.pop() as string;
			for (const part of parts)
				directory = await directory.getDirectoryHandle(part);
			const handle = await directory.getFileHandle(filename);
			const content = await (await handle.getFile()).text();
			const next =
				kind === "append"
					? `${content}${change}`
					: JSON.stringify({ ...JSON.parse(content), ...JSON.parse(change) });
			const writable = await handle.createWritable();
			await writable.write(next);
			await writable.close();
		},
		{ path, change, kind },
	);
}

async function readProjectFile(page: Page, path: string) {
	return page.evaluate(async (path) => {
		const name = localStorage.getItem("ecad.active-project") as string;
		let directory = await (
			await navigator.storage.getDirectory()
		).getDirectoryHandle(name);
		const parts = path.split("/");
		const filename = parts.pop() as string;
		for (const part of parts)
			directory = await directory.getDirectoryHandle(part);
		return (await (await directory.getFileHandle(filename)).getFile()).text();
	}, path);
}

test("a project changed on disk stops autosave and offers to reload from disk", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await expect
		.poll(async () => (await documentState(page)).name)
		.toBe("Untitled");
	await openSchematic(page);
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	expect((await documentState(page)).shapes).toHaveLength(1);

	await editProjectFile(
		page,
		".ecadprj",
		"\n# Edited in another tab\n",
		"append",
	);
	await page.evaluate(() => {
		const counts = { manifestReads: 0, writes: 0 };
		Object.assign(window, { projectFileAccess: counts });
		const getFile = FileSystemFileHandle.prototype.getFile;
		FileSystemFileHandle.prototype.getFile = function () {
			if (this.name === ".ecadprj") counts.manifestReads++;
			return getFile.call(this);
		};
		const createWritable = FileSystemFileHandle.prototype.createWritable;
		FileSystemFileHandle.prototype.createWritable = function (...args) {
			counts.writes++;
			return createWritable.apply(this, args);
		};
	});
	const access = () =>
		page.evaluate(
			() =>
				(
					window as unknown as {
						projectFileAccess: { manifestReads: number; writes: number };
					}
				).projectFileAccess,
		);

	await drawRectangle(page, 40);
	const notice = page.getByRole("alert").filter({
		hasText: "This project changed on disk",
	});
	await expect(notice).toBeVisible();
	await expect(notice).toContainText(
		"Your unsaved changes are still here. Reloading from disk discards them.",
	);
	await expect(
		notice.getByRole("button", { name: "Reload from disk", exact: true }),
	).toBeEnabled();
	expect((await documentState(page)).dirty).toBe(true);
	expect((await documentState(page)).shapes).toHaveLength(2);
	await expect(
		page
			.getByRole("alert")
			.filter({ hasText: "Reload it from disk before saving" }),
	).toHaveCount(0);
	await screenshot(page, "project-conflict.png");

	const afterConflict = await access();
	expect(afterConflict.writes).toBe(0);
	await drawRectangle(page, 80);
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(3);
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
	expect(await access()).toEqual(afterConflict);
	await expect(notice).toBeVisible();
	await expect(notice).toContainText(
		"Saving, and opening other files or projects, is paused",
	);

	const switchView = page.getByRole("button", {
		name: "Switch to circuit view",
		exact: true,
	});
	await switchView.click();
	await expect(switchView).toBeEnabled();
	await expect(
		page
			.getByRole("alert")
			.filter({ hasText: "Reload it from disk before saving" }),
	).toHaveCount(0);
	expect(await access()).toEqual(afterConflict);
	expect((await documentState(page)).shapes).toHaveLength(3);
	await (await openProjectFiles(page))
		.getByRole("link", {
			name: "Open Untitled.ecaddraw in circuit view",
			exact: true,
		})
		.click();
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
	await expect(
		page
			.getByRole("alert")
			.filter({ hasText: "Reload it from disk before saving" }),
	).toHaveCount(0);
	expect(await access()).toEqual(afterConflict);
	await closeProjectFiles(page);

	await notice
		.getByRole("button", { name: "Reload from disk", exact: true })
		.click();
	await expect(notice).toHaveCount(0);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	expect((await documentState(page)).shapes).toHaveLength(1);

	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	await drawRectangle(page, 40);
	await expect
		.poll(async () => (await documentState(page)).shapes.length)
		.toBe(2);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	expect(await readProjectFile(page, ".ecadprj")).not.toContain(
		"Edited in another tab",
	);
});

test("a conflict found by an explicit save or an import alone does not claim unsaved changes", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await expect
		.poll(async () => (await documentState(page)).name)
		.toBe("Untitled");
	await editProjectFile(
		page,
		".ecadprj",
		"\n# Edited in another tab\n",
		"append",
	);
	const notice = page.getByRole("alert").filter({
		hasText: "This project changed on disk",
	});
	const repeated = page
		.getByRole("alert")
		.filter({ hasText: "Reload it from disk before saving" });

	await openProjectActions(page);
	await page
		.getByRole("menuitem", { name: "Save project", exact: true })
		.click();
	await expect(notice).toBeVisible();
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
	await expect(notice).not.toContainText("Your unsaved changes");
	await expect(notice).toContainText(
		"Saving is paused so neither version is overwritten.",
	);
	await expect(notice).not.toContainText("opening other files");
	await expect(repeated).toHaveCount(0);
	expect((await documentState(page)).dirty).toBe(false);

	await (await openProjectFiles(page))
		.getByLabel("Add STEP files", { exact: true })
		.setInputFiles({
			name: "board.step",
			mimeType: "application/step",
			buffer: Buffer.from("ISO-10303-21;"),
		});
	await expect
		.poll(() =>
			page.evaluate(() => !document.querySelector('[aria-busy="true"]')),
		)
		.toBe(true);
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
	await expect(repeated).toHaveCount(0);
	await expect(notice).not.toContainText("Your unsaved changes");
	expect((await documentState(page)).dirty).toBe(false);
	expect((await documentState(page)).assets).toEqual([]);

	await (await openProjectFiles(page))
		.getByLabel("Add symbol files", { exact: true })
		.setInputFiles({
			name: "point.ecadsym",
			mimeType: "application/json",
			buffer: Buffer.from(
				JSON.stringify({
					format: "ecad-symbol",
					version: 1,
					units: "mm",
					id: "conflict-point",
					name: "Conflict point",
					description: "",
					prefix: "TP",
					value: "",
					shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }],
				}),
			),
		});
	await expect
		.poll(() =>
			page.evaluate(() => !document.querySelector('[aria-busy="true"]')),
		)
		.toBe(true);
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
	await expect(repeated).toHaveCount(0);
	await expect(notice).toBeVisible();
	expect((await documentState(page)).symbols).toEqual([]);
	await notice
		.getByRole("button", { name: "Reload from disk", exact: true })
		.click();
	await expect(notice).toHaveCount(0);
});

test("creating a project from one with a conflict carries its assets and leaves the conflict behind", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await expect
		.poll(async () => (await documentState(page)).name)
		.toBe("Untitled");
	await (await openProjectFiles(page))
		.getByLabel("Add STEP files", { exact: true })
		.setInputFiles({
			name: "board.step",
			mimeType: "application/step",
			buffer: Buffer.from("ISO-10303-21;"),
		});
	await expect
		.poll(async () => (await documentState(page)).assets?.length)
		.toBe(1);
	await closeProjectFiles(page);
	const original = await page.evaluate(() =>
		localStorage.getItem("ecad.active-project"),
	);
	await editProjectFile(
		page,
		".ecadprj",
		"\n# Edited in another tab\n",
		"append",
	);
	const notice = page.getByRole("alert").filter({
		hasText: "This project changed on disk",
	});
	await openProjectActions(page);
	await page
		.getByRole("menuitem", { name: "Save project", exact: true })
		.click();
	await expect(notice).toBeVisible();

	await openProjectActions(page);
	await page
		.getByRole("menuitem", { name: "New untitled project", exact: true })
		.click();
	await expect
		.poll(() =>
			page.evaluate(() => localStorage.getItem("ecad.active-project")),
		)
		.not.toBe(original);
	await expect(notice).toHaveCount(0);
	await expect
		.poll(async () => (await documentState(page)).assets?.length)
		.toBe(1);
	expect((await documentState(page)).dirty).toBe(false);
	await expect(
		page
			.getByRole("alert")
			.filter({ hasText: "Reload it from disk before saving" }),
	).toHaveCount(0);
});

test("a conflict found by a new project's first save shows the notice", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await expect
		.poll(async () => (await documentState(page)).name)
		.toBe("Untitled");
	await openSchematic(page);
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	const original = await page.evaluate(() =>
		localStorage.getItem("ecad.active-project"),
	);
	await page.evaluate((original) => {
		const createWritable = FileSystemFileHandle.prototype.createWritable;
		FileSystemFileHandle.prototype.createWritable = async function (...args) {
			const writable = await createWritable.apply(this, args);
			if (
				this.name !== ".ecadprj" ||
				localStorage.getItem("ecad.active-project") !== original
			)
				return writable;
			FileSystemFileHandle.prototype.createWritable = createWritable;
			const write = writable.write.bind(writable);
			writable.write = async (data: FileSystemWriteChunkType) =>
				write(new Blob([data as BlobPart, "\n# Edited in another window\n"]));
			return writable;
		};
	}, original);
	await openProjectActions(page);
	await page
		.getByRole("menuitem", { name: "New untitled project", exact: true })
		.click();
	await expect
		.poll(() =>
			page.evaluate(() => localStorage.getItem("ecad.active-project")),
		)
		.not.toBe(original);
	const notice = page.getByRole("alert").filter({
		hasText: "This project changed on disk",
	});
	await expect(notice).toBeVisible();
	await expect(notice).toContainText("Your unsaved changes are still here.");
	expect((await documentState(page)).dirty).toBe(true);
	expect((await documentState(page)).shapes).toHaveLength(1);
	await notice
		.getByRole("button", { name: "Reload from disk", exact: true })
		.click();
	await expect(notice).toHaveCount(0);
});

test("unsaved edits in the library symbol editor are named by the conflict notice", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/tests/browser/projects.html");
	await expect
		.poll(async () => (await documentState(page)).name)
		.toBe("Untitled");
	const manifest = await readProjectFile(page, ".ecadprj");
	const drawing = /^drawing = "(.+)"$/m.exec(manifest)?.[1];
	if (!drawing) throw new Error("The project has no drawing.");
	await editProjectFile(
		page,
		drawing,
		JSON.stringify({
			symbolLibraries: [
				{
					id: "qa",
					name: "QA lib",
					enabled: true,
					source: {
						kind: "embedded",
						symbols: [
							{
								format: "ecad-symbol",
								version: 1,
								units: "mm",
								id: "qa-part",
								name: "QA part",
								description: "",
								prefix: "U",
								value: "",
								shapes: [
									{ kind: "rectangle", x: 0, y: 0, width: 10, height: 6 },
									{ kind: "pin", name: "Signal", x: -6, y: 0 },
								],
							},
						],
					},
				},
			],
		}),
		"json",
	);
	await page.reload();
	await expect
		.poll(async () => (await documentState(page)).name)
		.toBe("Untitled");
	await openSchematic(page);
	await page.getByRole("button", { name: "Symbols", exact: true }).click();
	await page
		.getByRole("button", { name: "Insert QA part", exact: true })
		.click();
	await page.locator("canvas").click({ position: { x: 600, y: 450 } });
	await page.getByRole("button", { name: "Edit symbol", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Symbol editor · QA part",
	);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);

	await editProjectFile(
		page,
		".ecadprj",
		"\n# Edited in another tab\n",
		"append",
	);
	await (await toolbarButton(page, "Rectangle")).click();
	await page.mouse.move(450, 350);
	await page.mouse.down();
	await page.mouse.move(650, 550);
	await page.mouse.up();

	const notice = page.getByRole("alert").filter({
		hasText: "This project changed on disk",
	});
	await expect(notice).toBeVisible();
	expect((await documentState(page)).dirty).toBe(false);
	await expect(notice).toContainText(
		"Your unsaved changes are still here. Reloading from disk discards them.",
	);
	await expect(
		page
			.getByRole("alert")
			.filter({ hasText: "Reload it from disk before saving" }),
	).toHaveCount(0);
	await notice
		.getByRole("button", { name: "Reload from disk", exact: true })
		.click();
	await expect(notice).toHaveCount(0);
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"Schematic editor",
	);
	await expect(
		page.getByRole("button", { name: "Back to schematic", exact: true }),
	).toHaveCount(0);
});

const benchParts = {
	id: "parts",
	name: "Bench parts",
	enabled: true,
	source: { kind: "directory", path: "parts" },
};
const kit = {
	id: "kit",
	name: "Kit",
	enabled: true,
	source: {
		kind: "embedded",
		symbols: [
			{
				format: "ecad-symbol",
				version: 1,
				units: "mm",
				id: "divider",
				name: "Divider",
				description: "",
				prefix: "R",
				value: "",
				shapes: [
					{ kind: "pin", name: "1", x: 0, y: 0 },
					{ kind: "pin", name: "2", x: 0, y: 5 },
					{
						kind: "symbol",
						library: { scope: "project", id: "parts" },
						definitionId: "resistor",
						x: 0,
						y: 0,
					},
				],
			},
		],
	},
};

for (const { name, libraries, part } of [
	{
		name: "its own library",
		libraries: [benchParts],
		part: { id: "resistor", library: "parts" },
	},
	{
		name: "a library it depends on",
		libraries: [benchParts, kit],
		part: { id: "divider", library: "kit" },
	},
])
	test(`a part whose symbol needs ${name} that fails to load is reported and never saved as a placeholder`, async ({
		page,
	}) => {
		await page.goto("/tests/browser/projects.html");
		await expect
			.poll(async () => (await documentState(page)).name)
			.toBe("Untitled");
		const manifest = await readProjectFile(page, ".ecadprj");
		const drawing = /^drawing = "(.+)"$/m.exec(manifest)?.[1];
		if (!drawing) throw new Error("The project has no drawing.");
		const saved = JSON.parse(await readProjectFile(page, drawing));
		await editProjectFile(
			page,
			drawing,
			JSON.stringify({
				symbolLibraries: libraries,
				circuit: {
					...saved.circuit,
					components: [
						{
							id: "r1",
							reference: "R1",
							value: "10k",
							part: {
								id: part.id,
								name: "Resistor",
								library: { scope: "project", id: part.library },
							},
							pins: [
								{
									id: "r1-1",
									name: "1",
									number: "1",
									electricalType: "passive",
								},
								{
									id: "r1-2",
									name: "2",
									number: "2",
									electricalType: "passive",
								},
							],
						},
					],
				},
			}),
			"json",
		);
		await page.reload();
		await expect
			.poll(async () => (await documentState(page)).name)
			.toBe("Untitled");
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Schematic editor", exact: true })
			.click();
		await closeProjectFiles(page);

		const banner = page.getByRole("alert").filter({ hasText: "Bench parts" });
		await expect(banner).toContainText(
			"Bench parts: Directory paths require the desktop app.",
		);
		await expect(banner).toContainText(
			"Load the missing symbol library before saving the linked PCB.",
		);
		await screenshot(page, "library-load-error.png");

		const stored = JSON.parse(await readProjectFile(page, drawing));
		expect(stored.shapes).toEqual([]);
		expect(JSON.stringify(stored)).not.toContain("circuit-fallback");
		expect(stored.circuit.components[0].schematicShapeId).toBeUndefined();
		expect((await documentState(page)).shapes).toEqual([]);
	});

async function writeProjectFile(page: Page, path: string, content: string) {
	await page.evaluate(
		async ({ path, content }) => {
			const name = localStorage.getItem("ecad.active-project") as string;
			let directory = await (
				await navigator.storage.getDirectory()
			).getDirectoryHandle(name);
			const parts = path.split("/");
			const filename = parts.pop() as string;
			for (const part of parts)
				directory = await directory.getDirectoryHandle(part, { create: true });
			const writable = await (
				await directory.getFileHandle(filename, { create: true })
			).createWritable();
			await writable.write(content);
			await writable.close();
		},
		{ path, content },
	);
}

const placedPartCases = [
	{
		name: "an embedded symbol whose nested library fails to load",
		owner: "good",
		child: "parts",
		issue: "Bench parts: Directory paths require the desktop app.",
	},
	{
		name: "a standalone project symbol whose nested library fails to load",
		owner: "project-symbols",
		child: "parts",
		issue: "Bench parts: Directory paths require the desktop app.",
	},
	{
		name: "a disabled project symbols library whose nested library fails to load",
		owner: "project-symbols",
		child: "parts",
		disabled: true,
		issue: "Bench parts: Directory paths require the desktop app.",
	},
	{
		name: "an embedded symbol whose nested symbol was deleted",
		owner: "good",
		child: "good",
		issue: 'Symbol "core" is unavailable in library "good".',
	},
	{
		name: "a nested symbol that resolves, and saves normally",
		owner: "good",
		child: "good",
		keepChild: true,
	},
];

for (const {
	name,
	owner: ownerId,
	child,
	disabled,
	issue,
	keepChild,
} of placedPartCases)
	test(`a placed part keeps its pins with ${name}`, async ({ page }) => {
		const standalone = ownerId === "project-symbols";
		const childLibrary = { scope: "project" as const, id: child };
		const owner = { scope: "project" as const, id: ownerId };
		const symbolFile = (id: string, shapes: unknown[]) =>
			parseSymbolFile(
				JSON.stringify({
					format: "ecad-symbol",
					version: 1,
					units: "mm",
					id,
					name: id,
					description: "",
					prefix: "U",
					value: "",
					shapes,
				}),
			);
		const core = symbolFile("core", [{ kind: "pin", name: "OUT", x: 5, y: 0 }]);
		const amp = symbolFile("amp", [
			{ kind: "pin", name: "IN", x: -5, y: 0 },
			{ kind: "pin", name: "GND", x: 0, y: 5 },
			{
				kind: "symbol",
				library: childLibrary,
				definitionId: "core",
				x: 0,
				y: 0,
			},
		]);
		const coreDefinition = {
			...libraryDefinitions([core])[0],
			library: childLibrary,
		};
		const ampDefinition = {
			...libraryDefinitions([amp], (library, id) =>
				library.id === child && id === "core" ? coreDefinition : undefined,
			)[0],
			library: owner,
		};
		const definitions = [...symbolDefinitions, coreDefinition, ampDefinition];
		const linked = synchronizePcb(
			createCircuit("Untitled", "pcb-main"),
			[createSymbol(1, ampDefinition, { x: 0, y: 0 }, "U1")],
			undefined,
			definitions,
		);
		expect(linked.file.circuit.components[0].pins).toHaveLength(3);

		await page.goto("/tests/browser/projects.html");
		await expect
			.poll(async () => (await documentState(page)).name)
			.toBe("Untitled");
		const manifest = await readProjectFile(page, ".ecadprj");
		const drawing = /^drawing = "(.+)"$/m.exec(manifest)?.[1];
		if (!drawing) throw new Error("The project has no drawing.");
		if (standalone) {
			await writeProjectFile(page, "symbols/amp.ecadsym", JSON.stringify(amp));
			await writeProjectFile(
				page,
				".ecadprj",
				manifest.replace("symbols = []", 'symbols = [ "symbols/amp.ecadsym" ]'),
			);
		}
		await editProjectFile(
			page,
			drawing,
			JSON.stringify({
				shapes: persistDrawingShapes(linked.shapes, definitions),
				circuit: linked.file.circuit,
				symbolLibraries: [
					...(child === "parts" ? [{ ...benchParts, id: "parts" }] : []),
					...(standalone
						? disabled
							? [
									{
										id: "project-symbols",
										name: "Project symbols",
										enabled: false,
										source: { kind: "embedded", symbols: [amp] },
									},
								]
							: []
						: [
								{
									id: owner.id,
									name: "Good",
									enabled: true,
									source: {
										kind: "embedded",
										symbols: keepChild ? [amp, core] : [amp],
									},
								},
							]),
				],
			}),
			"json",
		);
		const before = await readProjectFile(page, drawing);
		await page.reload();
		await expect
			.poll(async () => (await documentState(page)).name)
			.toBe("Untitled");
		await openSchematic(page);
		await drawRectangle(page, 120);
		if (keepChild) {
			await expect
				.poll(async () => (await documentState(page)).dirty)
				.toBe(false);
			const saved = JSON.parse(
				await readProjectFile(
					page,
					/^drawing = "(.+)"$/m.exec(
						await readProjectFile(page, ".ecadprj"),
					)![1],
				),
			);
			expect(saved.shapes).toHaveLength(2);
			expect(saved.circuit.components[0].pins).toEqual(
				linked.file.circuit.components[0].pins,
			);
			return;
		}

		const banner = page.getByRole("alert").filter({
			hasText: "Load the missing symbol library before saving the linked PCB.",
		});
		await expect(banner).toBeVisible();
		await expect(banner).toContainText(issue ?? "");
		expect((await documentState(page)).dirty).toBe(true);
		expect(await readProjectFile(page, drawing)).toBe(before);
	});
