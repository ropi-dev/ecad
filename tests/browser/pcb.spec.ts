import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { Page } from "@playwright/test";
import { required } from "../helpers/required.ts";
import {
	closeProjectFiles,
	openProjectFiles,
	projectRail,
} from "./project-files";
import { screenPointOfMillimetres } from "./rulers";
import { expect, test } from "./seeded-project";
import { toolbarButton } from "./toolbar";

const documentState = async (page: Page) =>
	JSON.parse((await page.locator("#project-document").textContent()) ?? "{}");

async function addExample(page: Page) {
	await page.goto("/tests/browser/projects.html");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Workspace home", exact: true })
		.click();
	await closeProjectFiles(page);
	await projectRail(page)
		.getByRole("button", { name: "Add file", exact: true })
		.click();
	await page
		.getByRole("menuitem", { name: "RP2350A reference design", exact: true })
		.click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"PCB editor · RP2350A",
	);
}

test("a designer adds the RP2350A example and gets a routed board in the same file as its schematic, which passes the check", async ({
	page,
}) => {
	await addExample(page);
	await expect
		.poll(async () => (await documentState(page)).boards)
		.toEqual(["rp2350a"]);
	await expect(page.getByText("All connections routed")).toBeVisible();
	expect(
		page.workers().some((worker) => worker.url().includes("analysis.worker")),
	).toBe(true);
	const files = await openProjectFiles(page);
	await expect(
		files.getByRole("link", { name: "Open RP2350A.ecaddraw in PCB view" }),
	).toHaveAttribute("aria-current", "page");
	await expect(
		files.getByRole("link", { name: "Open RP2350A.ecaddraw", exact: true }),
	).not.toHaveAttribute("aria-current", "page");
	await expect(files.getByText(".ecadpcb")).toHaveCount(0);
	await closeProjectFiles(page);

	await page.getByRole("button", { name: "Design rules check" }).click();
	await page.getByRole("button", { name: "Run DRC", exact: true }).click();
	await expect(
		page.getByText("No violations, and every connection is routed."),
	).toBeVisible();

	await page.getByRole("button", { name: "Switch to schematic view" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"Schematic editor · RP2350A",
	);
	await page.getByRole("button", { name: "Schematic settings" }).click();
	const settings = page.getByRole("dialog", { name: "Schematic settings" });
	await expect(settings.getByLabel("Title", { exact: true })).toHaveValue(
		"RP2350A QFN-60 Minimal Design Example",
	);
	await expect(settings.getByLabel("Revision")).toHaveValue("S1");
	await page.keyboard.press("Escape");
	await expect(settings).toHaveCount(0);
	await page.getByRole("button", { name: "Switch to pcb view" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"PCB editor · RP2350A",
	);
	await expect(page.getByText("All connections routed")).toBeVisible();
});

test("opening the RP2350A example from the start page lands in its PCB", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Workspace home", exact: true })
		.click();
	await closeProjectFiles(page);
	await page
		.getByRole("button", { name: "RP2350A reference design", exact: true })
		.click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"PCB editor · RP2350A",
	);
	await expect
		.poll(async () => (await documentState(page)).boards)
		.toEqual(["rp2350a"]);
});

test("choosing a layer focuses it as the Gerber viewer does, and choosing it again shows every layer", async ({
	page,
}) => {
	await addExample(page);
	await expect(page.getByText("All connections routed")).toBeVisible();
	const layers = page.getByRole("complementary", { name: "Layers" });
	const backCopper = layers.locator('[data-layer="B.Cu"]');
	const drawOnBack = layers.getByRole("button", {
		name: "Draw on Back copper",
	});
	const canvas = page.locator("canvas");
	const capture = async () => {
		await page.mouse.move(700, 120);
		return canvas.screenshot();
	};
	await expect(layers.locator("[data-focused=true]")).toHaveCount(0);

	await drawOnBack.click();
	await expect(drawOnBack).toHaveAttribute("aria-pressed", "true");
	await expect(backCopper).toHaveAttribute("data-focused", "true");
	await expect(drawOnBack).toHaveAccessibleDescription(
		"Focused. The other layers are dimmed.",
	);
	await expect(page.getByText("All connections routed · B.Cu")).toBeVisible();
	const focused = await capture();

	await drawOnBack.click();
	await expect(backCopper).toHaveAttribute("data-focused", "false");
	await expect(drawOnBack).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByText("All connections routed · B.Cu")).toBeVisible();
	await expect.poll(async () => (await capture()).equals(focused)).toBe(false);
});

