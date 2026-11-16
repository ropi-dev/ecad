import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { DrawingExportOptions } from "#/drawing/export.ts";
import type { DrawingExportRequest } from "#/drawing/export-reply.ts";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import { captureSvgPng, loadSvgImage } from "#/engine/capture-png.ts";
import { measureText } from "#/engine/drawing/text.ts";
import { inWorkerOrHere } from "#/lib/worker-task.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";

const startExportWorker =
	typeof Worker === "undefined"
		? undefined
		: () =>
				new Worker(new URL("./export.worker.ts", import.meta.url), {
					type: "module",
				});

export function exportDrawing(
	shapes: EditorShape[],
	options: Omit<DrawingExportOptions, "measureText" | "coverOutput">,
	format: "svg" | "png",
	startWorker = startExportWorker,
): Promise<Blob> {
	const { width, height } = options;
	const paper =
		options.background === "transparent"
			? null
			: options.background === "dark"
				? darkSchematicTheme.paper
				: "white";
	const svgBlob = (svg: string) => new Blob([svg], { type: "image/svg+xml" });
	return inWorkerOrHere(
		startWorker,
		async (ask) => {
			const svg = await measurePerformanceAsync(
				"drawing.export-svg",
				() =>
					ask<string>({
						type: "svg",
						shapes,
						options: { ...options, coverOutput: format === "png" },
					} satisfies DrawingExportRequest),
				{ shapes: shapes.length },
			);
			if (format === "svg") return svgBlob(svg);
			let image: ImageBitmap | undefined;
			try {
				image = await loadSvgImage(svg, createImageBitmap);
			} catch {}
			if (image?.width !== width || image.height !== height) {
				image?.close();
				return captureSvgPng(svg, width, height, paper);
			}
			try {
				return await ask<Blob>(
					{ type: "png", image } satisfies DrawingExportRequest,
					[image],
				);
			} catch {
				image.close();
				return captureSvgPng(svg, width, height, paper);
			}
		},
		async () => {
			const { exportDrawingSvg } = await import("#/drawing/export.ts");
			const svg = exportDrawingSvg(shapes, { ...options, measureText });
			return format === "svg"
				? svgBlob(svg)
				: captureSvgPng(svg, width, height, paper);
		},
	);
}
