import {
	type DrawingExportRequest,
	drawingExportReply,
} from "#/drawing/export-reply.ts";

self.onmessage = async (event: MessageEvent<DrawingExportRequest>) => {
	self.postMessage(await drawingExportReply(event.data));
};
