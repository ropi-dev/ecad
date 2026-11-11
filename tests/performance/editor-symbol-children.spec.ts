import { fromMils } from "@ecad/drawing-core/drawing/units.ts";
import { expect, type Page, test } from "@playwright/test";
import { drawingPoint, selectSymbolParent } from "../browser/symbol-items";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	committed,
	finish,
	interaction,
	metric,
	ready,
	report,
	saveCount,
	saved,
} from "./app-helpers.ts";

setupAppTests();

async function worldPoint(page: Page, point: { x: number; y: number }) {
	const origin = await drawingPoint(page, { x: 0, y: 0 });
	const unit = await drawingPoint(page, { x: 1, y: 1 });
	return {
		x: (point.x - origin.x) / (unit.x - origin.x),
		y: (point.y - origin.y) / (unit.y - origin.y),
	};
}

test(
	"editor-symbol-children",
	{ tag: ["@editor", "@symbols"] },
	async ({ page }, testInfo) => {
		await page.addInitScript(() => {
			const file = {
				format: "ecad-symbol",
				version: 1,
				units: "mm",
				id: "hierarchy-part",
				name: "Hierarchy part",
				description: "",
				prefix: "U",
				value: "",
				shapes: [
					{
						kind: "rectangle",
						x: 0,
						y: 0,
						width: 40,
						height: 160,
						locked: false,
					},
					{
						kind: "text",
						text: "Controller",
						x: 0,
						y: 0,
						width: 15,
						height: 3,
						fontSize: 2,
					},
					...Array.from({ length: 128 }, (_, index) => ({
						kind: "pin",
						x: index < 64 ? -20 : 20,
						y: ((index % 64) - 32) * 2.54,
						name: `Signal ${index + 1}`,
						number: String(index + 1),
						locked: false,
					})),
				],
			};
			localStorage.setItem(
				"ecad.user-config.v1",
				JSON.stringify({
					version: 1,
					symbolLibraries: [
						{
							id: "hierarchy",
							name: "Hierarchy",
							enabled: true,
							source: { kind: "embedded", symbols: [file] },
						},
					],
				}),
			);
		});
		await page.goto("/editor?perf=1");
		await ready(page);
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		await page
			.getByRole("button", { name: "Insert Hierarchy part", exact: true })
			.click();
		const canvas = page.locator("canvas");
		const box = required(await canvas.boundingBox());
		const grid = fromMils(100);
		const placement = await worldPoint(page, {
			x: box.x + box.width * 0.45,
			y: box.y + box.height * 0.5,
		});
		const parent = {
			x: Math.round(placement.x / grid) * grid,
			y: Math.round(placement.y / grid) * grid,
		};
		let saves = await saveCount(page);
		const origin = await drawingPoint(page, parent);
		await page.mouse.click(origin.x, origin.y);
		const anchor = page.locator(
			'[data-testid="text-anchor"][data-anchor-id*=":text:"]',
		);
		const children = [
			{ kind: "rectangle", x: 0, y: 0, label: "Center X" },
			{ kind: "text", x: 0, y: 0, label: "Anchor X" },
			{ kind: "pin", x: -20, y: 0, label: "Center X" },
		];
		for (let repeat = 0; repeat < 3; repeat++) {
			for (const child of children) {
				// The previous edit saves; a save that lands mid-press cancels the
				// press, so let it finish before the next child is selected.
				await saved(page, saves);
				saves = await saveCount(page);
				const point = await drawingPoint(page, {
					x: parent.x + child.x + (child.kind === "rectangle" ? 10 : 0),
					y: parent.y + child.y + (child.kind === "rectangle" ? 30 : 0),
				});
				await page.mouse.move(point.x, point.y);
				for (const clickCount of [1, 2]) {
					await page.mouse.down({ clickCount });
					// A press that ends where it began on a pin end starts a wire.
					if (child.kind === "pin") {
						await page.mouse.move(point.x + 4, point.y);
						await page.mouse.move(point.x, point.y);
					}
					await page.mouse.up({ clickCount });
				}
				await expect(page.getByTestId("symbol-child-selection")).toBeVisible();
				await expect(
					page.getByRole("spinbutton", { name: child.label, exact: true }),
				).toBeVisible();
				await interaction(page, "symbol.child-edit", async () => {
					const { label } = child;
					const input = page.getByRole("spinbutton", {
						name: label,
						exact: true,
					});
					const value =
						child.kind === "pin" ? -780 + repeat * 10 : 200 + repeat * 50;
					await input.fill(String(value));
					await input.press("Tab");
					child.x = fromMils(value);
					await committed(page, label, fromMils(value));
					await page.evaluate(
						() =>
							new Promise<void>((resolve) =>
								requestAnimationFrame(() =>
									requestAnimationFrame(() => resolve()),
								),
							),
					);
				});
				await selectSymbolParent(page);
				const text = required(children.find(({ kind }) => kind === "text"));
				const expected = await drawingPoint(page, {
					x: parent.x + text.x,
					y: parent.y + text.y,
				});
				await expect
					.poll(async () => {
						const box = required(await anchor.boundingBox());
						return Math.hypot(
							box.x + box.width / 2 - expected.x,
							box.y + box.height / 2 - expected.y,
						);
					})
					.toBeLessThan(1);
			}
		}
		const value = await report(page);
		await finish(page, testInfo, "editor-symbol-children", {
			interactionP95Ms: required(metric(value, "scenario.interaction")),
		});
	},
);
