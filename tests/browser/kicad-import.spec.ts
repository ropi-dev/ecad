import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { Page } from "@playwright/test";
import {
	referenceNetGroups,
	sortNetGroups,
} from "../fixtures/kicad/reference-nets";
import { required } from "../helpers/required.ts";
import { captureArtifacts } from "./artifacts";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { expect, test } from "./seeded-project";

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
const editorShapes = async (page: Page) =>
	canonical(
		JSON.parse((await page.locator("#project-document").textContent()) ?? "{}")
			.editorShapes,
	) as EditorShape[] | undefined;

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
	expect(report.components).toHaveLength(87);
	await expect
		.poll(async () => (await editorShapes(page))?.length ?? 0)
		.toBeGreaterThan(0);
	const imported = await editorShapes(page);
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
	await expect.poll(() => editorShapes(page)).toEqual(imported);
	await page.keyboard.press("F6");
	if (captureArtifacts)
		await page.screenshot({
			path: resolve("perf-artifacts/kicad-reopened-schematic.png"),
		});
	expect(referenceNetGroups(required(await editorShapes(page)))).toEqual(
		oracle,
	);
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
	).toContainText("U2");
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
});
