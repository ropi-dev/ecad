import { archiveWorkerReply } from "#/formats/gerber/archive.ts";

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
	self.postMessage(await archiveWorkerReply(event.data.file));
};
