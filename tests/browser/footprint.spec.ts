import { expect, type Page, test } from "@playwright/test";
import {
	closeProjectFiles,
	openProjectFiles,
	projectRail,
} from "./project-files";
import { toolbarButton } from "./toolbar";

const documentState = async (page: Page) =>
	JSON.parse((await page.locator("#project-document").textContent()) ?? "{}");

async function screenPointOfMillimetres(page: Page, x: number, y: number) {
	const rulers = page.getByRole("img", {
		name: "Drawing rulers in millimetres",
	});
	await expect(rulers.locator("[data-axis]")).not.toHaveCount(0);
	const scale = await rulers.evaluate((element) => {
		const axis = (name: string, key: "x" | "y") => {
			const ticks = [
				...element.querySelectorAll<SVGGElement>(
					`g[data-axis="${name}"][data-value]`,
				),
			]
				.map((tick) => {
					const box = (
						tick.querySelector("line") as SVGLineElement
					).getBoundingClientRect();
					return {
						value: Number(tick.dataset.value),
						position: box[key] + (key === "x" ? box.width : box.height) / 2,
					};
				})
				.sort((a, b) => a.value - b.value);
			const first = ticks[0];
			const last = ticks[ticks.length - 1];
			const perUnit =
				(last.position - first.position) / (last.value - first.value);
			return { perUnit, origin: first.position - first.value * perUnit };
		};
		return { x: axis("x", "x"), y: axis("y", "y") };
	});
	return {
		x: scale.x.origin + x * scale.x.perUnit,
		y: scale.y.origin + y * scale.y.perUnit,
	};
}

async function drag(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
) {
	const start = await screenPointOfMillimetres(page, from.x, from.y);
	const end = await screenPointOfMillimetres(page, to.x, to.y);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, {
		steps: 3,
	});
	await page.mouse.move(end.x, end.y, { steps: 3 });
	await page.mouse.up();
}

async function createFootprint(page: Page) {
	await page.goto("/tests/browser/projects.html");
	await (await openProjectFiles(page))
		.getByRole("link", { name: "Workspace home", exact: true })
		.click();
	await closeProjectFiles(page);
	await projectRail(page)
		.getByRole("button", { name: "Add file", exact: true })
		.click();
	await page
		.getByRole("menuitem", { name: "New footprint", exact: true })
		.click();
	await page.getByRole("dialog").getByRole("textbox").fill("Test part");
	await page
		.getByRole("button", { name: "Create footprint", exact: true })
		.click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Footprint editor · Test part",
	);
}

