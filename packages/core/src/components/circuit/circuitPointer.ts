import type { CircuitNet } from "@ecad/drawing-core/circuit/model.ts";
import type { CircuitCommand } from "@ecad/drawing-core/circuit/store.ts";
import {
	type Dispatch,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	type SetStateAction,
	type SVGProps,
	useRef,
	useState,
} from "react";
import type { CircuitTool } from "#/components/circuit/CircuitToolbar.tsx";
import type {
	CircuitDrag,
	CircuitPosition,
	CircuitSelection,
	ConnectionDrag,
} from "#/components/circuit/circuitEditorState.ts";
import type { CircuitView } from "#/components/circuit/useCircuitNavigation.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";

type Point = { x: number; y: number };

/** Pointer gestures in progress on the circuit graph. */
export function useCircuitPointerState() {
	const [pan, setPan] = useState<{
		x: number;
		y: number;
		view: CircuitView;
		pointerId: number;
	} | null>(null);
	const [drag, setDrag] = useState<CircuitDrag | null>(null);
	const [connectionDrag, setConnectionDrag] = useState<ConnectionDrag | null>(
		null,
	);
	const suppressPinClick = useRef(false);
	return {
		pan,
		setPan,
		drag,
		setDrag,
		connectionDrag,
		setConnectionDrag,
		suppressPinClick,
	};
}

/**
 * Pointer handling for the circuit graph: panning, dragging components and
 * nets, dragging a connection from a pin onto another pin or net, and placing
 * a component or net with the placement tools. Built on every render, so the
 * handlers see the current state.
 */
