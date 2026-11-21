import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import type { DrawingExportOptions } from "#/drawing/export.ts";
import type { DrawingExportRequest } from "#/drawing/export-reply.ts";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import { captureSvgPng, loadSvgImage } from "#/engine/capture-png.ts";
import { measureText } from "#/engine/drawing/text.ts";
import { inWorkerOrHere, keepWarm } from "#/lib/worker-task.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";

const startExportWorker =
	typeof Worker === "undefined"
		? undefined
		: keepWarm(
				() =>
					new Worker(new URL("./export.worker.ts", import.meta.url), {
						type: "module",
					}),
			);

let warming: Promise<unknown> | undefined;

export function warmDrawingExport(startWorker = startExportWorker) {
	warming ??= inWorkerOrHere(
		startWorker,
		(ask) => ask<boolean>({ type: "warm" } satisfies DrawingExportRequest),
		() => false,
	)
		.catch(() => undefined)
		.finally(() => {
			warming = undefined;
		});
	return warming;
}

export type DrawingExportFormat = "svg" | "png" | "pdf";

export async function exportDrawing(
	shapes: EditorShape[],
	options: Omit<DrawingExportOptions, "measureText" | "coverOutput"> & {
		title?: string;
		layers?: boolean;
	},
	format: DrawingExportFormat,
	startWorker = startExportWorker,
): Promise<Blob> {
	await warming;
	if (format === "pdf") return exportPdf(shapes, options, startWorker);
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

function exportPdf(
	shapes: EditorShape[],
	{
		area,
		background,
		sheet,
		title = "Drawing",
		layers = false,
		zoneFills,
		maskMargin,
		copperLayers,
	}: Omit<DrawingExportOptions, "measureText" | "coverOutput"> & {
		title?: string;
		layers?: boolean;
	},
	startWorker = startExportWorker,
): Promise<Blob> {
	const options = {
		area,
		background,
		sheet,
		title,
		layers,
		...(zoneFills ? { zoneFills } : {}),
		...(maskMargin === undefined ? {} : { maskMargin }),
		...(copperLayers === undefined ? {} : { copperLayers }),
	};
	const pdfBlob = (bytes: Uint8Array<ArrayBuffer>) =>
		new Blob([bytes], { type: "application/pdf" });
	return inWorkerOrHere(
		startWorker,
		async (ask) =>
			pdfBlob(
				await measurePerformanceAsync(
					"drawing.export-pdf",
					() =>
						ask<Uint8Array<ArrayBuffer>>({
							type: "pdf",
							shapes,
							options,
						} satisfies DrawingExportRequest),
					{ shapes: shapes.length },
				),
			),
		async () => {
			const { exportDrawingPdf } = await import("#/drawing/export-pdf.ts");
			return pdfBlob(
				await exportDrawingPdf(shapes, { ...options, measureText }),
			);
		},
	);
}
