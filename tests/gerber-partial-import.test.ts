import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { parseGerber } from "#/formats/gerber/index.ts";
import { parseGerberFile } from "#/formats/parseGerberFile.ts";
import { installParseWorker } from "./helpers/parse-worker";

const header = "%FSLAX46Y46*%\n%MOMM*%\n%ADD10C,1*%\nD10*\n";
const flash = "X0Y0D03*\n";
// A square region whose last segment stops short of the start point.
const openContour =
	"G36*\nX0Y0D02*\nX1000000Y0D01*\nX1000000Y1000000D01*\nX0Y1000000D01*\nG37*\n";
const severities = (source: string) =>
	parseGerber(source, "test.gbr").diagnostics.map(({ severity, line }) => [
		severity,
		line,
	]);

let restore: () => void;
before(() => {
	restore = installParseWorker();
});
after(() => restore());

test("a missing M02 is a warning and the parsed geometry is kept", () => {
	const result = parseGerber(header + flash, "truncated.gbr");
	assert.deepEqual(severities(header + flash), [["warning", 5]]);
	assert.equal(result.object.objects.length, 1);
});

test("skipped commands are errors, not fatal, and the rest still parses", () => {
	assert.deepEqual(severities(`${header}G99*\n%XYZ*%\n${flash}M02*`), [
		["error", 5],
		["error", 6],
	]);
});

test("unusable files are fatal and stop without follow-on noise", () => {
	assert.deepEqual(severities(`${header}%IPNEG*%\n${flash}`), [["fatal", 5]]);
	assert.deepEqual(severities(`${header}%MIA1B0*%\n${flash}M02*`), [
		["fatal", 5],
	]);
	assert.deepEqual(severities(`${header}%SFA1B1*%\n${flash}M02*`), [
		["warning", 5],
	]);
	assert.deepEqual(severities(`%ADD10C,1*%D10*${flash}M02*`), [
		["error", 1],
		["error", 1],
		["error", 1],
		["fatal", undefined],
		["fatal", undefined],
	]);
});

test("a Gerber file with an unclosed contour and a skipped command renders with both", async () => {
	const parsed = await parseGerberFile(
		new File([`${header}G99*\n${openContour}M02*`], "region.gbr"),
	);
	try {
		assert.equal(parsed.object.objects.length, 1);
		assert.deepEqual(
			parsed.object.diagnostics.map(({ severity }) => severity),
			["error", "warning"],
		);
	} finally {
		parsed.dispose();
	}
});

test("a fatal Gerber file is rejected with its line", async () => {
	await assert.rejects(
		parseGerberFile(new File([`${header}%IPNEG*%\n${flash}M02*`], "neg.gbr")),
		{ _tag: "InvalidFile", message: /Line 5\b/ },
	);
	await assert.rejects(
		parseGerberFile(new File([`%ADD10C,1*%D10*${flash}M02*`], "units.gbr")),
		{ _tag: "InvalidFile" },
	);
});
