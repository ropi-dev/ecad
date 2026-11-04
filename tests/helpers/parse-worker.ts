import { parseWorkerReply } from "#/formats/parse-reply.ts";

/** Runs the Gerber parse worker inline, because Node has no Web Worker. */
class InlineParseWorker {
	onmessage: Worker["onmessage"] = null;
	onerror: Worker["onerror"] = null;
	onmessageerror: Worker["onmessageerror"] = null;
	postMessage(message: { id: number; source: string; filename: string }) {
		const data = {
			id: message.id,
			...parseWorkerReply(message.source, message.filename),
		};
		queueMicrotask(() =>
			this.onmessage?.call(
				this as unknown as Worker,
				new MessageEvent("message", { data }),
			),
		);
	}
	terminate() {}
}

export function installParseWorker() {
	const previous = globalThis.Worker;
	globalThis.Worker = InlineParseWorker as unknown as typeof Worker;
	return () => {
		globalThis.Worker = previous;
	};
}
