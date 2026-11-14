import { expect, type Page, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
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

async function boardSelection(page: Page) {
	return page.evaluate(() => {
		const area = (
			document.querySelector("[data-view]") as HTMLElement
		).getBoundingClientRect();
		return Object.fromEntries(
			[
				...document.querySelectorAll<SVGPolygonElement>(
					'[data-testid="board-selection"]',
				),
			].map((outline) => {
				const corners = (outline.getAttribute("points") ?? "")
					.split(" ")
					.map((corner) => corner.split(",").map(Number));
				return [
					Number(outline.dataset.shapeId),
					{
						x:
							area.left +
							corners.reduce((sum, [x]) => sum + x, 0) / corners.length,
						y:
							area.top +
							corners.reduce((sum, [, y]) => sum + y, 0) / corners.length,
					},
				];
			}),
		);
	});
}

test("a footprint takes pads and layer graphics, hides layers and is edited as a 3D board", async ({
	page,
}) => {
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
		page.getByRole("img", { name: "Drawing rulers in millimetres" }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Pads", exact: true }),
	).toBeEnabled();
	const boardCanvas = await area.locator("canvas").elementHandle();
	const view = required(await area.boundingBox());

	// A rectangle dragged to the left selects whatever it touches.
	await page.mouse.move(view.x + view.width - 80, view.y + 70);
	await page.mouse.down();
	await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2, {
		steps: 3,
	});
	await page.mouse.move(view.x + 330, view.y + view.height - 110, { steps: 3 });
	await page.mouse.up();
	const selection = page.locator('[data-testid="board-selection"]');
	await expect(selection).toHaveCount(4);
	const [throughHole] = (await documentState(page)).editorShapes;
	const outlines = await boardSelection(page);
	await page.keyboard.press("Escape");
	await expect(selection).toHaveCount(0);

	const grip = required(outlines[throughHole.id]);
	await page.mouse.click(grip.x, grip.y);
	await expect(selection).toHaveCount(1);
	await expect(selection).toHaveAttribute(
		"data-shape-id",
		String(throughHole.id),
	);
	await expect(page.getByTestId("resize-handle")).not.toHaveCount(0);
	await page.mouse.move(grip.x, grip.y);
	await page.mouse.down();
	await page.mouse.move(grip.x - 40, grip.y - 10, { steps: 3 });
	await page.mouse.move(grip.x - 90, grip.y - 30, { steps: 3 });
	await page.mouse.up();
	await expect(selection).toHaveAttribute(
		"data-shape-id",
		String(throughHole.id),
	);
	await expect
		.poll(async () => {
			const moved = (await documentState(page)).editorShapes[0];
			return moved.x !== throughHole.x || moved.y !== throughHole.y;
		})
		.toBe(true);
	const moved = (await documentState(page)).editorShapes[0];
	for (const coordinate of [moved.x, moved.y])
		expect(
			Math.abs(coordinate * 10 - Math.round(coordinate * 10)),
		).toBeLessThan(1e-6);

	await (await toolbarButton(page, "Surface mount pad")).click();
	await page.mouse.move(view.x + view.width - 200, view.y + view.height / 2);
	await expect(page.locator('[data-testid="board-placement"]')).toHaveCount(1);
	await page.mouse.click(view.x + view.width - 200, view.y + view.height / 2);
	await page.keyboard.press("Escape");
	await expect
		.poll(async () => (await documentState(page)).editorShapes.length)
		.toBe(5);
	expect((await documentState(page)).editorShapes[4].pad.type).toBe("smd");
	expect(
		await area
			.locator("canvas")
			.evaluate((canvas, before) => canvas === before, boardCanvas),
	).toBe(true);
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
	expect((await documentState(page)).editorShapes).toHaveLength(5);
});
