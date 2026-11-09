import {
	parseSavedSymbolLibrary,
	parseSymbolFile,
} from "@ecad/core/components/editor/symbolFormat.ts";
import {
	type ProjectDocument,
	projectNameSchema,
	projectPathSchema,
} from "@ecad/core/projects/format.ts";
import { parseSymbolConfig } from "@ecad/core/symbol-library/config.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { z } from "zod";
import {
	appChannels,
	displayChannels,
	type InvokeChannel,
	libraryChannels,
	projectChannels,
} from "#/bridge.ts";

const PATH_LIMIT = 4096;

/** Runs a core parser so IPC payloads use the same rules as files on disk. */
function parsedBy<T>(parse: (text: string) => T) {
	return z.unknown().transform((value, context): T => {
		try {
			const text = JSON.stringify(value);
			if (text === undefined) throw new Error("A value is required.");
			return parse(text);
		} catch (cause) {
			context.addIssue({
				code: "custom",
				message: errorMessage(cause, "Invalid value."),
			});
			return z.NEVER;
		}
	});
}

// The renderer passes back the directory of the open project. DesktopProjects
// rejects any value other than the project the main process opened.
const projectDirectory = z.string().min(1).max(PATH_LIMIT);
const projectPath = projectPathSchema.max(PATH_LIMIT);
// Library paths are compared with configured paths before they are resolved.
const libraryPath = z
	.string()
	.max(PATH_LIMIT)
	.refine(
		(path) => path.trim().length > 0 && !path.includes("\0"),
		"Enter a library directory path.",
	);
const scope = z.enum(["user", "project"]);
const directorySymbolRequest = z.strictObject({
	path: libraryPath,
	scope,
	projectDirectory: projectDirectory.optional(),
	id: z.string().min(1).max(64),
});
const symbolFile = parsedBy(parseSymbolFile);
const symbolLibrary = parsedBy(parseSavedSymbolLibrary);
// The project repository validates drawing, circuit and symbol contents before
// writing. Checking the structure here avoids parsing large drawings twice.
const projectDocument = z
	.object({
		shapes: z.array(z.unknown()),
		pages: z.array(z.unknown()).optional(),
		drawings: z.array(z.unknown()).optional(),
		circuits: z.array(z.unknown()).optional(),
		symbols: z.array(z.unknown()),
		symbolLibraries: z.array(z.unknown()).optional(),
	})
	.transform((document) => document as unknown as ProjectDocument);
const projectAssets = z.array(
	z.strictObject({
		name: projectNameSchema,
		kind: z.enum(["gerber", "step"]),
		bytes: z.instanceof(Uint8Array),
	}),
);

/** Each invoke channel lists the exact arguments the preload bridge sends. */
export const ipcArguments = {
	[libraryChannels.load]: z.tuple([]),
	[libraryChannels.save]: z.tuple([symbolLibrary, symbolLibrary]),
	[libraryChannels.openDirectory]: z.tuple([]),
	[libraryChannels.loadConfiguration]: z.tuple([]),
	[libraryChannels.saveConfiguration]: z.tuple([parsedBy(parseSymbolConfig)]),
	[libraryChannels.openLibraryDirectory]: z.tuple([z.string().max(PATH_LIMIT)]),
	[libraryChannels.loadDirectory]: z.tuple([
		libraryPath,
		scope,
		projectDirectory.optional(),
	]),
	[libraryChannels.canWriteConfiguration]: z.tuple([]),
	[libraryChannels.inspectDirectorySymbol]: z.tuple([directorySymbolRequest]),
	[libraryChannels.saveDirectorySymbol]: z.tuple([
		directorySymbolRequest,
		symbolFile,
		symbolFile,
	]),
	[projectChannels.load]: z.tuple([]),
	[projectChannels.create]: z.tuple([projectNameSchema]),
	[projectChannels.open]: z.tuple([]),
	[projectChannels.save]: z.tuple([projectDirectory, projectDocument]),
	[projectChannels.saveProject]: z.tuple([projectDirectory]),
	[projectChannels.importAssets]: z.tuple([projectDirectory, projectAssets]),
	[projectChannels.readAsset]: z.tuple([projectDirectory, projectPath]),
	[projectChannels.canWriteFile]: z.tuple([projectDirectory, projectPath]),
	[projectChannels.refresh]: z.tuple([projectDirectory]),
	[displayChannels.getCalibration]: z.tuple([]),
	[appChannels.quit]: z.tuple([]),
} satisfies Record<InvokeChannel, z.ZodTuple>;

export type IpcArguments<Channel extends InvokeChannel> = z.output<
	(typeof ipcArguments)[Channel]
>;

/** Rejects malformed renderer arguments before a handler touches the filesystem. */
export function parseIpcArguments<Channel extends InvokeChannel>(
	channel: Channel,
	args: readonly unknown[],
): IpcArguments<Channel> {
	const schema: z.ZodType | undefined = ipcArguments[channel];
	if (!schema) throw new Error(`Unknown request: ${channel}.`);
	const result = schema.safeParse(args);
	// The schema for this channel produced the data, so it has that channel's types.
	if (result.success) return result.data as IpcArguments<Channel>;
	const issue = result.error.issues[0];
	const [index, ...field] = issue?.path ?? [];
	const location =
		typeof index === "number"
			? ` (argument ${index + 1}${field.length ? `, ${field.map(String).join(".")}` : ""})`
			: "";
	throw new Error(
		`Invalid ${channel} request${location}: ${issue?.message ?? "Check the request."}`,
	);
}
