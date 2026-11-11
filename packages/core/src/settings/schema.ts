import { z } from "zod";
import { schemaReason } from "#/projects/errors.ts";

export const SETTINGS_FILE_LIMIT = 1024 * 1024;

export const antialiasingModes = ["auto", "on", "off"] as const;
export type AntialiasingMode = (typeof antialiasingModes)[number];

export const ercSeverityLevels = ["error", "warning", "off"] as const;
export type ErcSeverityLevel = (typeof ercSeverityLevels)[number];

const ruleId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const ercLevel = z.enum(ercSeverityLevels);
const ercSeveritySchema = z
	.record(ruleId, ercLevel)
	.refine((value) => Object.keys(value).length <= 256, "Too many ERC rules.");
const readErcSeveritySchema = z.record(z.string(), z.unknown()).transform(
	(value) =>
		Object.fromEntries(
			Object.entries(value)
				.filter(
					([rule, level]) =>
						ruleId.safeParse(rule).success && ercLevel.safeParse(level).success,
				)
				.slice(0, 256),
		) as z.infer<typeof ercSeveritySchema>,
);

const appShape = {
	version: z.literal(1),
	antialiasing: z.enum(antialiasingModes).optional(),
	debugStats: z.boolean().optional(),
	ercSeverity: ercSeveritySchema.optional(),
};
const projectShape = {
	ercSeverity: ercSeveritySchema.optional(),
};

export const appSettingsSchema = z.looseObject(appShape);
export const projectSettingsSchema = z.looseObject(projectShape);

const lenient = <Shape extends Record<string, z.ZodType>>(shape: Shape) =>
	z
		.looseObject(
			Object.fromEntries(
				Object.entries(shape).map(([key, field]) => [
					key,
					field.safeParse(undefined).success ? field.catch(undefined) : field,
				]),
			) as Shape,
		)
		.transform(
			(value) =>
				Object.fromEntries(
					Object.entries(value).filter(([, entry]) => entry !== undefined),
				) as typeof value,
		);

export const readAppSettingsSchema = lenient({
	...appShape,
	ercSeverity: readErcSeveritySchema.optional(),
});
export const readProjectSettingsSchema = lenient({
	...projectShape,
	ercSeverity: readErcSeveritySchema.optional(),
});

export type AppSettings = z.output<typeof appSettingsSchema>;
export type ProjectSettings = z.output<typeof projectSettingsSchema>;
export type ErcSeverityOverrides = z.infer<typeof ercSeveritySchema>;

export const defaultAppSettings = (): AppSettings => ({ version: 1 });

export function parseAppSettings(text: string): AppSettings {
	if (new TextEncoder().encode(text).length > SETTINGS_FILE_LIMIT)
		throw new Error("The settings file must be 1 MB or smaller.");
	const result = readAppSettingsSchema.safeParse(JSON.parse(text));
	if (!result.success) throw new Error(schemaReason(result.error.issues));
	return result.data;
}

export function serializeAppSettings(settings: AppSettings): string {
	const text = `${JSON.stringify(appSettingsSchema.parse(settings), null, "\t")}\n`;
	if (new TextEncoder().encode(text).length > SETTINGS_FILE_LIMIT)
		throw new Error("Settings must be 1 MB or smaller.");
	return text;
}

export function withErcSeverity<T extends ProjectSettings>(
	settings: T,
	rule: string,
	level: ErcSeverityLevel | undefined,
): T {
	const { ercSeverity: current, ...rest } = settings;
	const { [rule]: _previous, ...levels } = current ?? {};
	const ercSeverity =
		level === undefined ? levels : { ...levels, [rule]: level };
	return (
		Object.keys(ercSeverity).length ? { ...rest, ercSeverity } : rest
	) as T;
}
