import { useEffect, useRef, useState } from "react";
import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	Minus,
	Plus,
} from "lucide-react";
import {
	gestureCamera,
	panCamera,
	MIN_ZOOM,
	MAX_ZOOM,
} from "../../engine/navigation";
import { useNetHover } from "./useNetHover";
import { useViewportNavigation } from "./useViewportNavigation";
import { createRenderer, fitCamera } from "../../engine";
import type {
	Camera,
	GraphicsRenderer,
	ParseResult,
	SceneLayer,
} from "../../engine/types";

export function GerberViewer() {
	const canvas = useRef<HTMLCanvasElement>(null);
	const container = useRef<HTMLDivElement>(null);
	const renderer = useRef<GraphicsRenderer | null>(null);
	const worker = useRef<Worker | null>(null);
	const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
	const request = useRef(0);
	const fittedLayer = useRef<SceneLayer | null>(null);
	const frame = useRef<number | null>(null);
	const draw = useRef<() => void>(() => {});
	const [layer, setLayer] = useState<SceneLayer | null>(null);
	const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
	const [homeCamera, setHomeCamera] = useState<Camera>({
		x: 0,
		y: 0,
		scale: 1,
	});
	const zoom = camera.scale / homeCamera.scale;
	const [size, setSize] = useState({ width: 1, height: 1 });
	const [backend, setBackend] = useState("");
	const [message, setMessage] = useState("");
	const [loading, setLoading] = useState(false);
	const [renderRevision, setRenderRevision] = useState(0);
	useViewportNavigation(container, !!layer, homeCamera.scale, setCamera);
	const hoveredIds = useNetHover(container, renderer, layer, camera, size);

	function resetView() {
		if (layer) setCamera(homeCamera);
	}
	function zoomView(factor: number) {
		const center = { x: size.width / 2, y: size.height / 2 };
		setCamera((current) =>
			gestureCamera(
				current,
				center,
				center,
				factor,
				size.width,
				size.height,
				homeCamera.scale,
			),
		);
	}
	function panView(x: number, y: number) {
		setCamera((current) => panCamera(current, { x: -x, y: -y }));
	}

	useEffect(() => {
		const target = canvas.current!;
		let disposed = false;
		const onError = (event: Event) => {
			setBackend("Renderer unavailable");
			setMessage((event as CustomEvent<string>).detail);
		};
		const onInvalidate = () => setRenderRevision((revision) => revision + 1);
		target.addEventListener("renderererror", onError);
		target.addEventListener("renderinvalidated", onInvalidate);
		void createRenderer(target)
			.then((result) => {
				if (disposed) {
					result.renderer.dispose?.();
					return;
				}
				renderer.current = result.renderer;
				setBackend(
					result.backend === "WebGPU"
						? result.accelerated
							? "WebGPU"
							: "WebGPU · software adapter"
						: "Canvas fallback",
				);
			})
			.catch((error: unknown) => {
				if (!disposed)
					setMessage(
						error instanceof Error
							? error.message
							: "Unable to start the renderer.",
					);
			});
		return () => {
			disposed = true;
			target.removeEventListener("renderererror", onError);
			target.removeEventListener("renderinvalidated", onInvalidate);
			renderer.current?.dispose?.();
			renderer.current = null;
		};
	}, []);

	useEffect(() => {
		const observer = new ResizeObserver(([entry]) => {
			setSize({
				width: entry.contentRect.width,
				height: entry.contentRect.height,
			});
		});
		observer.observe(container.current!);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (
			layer &&
			layer !== fittedLayer.current &&
			size.width > 1 &&
			size.height > 1
		) {
			fittedLayer.current = layer;
			const fitted = fitCamera(
				layer.bounds,
				size.width,
				size.height,
				Math.min(40, size.width / 10),
			);
			setHomeCamera(fitted);
			setCamera(fitted);
		}
	}, [layer, size]);

	useEffect(() => {
		if (!renderer.current || !canvas.current) return;
		draw.current = () => {
			if (!renderer.current || !canvas.current) return;
			try {
				renderer.current.render(canvas.current, layer ? [layer] : [], {
					...size,
					camera,
					pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
					grid: false,
					selectedIds: hoveredIds,
					background: "#111318",
				});
			} catch (error) {
				setMessage(
					error instanceof Error ? error.message : "Unable to draw this file.",
				);
			}
		};
		if (frame.current === null)
			frame.current = requestAnimationFrame(() => {
				frame.current = null;
				draw.current();
			});
	}, [layer, camera, size, backend, renderRevision, hoveredIds]);

	useEffect(
		() => () => {
			if (frame.current !== null) cancelAnimationFrame(frame.current);
			frame.current = null;
			request.current++;
			worker.current?.terminate();
			if (timeout.current) clearTimeout(timeout.current);
		},
		[],
	);

	async function openFile(file: File) {
		const id = ++request.current;
		worker.current?.terminate();
		if (timeout.current) clearTimeout(timeout.current);
		setLoading(true);
		setMessage("");
		setLayer(null);
		try {
			const source = await file.text();
			if (id !== request.current) return;
			const parser = new Worker(
				new URL("../../formats/parse.worker.ts", import.meta.url),
				{ type: "module" },
			);
			worker.current = parser;
			const finish = () => {
				parser.terminate();
				if (timeout.current) clearTimeout(timeout.current);
				setLoading(false);
			};
			parser.onmessage = (
				event: MessageEvent<{ result: ParseResult; error?: string }>,
			) => {
				if (id !== request.current) return;
				finish();
				if (event.data.error) {
					setMessage(event.data.error);
					return;
				}
				const { layer: parsed, diagnostics } = event.data.result;
				const errors = diagnostics.filter(
					(entry) => entry.severity === "error",
				);
				if (errors.length) {
					setMessage(errors.map((entry) => entry.message).join("; "));
					return;
				}
				if (!parsed.objects.length) {
					setMessage("This file contains no drawable geometry.");
					return;
				}
				setLayer({ ...parsed, color: "#e8b77e", visible: true, opacity: 1 });
				setMessage(diagnostics.map((entry) => entry.message).join("; "));
			};
			parser.onerror = (event) => {
				if (id === request.current) {
					finish();
					setMessage(event.message || "Unable to parse this file.");
				}
			};
			timeout.current = setTimeout(() => {
				if (id === request.current) {
					finish();
					setMessage("Parsing timed out. Try a smaller file.");
				}
			}, 20000);
			parser.postMessage({ id, source, filename: file.name });
		} catch (error) {
			if (id === request.current) {
				setLoading(false);
				setMessage(
					error instanceof Error ? error.message : "Unable to read this file.",
				);
			}
		}
	}

	return (
		<main className="gerber-viewer">
			<header className="file-bar">
				<input
					type="file"
					aria-label="Open Gerber file"
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (file) void openFile(file);
						event.target.value = "";
					}}
				/>
				<span className="file-name">
					{loading ? "Reading file…" : layer?.name}
				</span>

				<span className="renderer-label">{backend}</span>
			</header>
			{message && (
				<p className="viewer-message" role="status">
					{message}
				</p>
			)}
			<div
				ref={container}
				className="drawing-area"
				role="region"
				aria-label="Gerber drawing viewport"
				tabIndex={0}
				onKeyDown={(event) => {
					if (!layer || event.ctrlKey || event.metaKey || event.altKey) return;
					const step = event.shiftKey ? 240 : 80;
					switch (event.key) {
						case "+":
						case "=":
							zoomView(1.25);
							break;
						case "-":
							zoomView(1 / 1.25);
							break;
						case "f":
						case "F":
						case "0":
							resetView();
							break;
						case "ArrowLeft":
							panView(-step, 0);
							break;
						case "ArrowRight":
							panView(step, 0);
							break;
						case "ArrowUp":
							panView(0, -step);
							break;
						case "ArrowDown":
							panView(0, step);
							break;
						default:
							return;
					}
					event.preventDefault();
				}}
			>
				<canvas ref={canvas} aria-label="Gerber file drawing" />
				<div
					className="view-controls"
					data-view-controls
					role="group"
					aria-label="View controls"
				>
					<button
						type="button"
						disabled={!layer || zoom <= MIN_ZOOM}
						title="Zoom out (-)"
						aria-label="Zoom out"
						onClick={() => zoomView(1 / 1.25)}
					>
						<Minus size={16} />
					</button>
					<button
						type="button"
						disabled={!layer || zoom >= MAX_ZOOM}
						title="Zoom in (+)"
						aria-label="Zoom in"
						onClick={() => zoomView(1.25)}
					>
						<Plus size={16} />
					</button>
					<button
						type="button"
						disabled={!layer}
						className="zoom-level"
						title="Reset to 100% (0)"
						aria-label="Reset zoom to 100%"
						onClick={resetView}
					>
						{Math.round(zoom * 100)}%
					</button>
					<span className="controls-divider" />
					<button
						type="button"
						disabled={!layer}
						title="Pan left"
						aria-label="Pan left"
						onClick={() => panView(-80, 0)}
					>
						<ArrowLeft size={16} />
					</button>
					<button
						type="button"
						disabled={!layer}
						title="Pan up"
						aria-label="Pan up"
						onClick={() => panView(0, -80)}
					>
						<ArrowUp size={16} />
					</button>
					<button
						type="button"
						disabled={!layer}
						title="Pan down"
						aria-label="Pan down"
						onClick={() => panView(0, 80)}
					>
						<ArrowDown size={16} />
					</button>
					<button
						type="button"
						disabled={!layer}
						title="Pan right"
						aria-label="Pan right"
						onClick={() => panView(80, 0)}
					>
						<ArrowRight size={16} />
					</button>
				</div>
				{layer && (
					<p className="navigation-hint">
						Drag to pan · Scroll or pinch to zoom · 0 to reset
					</p>
				)}
				{!layer && !loading && !message && (
					<p className="empty-message">Choose a Gerber file to view it.</p>
				)}
			</div>
		</main>
	);
}
