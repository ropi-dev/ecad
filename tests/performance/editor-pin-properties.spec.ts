import { snapCoordinate } from "@ecad/drawing-core/drawing/shapes.ts";
import { expect, type Page, test } from "@playwright/test";
import { openProjectFiles } from "../browser/project-files";
import { drawingGridStep, drawingPoint } from "../browser/symbol-items";
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

async function snappedPosition(page: Page, position: { x: number; y: number }) {
	const box = required(await page.locator("canvas").boundingBox());
	const zero = await drawingPoint(page, { x: 0, y: 0 });
	const unit = await drawingPoint(page, { x: 1, y: 1 });
	const step = await drawingGridStep(page);
	const world = (axis: "x" | "y") =>
		snapCoordinate(
			(box[axis] + position[axis] - zero[axis]) / (unit[axis] - zero[axis]),
			step,
		);
	const point = await drawingPoint(page, { x: world("x"), y: world("y") });
	return { x: point.x - box.x, y: point.y - box.y };
}

for (const scenario of [
	"editor-pin-labels",
	"editor-pin-visibility",
] as const) {
	test(
		scenario,
		{ tag: ["@editor", "@symbols"] },
		async ({ page }, testInfo) => {
			await page.goto("/projects?perf=1");
			await ready(page);
			await expect(
				page.getByLabel("Workspace instructions", { exact: true }),
			).toBeVisible();
			const symbol = {
				format: "ecad-symbol",
				version: 1,
				units: "mm",
				id: "labeled-package",
				name: "Labeled package",
				description: "",
				prefix: "U",
				value: "",
				shapes: Array.from({ length: 128 }, (_, index) => ({
					kind: "pin",
					name: `Signal ${index + 1}`,
					number: String(index + 1).padStart(3, "0"),
					x: index < 64 ? -20 : 20,
					y: (index % 64) * 4 - 128,
				})),
			};
			await expect(
				(await openProjectFiles(page)).getByLabel("Add symbol files"),
			).toBeEnabled();
			await (await openProjectFiles(page))
				.getByLabel("Add symbol files")
				.setInputFiles({
					name: "labeled.ecadsym",
					mimeType: "application/json",
					buffer: Buffer.from(JSON.stringify(symbol)),
				});
			await (await openProjectFiles(page))
				.getByRole("link", {
					name: "Open labeled-package.ecadsym",
					exact: true,
				})
				.click();
			await editorReady(page, "Symbol editor · Labeled package");
			await (await toolbarButton(page, "Pin")).click();
			const canvas = page.locator("canvas");
			const bounds = required(await canvas.boundingBox());
			const position = { x: bounds.width * 0.4, y: bounds.height / 2 };
			await canvas.click({ position });
			// Shift keeps the press on the pin from starting a wire.
			await canvas.dblclick({
				position: await snappedPosition(page, position),
				modifiers: ["Shift"],
			});
			await expect(
				page.getByRole("textbox", { name: "Name", exact: true }),
			).toBeVisible();
			if (scenario === "editor-pin-visibility") {
				for (const [label, value] of [
					["Name", "RUN"],
					["Number", "26"],
				]) {
					await page
						.getByRole("textbox", { name: label, exact: true })
						.fill(value);
					await page
						.getByRole("textbox", { name: label, exact: true })
						.press("Enter");
				}
				for (let repeat = 0; repeat < 3; repeat++) {
					for (const label of ["Show name", "Show number"]) {
						await interaction(page, "pin.edit-visibility", async () => {
							const before =
								(await report(page)).metrics["renderer.frame"]?.count ?? 0;
							const input = page.getByRole("checkbox", {
								name: label,
								exact: true,
							});
							await input.setChecked(repeat % 2 === 1);
							await expect(input).toBeChecked({ checked: repeat % 2 === 1 });
							await page.waitForFunction(
								(before) =>
									((
										window.__ecadPerformance ??
										(() => {
											throw new Error("Expected a value");
										})()
									).snapshot().metrics["renderer.frame"]?.count ?? 0) > before,
								before,
							);
						});
					}
				}
			} else
				for (let repeat = 0; repeat < 3; repeat++) {
					await interaction(page, "pin.edit-labels", async () => {
						const before =
							(await report(page)).metrics["renderer.frame"]?.count ?? 0;
						for (const [label, value] of [
							["Name", `VCC${repeat}`],
							["Number", `A${repeat + 1}`],
						]) {
							await page
								.getByRole("textbox", { name: label, exact: true })
								.fill(value);
							await page
								.getByRole("textbox", { name: label, exact: true })
								.press("Enter");
						}
						await page.waitForFunction(
							(before) =>
								((
									window.__ecadPerformance ??
									(() => {
										throw new Error("Expected a value");
									})()
								).snapshot().metrics["renderer.frame"]?.count ?? 0) > before,
							before,
						);
					});
				}
			const value = await report(page);
			await finish(page, testInfo, scenario, {
				interactionP95Ms: required(metric(value, "scenario.interaction")),
			});
		},
	);
}
