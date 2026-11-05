import { kicadWorkerReply } from "#/formats/kicad/parse-reply.ts";

// The worker reads the file itself, so decoding and parsing stay off the UI thread.
self.onmessage = async (event: MessageEvent<{ file: File }>) => {
	self.postMessage(await kicadWorkerReply(event.data.file));
};