export function circuitPointerHandlers({
	state: {
		pan,
		setPan,
		drag,
		setDrag,
		connectionDrag,
		setConnectionDrag,
		suppressPinClick,
	},
	svg,
	tool,
	placement,
	placementPinCount,
	view,
	setView,
	pinNets,
	snap,
	componentPosition,
	select,
	selectPin,
	setCheckedPins,
	setPendingPin,
	setPlacementPoint,
	setConnecting,
	placeAt,
	run,
}: {
	state: ReturnType<typeof useCircuitPointerState>;
	svg: RefObject<SVGSVGElement | null>;
	tool: CircuitTool;
	placement: SymbolDefinition | null;
	placementPinCount: number;
	view: CircuitView;
	setView: Dispatch<SetStateAction<CircuitView>>;
	pinNets: ReadonlyMap<string, CircuitNet>;
	snap<T extends Point>(position: T): T;
	componentPosition(position: Point, pinCount: number): Point;
	select(next: CircuitSelection): void;
	selectPin(id: string): void;
	setCheckedPins: Dispatch<SetStateAction<string[]>>;
	setPendingPin: Dispatch<SetStateAction<string | null>>;
	setPlacementPoint: Dispatch<SetStateAction<Point | null>>;
	setConnecting(value: boolean): void;
	placeAt(position: Point): void;
	run(command: CircuitCommand): boolean;
}) {
	function point(event: { clientX: number; clientY: number }) {
		const matrix = svg.current?.getScreenCTM()?.inverse();
		if (!matrix) return { x: 0, y: 0 };
		return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
	}
	function connectionDropTarget(
		event: { clientX: number; clientY: number },
		sourceId: string,
	): ConnectionDrag["target"] {
		const button = svg.current?.ownerDocument
			.elementFromPoint(event.clientX, event.clientY)
			?.closest("button[data-circuit-pin-id], button[data-circuit-net-id]");
		const id = button?.getAttribute("data-circuit-pin-id");
		const netId = button?.getAttribute("data-circuit-net-id");
		if (!svg.current?.contains(button ?? null)) return null;
		return netId
			? { kind: "net", id: netId }
			: id && id !== sourceId
				? { kind: "pin", id }
				: null;
	}
	function cancelConnectionDrag() {
		if (!connectionDrag) return;
		suppressPinClick.current = true;
		setConnectionDrag(null);
		if (svg.current?.hasPointerCapture(connectionDrag.pointerId)) {
			svg.current.releasePointerCapture(connectionDrag.pointerId);
		}
	}
	function startConnectionDrag(
		event: ReactPointerEvent<HTMLButtonElement>,
		pinId: string,
	) {
		if (event.button !== 0 || (tool !== "select" && tool !== "connect")) return;
		event.preventDefault();
		event.stopPropagation();
		svg.current?.focus({ preventScroll: true });
		svg.current?.setPointerCapture(event.pointerId);
		setConnectionDrag({
			pinId,
			pointerId: event.pointerId,
			start: { x: event.clientX, y: event.clientY },
			point: point(event),
			active: false,
			target: null,
		});
	}
	function startDrag(
		event: ReactPointerEvent<HTMLButtonElement>,
		position: CircuitPosition,
	) {
		if (event.button !== 0 || tool !== "select") return;
		event.stopPropagation();
		select({ kind: position.kind, id: position.id });
		setCheckedPins([]);
		event.currentTarget.setPointerCapture(event.pointerId);
		setDrag({
			position,
			start: point(event),
			startClient: { x: event.clientX, y: event.clientY },
			active: false,
			x: position.x,
			y: position.y,
			pointerId: event.pointerId,
		});
	}
	const svgHandlers: SVGProps<SVGSVGElement> = {
		onPointerDownCapture: () => {
			suppressPinClick.current = false;
		},
		onPointerLeave: () => setPlacementPoint(null),
		onClickCapture: (event) => {
			if (suppressPinClick.current && event.detail > 0) {
				suppressPinClick.current = false;
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			if (
				(tool === "net" || (tool === "component" && placement)) &&
				event.button === 0
			) {
				event.preventDefault();
				event.stopPropagation();
				placeAt(
					tool === "component"
						? componentPosition(point(event), placementPinCount)
						: point(event),
				);
			}
		},
		onPointerDown: (event) => {
			if (
				!(event.target instanceof Element) ||
				!event.target.closest("button")
			) {
				event.currentTarget.focus({ preventScroll: true });
				if (event.button === 0 && tool === "select") select(null);
			}
			if (event.button !== 1 && (tool !== "pan" || event.button !== 0)) return;
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			setPan({
				x: event.clientX,
				y: event.clientY,
				view,
				pointerId: event.pointerId,
			});
		},
		onPointerMove: (event) => {
			// An active pan owns its pointer, even while a placement tool is
			// active. Leaving placementPoint untouched keeps the preview under
			// the cursor, since panning keeps the cursor's graph point fixed.
			if (pan?.pointerId === event.pointerId) {
				const matrix = svg.current?.getScreenCTM();
				if (matrix)
					setView({
						...pan.view,
						x: pan.view.x - (event.clientX - pan.x) / matrix.a,
						y: pan.view.y - (event.clientY - pan.y) / matrix.d,
					});
				return;
			}
			if (connectionDrag?.pointerId === event.pointerId) {
				setConnectionDrag({
					...connectionDrag,
					point: point(event),
					active:
						connectionDrag.active ||
						Math.hypot(
							event.clientX - connectionDrag.start.x,
							event.clientY - connectionDrag.start.y,
						) > 4,
					target: connectionDropTarget(event, connectionDrag.pinId),
				});
				return;
			}
			if ((tool === "component" && placement) || tool === "net") {
				setPlacementPoint(
					tool === "component"
						? componentPosition(point(event), placementPinCount)
						: snap(point(event)),
				);
				return;
			}
			if (!drag || drag.pointerId !== event.pointerId) return;
			const current = point(event);
			const active =
				drag.active ||
				Math.hypot(
					event.clientX - drag.startClient.x,
					event.clientY - drag.startClient.y,
				) > 3;
			const position = active
				? snap({
						x: drag.position.x + current.x - drag.start.x,
						y: drag.position.y + current.y - drag.start.y,
					})
				: drag.position;
			setDrag({
				...drag,
				active,
				x: position.x,
				y: position.y,
			});
		},
		onPointerUp: (event) => {
			if (pan?.pointerId === event.pointerId) {
				setPan(null);
				return;
			}
			if (connectionDrag?.pointerId === event.pointerId) {
				suppressPinClick.current = true;
				setConnectionDrag(null);
				if (!connectionDrag.active) selectPin(connectionDrag.pinId);
				else {
					const target = connectionDropTarget(event, connectionDrag.pinId);
					if (target) {
						const targetNetId =
							target.kind === "net" ? target.id : pinNets.get(target.id)?.id;
						const sameNet =
							targetNetId &&
							pinNets.get(connectionDrag.pinId)?.id === targetNetId;
						const command: CircuitCommand =
							target.kind === "net"
								? {
										type: "connect",
										pinIds: [connectionDrag.pinId],
										netId: target.id,
									}
								: {
										type: "connect",
										pinIds: [connectionDrag.pinId, target.id],
									};
						if (sameNet || run(command)) {
							setPendingPin(null);
							setConnecting(false);
							select(target);
						}
					}
				}
				return;
			}
			if (!drag || drag.pointerId !== event.pointerId) return;
			const current = point(event);
			const { x, y } = snap({
				x: drag.position.x + current.x - drag.start.x,
				y: drag.position.y + current.y - drag.start.y,
			});
			const active =
				drag.active ||
				Math.hypot(
					event.clientX - drag.startClient.x,
					event.clientY - drag.startClient.y,
				) > 3;
			if (active && (x !== drag.position.x || y !== drag.position.y))
				run({ type: "move", positions: [{ ...drag.position, x, y }] });
			setDrag(null);
		},
		onPointerCancel: () => {
			cancelConnectionDrag();
			setDrag(null);
			setPan(null);
		},
		onLostPointerCapture: () => setConnectionDrag(null),
	};
	return { cancelConnectionDrag, startConnectionDrag, startDrag, svgHandlers };
}
