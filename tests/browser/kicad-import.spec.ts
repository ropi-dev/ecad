import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { expect, test } from "@playwright/test";
import { importKiCadSchematic } from "#/formats/kicad/import.ts";
import {
	referenceNetGroups,
	sortNetGroups,
} from "../fixtures/kicad/reference-nets";
import { required } from "../helpers/required.ts";
import { captureArtifacts } from "./artifacts";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { toolbarButton } from "./toolbar";

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
	await expect(
		page.getByLabel("Workspace instructions", { exact: true }),
	).toBeVisible();
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
	const report = JSON.parse(readFileSync(required(path), "utf8"));
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
	const supplies = reopened.filter(
		(shape) => shape.kind === "symbol" && shape.netSymbol,
	);
	expect(supplies).toHaveLength(41);
	for (const supply of supplies) {
		if (supply.kind !== "symbol") continue;
		expect(supply.attributes.name).not.toBe("");
		expect(supply.attributes.reference).toBe("");
		expect(supply.attributes.value).toBe("");
		expect(supply.texts.map((label) => label.attribute)).toEqual(["name"]);
	}
	expect(
		reopened.filter(
			(shape) => shape.kind === "text" && shape.electrical === "supply",
		),
	).toHaveLength(0);
	const exports = resolve("perf-artifacts/kicad-exports");
	mkdirSync(exports, { recursive: true });
	await (await toolbarButton(page, "Export drawing")).click();
	const dialog = page.getByRole("dialog", { name: "Export drawing" });
	await dialog.getByLabel("Width in pixels").fill("2400");
	await dialog.getByLabel("Height in pixels").fill("1600");
	for (const format of ["svg", "png"]) {
		if (format === "png")
			await (await toolbarButton(page, "Export drawing")).click();
		await dialog
			.getByRole("combobox", { name: "Format", exact: true })
			.selectOption(format);
		const pending = page.waitForEvent("download");
		await dialog.getByRole("button", { name: "Download", exact: true }).click();
		const download = await pending;
		const path = await download.path();
		expect(path).not.toBeNull();
		await download.saveAs(`${exports}/rp2350a-imported.${format}`);
		const bytes = readFileSync(required(path));
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
				const ctx =
					canvas.getContext("2d") ??
					(() => {
						throw new Error("Expected a value");
					})();
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
	await expect(dialog).not.toBeVisible();
	expect(
		referenceNetGroups(
			JSON.parse(
				(await page.locator("#project-document").textContent()) ?? "{}",
			).editorShapes,
		),
	).toEqual(oracle);
});

test("a KiCad schematic with one broken symbol imports the rest and names the skipped symbol", async ({
	page,
}) => {
	await page.goto("/tests/browser/projects.html");
	await closeProjectFiles(page);
	const source = `(kicad_sch (version 20250114) (paper "A4")
	(lib_symbols (symbol "Good" (symbol "Good_1_1" (rectangle (start -2 -2) (end 2 2)) (pin input line (at -4 0 0) (length 2) (name "IN") (number "1")))))
	(symbol (lib_id "Good") (at 100 100 0) (unit 1) (uuid "good") (property "Reference" "U1" (at 100 96 0)))
	(symbol (lib_id "Lib:Missing") (at 130 100 0) (unit 1) (uuid "missing") (property "Reference" "U2" (at 130 96 0)))
	(wire (pts (xy 90 100) (xy 96 100)))
	(label "IN" (at 90 100 0)))`;
	await (await openProjectFiles(page))
		.getByLabel("Add KiCad schematic files")
		.setInputFiles({
			name: "partial.kicad_sch",
			mimeType: "text/plain",
			buffer: Buffer.from(source),
		});
	await expect(
		page.getByRole("list", { name: "Skipped KiCad items", exact: true }),
	).toHaveText(
		"Symbol U2 (Lib:Missing): Its library symbol is not embedded in the schematic.",
	);
	await expect(
		page.getByText("Skipped 1 item that could not be converted:"),
	).toBeVisible();
	await expect
		.poll(async () =>
			(
				JSON.parse(
					(await page.locator("#project-document").textContent()) ?? "{}",
				).editorShapes as EditorShape[] | undefined
			)?.map((shape) =>
				shape.kind === "symbol"
					? `symbol ${shape.attributes.reference}`
					: shape.kind,
			),
		)
		.toEqual(["symbol U1", "wire", "text"]);
	if (captureArtifacts)
		await page.screenshot({
			path: test.info().outputPath("kicad-skipped-items.png"),
		});
	const download = page.waitForEvent("download");
	await page
		.getByRole("button", { name: "Download import report", exact: true })
		.click();
	const path = await (await download).path();
	const report = JSON.parse(readFileSync(required(path), "utf8"));
	expect(report.skipped).toEqual([
		{
			item: "symbol U2 (Lib:Missing)",
			reason: "Its library symbol is not embedded in the schematic.",
		},
	]);
});
