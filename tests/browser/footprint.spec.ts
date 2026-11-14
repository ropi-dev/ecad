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

test("a footprint takes pads and layer graphics, hides layers and turns into a 3D board", async ({
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
	await expect(flat).toBeDisabled();

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
	).toBeDisabled();
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
