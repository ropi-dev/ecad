import type { CircuitNet } from "@ecad/drawing-core/circuit/model.ts";
import type { CircuitCommand } from "@ecad/drawing-core/circuit/store.ts";
import { type Accessor, createSignal, type Setter } from "solid-js";
import type { CircuitTool } from "#/components/circuit/CircuitToolbar.tsx";
import type {
	CircuitDrag,
	CircuitPosition,
	CircuitSelection,
	ConnectionDrag,
	GraphButtonEvent,
} from "#/components/circuit/circuitEditorState.ts";
import type { CircuitView } from "#/components/circuit/useCircuitNavigation.ts";
import type { SymbolDefinition } from "#/drawing/symbols.ts";

type Point = { x: number; y: number };
type SvgEvent<E extends Event> = E & { currentTarget: SVGSVGElement };

/** Pointer gestures in progress on the circuit graph. */
export function useCircuitPointerState() {
	const [pan, setPan] = createSignal<{
		x: number;
		y: number;
		view: CircuitView;
		pointerId: number;
	} | null>(null);
	const [drag, setDrag] = createSignal<CircuitDrag | null>(null);
	const [connectionDrag, setConnectionDrag] =
		createSignal<ConnectionDrag | null>(null);
	return {
		pan,
		setPan,
		drag,
		setDrag,
		connectionDrag,
		setConnectionDrag,
		suppressPinClick: { current: false },
	};
}

