import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import {
	type DrawingExportOptions,
	exportDrawingSvg,
} from "#/drawing/export.ts";
import type { DrawingPdfOptions } from "#/drawing/export-pdf.ts";
import { loadDrawingFonts } from "#/engine/drawing/fonts.ts";
import { measureText } from "#/engine/drawing/text.ts";
import { type WorkerReply, workerReply } from "#/lib/worker-task.ts";

export type DrawingExportRequest =
	| {
			type: "svg";
			shapes: EditorShape[];
			options: Omit<DrawingExportOptions, "measureText">;
	  }
	| {
			type: "pdf";
			shapes: EditorShape[];
			options: Omit<DrawingPdfOptions, "measureText">;
	  }
	| { type: "png"; image: ImageBitmap }
	| { type: "warm" };

export async function drawingExportReply(
	request: DrawingExportRequest,
): Promise<WorkerReply<string | Blob | Uint8Array | boolean>> {
	if (typeof OffscreenCanvas === "undefined") return { unavailable: true };
	if (request.type === "warm")
		return (await loadDrawingFonts())
			? { result: true }
			: { unavailable: true };
	if (request.type === "svg") {
		if (!(await loadDrawingFonts())) return { unavailable: true };
		return workerReply(
			() =>
				exportDrawingSvg(request.shapes, { ...request.options, measureText }),
			"Export failed.",
		);
	}
	if (request.type === "pdf") {
		const writer = await import("#/drawing/export-pdf.ts").catch(
			() => undefined,
		);
		if (!writer || !(await loadDrawingFonts())) return { unavailable: true };
		return workerReply(
			() =>
				writer.exportDrawingPdf(request.shapes, {
					...request.options,
					measureText,
				}),
			"Export failed.",
		);
	}
	const { image } = request;
	try {
		const canvas = new OffscreenCanvas(image.width, image.height);
		const context = canvas.getContext("bitmaprenderer");
		if (context) {
			context.transferFromImageBitmap(image);
			return await workerReply(
				() => canvas.convertToBlob({ type: "image/png" }),
				"Export failed.",
			);
		}
	} catch {}
	image.close();
	return { unavailable: true };
}
