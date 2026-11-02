import { expect, type Page, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { closeProjectFiles, openProjectFiles } from "./project-files";

const schematicCamera = async (page: Page) => {
	const value = await page.locator("html").getAttribute("data-editor-camera");
	if (!value) return null;
	return JSON.stringify(JSON.parse(value), (_key, entry) =>
		typeof entry === "number" ? Number(entry.toFixed(9)) : entry,
	);
};
const circuitCamera = (page: Page) =>
	page
		.getByLabel("Circuit connections graph", { exact: true })
		.getAttribute("viewBox");

async function switchTo(page: Page, view: "schematic" | "circuit") {
	if (view === "schematic")
		await page.locator("html").evaluate((element) => {
			delete element.dataset.editorCamera;
		});
	await page
		.getByRole("button", { name: `Switch to ${view} view`, exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Zoom in", exact: true }),
	).toBeEnabled();
	if (view === "schematic")
		await expect.poll(() => schematicCamera(page)).not.toBeNull();
}

async function moveCamera(
	page: Page,
	view: "schematic" | "circuit",
	steps: number,
) {
	for (let index = 0; index < steps; index++)
		await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	const canvas =
		view === "schematic"
			? page.locator("canvas")
			: page.getByLabel("Circuit connections graph", { exact: true });
	const box = (await canvas.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down({ button: "middle" });
	await page.mouse.move(
		box.x + box.width / 2 + 90,
		box.y + box.height / 2 + 55,
		{ steps: 8 },
	);
	await page.mouse.up({ button: "middle" });
	await page.mouse.move(1000, 50);
}

test("each document retains independent schematic and circuit zoom and pan", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await closeProjectFiles(page);
	await expect(
		page.getByRole("button", { name: "Zoom in", exact: true }),
	).toBeEnabled();
	const initialSchematic = await schematicCamera(page);
	await moveCamera(page, "schematic", 3);
	await expect.poll(() => schematicCamera(page)).not.toBe(initialSchematic);
	const schematic = await schematicCamera(page);
	await switchTo(page, "circuit");
	const initialCircuit = await circuitCamera(page);
	await moveCamera(page, "circuit", 2);
	await expect.poll(() => circuitCamera(page)).not.toBe(initialCircuit);
	const circuit = await circuitCamera(page);
	for (let index = 0; index < 3; index++) {
		await switchTo(page, "schematic");
		await expect.poll(() => schematicCamera(page)).toBe(schematic);
		await switchTo(page, "circuit");
		await expect.poll(() => circuitCamera(page)).toBe(circuit);
	}
	const sidebar = await openProjectFiles(page);
	await sidebar.getByRole("button", { name: "Add file", exact: true }).click();
	await page
		.getByRole("menuitem", { name: "New circuit", exact: true })
		.click();
	await page
		.getByLabel("Circuit name", { exact: true })
		.fill("Viewport isolation");
	await page
		.getByRole("button", { name: "Create circuit", exact: true })
		.click();
	await closeProjectFiles(page);
	await expect.poll(() => circuitCamera(page)).not.toBe(circuit);
	await moveCamera(page, "circuit", 1);
	const otherCircuit = await circuitCamera(page);
	await switchTo(page, "schematic");
	await expect.poll(() => schematicCamera(page)).not.toBe(schematic);
	await moveCamera(page, "schematic", 1);
	const otherSchematic = await schematicCamera(page);
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await closeProjectFiles(page);
	await expect.poll(() => schematicCamera(page)).toBe(schematic);
	await mkdir("/tmp/ecad-viewport", { recursive: true });
	await page.screenshot({ path: "/tmp/ecad-viewport/schematic-restored.png" });
	await switchTo(page, "circuit");
	await expect.poll(() => circuitCamera(page)).toBe(circuit);
	await page.screenshot({ path: "/tmp/ecad-viewport/circuit-restored.png" });
	await (await openProjectFiles(page))
		.getByRole("link", {
			name: "Open Viewport isolation.ecaddraw",
			exact: true,
		})
		.click();
	await closeProjectFiles(page);
	await expect.poll(() => schematicCamera(page)).toBe(otherSchematic);
	await switchTo(page, "circuit");
	await expect.poll(() => circuitCamera(page)).toBe(otherCircuit);
	await page.reload();
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
		.click();
	await closeProjectFiles(page);
	await expect.poll(() => schematicCamera(page)).toBe(initialSchematic);
	await switchTo(page, "circuit");
	await expect.poll(() => circuitCamera(page)).toBe(initialCircuit);
});
