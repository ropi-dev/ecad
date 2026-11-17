import {
	type DrawingExportRequest,
	drawingExportReply,
} from "#/drawing/export-reply.ts";

self.onmessage = async (event: MessageEvent<DrawingExportRequest>) => {
	const reply = await drawingExportReply(event.data);
	self.postMessage(reply, {
		transfer:
			"result" in reply && reply.result instanceof Uint8Array
				? [reply.result.buffer]
				: [],
	});
};
