import { parseWorkerReply } from "#/formats/parse-reply.ts";

self.onmessage = (
	event: MessageEvent<{ id: number; source: string; filename: string }>,
) => {
	const { id, source, filename } = event.data;
	const reply = parseWorkerReply(source, filename);
	const mesh = "result" in reply ? reply.result.mesh : undefined;
	self.postMessage(
		{ id, ...reply },
		{ transfer: mesh ? [mesh.positions.buffer, mesh.edges.buffer] : [] },
	);
};
