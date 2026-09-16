import { type Unzipped, unzip } from "fflate";
import { gerberLayerOrder } from "./gerber/layer-order";

const GERBER_EXTENSION =
	/\.(gbr|ger|gerber|gbx|pho|art|cmp|sol|plc|stc|sts|g[bt][lspoa]|gko|gml|gm\d+|gl?\d+)$/i;

export async function expandGerberFile(file: File, signal: AbortSignal) {
	signal.throwIfAborted();
	if (!/\.zip$/i.test(file.name)) return [file];
	const data = new Uint8Array(await file.arrayBuffer());
	signal.throwIfAborted();
	const contents = await new Promise<Unzipped>((resolve, reject) => {
		let terminate: (() => void) | undefined;
		const abort = () => {
			terminate?.();
			reject(signal.reason);
		};
		signal.addEventListener("abort", abort, { once: true });
		try {
			terminate = unzip(
				data,
				{
					filter: ({ name }) =>
						!name.endsWith("/") &&
						!name
							.split("/")
							.some((part) => part.startsWith(".") || part === "__MACOSX"),
				},
				(error, result) => {
					signal.removeEventListener("abort", abort);
					if (error)
						reject(
							new Error("Unable to read this ZIP archive.", { cause: error }),
						);
					else resolve(result);
				},
			);
		} catch (error) {
			signal.removeEventListener("abort", abort);
			reject(new Error("Unable to read this ZIP archive.", { cause: error }));
		}
	});
	signal.throwIfAborted();
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
					file: new File([new Uint8Array(bytes)], name, { type: "text/plain" }),
					order: gerberLayerOrder(name, source),
				},
			];
		})
		// The renderer stacks from bottom to top; the layer panel reverses this.
		.sort((a, b) => b.order[0] - a.order[0] || b.order[1] - a.order[1])
		.map(({ file }) => file);
	if (!files.length)
		throw new Error("This ZIP archive contains no Gerber files.");
	return files;
}
