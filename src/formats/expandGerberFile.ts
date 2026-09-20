import { Effect } from "effect";
import { type Unzipped, unzip } from "fflate";
import { runEffect } from "#/lib/effect";
import { gerberLayerOrder } from "./gerber/layer-order";
import { ArchiveError, readFile } from "./import-effects";

const GERBER_EXTENSION =
	/\.(gbr|ger|gerber|gbx|pho|art|cmp|sol|plc|stc|sts|g[bt][lspoa]|gko|gml|gm\d+|gl?\d+)$/i;

export function expandGerberFileEffect(file: File) {
	return Effect.gen(function* () {
		if (!/\.zip$/i.test(file.name)) return [file];
		const buffer = yield* readFile(() => file.arrayBuffer());
		const data = new Uint8Array(buffer);
		const contents = yield* Effect.async<Unzipped, ArchiveError>((resume) => {
			try {
				const terminate = unzip(
					data,
					{
						filter: ({ name }) =>
							!name.endsWith("/") &&
							!name
								.split("/")
								.some((part) => part.startsWith(".") || part === "__MACOSX"),
					},
					(cause, result) => {
						resume(
							cause
								? Effect.fail(
										new ArchiveError({
											message: "Unable to read this ZIP archive.",
											cause,
										}),
									)
								: Effect.succeed(result),
						);
					},
				);
				return Effect.sync(terminate);
			} catch (cause) {
				resume(
					Effect.fail(
						new ArchiveError({
							message: "Unable to read this ZIP archive.",
							cause,
						}),
					),
				);
			}
		});
		const decoder = new TextDecoder();
		const files = Object.entries(contents)
			.flatMap(([name, bytes]) => {
				const source = decoder.decode(bytes);
				if (
					!GERBER_EXTENSION.test(name) &&
					!/%(?:FS[LT][AI]X\d\dY\d\d|MO(?:IN|MM)|ADD\d|TF\.FileFunction)/.test(
						source,
					)
				)
					return [];
				return [
					{
						file: new File([new Uint8Array(bytes)], name, {
							type: "text/plain",
						}),
						order: gerberLayerOrder(name, source),
					},
				];
			})
			// The renderer stacks from bottom to top; the layer panel reverses this.
			.sort((a, b) => b.order[0] - a.order[0] || b.order[1] - a.order[1])
			.map(({ file }) => file);
		if (!files.length)
			return yield* new ArchiveError({
				message: "This ZIP archive contains no Gerber files.",
			});
		return files;
	});
}

export function expandGerberFile(file: File, signal: AbortSignal) {
	return runEffect(expandGerberFileEffect(file), signal);
}
