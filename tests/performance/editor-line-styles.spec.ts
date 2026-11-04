import { expect, test } from "@playwright/test";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test("editor-line-styles", async ({ page }, testInfo) => {
	await page.goto("/projects?perf=1");
	await ready(page);
	await page.evaluate(async () => {
		const kinds = ["rectangle", "circle", "triangle", "line"];
		const styles = ["dashed", "dotted", "dash-dot", "dash-dot-dot"];
		const shapes = Array.from({ length: 100 }, (_, index) => ({
			id: index + 1,
			kind: kinds[index % kinds.length],
			x: -90 + (index % 10) * 20,
			y: -54 + Math.floor(index / 10) * 12,
			width: 12,
			height: kinds[index % kinds.length] === "circle" ? 12 : 8,
			rotation: 0,
			lineWidth: 0.4,
			lineStyle: styles[Math.floor(index / 4) % styles.length],
		}));
		const directory = await (
			await navigator.storage.getDirectory()
		).getDirectoryHandle("Line style fixture", { create: true });
		for (const [name, content] of [
			[
				".ecadprj",
				'format = "ecad-project"\nversion = 1\nname = "Line style fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
			],
			["drawing.ecaddraw", JSON.stringify({ shapes })],
		]) {
			const writer = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await writer.write(content);
			await writer.close();
		}
		localStorage.setItem("ecad.active-project", "Line style fixture");
	});
	await page.goto("/editor?perf=1");
	await ready(page);
	await expect
		.poll(
			async () =>
				(await report(page)).metrics["editor.line-style-geometry"]?.count ?? 0,
		)
		.toBeGreaterThan(0);
	const bounds = required(await page.locator("canvas").boundingBox());
	await page.mouse.move(
		bounds.x + bounds.width * 0.25,
		bounds.y + bounds.height * 0.2,
	);
	await page.mouse.down();
	await page.mouse.move(
		bounds.x + bounds.width * 0.75,
		bounds.y + bounds.height * 0.8,
	);
	await page.mouse.up();
	await expect(
		page.getByText("Selected shapes", { exact: true }),
	).toBeVisible();
	const select = page.getByRole("combobox", {
		name: "Line style",
		exact: true,
	});
	for (const style of ["dashed", "dotted", "dash-dot-dot"]) {
		await interaction(page, "line-style.change", async () => {
			await select.selectOption(style);
			await page.waitForFunction(
				(style) =>
					document.querySelector<HTMLSelectElement>(
						'select[aria-label="Line style"]',
					)?.value === style,
				style,
			);
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
		});
	}
	await expect
		.poll(async () =>
			page.evaluate(async () => {
				const directory = await (
					await navigator.storage.getDirectory()
				).getDirectoryHandle("Line style fixture");
				const manifest = await (
					await directory.getFileHandle(".ecadprj")
				).getFile();
				const path = ((await manifest.text()).match(
					/^drawing\s*=\s*"([^"]+)"/m,
				) ??
					(() => {
						throw new Error("Expected a value");
					})())[1].split("/");
				const name =
					path.pop() ??
					(() => {
						throw new Error("Expected a value");
					})();
				let folder = directory;
				for (const segment of path)
					folder = await folder.getDirectoryHandle(segment);
				const file = await (await folder.getFileHandle(name)).getFile();
				return JSON.parse(await file.text()).shapes.every(
					(shape: { lineStyle: string }) => shape.lineStyle === "dash-dot-dot",
				);
			}),
		)
		.toBe(true);
	const interactionP95Ms = required(
		metric(await report(page), "scenario.interaction"),
	);
	await page.reload();
	await ready(page);
	await expect
		.poll(
			async () =>
				(await report(page)).metrics["editor.line-style-geometry"]?.count ?? 0,
		)
		.toBeGreaterThan(0);
	const value = await report(page);
	await finish(page, testInfo, "editor-line-styles", {
		interactionP95Ms,
		styleGeometryP95Ms: required(metric(value, "editor.line-style-geometry")),
	});
});