test("a designer deletes a routed track and draws it again with the Track tool", async ({
	page,
}) => {
	await addExample(page);
	await expect(page.getByText("All connections routed")).toBeVisible();
	const { editorShapes } = await documentState(page);
	const track = required(
		(editorShapes as EditorShape[]).find(
			(shape) =>
				shape.kind === "line" &&
				shape.layer === "F.Cu" &&
				"net" in shape &&
				shape.width > 3 &&
				Math.abs(Math.sin(2 * shape.rotation)) < 1e-6,
		),
	);
	const along = (side: number) => ({
		x: track.x + (side * track.width * Math.cos(track.rotation)) / 2,
		y: track.y + (side * track.width * Math.sin(track.rotation)) / 2,
	});
	const middle = await screenPointOfMillimetres(page, track.x, track.y);
	await page.mouse.click(middle.x, middle.y);
	await page.keyboard.press("Delete");
	await expect(page.getByText("1 unrouted connection")).toBeVisible();

	await (await toolbarButton(page, "Track")).click();
	for (const side of [-1, 1]) {
		const end = along(side);
		const point = await screenPointOfMillimetres(page, end.x, end.y);
		await page.mouse.move(point.x, point.y);
		await page.mouse.click(point.x, point.y);
	}
	await expect(page.getByText("All connections routed")).toBeVisible();
});

test("the schematic, circuit and PCB of a circuit stay open together and keep the same component selected", async ({
	page,
}) => {
	await addExample(page);
	await expect(page.getByText("All connections routed")).toBeVisible();
	const panes = page.locator("[data-editor-pane]");
	await expect(panes).toHaveCount(3);
	const active = page.locator('[data-editor-pane="active"]');
	const selectedReferences = async () => {
		const ids = await active
			.getByTestId("text-anchor")
			.evaluateAll((anchors) =>
				anchors.map((anchor) =>
					Number(anchor.getAttribute("data-anchor-id")?.split(":")[0]),
				),
			);
		const shapes: {
			id: number;
			kind: string;
			attributes?: { reference?: string };
		}[] = (await documentState(page)).editorShapes;
		return [
			...new Set(
				shapes
					.filter((shape) => shape.kind === "symbol" && ids.includes(shape.id))
					.map((shape) => shape.attributes?.reference),
			),
		].sort();
	};
	const footprint = required(
		((await documentState(page)).editorShapes as EditorShape[]).find(
			(shape) =>
				shape.kind === "symbol" &&
				shape.footprint !== undefined &&
				shape.attributes?.reference === "U1",
		),
	);
	await page
		.getByRole("button", { name: "Draw on Front fabrication", exact: true })
		.click();
	for (const layer of ["Front copper", "Back copper"])
		await page
			.getByRole("button", { name: `Hide ${layer}`, exact: true })
			.click();
	const point = await screenPointOfMillimetres(page, footprint.x, footprint.y);
	await page.mouse.click(point.x, point.y);
	await expect.poll(selectedReferences).toEqual(["U1"]);
	await page
		.locator('[data-editor-pane="active"] canvas')
		.first()
		.evaluate((canvas) => {
			canvas.dataset.kept = "true";
		});

	await page.getByRole("button", { name: "Switch to schematic view" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"Schematic editor · RP2350A",
	);
	await expect.poll(selectedReferences).toEqual(["U1"]);

	await page.getByRole("button", { name: "Switch to circuit view" }).click();
	const selectedComponent = active.locator(".circuit-component.is-selected");
	await expect(
		selectedComponent.getByRole("button", { name: "Select component U1" }),
	).toBeVisible();
	await active
		.getByRole("button", { name: "Select component X1", exact: true })
		.click();
	await expect(
		selectedComponent.getByRole("button", { name: "Select component X1" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Switch to pcb view" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"PCB editor · RP2350A",
	);
	await expect.poll(selectedReferences).toEqual(["X1"]);
	await expect(active.locator('canvas[data-kept="true"]')).toHaveCount(1);
	await expect(panes).toHaveCount(3);
});
