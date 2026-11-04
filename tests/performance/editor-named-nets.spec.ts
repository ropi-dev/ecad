import { expect, test } from "@playwright/test";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("editor-named-nets", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async () => {
		const shapes = [
			...Array.from({ length: 346 }, (_, index) => ({
				id: index + 1,
				kind: "wire",
				x: (index % 20) * 15 - 145,
				y: Math.floor(index / 20) * 8 - 68,
				width: 10,
				height: 0.2,
				lineWidth: 0.2,
				rotation: 0,
			})),
			...Array.from({ length: 94 }, (_, index) => ({
				id: 347 + index,
				kind: "text",
				electrical: index % 2 ? "net" : "supply",
				text: `NET${index % 20}`,
				x: (index % 20) * 15 - 150,
				y: Math.floor(index / 20) * 8 - 68,
				width: 8,
				height: 2,
				fontSize: 1.5,
				lineWidth: 0.2,
				rotation: 0,
				horizontalAlign: "left",
				verticalAlign: "bottom",
			})),
		];
		const directory = await (
			await navigator.storage.getDirectory()
		).getDirectoryHandle("Named nets", { create: true });
		for (const [name, content] of [
			[
				".ecadprj",
				'format = "ecad-project"\nversion = 1\nname = "Named nets"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
			],
			["drawing.ecaddraw", JSON.stringify({ shapes })],
		]) {
			const writer = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Named nets");
	});
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect(page.getByTestId("text-anchor")).toHaveCount(94);
	await (await toolbarButton(page, "Supply label")).click();
	const canvas = page.locator("canvas");
	const bounds = required(await canvas.boundingBox());
	await canvas.click({
		position: { x: bounds.width * 0.4, y: bounds.height * 0.3 },
	});
	for (let repeat = 0; repeat < 3; repeat++) {
		await interaction(page, "net-label.rename", async () => {
			await page
				.getByRole("textbox", { name: "Net name", exact: true })
				.fill(`+3V${repeat}`);
			await page
				.getByRole("textbox", { name: "Net name", exact: true })
				.press("Tab");
			await expect(
				page.getByRole("textbox", { name: "Net name", exact: true }),
			).toHaveValue(`+3V${repeat}`);
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
		});
	}
	await expect(page.getByTestId("text-anchor")).toHaveCount(95);
	await page.screenshot({
		path: "perf-artifacts/named-nets-workload.png",
		fullPage: true,
	});
	const interactionP95Ms = required(
		metric(await report(page), "scenario.interaction"),
	);
	await finish(page, testInfo, "editor-named-nets", { interactionP95Ms });
});
