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
	const canvas = page.locator('canvas[aria-label^="PCB editor"]');
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

test("a designer adds two inner copper layers and routes a track through one with Page Down and Page Up", async ({
	page,
}) => {
	await addExample(page);
	await expect(page.getByText("All connections routed")).toBeVisible();
	const layers = page.getByRole("complementary", { name: "Layers" });
	await expect(layers.locator('[data-layer="In1.Cu"]')).toHaveCount(0);
	await (await toolbarButton(page, "Board setup")).click();
	await page
		.getByRole("region", { name: "Board setup" })
		.getByLabel("Copper layers")
		.selectOption("4");
	await expect(
		layers.getByRole("button", { name: "Draw on Inner copper 1" }),
	).toBeVisible();
	await expect(layers.locator('[data-layer="In2.Cu"]')).toHaveCount(1);
	await expect(layers.locator('[data-layer="In3.Cu"]')).toHaveCount(0);
	await page.keyboard.press("Escape");

	const { editorShapes } = await documentState(page);
	const shapes = editorShapes as EditorShape[];
	const track = required(
		shapes.find(
			(shape) =>
				shape.kind === "line" &&
				shape.layer === "F.Cu" &&
				"net" in shape &&
				shape.width > 3 &&
				Math.abs(Math.sin(2 * shape.rotation)) < 1e-6,
		),
	);
	const vias = shapes.filter((shape) => shape.kind === "circle" && shape.via);
	const along = (side: number) => ({
		x: track.x + (side * track.width * Math.cos(track.rotation)) / 2,
		y: track.y + (side * track.width * Math.sin(track.rotation)) / 2,
	});
	const clickAt = async (side: number) => {
		const end = along(side);
		const point = await screenPointOfMillimetres(page, end.x, end.y);
		await page.mouse.move(point.x, point.y);
		await page.mouse.click(point.x, point.y);
	};
	const middle = await screenPointOfMillimetres(page, track.x, track.y);
	await page.mouse.click(middle.x, middle.y);
	await page.keyboard.press("Delete");
	await expect(page.getByText("1 unrouted connection")).toBeVisible();

	await (await toolbarButton(page, "Track")).click();
	await clickAt(-1);
	await clickAt(-0.4);
	await page.keyboard.press("PageDown");
	await expect(page.getByText("· In1.Cu")).toBeVisible();
	await clickAt(0.4);
	await page.keyboard.press("PageUp");
	await expect(page.getByText("· F.Cu")).toBeVisible();
	await clickAt(1);
	await expect(page.getByText("All connections routed")).toBeVisible();
	await expect
		.poll(async () => {
			const after = (await documentState(page)).editorShapes as EditorShape[];
			return {
				inner: after.filter(
					(shape) => shape.kind === "line" && shape.layer === "In1.Cu",
				).length,
				vias: after.filter((shape) => shape.kind === "circle" && shape.via)
					.length,
			};
		})
		.toEqual({ inner: 1, vias: vias.length + 2 });
});

test("a designer draws a polygon copper zone corner by corner, drags a corner and raises its priority", async ({
	page,
}) => {
	await addExample(page);
	await expect(page.getByText("All connections routed")).toBeVisible();
	const shapes = async () =>
		(await documentState(page)).editorShapes as EditorShape[];
	const outline = required(
		(await shapes()).find(
			(shape) => shape.kind === "rectangle" && shape.layer === "Edge.Cuts",
		),
	);
	const at = (dx: number, dy: number) =>
		screenPointOfMillimetres(
			page,
			outline.x + dx * outline.width,
			outline.y + dy * outline.height,
		);
	const corners = [
		await at(-0.4, 0.4),
		await at(-0.2, 0.4),
		await at(-0.2, 0.3),
		await at(-0.3, 0.3),
		await at(-0.3, 0.2),
		await at(-0.4, 0.2),
	];
	const zones = async () =>
		(await shapes()).flatMap((shape) =>
			shape.kind === "rectangle" && shape.zone?.outline ? [shape] : [],
		);

	await (await toolbarButton(page, "Polygon copper zone")).click();
	for (const corner of corners.slice(0, 3)) {
		await page.mouse.move(corner.x, corner.y);
		await page.mouse.click(corner.x, corner.y);
	}
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Select", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	expect(await zones()).toEqual([]);
	await (await toolbarButton(page, "Polygon copper zone")).click();
	for (const corner of corners) {
		await page.mouse.move(corner.x, corner.y);
		await page.mouse.click(corner.x, corner.y);
	}
	await page.keyboard.press("Enter");
	await expect.poll(async () => (await zones()).length).toBe(1);
	const [drawn] = await zones();
	expect(drawn.zone?.outline).toHaveLength(6);
	expect(drawn.width).toBeCloseTo(outline.width * 0.2, 0);

	const handle = page.locator(
		`[data-testid="resize-handle"][data-shape-id="${drawn.id}"][data-handle="corner:2"]`,
	);
	await expect(handle).toBeVisible();
	const from = required(await handle.boundingBox());
	const to = await at(-0.25, 0.25);
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 4 });
	await page.mouse.up();
	await expect
		.poll(async () => (await zones())[0]?.zone?.outline?.length)
		.toBe(6);
	await expect
		.poll(async () => (await zones())[0]?.height)
		.toBeCloseTo(drawn.height, 1);
	await expect
		.poll(async () => (await zones())[0]?.width)
		.toBeCloseTo(drawn.width, 1);
	expect((await zones())[0]?.zone?.outline).not.toEqual(drawn.zone?.outline);

	const inside = await at(-0.35, 0.35);
	await page.mouse.dblclick(inside.x, inside.y);
	const priority = page.getByLabel("Zone priority");
	await expect(priority).toHaveValue("0");
	await priority.fill("2");
	await priority.press("Enter");
	await expect.poll(async () => (await zones())[0]?.zone?.priority).toBe(2);
	for (const refused of ["2000", "1.5"]) {
		await priority.fill(refused);
		await priority.press("Enter");
		await expect(priority).toHaveValue("2");
	}
	expect((await zones())[0]?.zone?.priority).toBe(2);
});

