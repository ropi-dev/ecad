import { test } from "@playwright/test";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	editorReady,
	finish,
	interaction,
	percentile,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

test(
	"editor-user-symbol",
	{ tag: ["@editor", "@symbols"] },
	async ({ page }, testInfo) => {
		const symbol = {
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id: "user-package",
			name: "User package",
			description: "",
			prefix: "U",
			value: "",
			shapes: Array.from({ length: 128 }, (_, index) => ({
				kind: "pin",
				name: `Pin ${index + 1}`,
				x: index < 64 ? -10 : 10,
				y: (index % 64) - 32,
			})),
		};
		await page.addInitScript((symbol) => {
			localStorage.setItem(
				"ecad.user-config.v1",
				JSON.stringify({
					version: 1,
					symbolLibraries: [
						{
							id: "user",
							name: "User",
							enabled: true,
							source: { kind: "embedded", symbols: [symbol] },
						},
					],
				}),
			);
		}, symbol);
		await page.goto("/editor?perf=1");
		await ready(page);
		await page.getByRole("button", { name: "Symbols", exact: true }).click();
		await page
			.getByRole("button", { name: "Insert User package", exact: true })
			.click();
		const bounds = required(await page.locator("canvas").boundingBox());
		const placed = { x: bounds.width * 0.4, y: bounds.height / 2 };
		await page.locator("canvas").click({ position: placed });
		for (let repeat = 0; repeat < 3; repeat++) {
			await page.locator("canvas").dblclick({ position: placed });
			await interaction(page, "symbol.open-user-definition", async () => {
				await page
					.getByRole("button", { name: "Edit symbol", exact: true })
					.click();
				await editorReady(page, "Symbol editor · User package");
			});
			await interaction(page, "symbol.save-user-definition", async () => {
				await (await toolbarButton(page, "Rectangle")).click();
				await page.mouse.move(
					bounds.x + bounds.width * 0.3,
					bounds.y + bounds.height * 0.3,
				);
				await page.mouse.down();
				await page.mouse.move(
					bounds.x + bounds.width * 0.4,
					bounds.y + bounds.height * 0.4,
				);
				await page.mouse.up();
				await page.waitForFunction(
					(count) =>
						JSON.parse(
							localStorage.getItem("ecad.user-config.v1") ??
								(() => {
									throw new Error("Expected a value");
								})(),
						).symbolLibraries[0].source.symbols[0].shapes.length === count,
					129 + repeat,
					{ polling: "raf", timeout: 30_000 },
				);
			});
			await page
				.getByRole("button", { name: "Back to schematic", exact: true })
				.click();
		}
		const value = await report(page);
		await finish(page, testInfo, "editor-user-symbol", {
			interactionP95Ms: percentile(
				value.events
					.filter((event) => event.name === "scenario.interaction")
					.map((event) => event.duration),
			),
		});
	},
);
