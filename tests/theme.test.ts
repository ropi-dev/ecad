import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	schematicThemes,
	type ThemeName,
	viewerThemes,
} from "#/drawing/schematic-theme.ts";
import { parseAppSettings } from "#/settings/schema.ts";
import { resolveTheme } from "#/settings/theme.ts";

test("the theme follows the system until one is chosen", () => {
	assert.equal(resolveTheme(undefined, true), "light");
	assert.equal(resolveTheme("system", false), "dark");
	assert.equal(resolveTheme("dark", true), "dark");
	assert.equal(resolveTheme("light", false), "light");
});

test("a saved theme is kept and an unknown one is dropped", () => {
	assert.deepEqual(parseAppSettings('{"version":1,"theme":"light"}'), {
		version: 1,
		theme: "light",
	});
	assert.deepEqual(parseAppSettings('{"version":1,"theme":"sepia"}'), {
		version: 1,
	});
});

const styles = readFileSync(
	new URL("../packages/core/src/styles.css", import.meta.url),
	"utf8",
);
function token(name: string): Record<ThemeName, string> {
	const match = styles.match(
		new RegExp(`${name}: light-dark\\((#[0-9a-f]+), (#[0-9a-f]+)\\);`),
	);
	assert.ok(match, `${name} is not a light-dark() token`);
	return { light: match[1], dark: match[2] };
}

test("stylesheet tokens match the canvas colours they sit beside", () => {
	for (const theme of ["light", "dark"] as const) {
		const schematic = schematicThemes[theme];
		assert.equal(token("--color-accent")[theme], schematic.appearance.selected);
		assert.equal(token("--color-paper")[theme], schematic.paper);
		assert.equal(token("--color-desk")[theme], schematic.desk);
		assert.equal(token("--color-app")[theme], viewerThemes[theme].background);
	}
});

function luminance(hex: string) {
	const [r, g, b] = [1, 3, 5].map((start) => {
		const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
		return channel <= 0.04045
			? channel / 12.92
			: ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(first: string, second: string) {
	const [light, dark] = [luminance(first), luminance(second)].sort(
		(a, b) => b - a,
	);
	return (light + 0.05) / (dark + 0.05);
}

test("everything drawn on the paper stands out from it in both themes", () => {
	const onShapes = new Set(["fill", "pad-hole", "pad-number", "clearance"]);
	for (const theme of ["light", "dark"] as const) {
		const { paper, sheet, appearance } = schematicThemes[theme];
		for (const [name, color] of [
			["sheet", sheet],
			...Object.entries(appearance).filter(([name]) => !onShapes.has(name)),
		])
			assert.ok(
				contrast(color, paper) >= 3,
				`${theme} ${name} ${color} is ${contrast(color, paper).toFixed(2)}:1 on ${paper}`,
			);
		const { grid, gridMajor } = schematicThemes[theme];
		assert.ok(
			contrast(gridMajor, paper) > contrast(grid, paper),
			`${theme} major grid dots are fainter than the minor ones`,
		);
		for (const color of viewerThemes[theme].layerPalette)
			assert.ok(
				contrast(color, viewerThemes[theme].background) >= 3,
				`${theme} layer ${color} is too close to the background`,
			);
	}
});
