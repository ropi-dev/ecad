import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { captureArtifacts } from "./artifacts";
import {
	closeProjectFiles,
	openPrimaryDrawing,
	openProjectFiles,
} from "./project-files";
import { expect, test } from "./seeded-project";
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
	await openPrimaryDrawing(page);
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
		has: page.getByRole("button", { name: "Reload from disk", exact: true }),
	});
	await expect(notice).toBeVisible();
	await expect(
		notice.getByRole("button", { name: "Reload from disk", exact: true }),
	).toBeEnabled();
	expect((await documentState(page)).dirty).toBe(true);
	expect((await documentState(page)).shapes).toHaveLength(2);
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

	const switchView = page.getByRole("button", {
		name: "Switch to circuit view",
		exact: true,
	});
	await switchView.click();
	await expect(switchView).toBeEnabled();
	expect(await access()).toEqual(afterConflict);
	expect((await documentState(page)).shapes).toHaveLength(3);
	await (await openProjectFiles(page))
		.getByRole("link", {
			name: "Open Untitled.ecaddraw in circuit view",
			exact: true,
		})
		.click();
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
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

// A part from the failed library itself takes the same unavailable-symbol
// path; tests/symbol-library-config.test.ts covers both at unit level.
test("a part whose symbol needs a library it depends on that fails to load is reported and never saved as a placeholder", async ({
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
			symbolLibraries: [benchParts, kit],
			circuit: {
				...saved.circuit,
				components: [
					{
						id: "r1",
						reference: "R1",
						value: "10k",
						part: {
							id: "divider",
							name: "Resistor",
							library: { scope: "project", id: "kit" },
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
	await openPrimaryDrawing(page);
	await closeProjectFiles(page);

	const banner = page.getByRole("alert").filter({ hasText: "Bench parts" });
	await expect(banner).toBeVisible();
	await screenshot(page, "library-load-error.png");

	const stored = JSON.parse(await readProjectFile(page, drawing));
	expect(stored.shapes).toEqual([]);
	expect(JSON.stringify(stored)).not.toContain("circuit-fallback");
	expect(stored.circuit.components[0].schematicShapeId).toBeUndefined();
	expect((await documentState(page)).shapes).toEqual([]);
});
