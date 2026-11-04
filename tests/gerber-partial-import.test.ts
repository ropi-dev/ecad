import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { parseGerber } from "#/formats/gerber/index.ts";
import { parseGerberFile } from "#/formats/parseGerberFile.ts";
import { installParseWorker } from "./helpers/parse-worker";

const header = "%FSLAX46Y46*%\n%MOMM*%\n%ADD10C,1*%\nD10*\n";
const flash = "X0Y0D03*\n";
// A square region whose last segment stops short of the start point.
const openContour = "G36*\nX0Y0D02*\nX1000000Y0D01*\nX1000000Y1000000D01*\nX0Y1000000D01*\nG37*\n";
const severities = (source: string) =>
	parseGerber(source, "test.gbr").diagnostics.map(
		({ severity, message }) => `${severity}: ${message}`,
	);

let restore: () => void;
before(() => {
	restore = installParseWorker();
});
after(() => restore());

test("a missing M02 is a warning and the parsed geometry is kept", () => {
	const result = parseGerber(header + flash, "truncated.gbr");
	assert.deepEqual(severities(header + flash), [
		"warning: Missing M02 end-of-file command; the file may be truncated.",
	]);
	assert.equal(result.object.objects.length, 1);
});

test("an unclosed region contour is closed with a warning", () => {
	const result = parseGerber(`${header}${openContour}M02*`, "region.gbr");
	assert.deepEqual(
		result.diagnostics.map(({ severity, message, line }) => ({
			severity,
			message,
			line,
		})),
		[
			{
				severity: "warning",
				message: "Region contour is not closed; a closing segment was added.",
				line: 10,
			},
		],
	);
	assert.equal(result.object.objects.length, 1);
	const geometry = result.object.objects[0].geometry;
	assert.ok(geometry.type === "path" && geometry.d.endsWith(" Z"));
});

test("skipped commands are errors, not fatal, and the rest still parses", () => {
	assert.deepEqual(severities(`${header}G99*\n%XYZ*%\n${flash}M02*`), [
		"error: Unsupported G-code G99",
		"error: Unsupported or malformed extended command 'XYZ' was skipped",
	]);
});

test("unusable files are fatal and stop without follow-on noise", () => {
	assert.deepEqual(severities(`${header}%IPNEG*%\n${flash}`), [
		"fatal: Legacy negative image polarity IPNEG is unsupported; the image would render inverted",
	]);
	assert.deepEqual(severities(`${header}%MIA1B0*%\n${flash}M02*`), [
		"fatal: Image transformation 'MIA1B0' is unsupported; the image would render transformed incorrectly",
	]);
	assert.deepEqual(severities(`${header}%SFA1B1*%\n${flash}M02*`), [
		"warning: Deprecated identity image transformation was accepted.",
	]);
	assert.deepEqual(severities(`%ADD10C,1*%D10*${flash}M02*`), [
		"error: A MO units command is required before geometry is defined",
		"error: Selected undefined aperture D10.",
		"error: An FS coordinate format command is required before coordinates",
		"fatal: Missing MO units declaration, so no coordinates can be read.",
		"fatal: Missing FS coordinate format declaration, so no coordinates can be read.",
	]);
});

test("step and repeat over the object limit is fatal, invalid parameters are skipped", () => {
	const limit = "Step and repeat exceeds the 500,000 object limit";
	assert.deepEqual(
		severities(`${header}%SRX500001Y1I1J0*%\n${flash}%SR*%\nM02*`),
		[`fatal: ${limit}`],
	);
	assert.deepEqual(
		severities(
			`${header}%SRX1000Y500I1J1*%\n${flash}X1000000Y0D03*\n%SR*%\n${flash}M02*`,
		),
		[`fatal: ${limit}`],
	);
	assert.deepEqual(
		severities(`${header}%SRX2Y2I-1J1*%\n${flash}M02*`),
		["error: Invalid step-and-repeat counts or distances"],
	);
});

test("identity image transformations are accepted and others are fatal", () => {
	for (const command of [
		"ASAXBY",
		"IR0",
		"SFA1.0B1.0",
		"SFA1",
		"OFA0.000B-0",
		"IOA0B0",
		"MIA0B0",
	])
		assert.deepEqual(
			severities(`${header}%${command}*%\n${flash}M02*`),
			["warning: Deprecated identity image transformation was accepted."],
			command,
		);
	for (const command of [
		"ASAYBX",
		"IR90",
		"SFA2B1",
		"OFA1B0",
		"IOA0B0.5",
		"MIA0B1",
		"IJALBL",
		"SFX",
	])
		assert.deepEqual(
			severities(`${header}%${command}*%\n${flash}M02*`),
			[
				`fatal: Image transformation '${command}' is unsupported; the image would render transformed incorrectly`,
			],
			command,
		);
});

test("malformed tokens count toward the diagnostic limit", () => {
	const result = parseGerber(
		`${header}${"%XYZ%\n".repeat(1000)}${flash}M02*`,
		"tokens.gbr",
	);
	assert.equal(result.diagnostics.length, 201);
	assert.equal(result.diagnostics.at(-1)?.message, "1,800 more problems are not listed.");
	assert.equal(result.object.objects.length, 1);
});

test("a file with many bad commands keeps a bounded diagnostic list", () => {
	const result = parseGerber(
		`${header}${"G99*\n".repeat(1000)}${flash}M02*`,
		"noisy.gbr",
	);
	assert.equal(result.diagnostics.length, 201);
	assert.deepEqual(result.diagnostics.at(-1), {
		severity: "error",
		message: "800 more problems are not listed.",
	});
	assert.equal(result.object.objects.length, 1);
});

test("a Gerber file without M02 renders with its warning", async () => {
	const parsed = await parseGerberFile(
		new File([header + flash], "truncated.gbr"),
	);
	try {
		assert.equal(parsed.object.objects.length, 1);
		assert.ok(parsed.object.object.children.length > 0);
		assert.deepEqual(parsed.object.diagnostics, [
			{
				severity: "warning",
				message:
					"Missing M02 end-of-file command; the file may be truncated.",
				line: 5,
			},
		]);
	} finally {
		parsed.dispose();
	}
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

test("a fatal Gerber file is rejected with its reason", async () => {
	await assert.rejects(
		parseGerberFile(new File([`${header}%IPNEG*%\n${flash}M02*`], "neg.gbr")),
		{
			_tag: "InvalidFile",
			message:
				"Line 5: Legacy negative image polarity IPNEG is unsupported; the image would render inverted",
		},
	);
	await assert.rejects(
		parseGerberFile(new File([`%ADD10C,1*%D10*${flash}M02*`], "units.gbr")),
		{
			message:
				"Missing MO units declaration, so no coordinates can be read.; Missing FS coordinate format declaration, so no coordinates can be read.",
		},
	);
});

test("a file whose every command was skipped explains why nothing rendered", async () => {
	await assert.rejects(
		parseGerberFile(new File([`${header}D11*\nX0Y0D03*\nM02*`], "empty.gbr")),
		{
			_tag: "InvalidFile",
			message:
				"This file contains no drawable geometry (Line 5: Selected undefined aperture D11.; Line 6: Aperture D11 is undefined).",
		},
	);
});
