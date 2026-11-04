import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { captureArtifacts } from "./artifacts";
import { closeProjectFiles, openProjectFiles } from "./project-files";
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

/** Changes a file of the open browser project as another tab would. */
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
		for (const part of parts) directory = await directory.getDirectoryHandle(part);
		return (await (await directory.getFileHandle(filename)).getFile()).text();
	}, path);
}

test("a project changed on disk stops autosave and offers to reload from disk", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await expect.poll(async () => (await documentState(page)).name).toBe("Untitled");
	await openSchematic(page);
	await drawRectangle(page);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	expect((await documentState(page)).shapes).toHaveLength(1);

	// Another tab rewrites the project manifest.
	await editProjectFile(page, ".ecadprj", "\n# Edited in another tab\n", "append");
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
				(window as unknown as {
					projectFileAccess: { manifestReads: number; writes: number };
				}).projectFileAccess,
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
	// The editor banner does not repeat the conflict as a save error.
	await expect(
		page.getByRole("alert").filter({ hasText: "Reload it from disk before saving" }),
	).toHaveCount(0);
	await screenshot(page, "project-conflict.png");

	// Further edits stay in memory without touching the changed files.
	const afterConflict = await access();
	expect(afterConflict.writes).toBe(0);
	await drawRectangle(page, 80);
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(3);
	await page.evaluate(
		() => new Promise((resolve) => setTimeout(resolve, 300)),
	);
	expect(await access()).toEqual(afterConflict);
	await expect(notice).toBeVisible();
	await expect(notice).toContainText(
		"Saving, and opening other files or projects, is paused",
	);

	// Switching views stays put and does not repeat the conflict as an error.
	const switchView = page.getByRole("button", {
		name: "Switch to circuit view",
		exact: true,
	});
	await switchView.click();
	await expect(switchView).toBeEnabled();
	await expect(
		page.getByRole("alert").filter({ hasText: "Reload it from disk before saving" }),
	).toHaveCount(0);
	expect(await access()).toEqual(afterConflict);
	expect((await documentState(page)).shapes).toHaveLength(3);

	await notice.getByRole("button", { name: "Reload from disk", exact: true }).click();
	await expect(notice).toHaveCount(0);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	expect((await documentState(page)).shapes).toHaveLength(1);

	// Saving works again after the reload.
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toBeEnabled();
	await drawRectangle(page, 40);
	await expect.poll(async () => (await documentState(page)).shapes.length).toBe(2);
	await expect.poll(async () => (await documentState(page)).dirty).toBe(false);
	expect(await readProjectFile(page, ".ecadprj")).not.toContain(
		"Edited in another tab",
	);
});

test("a conflict found by an import alone does not claim unsaved changes", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await expect.poll(async () => (await documentState(page)).name).toBe("Untitled");
	await editProjectFile(page, ".ecadprj", "\n# Edited in another tab\n", "append");
	await (await openProjectFiles(page))
		.getByLabel("Add STEP files", { exact: true })
		.setInputFiles({
			name: "board.step",
			mimeType: "application/step",
			buffer: Buffer.from("ISO-10303-21;"),
		});
	const notice = page.getByRole("alert").filter({
		hasText: "This project changed on disk",
	});
	await expect(notice).toBeVisible();
	await expect(notice).not.toContainText("Your unsaved changes");
	expect((await documentState(page)).dirty).toBe(false);
	expect((await documentState(page)).assets).toEqual([]);
	await notice.getByRole("button", { name: "Reload from disk", exact: true }).click();
	await expect(notice).toHaveCount(0);
});

const benchParts = {
	id: "parts",
	name: "Bench parts",
	enabled: true,
	source: { kind: "directory", path: "parts" },
};
// An embedded library loads, but its symbol places one from Bench parts.
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
		// A directory library cannot load in the browser. The part is not placed yet.
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
								{ id: "r1-1", name: "1", number: "1", electricalType: "passive" },
								{ id: "r1-2", name: "2", number: "2", electricalType: "passive" },
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
