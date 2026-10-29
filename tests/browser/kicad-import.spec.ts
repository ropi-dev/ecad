import { captureArtifacts } from "./artifacts";
import { expect, test } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import {
	referenceNetGroups,
	sortNetGroups,
} from "../fixtures/kicad/reference-nets";
import { toolbarButton } from "./toolbar";
import { resolve } from "node:path";
import type { EditorShape } from "#/drawing/shapes.ts";
import { importKiCadSchematic } from "#/formats/kicad/import.ts";
import { closeProjectFiles, openProjectFiles } from "./project-files";

const fixture = resolve(
	"tests/fixtures/kicad/RPI-RP2350A-MINIMAL_R4-S1.kicad_sch",
);
const canonical = (value: unknown) =>
	JSON.parse(
		JSON.stringify(value, (_key, entry) =>
			typeof entry === "number" ? Number(entry.toFixed(9)) : entry,
		),
	);
const oracle = sortNetGroups(
	JSON.parse(
		readFileSync(resolve("tests/fixtures/kicad/source-nets.json"), "utf8"),
	),
);
const expected = importKiCadSchematic(readFileSync(fixture, "utf8"));

test("imported RP2350A drawing reopens with its components, terminals, wires and labels intact", async ({
	page,
}) => {
	test.setTimeout(120000);
	await page.goto("/tests/browser/projects.html");
	await closeProjectFiles(page);
	await expect(page.getByLabel("Workspace instructions", { exact: true })).toBeVisible();
	await (await openProjectFiles(page))
		.getByLabel("Add KiCad schematic files")
		.setInputFiles(fixture);
	await expect(
		page.getByRole("button", { name: "Download import report", exact: true }),
	).toBeVisible();
	const download = page.waitForEvent("download");
	await page
		.getByRole("button", { name: "Download import report", exact: true })
		.click();
	const file = await download;
	const path = await file.path();
	expect(path).not.toBeNull();
	const report = JSON.parse(readFileSync(path!, "utf8"));
	expect(report.components).toEqual(expected.report.components);
	expect(report.metadata).toEqual(expected.report.metadata);
	expect(report.supplies).toEqual(expected.report.supplies);
	await expect
		.poll(async () =>
			canonical(
				JSON.parse(
					(await page.locator("#project-document").textContent()) ?? "{}",
				).editorShapes,
			),
		)
		.toEqual(canonical(expected.shapes));
	await page.reload();
	const link = (await openProjectFiles(page)).getByRole("link", {
		name: "Open RPI-RP2350A-MINIMAL_R4-S1.ecaddraw",
		exact: true,
	});
	await link.click();
	await expect(
		page.getByRole("heading", {
			name: /Schematic editor .* RPI-RP2350A-MINIMAL_R4-S1/,
		}),
	).toBeVisible();
	await expect
		.poll(async () => {
			const document = JSON.parse(
				(await page.locator("#project-document").textContent()) ?? "{}",
			);
			return canonical(document.editorShapes as EditorShape[]);
		})
		.toEqual(canonical(expected.shapes));
	await page.keyboard.press("F6");
	if (captureArtifacts)
		await page.screenshot({
			path: resolve("perf-artifacts/kicad-reopened-schematic.png"),
		});
	const reopened = JSON.parse(
		(await page.locator("#project-document").textContent()) ?? "{}",
	).editorShapes as EditorShape[];
	expect(referenceNetGroups(reopened)).toEqual(oracle);
	expect(
		reopened.filter(
			(shape) => shape.kind === "text" && shape.electrical === "net",
		),
	).toHaveLength(94);
	expect(
		reopened.filter(
			(shape) => shape.kind === "text" && shape.electrical === "supply",
		),
	).toHaveLength(41);
	const exports = resolve("perf-artifacts/kicad-exports");
	mkdirSync(exports, { recursive: true });
	await (await toolbarButton(page, "View tools")).click();
	await page
		.getByRole("button", { name: "Export drawing", exact: true })
		.click();
	const dialog = page.getByRole("dialog", { name: "Export drawing" });
	await dialog.getByLabel("Width in pixels").fill("2400");
	await dialog.getByLabel("Height in pixels").fill("1600");
	for (const format of ["svg", "png"]) {
		await dialog
			.getByRole("combobox", { name: "Format", exact: true })
			.selectOption(format);
		const pending = page.waitForEvent("download");
		await dialog.getByRole("button", { name: "Download", exact: true }).click();
		const download = await pending;
		const path = await download.path();
		expect(path).not.toBeNull();
		await download.saveAs(`${exports}/rp2350a-imported.${format}`);
		const bytes = readFileSync(path!);
		if (format === "svg") {
			const coverage = await page.evaluate((svg) => {
				const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
				return {
					errors: doc.querySelectorAll("parsererror").length,
					names: [...doc.querySelectorAll("[data-name]")].map((e) =>
						e.getAttribute("data-name"),
					),
					texts: [...doc.querySelectorAll("text")].map((e) => e.textContent),
				};
			}, bytes.toString("utf8"));
			expect(coverage.errors).toBe(0);
			for (const shape of reopened)
				expect(coverage.names).toContain(`${shape.kind} ${shape.id}`);
			expect(coverage.texts).toContain("U1");
			expect(coverage.texts).toContain("GND");
		} else {
			expect([...bytes.subarray(0, 8)]).toEqual([
				137, 80, 78, 71, 13, 10, 26, 10,
			]);
			expect(bytes.readUInt32BE(16)).toBe(2400);
			expect(bytes.readUInt32BE(20)).toBe(1600);
			const ink = await page.evaluate(async (base64) => {
				const image = new Image();
				image.src = `data:image/png;base64,${base64}`;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = 2400;
				canvas.height = 1600;
				const ctx = canvas.getContext("2d")!;
				ctx.drawImage(image, 0, 0);
				const data = ctx.getImageData(0, 0, 2400, 1600).data;
				let ink = 0;
				for (let i = 0; i < data.length; i += 4)
					if (data[i] < 200 && data[i + 3] === 255) ink++;
				return ink;
			}, bytes.toString("base64"));
			expect(ink).toBeGreaterThan(10000);
		}
	}
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	expect(
		referenceNetGroups(
			JSON.parse(
				(await page.locator("#project-document").textContent()) ?? "{}",
			).editorShapes,
		),
	).toEqual(oracle);
});