test("a footprint takes pads and layer graphics, hides layers and turns into a 3D board", async ({
	page,
}) => {
	await createFootprint(page);
	const canvas = page.getByRole("application", { name: "Footprint editor" });
	await expect(canvas.locator("canvas")).toBeVisible();
	const flat = page.getByRole("button", { name: "2D", exact: true });
	await expect(flat).toBeEnabled();

	await (await toolbarButton(page, "Surface mount pad")).click();
	for (const x of [-1, 1]) {
		const point = await screenPointOfMillimetres(page, x, 0);
		await page.mouse.move(point.x, point.y);
		await page.mouse.click(point.x, point.y);
	}
	await page.keyboard.press("Escape");
	await expect
		.poll(async () =>
			(await documentState(page)).editorShapes.map(
				(shape: { pad?: { number: string }; layer?: string; x: number }) => [
					shape.pad?.number,
					shape.layer,
					shape.x,
				],
			),
		)
		.toEqual([
			["1", "F.Cu", -1],
			["2", "F.Cu", 1],
		]);

	await page.getByRole("button", { name: "Draw on Front silkscreen" }).click();
	await page.getByRole("button", { name: "Shapes", exact: true }).click();
	await page.getByRole("button", { name: "Wire", exact: true }).click();
	await drag(page, { x: -0.5, y: 1 }, { x: 0.5, y: 1 });
	await expect
		.poll(async () => {
			const wire = (await documentState(page)).editorShapes[2];
			return wire && [wire.kind, wire.layer, wire.width, wire.lineWidth];
		})
		.toEqual(["line", "F.SilkS", 1, 0.15]);

	await page.getByRole("button", { name: "Draw on Front courtyard" }).click();
	await page.getByRole("button", { name: "Shapes", exact: true }).click();
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
	await drag(page, { x: -1.8, y: -1.2 }, { x: 1.8, y: 1.2 });
	await expect
		.poll(async () => (await documentState(page)).editorShapes[3]?.layer)
		.toBe("F.CrtYd");
	await expect(
		page.getByRole("button", { name: "Hide Front courtyard" }),
	).toBeDisabled();

	const pad = await screenPointOfMillimetres(page, -1, 0);
	const attributes = page.getByRole("complementary", {
		name: "Selection attributes",
	});
	await page.getByRole("button", { name: "Hide Front copper" }).click();
	await page.mouse.dblclick(pad.x, pad.y);
	await expect(attributes.getByLabel("Layer")).toHaveValue("F.CrtYd");
	await expect(attributes.getByLabel("Pad number")).toHaveCount(0);
	await page.getByRole("button", { name: "Show Front copper" }).click();
	await page.mouse.dblclick(pad.x, pad.y);
	await expect(attributes.getByLabel("Pad number")).toHaveValue("1");
	await expect(attributes.getByLabel("Center X")).toHaveValue("-1");
	await attributes.getByLabel("Pad type").selectOption("through-hole");
	await expect
		.poll(async () => (await documentState(page)).editorShapes[0].pad)
		.toEqual({ number: "1", type: "through-hole", drill: 0.6 });
	const drill = attributes.getByLabel("Drill");
	await drill.fill("3");
	await drill.press("Enter");
	await expect(drill).toHaveValue("0.6");
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "Hide Back copper" }).click();
	const secondPad = await screenPointOfMillimetres(page, 1, 0);
	await page.mouse.dblclick(secondPad.x, secondPad.y);
	const backCopper = attributes.getByLabel("Layer").locator("option", {
		hasText: "Back copper",
	});
	await expect(backCopper).toHaveText("Back copper (hidden)");
	await expect(backCopper).toBeDisabled();
	await page.getByRole("button", { name: "Show Back copper" }).click();
	await page.mouse.dblclick(secondPad.x, secondPad.y);
	await attributes.getByLabel("Layer").selectOption("B.Cu");
	await expect
		.poll(async () => (await documentState(page)).editorShapes[1].layer)
		.toBe("B.Cu");
	await expect(attributes.getByLabel("Layer")).toHaveValue("B.Cu");
	await page.keyboard.press("Escape");

	await expect
		.poll(
			async () => (await documentState(page)).footprints?.[0]?.shapes.length,
		)
		.toBe(4);

	const area = page.locator("[data-view]");
	await expect(flat).toHaveAttribute("aria-pressed", "true");
	await flat.click();
	await expect(area).toHaveAttribute("data-view", "3d");
	await expect(flat).toHaveAttribute("aria-pressed", "false");
	await expect(
		page.getByRole("application", { name: "Footprint board" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Pads", exact: true }),
	).toBeEnabled();
	await expect(
		page.getByRole("img", { name: "Drawing rulers in millimetres" }),
	).toHaveCount(0);
	const boardCanvas = await area.locator("canvas").elementHandle();
	await page.getByRole("button", { name: "Hide Front silkscreen" }).click();
	await expect(
		page.getByRole("button", { name: "Show Front silkscreen" }),
	).toBeVisible();
	expect(
		await area
			.locator("canvas")
			.evaluate((canvas, before) => canvas === before, boardCanvas),
	).toBe(true);
	await flat.click();
	await expect(area).toHaveAttribute("data-view", "2d");
	await expect(flat).toHaveAttribute("aria-pressed", "true");
	await expect(
		page.getByRole("button", { name: "Pads", exact: true }),
	).toBeEnabled();
	expect((await documentState(page)).editorShapes).toHaveLength(4);
});

