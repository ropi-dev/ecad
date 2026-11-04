import { expect, test } from "@playwright/test";
import { toolbarButton } from "../browser/toolbar";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

for (const connectionKind of ["wire", "pin"] as const)
	test(`editor-${connectionKind}-junction`, async ({ page }, testInfo) => {
		await page.goto("/projects?perf=1");
		await ready(page);
		await page.evaluate(async () => {
			const shapes = Array.from({ length: 200 }, (_, index) => ({
				id: index + 1,
				kind: "wire",
				x: 80 + (index % 10) * 6,
				y: 60 + Math.floor(index / 10) * 3,
				width: 4,
				height: 0.254,
				lineWidth: 0.254,
				rotation: 0,
			}));
			const root = await navigator.storage.getDirectory();
			const directory = await root.getDirectoryHandle("Junction fixture", {
				create: true,
			});
			for (const [name, content] of [
				[
					".ecadprj",
					'format = "ecad-project"\nversion = 1\nname = "Junction fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
				],
				["drawing.ecaddraw", JSON.stringify({ shapes })],
			]) {
				const writer = await (
					await directory.getFileHandle(name, { create: true })
				).createWritable();
				await writer.write(content);
				await writer.close();
			}
			localStorage.setItem("ecad.active-project", "Junction fixture");
		});
		await page.goto("/editor?perf=1");
		await ready(page);
		await expect(
			page.getByRole("button", { name: "Select", exact: true }),
		).toBeEnabled();
		await page
			.getByRole("button", { name: "Snap to grid", exact: true })
			.click();
		const canvas = page.locator("canvas");
		const bounds = (await canvas.boundingBox())!;
		const start = { x: bounds.width * 0.25, y: bounds.height * 0.6 };
		const end = { x: bounds.width * 0.55, y: start.y };
		const branch = { x: bounds.width * 0.4, y: bounds.height * 0.4 };
		await (await toolbarButton(page, "Pin")).click();
		await canvas.click({ position: start });
		await canvas.click({ position: start });
		await canvas.click({ position: end });
		await page.keyboard.press("Enter");
		if (connectionKind === "wire") {
			await (await toolbarButton(page, "Pin")).click();
			await canvas.click({ position: branch });
		}
		for (let repeat = 0; repeat < 3; repeat++) {
			if (connectionKind === "wire") {
				await canvas.click({ position: branch });
				await expect(page.locator('[data-tool="wire"]')).toBeAttached();
			} else await (await toolbarButton(page, "Pin")).click();
			await interaction(page, `${connectionKind}.join-segment`, async () => {
				await canvas.click({ position: { x: branch.x, y: start.y } });
				await page.waitForFunction(() =>
					document.querySelector('[data-tool="select"]'),
				);
			});
			if (repeat < 2) await (await toolbarButton(page, "Undo")).click();
		}
		await expect
			.poll(async () =>
				page.evaluate(async () => {
					let directory = await (
						await navigator.storage.getDirectory()
					).getDirectoryHandle("Junction fixture");
					const manifest = await (
						await directory.getFileHandle(".ecadprj")
					).getFile();
					const path = (await manifest.text())
						.match(/^drawing\s*=\s*"([^"]+)"/m)![1]
						.split("/");
					const name = path.pop()!;
					for (const part of path)
						directory = await directory.getDirectoryHandle(part);
					const file = await (await directory.getFileHandle(name)).getFile();
					return JSON.parse(await file.text()).shapes.length;
				}),
			)
			.toBe(connectionKind === "wire" ? 205 : 204);
		const value = await report(page);
		await finish(page, testInfo, `editor-${connectionKind}-junction`, {
			interactionP95Ms: metric(value, "scenario.interaction")!,
			normalizationP95Ms: metric(value, "editor.wire-normalize")!,
		});
	});