/**
 * Pointer handling for the circuit graph: panning, dragging components and
 * nets, dragging a connection from a pin onto another pin or net, and placing
 * a component or net with the placement tools. The handlers read the current
 * state when they run.
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
	svg: Accessor<SVGSVGElement | undefined>;
	tool: Accessor<CircuitTool>;
	placement: Accessor<SymbolDefinition | null>;
	placementPinCount: Accessor<number>;
	view: Accessor<CircuitView>;
	setView(view: CircuitView): void;
	pinNets: Accessor<ReadonlyMap<string, CircuitNet>>;
	snap<T extends Point>(position: T): T;
	componentPosition(position: Point, pinCount: number): Point;
	select(next: CircuitSelection): void;
	selectPin(id: string): void;
	setCheckedPins: Setter<string[]>;
	setPendingPin: Setter<string | null>;
	setPlacementPoint: Setter<Point | null>;
	setConnecting(value: boolean): void;
	placeAt(position: Point): void;
	run(command: CircuitCommand): boolean;
}) {
	function point(event: { clientX: number; clientY: number }) {
		const matrix = svg()?.getScreenCTM()?.inverse();
		if (!matrix) return { x: 0, y: 0 };
		return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
	}
	function connectionDropTarget(
		event: { clientX: number; clientY: number },
		sourceId: string,
	): ConnectionDrag["target"] {
		const element = svg();
		const button = element?.ownerDocument
			.elementFromPoint(event.clientX, event.clientY)
			?.closest("button[data-circuit-pin-id], button[data-circuit-net-id]");
		const id = button?.getAttribute("data-circuit-pin-id");
		const netId = button?.getAttribute("data-circuit-net-id");
		if (!element?.contains(button ?? null)) return null;
		return netId
			? { kind: "net", id: netId }
			: id && id !== sourceId
				? { kind: "pin", id }
				: null;
	}
	function cancelConnectionDrag() {
		const current = connectionDrag();
		if (!current) return;
		suppressPinClick.current = true;
		setConnectionDrag(null);
		const element = svg();
		if (element?.hasPointerCapture(current.pointerId)) {
			element.releasePointerCapture(current.pointerId);
		}
	}
	function startConnectionDrag(
		event: GraphButtonEvent<PointerEvent>,
		pinId: string,
	) {
		const current = tool();
		if (event.button !== 0 || (current !== "select" && current !== "connect"))
			return;
		event.preventDefault();
		event.stopPropagation();
		svg()?.focus({ preventScroll: true });
		svg()?.setPointerCapture(event.pointerId);
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
		event: GraphButtonEvent<PointerEvent>,
		position: CircuitPosition,
	) {
		if (event.button !== 0 || tool() !== "select") return;
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
	const svgHandlers = {
		onPointerDownCapture: () => {
			suppressPinClick.current = false;
		},
		onPointerLeave: () => setPlacementPoint(null),
		onClickCapture: (event: MouseEvent) => {
			if (suppressPinClick.current && event.detail > 0) {
				suppressPinClick.current = false;
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			const current = tool();
			if (
				(current === "net" || (current === "component" && placement())) &&
				event.button === 0
			) {
				event.preventDefault();
				event.stopPropagation();
				placeAt(
					current === "component"
						? componentPosition(point(event), placementPinCount())
						: point(event),
				);
			}
		},
		onPointerDown: (event: SvgEvent<PointerEvent>) => {
			if (
				!(event.target instanceof Element) ||
				!event.target.closest("button")
			) {
				event.currentTarget.focus({ preventScroll: true });
				if (event.button === 0 && tool() === "select") select(null);
			}
			if (event.button !== 1 && (tool() !== "pan" || event.button !== 0))
				return;
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			setPan({
				x: event.clientX,
				y: event.clientY,
				view: view(),
				pointerId: event.pointerId,
			});
		},
		onPointerMove: (event: PointerEvent) => {
			// An active pan owns its pointer, even while a placement tool is
			// active. Leaving placementPoint untouched keeps the preview under
			// the cursor, since panning keeps the cursor's graph point fixed.
			const panning = pan();
			if (panning?.pointerId === event.pointerId) {
				const matrix = svg()?.getScreenCTM();
				if (matrix)
					setView({
						...panning.view,
						x: panning.view.x - (event.clientX - panning.x) / matrix.a,
						y: panning.view.y - (event.clientY - panning.y) / matrix.d,
					});
				return;
			}
			const connecting = connectionDrag();
			if (connecting?.pointerId === event.pointerId) {
				setConnectionDrag({
					...connecting,
					point: point(event),
					active:
						connecting.active ||
						Math.hypot(
							event.clientX - connecting.start.x,
							event.clientY - connecting.start.y,
						) > 4,
					target: connectionDropTarget(event, connecting.pinId),
				});
				return;
			}
			const current = tool();
			if ((current === "component" && placement()) || current === "net") {
				setPlacementPoint(
					current === "component"
						? componentPosition(point(event), placementPinCount())
						: snap(point(event)),
				);
				return;
			}
			const dragging = drag();
			if (!dragging || dragging.pointerId !== event.pointerId) return;
			const position = point(event);
			const active =
				dragging.active ||
				Math.hypot(
					event.clientX - dragging.startClient.x,
					event.clientY - dragging.startClient.y,
				) > 3;
			const next = active
				? snap({
						x: dragging.position.x + position.x - dragging.start.x,
						y: dragging.position.y + position.y - dragging.start.y,
					})
				: dragging.position;
			setDrag({
				...dragging,
				active,
				x: next.x,
				y: next.y,
			});
		},
		onPointerUp: (event: PointerEvent) => {
			if (pan()?.pointerId === event.pointerId) {
				setPan(null);
				return;
			}
			const connecting = connectionDrag();
			if (connecting?.pointerId === event.pointerId) {
				suppressPinClick.current = true;
				setConnectionDrag(null);
				if (!connecting.active) selectPin(connecting.pinId);
				else {
					const target = connectionDropTarget(event, connecting.pinId);
					if (target) {
						const nets = pinNets();
						const targetNetId =
							target.kind === "net" ? target.id : nets.get(target.id)?.id;
						const sameNet =
							targetNetId && nets.get(connecting.pinId)?.id === targetNetId;
						const command: CircuitCommand =
							target.kind === "net"
								? {
										type: "connect",
										pinIds: [connecting.pinId],
										netId: target.id,
									}
								: {
										type: "connect",
										pinIds: [connecting.pinId, target.id],
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
			const dragging = drag();
			if (!dragging || dragging.pointerId !== event.pointerId) return;
			const position = point(event);
			const { x, y } = snap({
				x: dragging.position.x + position.x - dragging.start.x,
				y: dragging.position.y + position.y - dragging.start.y,
			});
			const active =
				dragging.active ||
				Math.hypot(
					event.clientX - dragging.startClient.x,
					event.clientY - dragging.startClient.y,
				) > 3;
			if (active && (x !== dragging.position.x || y !== dragging.position.y))
				run({ type: "move", positions: [{ ...dragging.position, x, y }] });
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
