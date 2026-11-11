import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	finish,
	interaction,
	metric,
	ready,
	report,
	saveCount,
	saved,
	savedShapeCount,
	undo,
} from "./app-helpers.ts";

setupAppTests();

test(
	"editor-component-move",
	{ tag: ["@editor"] },
	async ({ page }, testInfo) => {
		const { createSymbol, symbolDefinitions } = await import(
			"#/drawing/symbols.ts"
		);
		const { drawShape, pinTerminals } = await import(
			"@ecad/drawing-core/drawing/shapes.ts"
		);
		const symbol = createSymbol(
			201,
			required(
				symbolDefinitions.find((definition) => definition.id === "resistor"),
			),
			{ x: 0, y: 0 },
		);
		const [left, right] = pinTerminals(symbol);
		const shapes = [
			...Array.from({ length: 200 }, (_, index) =>
				drawShape(
					index + 1,
					"wire",
					{ x: 80 + (index % 10) * 6, y: 60 + Math.floor(index / 10) * 3 },
					{ x: 84 + (index % 10) * 6, y: 60 + Math.floor(index / 10) * 3 },
				),
			),
			symbol,
			drawShape(202, "wire", right, { x: 40, y: 0 }),
			drawShape(203, "pin", left, left),
		];
		await page.goto("/projects?perf=1");
		await ready(page);
		await page.evaluate(async (shapes) => {
			const root = await navigator.storage.getDirectory();
			const directory = await root.getDirectoryHandle("Component movement", {
				create: true,
			});
			for (const [name, content] of [
				[
					".ecadprj",
					'format = "ecad-project"\nversion = 1\nname = "Component movement"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
				],
				["drawing.ecaddraw", JSON.stringify({ shapes })],
			]) {
				const writer = await (
					await directory.getFileHandle(name, { create: true })
				).createWritable();
				await writer.write(content);
				await writer.close();
			}
			localStorage.setItem("ecad.active-project", "Component movement");
		}, shapes);
		await page.goto("/editor?perf=1");
		await ready(page);
		await expect(
			page.getByRole("button", { name: "Select", exact: true }),
		).toBeEnabled();
		const canvas = page.locator("canvas");
		const bounds = required(await canvas.boundingBox());
		const source = {
			x: bounds.x + bounds.width / 2,
			y: bounds.y + bounds.height / 2,
		};
		for (let repeat = 0; repeat < 3; repeat++) {
			await page.mouse.dblclick(source.x, source.y);
			await expect(
				page.getByRole("spinbutton", { name: "Center X", exact: true }),
			).toBeVisible();
			let saves = await saveCount(page);
			await interaction(page, "component.move-connected", async () => {
				await page.mouse.move(source.x, source.y);
				await page.mouse.down();
				await page.mouse.move(source.x + 40, source.y - 60, { steps: 4 });
				await page.mouse.up();
				await page.waitForFunction(
					() => {
						const value = document
							.querySelector<HTMLInputElement>('input[aria-label="Center X"]')
							?.getAttribute("data-committed-value");
						return value !== null && value !== undefined && Number(value) > 0;
					},
					undefined,
					{ polling: "raf" },
				);
			});
			if (repeat < 2) {
				// A save that lands mid-drag cancels the drag, so let the move and
				// its undo save before the next drag.
				await saved(page, saves);
				saves = await saveCount(page);
				await undo(page);
				await saved(page, saves);
			}
		}
		// 203 fixture shapes plus the segments added when the moved part's wire is rerouted.
		await expect
			.poll(() => savedShapeCount(page, "Component movement"))
			.toBe(205);
		const value = await report(page);
		await finish(page, testInfo, "editor-component-move", {
			interactionP95Ms: required(metric(value, "scenario.interaction")),
			normalizationP95Ms: required(metric(value, "editor.wire-normalize")),
		});
	},
);
