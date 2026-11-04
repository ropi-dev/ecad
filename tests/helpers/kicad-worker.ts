import { kicadWorkerReply } from "#/formats/kicad/parse-reply.ts";

/** Runs the KiCad schematic worker inline, because Node has no Web Worker. */
class InlineKiCadWorker {
	onmessage: Worker["onmessage"] = null;
	onerror: Worker["onerror"] = null;
	onmessageerror: Worker["onmessageerror"] = null;
	readonly posted: unknown[] = [];
	terminated = 0;
	constructor(readonly url: string) {}
	postMessage(message: { file: File }) {
		this.posted.push(message);
		void kicadWorkerReply(message.file).then((reply) =>
			this.onmessage?.call(
				this as unknown as Worker,
				// Structured cloning is what the browser applies to the reply.
				new MessageEvent("message", { data: structuredClone(reply) }),
			),
		);
	}
	terminate() {
		this.terminated++;
	}
}

export function installKiCadWorker() {
	const previous = globalThis.Worker;
	const workers: InlineKiCadWorker[] = [];
	globalThis.Worker = class extends InlineKiCadWorker {
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
