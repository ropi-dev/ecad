import { mkdir } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
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
	const box = required(await canvas.boundingBox());
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

for (const [direction, steps] of [
	["in", 12],
	["out", 8],
] as const) {
	test(`physical zoom ${direction} beyond fit-relative limits survives view switches`, async ({
		page,
	}) => {
		await page.addInitScript(() => {
			window.ecadDisplay = {
				getCalibration: () =>
					new Promise((resolve) =>
						setTimeout(() => resolve({ pixelsPerMm: 6.4 }), 100),
					),
				onChanged: () => () => {},
			};
		});
		await page.goto("/tests/browser/projects.html");
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
			.click();
		await closeProjectFiles(page);
		const actualSize = page.getByRole("button", {
			name: "Actual size",
			exact: true,
		});
		await expect(actualSize).toBeEnabled();
		for (let index = 0; index < steps; index++)
			await page
				.getByRole("button", { name: `Zoom ${direction}`, exact: true })
				.click();
		await moveCamera(page, "schematic", 0);
		const zoom = await actualSize.innerText();
		const camera = await schematicCamera(page);
		for (let index = 0; index < 2; index++) {
			await switchTo(page, "circuit");
			await switchTo(page, "schematic");
			await expect(actualSize).toBeEnabled();
			await expect(actualSize).toHaveText(zoom);
			await expect.poll(() => schematicCamera(page)).toBe(camera);
		}
		await mkdir("/tmp/ecad-viewport", { recursive: true });
		await page.screenshot({
			path: `/tmp/ecad-viewport/physical-zoom-${direction}-restored.png`,
		});
	});
}

for (const delay of [0, 100]) {
	test(`a schematic opens at actual size when the display calibration takes ${delay} ms`, async ({
		page,
	}) => {
		await page.addInitScript((delay) => {
			window.ecadDisplay = {
				getCalibration: () =>
					new Promise((resolve) =>
						setTimeout(() => resolve({ pixelsPerMm: 6.4 }), delay),
					),
				onChanged: () => () => {},
			};
		}, delay);
		await page.goto("/tests/browser/projects.html");
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Open Untitled.ecaddraw", exact: true })
			.click();
		await closeProjectFiles(page);
		const actualSize = page.getByRole("button", {
			name: "Actual size",
			exact: true,
		});
		await expect(actualSize).toBeEnabled();
		await expect(actualSize).toHaveText("100%");
		await page
			.getByRole("button", { name: "Fit drawing", exact: true })
			.click();
		await expect(actualSize).not.toHaveText("100%");
		await switchTo(page, "circuit");
		await switchTo(page, "schematic");
		await expect(actualSize).toBeEnabled();
		await expect(actualSize).not.toHaveText("100%");
	});
}

test("the zoom label trails a continuous zoom and ends on its level", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	const fit = page.getByRole("button", { name: "Fit drawing", exact: true });
	await expect(fit).toBeEnabled();
	await expect(fit).toHaveText(/^\d+%$/);
	const before = required(await fit.textContent());
	// Zoom in for 30 frames, then back out by the same steps.
	const { changes, elapsed } = await fit.evaluate(
		(button) =>
			new Promise<{ changes: number; elapsed: number }>((resolve) => {
				const canvas = document.querySelector("canvas");
				if (!canvas) throw new Error("Expected the canvas");
				let changes = 0;
				const observer = new MutationObserver(() => changes++);
				observer.observe(button, {
					characterData: true,
					childList: true,
					subtree: true,
				});
				const started = performance.now();
				let frame = 0;
				const tick = () => {
					if (frame === 60) {
						const elapsed = performance.now() - started;
						observer.disconnect();
						resolve({ changes, elapsed });
						return;
					}
					canvas.dispatchEvent(
						new WheelEvent("wheel", {
							deltaY: frame < 30 ? -8 : 8,
							ctrlKey: true,
							clientX: innerWidth / 2,
							clientY: innerHeight / 2,
							bubbles: true,
							cancelable: true,
						}),
					);
					frame++;
					requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}),
	);
	// One update when the zoom starts, then at most one every 100 ms.
	expect(changes).toBeGreaterThan(0);
	expect(changes).toBeLessThanOrEqual(Math.floor(elapsed / 100) + 1);
	await expect(fit).toHaveText(before);
});

test("a continuous zoom places each ruler tick with one attribute", async ({
	page,
}) => {
	await page.goto("/tests/browser/editor.html");
	const rulers = page.getByRole("img", { name: "Drawing rulers in mils" });
	await expect(rulers.locator("[data-axis]")).not.toHaveCount(0);
	// Zoom in for 20 frames, then back out by the same steps.
	const { frames, writes, ticks } = await rulers.evaluate(
		(rulers) =>
			new Promise<{ frames: number; writes: number; ticks: number }>(
				(resolve) => {
					const canvas = document.querySelector("canvas");
					if (!canvas) throw new Error("Expected the canvas");
					let writes = 0;
					let ticks = 0;
					const count = (records: MutationRecord[]) => {
						writes += records.filter(
							(record) => record.type === "attributes",
						).length;
					};
					const observer = new MutationObserver(count);
					observer.observe(rulers, { attributes: true, subtree: true });
					let frame = 0;
					const tick = () => {
						ticks = Math.max(
							ticks,
							rulers.querySelectorAll("[data-axis]").length,
						);
						if (frame === 40) {
							count(observer.takeRecords());
							observer.disconnect();
							resolve({ frames: frame, writes, ticks });
							return;
						}
						canvas.dispatchEvent(
							new WheelEvent("wheel", {
								deltaY: frame < 20 ? -8 : 8,
								ctrlKey: true,
								clientX: innerWidth / 2,
								clientY: innerHeight / 2,
								bubbles: true,
								cancelable: true,
							}),
						);
						frame++;
						requestAnimationFrame(tick);
					};
					requestAnimationFrame(tick);
				},
			),
	);
	// The ticks follow every frame.
	expect(writes).toBeGreaterThan(frames);
	// A frame writes one transform per labelled tick and the two paths of the
	// unlabelled ones. The allowance covers the values of ticks that enter.
	expect(writes).toBeLessThanOrEqual(frames * (ticks + 2) + 60);
});
