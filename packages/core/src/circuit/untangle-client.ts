import type {
	Circuit,
	CircuitFile,
	GraphLayout,
} from "@ecad/drawing-core/circuit/model.ts";
import { inWorkerOrHere, keepWarm } from "#/lib/worker-task.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";

type Positions = GraphLayout["positions"];

const warmUntangleWorker = keepWarm(
	() =>
		new Worker(new URL("./untangle.worker.ts", import.meta.url), {
			type: "module",
		}),
);
const untangleWorker = () =>
	typeof Worker === "undefined" ? undefined : warmUntangleWorker;

export function untangleCircuit(
	file: CircuitFile,
	signal?: AbortSignal,
	startWorker = untangleWorker(),
): Promise<Positions> {
	return inWorkerOrHere(
		startWorker,
		(ask) =>
			measurePerformanceAsync("circuit.untangle", () => ask<Positions>(file), {
				components: file.circuit.components.length,
				nets: file.circuit.nets.length,
			}),
		async () =>
			(
				await import("@ecad/drawing-core/circuit/untangle.ts")
			).untangleCircuitGraph(file),
		{ signal },
	);
}

export async function untangledCircuitView(
	circuit: Circuit,
	signal?: AbortSignal,
	startWorker = untangleWorker(),
): Promise<CircuitFile> {
	const file: CircuitFile = {
		circuit,
		graph: {
			format: "ecad-circuit-graph",
			version: 1,
			circuitId: circuit.id,
			positions: [],
		},
	};
	file.graph.positions = await untangleCircuit(file, signal, startWorker);
	return file;
}
