import {
	buildCircuitGraph,
	componentWidth,
	netNodeBox,
} from "@ecad/drawing-core/circuit/graph.ts";
import type {
	CircuitCommand,
	CircuitStore,
} from "@ecad/drawing-core/circuit/store.ts";
import type { ErcSubject } from "@ecad/drawing-core/erc/engine.ts";
import type { Dispatch, SetStateAction } from "react";
import type {
	CircuitGraph,
	CircuitSelection,
} from "#/components/circuit/circuitEditorState.ts";
import type { CircuitView } from "#/components/circuit/useCircuitNavigation.ts";

/**
 * The view that shows every component and net. With `resetZoom`, the graph
 * is centred at the canvas's own size (1:1). Otherwise the view is widened to
 * fit the whole graph with a margin, leaving room for the toolbar.
 */
export function fitCircuitView(
	graph: CircuitGraph,
	bounds: { width: number; height: number } | undefined,
	resetZoom: boolean,
): CircuitView {
	const viewport = {
		width: bounds?.width || 1600,
		height: bounds?.height || 760,
	};
	const points = [
		...graph.components.map((component) => ({
			x: component.x,
			y: component.y,
			width: componentWidth,
			height: component.height,
		})),
		...graph.nets.map((net) => {
			const box = netNodeBox(net.label);
			return { ...box, x: net.x + box.x, y: net.y + box.y };
		}),
	];
	if (!points.length) return { x: 0, y: 0, ...viewport };
	if (resetZoom)
		return {
			x:
				(Math.min(...points.map((point) => point.x)) +
					Math.max(...points.map((point) => point.x + point.width))) /
					2 -
				viewport.width / 2,
			y:
				(Math.min(...points.map((point) => point.y)) +
					Math.max(...points.map((point) => point.y + point.height))) /
					2 -
				viewport.height / 2,
			...viewport,
		};
	const x = Math.min(...points.map((point) => point.x)) - 60;
	const y = Math.min(...points.map((point) => point.y)) - 60;
	const canvasHeight = bounds?.height || 760;
	return {
		x,
		y,
		width: Math.max(
			600,
			Math.max(...points.map((point) => point.x + point.width)) - x + 60,
		),
		height:
			(Math.max(
				400,
				Math.max(...points.map((point) => point.y + point.height)) - y + 60,
			) *
				canvasHeight) /
			Math.max(100, canvasHeight - 96),
	};
}

/**
 * Selects an electrical-check subject and centres the view on it. A pin on a
 * collapsed component expands that component first.
 */
export function revealCircuitSubject(
	subject: ErcSubject,
	{
		graph,
		store,
		run,
		select,
		setView,
	}: {
		graph: CircuitGraph;
		store: CircuitStore;
		run(command: CircuitCommand): boolean;
		select(next: CircuitSelection): void;
		setView: Dispatch<SetStateAction<CircuitView>>;
	},
) {
	let targetGraph = graph;
	if (subject.kind === "pin") {
		const owner = graph.components.find((component) =>
			component.component.pins.some((pin) => pin.id === subject.id),
		);
		if (owner?.collapsed) {
			if (
				!run({
					type: "set-component-collapsed",
					id: owner.id,
					collapsed: false,
				})
			)
				return;
			targetGraph = buildCircuitGraph(store.getSnapshot());
		}
	}
	select(subject);
	const point =
		subject.kind === "pin"
			? targetGraph.pinNodes.get(subject.id)
			: subject.kind === "net"
				? targetGraph.nets.find((net) => net.id === subject.id)
				: targetGraph.components.find(
						(component) => component.id === subject.id,
					);
	if (point)
		setView((current) => ({
			...current,
			x: point.x - current.width / 2,
			y: point.y - current.height / 2,
		}));
}
