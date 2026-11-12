import { parseWorkerReply } from "#/formats/parse-reply.ts";

self.onmessage = (
	event: MessageEvent<{ id: number; source: string; filename: string }>,
) => {
	const { id, source, filename } = event.data;
	const reply = parseWorkerReply(source, filename);
	const { mesh, walls } = "result" in reply ? reply.result : {};
	const buffers = [
		mesh?.positions,
		mesh?.edges,
		walls?.positions,
		walls?.normals,
	].flatMap((array) => (array ? [array.buffer] : []));
	self.postMessage({ id, ...reply }, { transfer: buffers });
};
