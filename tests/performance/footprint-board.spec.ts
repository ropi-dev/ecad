import { expect, test } from "@playwright/test";
import { openProjectFiles } from "../browser/project-files";
import { toolbarButton } from "../browser/toolbar";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import {
	editorReady,
	finish,
	interaction,
	metric,
	ready,
	report,
} from "./app-helpers.ts";

setupAppTests();

test(
	"footprint-board",
	{ tag: ["@footprint", "@editor"] },
	async ({ page }, testInfo) => {
		await page.goto("/projects?perf=1");
		await ready(page);
		await page.evaluate(async () => {
			const shapes: Record<string, unknown>[] = [];
			const add = (shape: Record<string, unknown>) =>
				shapes.push({
					id: shapes.length + 1,
					rotation: 0,
					lineWidth: 0.15,
					...shape,
				});
			for (let side = 0; side < 4; side++)
				for (let index = 0; index < 25; index++) {
					const along = (index - 12) * 0.5;
					const vertical = side % 2 === 0;
					add({
						kind: "rectangle",
						layer: "F.Cu",
						filled: true,
						pad: { number: String(side * 25 + index + 1), type: "smd" },
						x: vertical ? (side === 0 ? -7.6 : 7.6) : along,
						y: vertical ? along : side === 1 ? -7.6 : 7.6,
						width: vertical ? 1.5 : 0.3,
						height: vertical ? 0.3 : 1.5,
					});
				}
			for (const [x, y] of [
				[-9.5, -9.5],
				[9.5, -9.5],
				[9.5, 9.5],
				[-9.5, 9.5],
			])
				add({
					kind: "circle",
					layer: "F.Cu",
					filled: true,
					pad: { number: "", type: "through-hole", drill: 1 },
					x,
					y,
					width: 1.7,
					height: 1.7,
				});
			for (const [layer, size] of [
				["F.SilkS", 14],
				["F.CrtYd", 17.5],
				["F.Fab", 13.6],
			] as const)
				add({
					kind: "rectangle",
					layer,
					x: 0,
					y: 0,
					width: size,
					height: size,
				});
			const root = await navigator.storage.getDirectory();
			const directory = await root.getDirectoryHandle("Footprint fixture", {
				create: true,
			});
			const footprints = await directory.getDirectoryHandle("footprints", {
				create: true,
			});
			const write = async (
				parent: FileSystemDirectoryHandle,
				name: string,
				content: string,
			) => {
				const writer = await (
					await parent.getFileHandle(name, { create: true })
				).createWritable();
				await writer.write(content);
				await writer.close();
			};
			await write(
				directory,
				".ecadprj",
				'format = "ecad-project"\nversion = 1\nname = "Footprint fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\nfootprints = [ "footprints/qfp-100.ecadfp" ]\n',
			);
			await write(
				directory,
				"drawing.ecaddraw",
				JSON.stringify({ shapes: [] }),
			);
			await write(
				footprints,
				"qfp-100.ecadfp",
				JSON.stringify({
					format: "ecad-footprint",
					version: 1,
					units: "mm",
					id: "qfp-100",
					name: "QFP 100",
					description: "",
					shapes,
				}),
			);
			localStorage.setItem("ecad.active-project", "Footprint fixture");
		});
		await page.goto("/editor?perf=1");
		await ready(page);
		await (await openProjectFiles(page))
			.getByRole("link", { name: "Open qfp-100.ecadfp", exact: true })
			.click();
		await editorReady(page, "Footprint editor · QFP 100");
		const bounds = required(await page.locator("canvas").boundingBox());
		const centre = {
			x: bounds.x + bounds.width / 2,
			y: bounds.y + bounds.height / 2,
		};
		await page.mouse.move(centre.x, centre.y);
		const layers = page.getByRole("complementary", { name: "Layers" });
		await layers
			.getByRole("button", { name: "Draw on Front silkscreen" })
			.click();
		for (let round = 0; round < 3; round++) {
			await interaction(page, "footprint.place-pad", async () => {
				await (await toolbarButton(page, "Surface mount pad")).click();
				await page.mouse.click(centre.x + round * 24, centre.y);
				await expect(layers.locator('[data-layer="F.Cu"]')).toContainText(
					String(105 + round),
				);
				await page.keyboard.press("Escape");
			});
			await interaction(page, "footprint.hide-layer", async () => {
				await layers.getByRole("button", { name: "Hide Front copper" }).click();
				await layers.getByRole("button", { name: "Show Front copper" }).click();
			});
		}
		const flat = page.getByRole("button", { name: "2D", exact: true });
		const area = page.locator("[data-view]");
		for (let round = 0; round < 3; round++) {
			await interaction(page, "footprint.board-open", async () => {
				await flat.click();
				await expect(area).toHaveAttribute("data-view", "3d");
				await expect(flat).toHaveAttribute("aria-pressed", "false");
			});
			await interaction(page, "footprint.board-close", async () => {
				await flat.click();
				await expect(area).toHaveAttribute("data-view", "2d");
				await expect(
					page.getByRole("button", { name: "Select", exact: true }),
				).toBeEnabled();
			});
		}
		const value = await report(page);
		await finish(page, testInfo, "footprint-board", {
			interactionP95Ms: required(metric(value, "scenario.interaction")),
			openFootprintMs: required(metric(value, "editor.open-footprint")),
		});
	},
);
