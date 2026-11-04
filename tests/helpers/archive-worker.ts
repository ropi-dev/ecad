import { archiveWorkerReply } from "#/formats/gerber/archive.ts";

/** Runs the Gerber archive worker inline, because Node has no Web Worker. */
class InlineArchiveWorker {
	onmessage: Worker["onmessage"] = null;
	onerror: Worker["onerror"] = null;
	onmessageerror: Worker["onmessageerror"] = null;
	readonly posted: unknown[] = [];
	terminated = 0;
	constructor(readonly url: string) {}
	postMessage(message: { file: File }) {
		this.posted.push(message);
		void archiveWorkerReply(message.file).then((data) =>
			this.onmessage?.call(
				this as unknown as Worker,
				new MessageEvent("message", { data }),
			),
		);
	}
	terminate() {
		this.terminated++;
	}
}

export function installArchiveWorker() {
	const previous = globalThis.Worker;
	const workers: InlineArchiveWorker[] = [];
	globalThis.Worker = class extends InlineArchiveWorker {
		constructor(url: URL | string) {
			super(String(url));
			workers.push(this);
		}
	} as unknown as typeof Worker;
	return {
		workers,
		restore: () => {
			globalThis.Worker = previous;
		},
	};
}
