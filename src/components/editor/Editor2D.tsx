import {
	Circle,
	Hand,
	MousePointer2,
	Slash,
	Square,
	Trash2,
	Triangle,
} from "lucide-react";
import {
	Fragment,
	type PointerEvent as ReactPointerEvent,
	useRef,
	useState,
} from "react";
import { screenToWorld, worldToScreen } from "#/engine/camera";
import type { Point } from "#/engine/types";
import { OrthographicViewer2D } from "../viewer/OrthographicViewer2D";
import type { Viewer2DSnapshot } from "../viewer/types/Viewer2DSnapshot";
import { viewControlButtonClassName } from "../viewer/ViewControls3D";
import { SelectionAttributes } from "./SelectionAttributes";
import {
	drawShape,
	type EditorShape,
	hitShape,
	intersectsSelection,
	moveShapes,
	type ResizeHandle,
	resizeHandles,
	resizeShape,
	type ShapeKind,
} from "./shapes";
import { useEditorScene } from "./useEditorScene";

const tools = [
	{ kind: "select", label: "Select", icon: MousePointer2 },
	{ kind: "pan", label: "Pan", icon: Hand },
	{ kind: "rectangle", label: "Rectangle", icon: Square },
	{ kind: "circle", label: "Circle", icon: Circle },
	{ kind: "triangle", label: "Triangle", icon: Triangle },
	{ kind: "line", label: "Line", icon: Slash },
] as const;
type Tool = ShapeKind | "select" | "pan";
interface Drag {
	pointerId: number;
	canvas: HTMLCanvasElement;
	start: Point;
	startScreen: Point;
	previousSelection: Set<number>;
	mode: "move" | "marquee" | "draw" | "resize";
	handle?: ResizeHandle;
	originals: EditorShape[];
	created: boolean;
	valid: boolean;
	additive: boolean;
}
interface Marquee {
	start: Point;
	end: Point;
}

