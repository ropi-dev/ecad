import type { CircuitFile } from "@ecad/drawing-core/circuit/model.ts";
import { untangleCircuitGraph } from "@ecad/drawing-core/circuit/untangle.ts";
import { workerReply } from "#/lib/worker-task.ts";

self.onmessage = async (event: MessageEvent<CircuitFile>) => {
	self.postMessage(
		await workerReply(
			() => untangleCircuitGraph(event.data),
			"Unable to untangle this circuit.",
		),
	);
};
