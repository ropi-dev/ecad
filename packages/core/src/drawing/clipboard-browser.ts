import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { drawingClipboardType } from "#/drawing/clipboard.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";

export const webDrawingClipboardType = `web ${drawingClipboardType}`;

export function selectionImages(shapes: EditorShape[]) {
	return measurePerformanceAsync(
		"drawing.clipboard-images",
		async () => {
			const [
				{ exportDrawingSvg },
				{ captureSvgPng },
				{ measureText },
				{ defaultSheet },
			] = await Promise.all([
				import("#/drawing/export.ts"),
				import("#/engine/capture-png.ts"),
				import("#/engine/drawing/text.ts"),
				import("#/drawing/worksheet.ts"),
			]);
			let svg = exportDrawingSvg(shapes, {
				width: 1024,
				height: 1024,
				area: "drawing",
				background: "white",
				sheet: defaultSheet,
				measureText,
			});
			const dimensions = /viewBox="([^"]+)"/.exec(svg);
			if (!dimensions) throw new Error("The clipboard SVG has no view box.");
			const viewBox = dimensions[1].split(" ").map(Number);
			const scale = Math.min(12, 1600 / Math.max(viewBox[2], viewBox[3]));
			const width = Math.max(1, Math.ceil(viewBox[2] * scale));
			const height = Math.max(1, Math.ceil(viewBox[3] * scale));
			svg = svg.replace(
				'width="1024" height="1024"',
				`width="${width}" height="${height}"`,
			);
			const png = await captureSvgPng(svg, width, height, "white");
			return { svg, png };
		},
		{ shapes: shapes.length },
	);
}

export function writeSelectionClipboard(
	shapes: EditorShape[],
	native: string,
	file: string,
): Promise<void> | null {
	if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write)
		return null;
	let cancelled = false;
	let cancel = () => {};
	const cleanup = () => {
		document.removeEventListener("copy", cancel, true);
		document.removeEventListener("cut", cancel, true);
	};
	try {
		const superseded = new Promise<never>((_resolve, reject) => {
			cancel = () => {
				cancelled = true;
				reject(
					new DOMException(
						"A newer copy replaced this selection.",
						"AbortError",
					),
				);
			};
		});
		document.addEventListener("copy", cancel, true);
		document.addEventListener("cut", cancel, true);
		const images = Promise.race([selectionImages(shapes), superseded]);
		const representations: Record<string, Blob | Promise<Blob>> = {
			"text/plain": new Blob([file], { type: "text/plain" }),
			"image/png": images.then(({ png }) => png),
			"text/html": images.then(
				({ svg }) =>
					new Blob(
						[
							`<img src="data:image/svg+xml,${encodeURIComponent(svg)}" data-ecad-selection="${encodeURIComponent(native)}" alt="Copied drawing">`,
						],
						{ type: "text/html" },
					),
			),
		};
		if (ClipboardItem.supports?.("image/svg+xml"))
			representations["image/svg+xml"] = images.then(
				({ svg }) => new Blob([svg], { type: "image/svg+xml" }),
			);
		if (ClipboardItem.supports?.(webDrawingClipboardType))
			representations[webDrawingClipboardType] = new Blob([native], {
				type: drawingClipboardType,
			});
		for (const representation of Object.values(representations))
			if (representation instanceof Promise)
				void representation.catch(() => {});
		return measurePerformanceAsync(
			"drawing.clipboard-write",
			() => navigator.clipboard.write([new ClipboardItem(representations)]),
			{ shapes: shapes.length },
		)
			.catch((cause) => {
				if (!cancelled) throw cause;
			})
			.finally(cleanup);
	} catch (cause) {
		cleanup();
		return Promise.reject(cause);
	}
}

export function clipboardSelectionText(data: DataTransfer): string {
	const native =
		data.getData(drawingClipboardType) || data.getData(webDrawingClipboardType);
	if (native) return native;
	const html = data.getData("text/html");
	if (html && html.length <= 20_000_000) {
		try {
			const encoded = new DOMParser()
				.parseFromString(html, "text/html")
				.querySelector("[data-ecad-selection]")
				?.getAttribute("data-ecad-selection");
			if (encoded) return decodeURIComponent(encoded);
		} catch {}
	}
	return data.getData("text/plain");
}