export function Editor2D() {
	const [shapes, setShapes] = useState<EditorShape[]>([]);
	const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
	const [marquee, setMarquee] = useState<Marquee | null>(null);
	const [tool, setTool] = useState<Tool>("select");
	const [ready, setReady] = useState(false);
	const [error, setError] = useState("");
	const snapshot = useRef<Viewer2DSnapshot | null>(null);
	const [view, setView] = useState<Viewer2DSnapshot | null>(null);
	const drag = useRef<Drag | null>(null);
	const nextId = useRef(1);
	const { scene, updateScene } = useEditorScene(shapes, selectedIds);
	const selected = shapes.filter((shape) => selectedIds.has(shape.id));
	const handles =
		tool === "select"
			? selected.flatMap((shape) =>
					resizeHandles(shape).map((handle) => ({ shape, handle })),
				)
			: [];
	const handleAt = (point: Point) => {
		const tolerance = 7 / (snapshot.current?.camera.scale ?? 1);
		return [...handles]
			.reverse()
			.find(
				({ handle }) =>
					Math.abs(handle.x - point.x) <= tolerance &&
					Math.abs(handle.y - point.y) <= tolerance,
			);
	};
	const pointAt = (event: ReactPointerEvent, canvas: HTMLCanvasElement) => {
		const view = snapshot.current;
		if (!view) return null;
		const rect = canvas.getBoundingClientRect();
		return screenToWorld(
			{ x: event.clientX - rect.left, y: event.clientY - rect.top },
			view.camera,
			rect.width,
			rect.height,
		);
	};
	const stop = (event: ReactPointerEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};
	const replaceShapes = (replacements: EditorShape[]) => {
		const byId = new Map(replacements.map((shape) => [shape.id, shape]));
		setShapes((current) => current.map((shape) => byId.get(shape.id) ?? shape));
	};
	const updateDrag = (event: ReactPointerEvent) => {
		const active = drag.current;
		if (!active || active.pointerId !== event.pointerId) return;
		stop(event);
		const point = pointAt(event, active.canvas);
		if (!point) return;
		if (active.mode === "resize" && active.handle) {
			replaceShapes([
				resizeShape(active.originals[0], active.handle, {
					x: point.x - active.start.x,
					y: point.y - active.start.y,
				}),
			]);
			return;
		}
		if (active.mode === "draw") {
			const original = active.originals[0];
			const draft = drawShape(original.id, original.kind, active.start, point);
			const scale = snapshot.current?.camera.scale ?? 1;
			active.valid =
				draft.width > 0 &&
				draft.height > 0 &&
				(draft.kind === "line"
					? draft.width
					: Math.min(draft.width, draft.height)) *
					scale >=
					3;
			replaceShapes([draft]);
			return;
		}
		if (active.mode === "move") {
			replaceShapes(
				moveShapes(active.originals, {
					x: point.x - active.start.x,
					y: point.y - active.start.y,
				}),
			);
			return;
		}
		const rect = active.canvas.getBoundingClientRect();
		const end = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		if (
			Math.hypot(end.x - active.startScreen.x, end.y - active.startScreen.y) < 3
		) {
			setMarquee(null);
			setSelectedIds(active.additive ? active.previousSelection : new Set());
			return;
		}
		setMarquee({ start: active.startScreen, end });
		const bounds = {
			minX: Math.min(active.start.x, point.x),
			maxX: Math.max(active.start.x, point.x),
			minY: Math.min(active.start.y, point.y),
			maxY: Math.max(active.start.y, point.y),
		};
		const ids = new Set(active.additive ? active.previousSelection : []);
		for (const shape of shapes)
			if (intersectsSelection(shape, bounds)) ids.add(shape.id);
		setSelectedIds(ids);
	};
	const finishDrag = (cancel = false) => {
		const active = drag.current;
		if (!active) return;
		drag.current = null;
		active.canvas.style.cursor = "";
		setMarquee(null);
		if (cancel || (active.created && !active.valid)) {
			if (active.created) {
				const createdIds = new Set(active.originals.map((shape) => shape.id));
				setShapes((current) =>
					current.filter((shape) => !createdIds.has(shape.id)),
				);
			} else if (active.mode === "move" || active.mode === "resize")
				replaceShapes(active.originals);
			setSelectedIds(active.previousSelection);
		} else if (active.created) setTool("select");
		if (active.canvas.hasPointerCapture(active.pointerId))
			active.canvas.releasePointerCapture(active.pointerId);
	};
	const removeSelected = () => {
		setShapes((current) =>
			current.filter((shape) => !selectedIds.has(shape.id)),
		);
		setSelectedIds(new Set());
	};
	const selectShape = (id: number, additive: boolean) => {
		const ids = new Set(additive ? selectedIds : []);
		if (additive && ids.has(id)) ids.delete(id);
		else ids.add(id);
		setSelectedIds(ids);
	};

	return (
		<main className="gerber-workspace">
			<h1 className="sr-only">2D editor · A3 landscape · 420 × 297 mm</h1>
			<header className="file-bar flex items-center gap-2">
				<a
					href="/"
					className="add-gerber-files no-underline focus-visible:outline-2 focus-visible:outline-amber-200"
				>
					Gerber viewer
				</a>
				<a
					href="/step"
					className="add-gerber-files no-underline focus-visible:outline-2 focus-visible:outline-amber-200"
				>
					STEP viewer
				</a>
			</header>
			<div className="workspace-body">
				<div
					className="editor-surface"
					data-tool={tool}
					onPointerDownCapture={(event) => {
						const canvas = event.target;
						if (!(canvas instanceof HTMLCanvasElement) || !ready) return;
						if (drag.current) {
							stop(event);
							return;
						}
						if (
							!event.isPrimary ||
							event.button !== 0 ||
							event.ctrlKey ||
							event.metaKey ||
							event.altKey ||
							tool === "pan"
						)
							return;
						const point = pointAt(event, canvas);
						if (!point) return;
						stop(event);
						canvas.focus({ preventScroll: true });
						const resize = handleAt(point);
						canvas.style.cursor = resize?.handle.cursor ?? "";
						let shape: EditorShape | undefined;
						const created = tool !== "select";
						if (created) {
							shape = drawShape(nextId.current++, tool, point, point);
							const added = shape;
							setShapes((current) => [...current, added]);
						} else if (resize) shape = resize.shape;
						else
							shape = [...shapes]
								.reverse()
								.find((candidate) =>
									hitShape(
										candidate,
										point,
										6 / (snapshot.current?.camera.scale ?? 1),
									),
								);
						if (shape && event.shiftKey && !created && !resize) {
							selectShape(shape.id, true);
							return;
						}
						const originals = shape
							? !created && !resize && selectedIds.has(shape.id)
								? selected
								: [shape]
							: [];
						setSelectedIds(
							resize
								? selectedIds
								: shape
									? new Set(originals.map((item) => item.id))
									: event.shiftKey
										? selectedIds
										: new Set(),
						);
						const rect = canvas.getBoundingClientRect();
						drag.current = {
							pointerId: event.pointerId,
							canvas,
							start: point,
							startScreen: {
								x: event.clientX - rect.left,
								y: event.clientY - rect.top,
							},
							previousSelection: selectedIds,
							mode: created
								? "draw"
								: resize
									? "resize"
									: shape
										? "move"
										: "marquee",
							handle: resize?.handle,
							originals,
							created,
							valid: false,
							additive: event.shiftKey,
						};
						canvas.setPointerCapture(event.pointerId);
					}}
					onPointerMoveCapture={(event) => {
						if (drag.current) {
							updateDrag(event);
							return;
						}
						if (!(event.target instanceof HTMLCanvasElement)) return;
						const point = pointAt(event, event.target);
						event.target.style.cursor = point
							? (handleAt(point)?.handle.cursor ?? "")
							: "";
					}}
					onPointerUpCapture={(event) => {
						if (drag.current?.pointerId !== event.pointerId) return;
						updateDrag(event);
						finishDrag();
					}}
					onPointerCancelCapture={(event) => {
						if (drag.current?.pointerId !== event.pointerId) return;
						stop(event);
						finishDrag(true);
					}}
					onLostPointerCapture={(event) => {
						if (drag.current?.pointerId === event.pointerId) finishDrag(true);
					}}
					onKeyDownCapture={(event) => {
						if (!(event.target instanceof HTMLCanvasElement)) return;
						if (event.key === "Escape") {
							if (drag.current) finishDrag(true);
							else setSelectedIds(new Set());
						} else if (
							selected.length > 0 &&
							(event.key === "Delete" || event.key === "Backspace")
						) {
							finishDrag();
							removeSelected();
						} else if (selected.length > 0 && event.key.startsWith("Arrow")) {
							const step = event.shiftKey ? 10 : 1;
							replaceShapes(
								moveShapes(selected, {
									x:
										event.key === "ArrowRight"
											? step
											: event.key === "ArrowLeft"
												? -step
												: 0,
									y:
										event.key === "ArrowUp"
											? step
											: event.key === "ArrowDown"
												? -step
												: 0,
								}),
							);
						} else return;
						event.preventDefault();
						event.stopPropagation();
					}}
				>
					{scene && (
						<OrthographicViewer2D
							scene={scene}
							updateScene={updateScene}
							selectionEnabled={false}
							onReady={setReady}
							onError={setError}
							onChange={(value) => {
								snapshot.current = value;
								setView((current) =>
									current &&
									current.camera.x === value.camera.x &&
									current.camera.y === value.camera.y &&
									current.camera.scale === value.camera.scale &&
									current.viewport.width === value.viewport.width &&
									current.viewport.height === value.viewport.height
										? current
										: value,
								);
							}}
							extraControls={
								<fieldset aria-label="Drawing tools" className="contents">
									{tools.map(({ kind, label, icon: Icon }) => (
										<Fragment key={kind}>
											{(kind === "select" || kind === "rectangle") && (
												<span
													aria-hidden="true"
													className="mx-1 h-6 w-px self-center bg-white/20"
												/>
											)}
											<button
												type="button"
												className={`${viewControlButtonClassName} editor-tool`}
												disabled={!ready}
												aria-label={label}
												title={label}
												aria-pressed={tool === kind}
												onClick={() => setTool(kind)}
											>
												<Icon size={18} aria-hidden="true" />
											</button>
										</Fragment>
									))}
									<button
										type="button"
										className={viewControlButtonClassName}
										disabled={!selected.length}
										aria-label="Delete"
										title="Delete selected shapes"
										onClick={removeSelected}
									>
										<Trash2 size={18} aria-hidden="true" />
									</button>
								</fieldset>
							}
							ariaLabel="2D shape editor"
							interactionHint="Choose a shape, then drag to draw it. Rectangles and triangles use two opposite corners, circles use a center and radius, and lines use two endpoints. Release to finish or press Escape to cancel. Drag shapes to move. Drag selected shapes' handles to resize; circle handles change the radius and line handles move endpoints. Drag empty space to select shapes. Shift + drag adds to the selection. Use the Pan tool or middle-drag to pan; pinch or Ctrl + scroll to zoom. Arrow keys move selected shapes by 1 mm, Shift + arrows by 10 mm. Delete removes the selection. Escape cancels. F6 fits the sheet."
						/>
					)}
					{view && (
						<div className="editor-resize-handles" aria-hidden="true">
							{handles.map(({ shape, handle }) => {
								const point = worldToScreen(
									handle,
									view.camera,
									view.viewport.width,
									view.viewport.height,
								);
								return (
									<span
										key={`${shape.id}:${handle.id}`}
										className="editor-resize-handle"
										data-testid="resize-handle"
										data-shape-id={shape.id}
										data-handle={handle.id}
										style={{ left: point.x, top: point.y }}
									/>
								);
							})}
						</div>
					)}
					{marquee && (
						<div
							className="editor-selection-rectangle"
							data-testid="selection-rectangle"
							aria-hidden="true"
							style={{
								left: Math.min(marquee.start.x, marquee.end.x),
								top: Math.min(marquee.start.y, marquee.end.y),
								width: Math.abs(marquee.end.x - marquee.start.x),
								height: Math.abs(marquee.end.y - marquee.start.y),
							}}
						/>
					)}
					{error && (
						<p className="viewer-message" role="alert">
							{error}
						</p>
					)}
				</div>
				<SelectionAttributes
					shapes={selected}
					onClear={() => setSelectedIds(new Set())}
				/>
			</div>
		</main>
	);
}