test("the schematic, circuit and PCB of a circuit stay open together and keep the same component selected", async ({
	page,
}) => {
	await addExample(page);
	await expect(page.getByText("All connections routed")).toBeVisible();
	const panes = page.locator("[data-editor-pane]");
	await expect(panes).toHaveCount(3, { timeout: 15_000 });
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

test("the realistic board draws each footprint's 3D model, and the cube button hides and shows them", async ({
	page,
}) => {
	await addExample(page);
	await expect(page.getByText("All connections routed")).toBeVisible();
	const models = page.getByRole("button", { name: "3D models" });
	await expect(models).toHaveCount(0);
	await page.getByRole("button", { name: "Realistic board" }).click();
	await expect(models).toHaveAttribute("aria-pressed", "true");
	const box = required(
		await page.locator('canvas[aria-label^="PCB editor"]').boundingBox(),
	);
	const panel = required(
		await page.getByRole("complementary", { name: "Layers" }).boundingBox(),
	);
	const left = panel.x + panel.width + 8;
	const capture = async () => {
		await page.mouse.move(700, 120);
		return page.screenshot({
			clip: {
				x: left,
				y: box.y,
				width: box.x + box.width - left,
				height: box.height / 2,
			},
		});
	};
	const settled = async () => {
		let previous: Buffer | undefined;
		await expect
			.poll(async () => {
				const next = await capture();
				const same = previous?.equals(next) ?? false;
				previous = next;
				return same;
			})
			.toBe(true);
		return required(previous);
	};
	await models.click();
	await expect(models).toHaveAttribute("aria-pressed", "false");
	const hidden = await settled();
	await models.click();
	await expect(models).toHaveAttribute("aria-pressed", "true");
	let shown: Buffer | undefined;
	await expect
		.poll(async () => {
			shown = await settled();
			return shown.equals(hidden);
		})
		.toBe(false);
	await models.click();
	await expect(models).toHaveAttribute("aria-pressed", "false");
	await expect.poll(async () => (await settled()).equals(hidden)).toBe(true);
	await models.click();
	await expect(models).toHaveAttribute("aria-pressed", "true");
	await expect
		.poll(async () => (await settled()).equals(required(shown)))
		.toBe(true);
	await page.getByRole("button", { name: "Realistic board" }).click();
	await expect(models).toHaveCount(0);
});

test("the realistic toggle shows the board with its solder mask in the flat and 3D views, and turning it off brings back the layer colors", async ({
	page,
}) => {
	await addExample(page);
	await expect(page.getByText("All connections routed")).toBeVisible();
	const realistic = page.getByRole("button", { name: "Realistic board" });
	const area = page.locator("div[data-view]");
	const flat = page.getByRole("button", { name: "2D", exact: true });
	const box = required(
		await page.locator('canvas[aria-label^="PCB editor"]').boundingBox(),
	);
	const toolbar = required(await flat.boundingBox());
	const panel = required(
		await page.getByRole("complementary", { name: "Layers" }).boundingBox(),
	);
	const left = panel.x + panel.width + 8;
	const capture = async () => {
		await page.mouse.move(700, 120);
		return page.screenshot({
			clip: {
				x: left,
				y: box.y,
				width: box.x + box.width - left,
				height: toolbar.y - box.y - 16,
			},
		});
	};
	const settled = async () => {
		let previous: Buffer | undefined;
		await expect
			.poll(async () => {
				const next = await capture();
				const same = previous?.equals(next) ?? false;
				previous = next;
				return same;
			})
			.toBe(true);
		return required(previous);
	};
	const toggleBothWays = async () => {
		await expect(realistic).toHaveAttribute("aria-pressed", "false");
		const layered = await settled();
		await realistic.click();
		await expect(realistic).toHaveAttribute("aria-pressed", "true");
		await expect
			.poll(async () => (await capture()).equals(layered))
			.toBe(false);
		await realistic.click();
		await expect(realistic).toHaveAttribute("aria-pressed", "false");
		await expect.poll(async () => (await capture()).equals(layered)).toBe(true);
	};

	await expect(area).toHaveAttribute("data-view", "2d");
	await toggleBothWays();

	await flat.click();
	await expect(area).toHaveAttribute("data-view", "3d");
	await toggleBothWays();
});

test("the PCB's Unplated hole tool places a hole through the board with no net", async ({
	page,
}) => {
	await addExample(page);
	await page.getByRole("button", { name: "Routing", exact: true }).click();
	await page
		.getByRole("button", { name: "Unplated hole", exact: true })
		.click();
	const point = await screenPointOfMillimetres(page, -12, -22);
	await page.mouse.move(point.x, point.y);
	await page.mouse.click(point.x, point.y);
	await page.keyboard.press("Escape");
	await expect
		.poll(async () =>
			((await documentState(page)).editorShapes as EditorShape[])
				.filter((shape) => shape.kind === "circle" && shape.hole)
				.map((shape) => [shape.width, shape.kind === "circle" && shape.hole]),
		)
		.toEqual([[3.2, { drill: 3.2 }]]);
	await page.mouse.dblclick(point.x, point.y);
	const attributes = page.getByRole("complementary", {
		name: "Selection attributes",
	});
	await expect(attributes.getByText("Through the board")).toBeVisible();
	await expect(attributes.getByLabel("Drill")).toHaveValue("3.2");
	await expect(attributes.getByLabel("Net")).toHaveCount(0);
});
