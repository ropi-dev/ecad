import { expect, test } from "@playwright/test";
import { drawingPoint } from "../browser/symbol-items";
import { toolbarButton } from "../browser/toolbar";
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

for (const connectionKind of ["wire", "pin"] as const)
	test(
		`editor-${connectionKind}-junction`,
		{ tag: ["@editor"] },
		async ({ page }, testInfo) => {
			const { drawShape } = await import(
				"@ecad/drawing-core/drawing/shapes.ts"
			);
			// Drawing coordinates in millimetres. The trunk runs left to right below
			// the centre; the wire variant also has a pin above it to branch from.
			const start = { x: -101.6, y: -25.4 };
			const end = { x: 12.7, y: -25.4 };
			const branch = { x: -38.1, y: 25.4 };
			const shapes = [
				...Array.from({ length: 200 }, (_, index) => ({
					id: index + 1,
					kind: "wire",
					x: 80 + (index % 10) * 6,
					y: 60 + Math.floor(index / 10) * 3,
					width: 4,
					height: 0.254,
					lineWidth: 0.254,
					rotation: 0,
				})),
				drawShape(201, "pin", start, start),
				drawShape(202, "wire", start, end),
				...(connectionKind === "wire"
					? [drawShape(203, "pin", branch, branch)]
					: []),
			];
			await page.goto("/projects?perf=1");
			await ready(page);
			await page.evaluate(async (shapes) => {
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
			}, shapes);
			await page.goto("/editor?perf=1");
			await ready(page);
			await expect(
				page.getByRole("button", { name: "Select", exact: true }),
			).toBeEnabled();
			await page
				.getByRole("button", { name: "Snap to grid", exact: true })
				.click();
			const branchPoint = await drawingPoint(page, branch);
			const joinPoint = await drawingPoint(page, { x: branch.x, y: start.y });
			const tool = (name: string) =>
				expect(page.locator(`[data-tool="${name}"]`)).toBeAttached();
			// A save that lands while a wire is being drawn ends the wire, so let
			// any save from opening the fixture, and later each undo, finish first.
			let saves = -1;
			for (let repeat = 0; repeat < 3; repeat++) {
				await saved(page, saves);
				if (connectionKind === "wire") {
					await page.mouse.click(branchPoint.x, branchPoint.y);
					await tool("wire");
				} else await (await toolbarButton(page, "Pin")).click();
				await interaction(page, `${connectionKind}.join-segment`, async () => {
					await page.mouse.click(joinPoint.x, joinPoint.y);
					await page.waitForFunction(() =>
						document.querySelector('[data-tool="select"]'),
					);
				});
				if (repeat < 2) {
					saves = await saveCount(page);
					await undo(page);
				}
			}
			await expect
				.poll(() => savedShapeCount(page, "Junction fixture"))
				.toBe(connectionKind === "wire" ? 205 : 204);
			const value = await report(page);
			await finish(page, testInfo, `editor-${connectionKind}-junction`, {
				interactionP95Ms: required(metric(value, "scenario.interaction")),
				normalizationP95Ms: required(metric(value, "editor.wire-normalize")),
			});
		},
	);