test("footprint items are selected, moved and placed on their layer in the 3D view", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await createFootprint(page);
	const canvas = page.getByRole("application", { name: "Footprint editor" });
	await expect(canvas.locator("canvas")).toBeVisible();
	await (await toolbarButton(page, "Surface mount pad")).click();
	for (const x of [-1, 1]) {
		const point = await screenPointOfMillimetres(page, x, 0);
		await page.mouse.move(point.x, point.y);
		await page.mouse.click(point.x, point.y);
	}
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Draw on Front silkscreen" }).click();
	await page.getByRole("button", { name: "Shapes", exact: true }).click();
	await page.getByRole("button", { name: "Rectangle", exact: true }).click();
	await drag(page, { x: -2, y: -1.5 }, { x: 2, y: 1.5 });
	await expect
		.poll(async () => (await documentState(page)).editorShapes.length)
		.toBe(3);
	await page.getByRole("button", { name: "Draw on Front copper" }).click();
	const firstPad = await screenPointOfMillimetres(page, -1, 0);
	await page.mouse.click(firstPad.x, firstPad.y);

	const flat = page.getByRole("button", { name: "2D", exact: true });
	await flat.click();
	const area = page.locator("[data-view]");
	await expect(area).toHaveAttribute("data-view", "3d");
	const outline = page.getByTestId("board-selection");
	await expect(outline).toHaveCount(1);
	const [first, second] = (await documentState(page)).editorShapes;
	await expect(outline).toHaveAttribute("data-shape-id", String(first.id));
	const centre = async () => {
		const box = await outline.boundingBox();
		if (!box) throw new Error("The selection outline has no box.");
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	};
	let start = await centre();
	await expect.poll(async () => (await centre()).x).toBe(start.x);
	start = await centre();

	const board = page.getByRole("application", { name: "Footprint board" });
	const boardBox = await board.boundingBox();
	if (!boardBox) throw new Error("The board view has no box.");
	await page.mouse.click(boardBox.x + boardBox.width - 60, boardBox.y + 60);
	await expect(outline).toHaveCount(0);
	await page.mouse.click(start.x, start.y);
	await expect(outline).toHaveCount(1);
	await expect(outline).toHaveAttribute("data-shape-id", String(first.id));

	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x - 30, start.y, { steps: 4 });
	await page.mouse.move(start.x - 60, start.y, { steps: 4 });
	await page.mouse.up();
	await expect
		.poll(async () => {
			const pad = (await documentState(page)).editorShapes[0];
			return [pad.id, pad.layer, pad.x < -1.2];
		})
		.toEqual([first.id, "F.Cu", true]);
	await expect
		.poll(async () => {
			const end = await centre();
			return Math.hypot(end.x - (start.x - 60), end.y - start.y);
		})
		.toBeLessThan(12);
	const moved = (await documentState(page)).editorShapes;
	expect(moved[1]).toEqual(second);
	expect(moved[2].x).toBe(0);

	await (await toolbarButton(page, "Surface mount pad")).click();
	await page.mouse.move(start.x + 40, start.y + 60);
	await expect(page.getByTestId("board-placement-preview")).toBeVisible();
	await page.mouse.click(start.x + 40, start.y + 60);
	await page.keyboard.press("Escape");
	await expect
		.poll(async () =>
			(await documentState(page)).editorShapes
				.slice(3)
				.map((shape: { pad?: { number: string }; layer?: string }) => [
					shape.pad?.number,
					shape.layer,
				]),
		)
		.toEqual([["3", "F.Cu"]]);

	await page.keyboard.press("ControlOrMeta+z");
	await expect
		.poll(async () => (await documentState(page)).editorShapes.length)
		.toBe(3);
	await flat.click();
	await expect(area).toHaveAttribute("data-view", "2d");
});

test("an empty footprint opens an empty 3D view that takes its first pad", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await createFootprint(page);
	const flat = page.getByRole("button", { name: "2D", exact: true });
	await flat.click();
	const area = page.locator("[data-view]");
	await expect(area).toHaveAttribute("data-view", "3d");
	const board = page.getByRole("application", { name: "Footprint board" });
	await expect(board).toBeVisible();
	const pads = page.getByRole("button", { name: "Pads", exact: true });
	await expect(pads).toBeEnabled();
	const box = await board.boundingBox();
	if (!box) throw new Error("The board view has no box.");
	await (await toolbarButton(page, "Surface mount pad")).click();
	const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.mouse.move(centre.x, centre.y);
	await expect(page.getByTestId("board-placement-preview")).toBeVisible();
	await page.mouse.click(centre.x, centre.y);
	await page.keyboard.press("Escape");
	await expect
		.poll(async () =>
			(await documentState(page)).editorShapes.map(
				(shape: { pad?: { number: string }; layer?: string }) => [
					shape.pad?.number,
					shape.layer,
				],
			),
		)
		.toEqual([["1", "F.Cu"]]);
	await page.keyboard.press("ControlOrMeta+z");
	await expect
		.poll(async () => (await documentState(page)).editorShapes.length)
		.toBe(0);
	await expect(area).toHaveAttribute("data-view", "3d");
	await expect(board).toBeVisible();
	await flat.click();
	await expect(area).toHaveAttribute("data-view", "2d");
});
