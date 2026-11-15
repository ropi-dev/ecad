import { z } from "zod";

export const PAPER_SIZES = {
	A5: { width: 210, height: 148 },
	A4: { width: 297, height: 210 },
	A3: { width: 420, height: 297 },
	A2: { width: 594, height: 420 },
	A1: { width: 841, height: 594 },
	A0: { width: 1189, height: 841 },
	Letter: { width: 279.4, height: 215.9 },
	Legal: { width: 355.6, height: 215.9 },
	Tabloid: { width: 431.8, height: 279.4 },
} as const;

export type PaperSize = keyof typeof PAPER_SIZES;

export const DEFAULT_PAPER: PaperSize = "A3";
export const SHEET_TEXT_LIMIT = 200;
export const SHEET_COMMENT_COUNT = 4;
export const CUSTOM_SHEET_MIN = 50;
export const CUSTOM_SHEET_MAX = 4000;

export interface SheetSettings {
	readonly paper?: PaperSize | "custom";
	readonly portrait?: boolean;
	readonly width?: number;
	readonly height?: number;
	readonly title?: string;
	readonly date?: string;
	readonly revision?: string;
	readonly company?: string;
	readonly comments?: string[];
}

export type SheetTextField = "title" | "date" | "revision" | "company";

const sheetText = z
	.string()
	.max(SHEET_TEXT_LIMIT, {
		error: `Title block text can have at most ${SHEET_TEXT_LIMIT} characters.`,
	})
	.regex(/^[^\r\n]*$/, { error: "Title block text must fit on one line." });

const customLength = z
	.number()
	.min(CUSTOM_SHEET_MIN, {
		error: `Custom sheets are at least ${CUSTOM_SHEET_MIN} mm on each side.`,
	})
	.max(CUSTOM_SHEET_MAX, {
		error: `Custom sheets are at most ${CUSTOM_SHEET_MAX} mm on each side.`,
	});

const paperNames = Object.keys(PAPER_SIZES) as [PaperSize, ...PaperSize[]];

export const sheetSettingsSchema = z
	.strictObject({
		paper: z
			.enum([...paperNames, "custom"])
			.optional()
			.describe(
				`Paper size. Absent means ${DEFAULT_PAPER}. "custom" uses width and height.`,
			),
		portrait: z
			.boolean()
			.optional()
			.describe("Portrait orientation of a standard paper size."),
		width: customLength
			.optional()
			.describe("Custom sheet width in millimetres."),
		height: customLength
			.optional()
			.describe("Custom sheet height in millimetres."),
		title: sheetText.optional().describe("Title block title."),
		date: sheetText.optional().describe("Title block date, as free text."),
		revision: sheetText.optional().describe("Title block revision."),
		company: sheetText.optional().describe("Title block company."),
		comments: z
			.array(sheetText)
			.max(SHEET_COMMENT_COUNT, {
				error: `The title block has ${SHEET_COMMENT_COUNT} comment lines.`,
			})
			.optional()
			.describe("Title block comment lines, first line nearest the company."),
	})
	.superRefine((sheet, context) => {
		const custom = sheet.paper === "custom";
		if (custom && (sheet.width === undefined || sheet.height === undefined))
			context.addIssue({
				code: "custom",
				message: "A custom sheet needs a width and a height.",
			});
		if (!custom && (sheet.width !== undefined || sheet.height !== undefined))
			context.addIssue({
				code: "custom",
				message: "Only a custom sheet has a width and a height.",
			});
		if (custom && sheet.portrait)
			context.addIssue({
				code: "custom",
				message: "A custom sheet sets its orientation by width and height.",
			});
	})
	.describe(
		"Paper size and title block shared by every schematic page. Absent fields take their defaults.",
	);

export function savedSheet(
	sheet: SheetSettings | undefined,
): SheetSettings | undefined {
	if (!sheet) return undefined;
	const result: {
		-readonly [Key in keyof SheetSettings]: SheetSettings[Key];
	} = {};
	if (sheet.paper === "custom") {
		result.paper = "custom";
		result.width = sheet.width;
		result.height = sheet.height;
	} else {
		if (sheet.paper && sheet.paper !== DEFAULT_PAPER)
			result.paper = sheet.paper;
		if (sheet.portrait) result.portrait = true;
	}
	for (const key of ["title", "date", "revision", "company"] as const) {
		const text = sheet[key]?.trim();
		if (text) result[key] = text;
	}
	const comments = (sheet.comments ?? []).map((line) => line.trim());
	while (comments.length && !comments.at(-1)) comments.pop();
	if (comments.length) result.comments = comments;
	return Object.keys(result).length ? result : undefined;
}

export function sheetPaper(sheet: SheetSettings | undefined): {
	width: number;
	height: number;
	name?: string;
} {
	if (
		sheet?.paper === "custom" &&
		sheet.width !== undefined &&
		sheet.height !== undefined
	)
		return { width: sheet.width, height: sheet.height };
	const name =
		sheet?.paper && sheet.paper !== "custom" ? sheet.paper : DEFAULT_PAPER;
	const { width, height } = PAPER_SIZES[name];
	return sheet?.portrait
		? { width: height, height: width, name }
		: { width, height, name };
}
