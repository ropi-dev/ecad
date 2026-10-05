import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import { pthGerber } from "../fixtures/pth-gerber";

for (const alternating of [false, true]) {
	test(`PTH import completes within budget with ${alternating ? "clear flashes" : "aperture holes"}`, async ({
		page,
	}) => {
		await page.goto("/tests/browser/parser-viewers.html");
		const result = await page.evaluate(
			async (source) => {
				const parserPath = "/packages/core/src/formats/parseGerberFile.ts";
				const {
					parseGerberFile,
				}: typeof import("#/formats/parseGerberFile.ts") = await import(
					/* @vite-ignore */ parserPath
				);
				const start = performance.now();
				const parsed = await parseGerberFile(new File([source], "PTH.gbr"));
				try {
					return {
						elapsed: performance.now() - start,
						diagnostics: parsed.diagnostics,
						objects: parsed.object.objects.length,
					};
				} finally {
					parsed.dispose();
				}
			},
			pthGerber(2000, alternating),
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.objects).toBe(alternating ? 4000 : 2000);
		expect(result.elapsed).toBeLessThan(10000);
	});
}

test("local Gerber regression file imports without timing out", async ({
	page,
}) => {
	const path = process.env.GERBER_PERFORMANCE_FILE;
	test.skip(!path, "Set GERBER_PERFORMANCE_FILE to measure a local Gerber.");
	const source = await readFile(path!, "utf8");
	await page.goto("/tests/browser/parser-viewers.html");
	const result = await page.evaluate(
		async ({ source, filename }) => {
			const parserPath = "/packages/core/src/formats/parseGerberFile.ts";
			const {
				parseGerberFile,
			}: typeof import("#/formats/parseGerberFile.ts") = await import(
				/* @vite-ignore */ parserPath
			);
			const start = performance.now();
			const parsed = await parseGerberFile(new File([source], filename));
			try {
				return {
					elapsed: performance.now() - start,
					diagnostics: parsed.diagnostics,
					objects: parsed.object.objects.length,
				};
			} finally {
				parsed.dispose();
			}
		},
		{ source, filename: basename(path!) },
	);
	console.log(
		`${basename(path!)}: ${Math.round(result.elapsed)} ms, ${result.objects} objects`,
	);
	expect(result.diagnostics).toEqual([]);
	expect(result.objects).toBeGreaterThan(0);
	expect(result.elapsed).toBeLessThan(10000);
});
