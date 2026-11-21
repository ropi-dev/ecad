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
		...(mesh?.instances ?? []).flatMap((instance) => [
			instance.positions,
			instance.edges,
			instance.offsets,
			instance.regions,
		]),
		...(walls?.instances ?? []).flatMap((instance) => [
			instance.positions,
			instance.normals,
		]),
	].flatMap((array) => (array ? [array.buffer] : []));
	self.postMessage({ id, ...reply }, { transfer: buffers });
};
