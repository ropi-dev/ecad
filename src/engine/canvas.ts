import { gridSpacing, screenToWorld, worldToScreen } from "./camera";
import { curveTolerance, GeometryCompiler, hitTestScene } from "./geometry";
import type {
	Geometry,
	GraphicsRenderer,
	Point,
	RenderOptions,
	SceneLayer,
} from "./types";

/** Compatibility backend; every format consumes the same scene representation. */
export class CanvasRenderer implements GraphicsRenderer {
	private compiler = new GeometryCompiler();
	private scratch: HTMLCanvasElement;
	private paths = new WeakMap<Geometry, { path: Path2D; tolerance: number }>();

	constructor(canvas: HTMLCanvasElement) {
		this.scratch = canvas.ownerDocument.createElement("canvas");
		if (!canvas.getContext("2d"))
			throw new Error("Could not initialize a canvas renderer.");
	}

	private path(geometry: Geometry, tolerance: number): Path2D {
		const cached = this.paths.get(geometry);
		if (cached && cached.tolerance <= tolerance) return cached.path;
		const path = new Path2D();
		for (const polygon of this.compiler.compile(geometry, tolerance).polygons)
			for (const ring of polygon) {
				if (!ring.length) continue;
				path.moveTo(ring[0][0], ring[0][1]);
				for (let index = 1; index < ring.length; index++)
					path.lineTo(ring[index][0], ring[index][1]);
				path.closePath();
			}
		this.paths.set(geometry, { path, tolerance });
		return path;
	}

	render(
		canvas: HTMLCanvasElement,
		layers: readonly SceneLayer[],
		options: RenderOptions,
	): void {
		const { width, height, pixelRatio: ratio, camera } = options;
		if (width <= 0 || height <= 0) return;
		const targetWidth = Math.max(1, Math.round(width * ratio)),
			targetHeight = Math.max(1, Math.round(height * ratio));
		if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
			canvas.width = targetWidth;
			canvas.height = targetHeight;
		}
		if (
			this.scratch.width !== targetWidth ||
			this.scratch.height !== targetHeight
		) {
			this.scratch.width = targetWidth;
			this.scratch.height = targetHeight;
		}
		const context = canvas.getContext("2d")!,
			layerContext = this.scratch.getContext("2d")!;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.globalAlpha = 1;
		context.globalCompositeOperation = "source-over";
		context.fillStyle = options.background;
		context.fillRect(0, 0, width, height);
		if (options.grid) this.grid(context, options);
		for (const layer of layers) {
			if (!layer.visible || layer.opacity <= 0) continue;
			layerContext.resetTransform();
			layerContext.clearRect(0, 0, targetWidth, targetHeight);
			const mirror = options.mirrored ? -1 : 1;
			layerContext.setTransform(
				camera.scale * ratio * mirror,
				0,
				0,
				-camera.scale * ratio,
				(width / 2 - camera.x * camera.scale * mirror) * ratio,
				(height / 2 + camera.y * camera.scale) * ratio,
			);
			layerContext.fillStyle = layer.color;
			for (const object of layer.objects) {
				layerContext.save();
				if (object.transform) layerContext.transform(...object.transform);
				layerContext.globalCompositeOperation =
					object.polarity === "clear" ? "destination-out" : "source-over";
				const matrix = object.transform;
				const scale = matrix
					? Math.max(
							Math.hypot(matrix[0], matrix[1]),
							Math.hypot(matrix[2], matrix[3]),
							1,
						)
					: 1;
				layerContext.fill(
					this.path(
						object.geometry,
						curveTolerance(camera.scale * ratio * scale),
					),
					"evenodd",
				);
				layerContext.restore();
			}
			context.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
			context.drawImage(this.scratch, 0, 0, width, height);
		}
		context.globalAlpha = 1;
		const selected = options.selectedId
			? layers
					.filter((layer) => layer.visible)
					.flatMap((layer) => layer.objects)
					.find((object) => object.id === options.selectedId)
			: undefined;
		if (selected) {
			const a = worldToScreen(
				{ x: selected.bounds.minX, y: selected.bounds.maxY },
				camera,
				width,
				height,
				options.mirrored,
			);
			const b = worldToScreen(
				{ x: selected.bounds.maxX, y: selected.bounds.minY },
				camera,
				width,
				height,
				options.mirrored,
			);
			context.strokeStyle = "#ffd464";
			context.lineWidth = 1.3;
			context.strokeRect(
				Math.min(a.x, b.x) - 3,
				Math.min(a.y, b.y) - 3,
				Math.abs(b.x - a.x) + 6,
				Math.abs(b.y - a.y) + 6,
			);
		}
	}

	private grid(
		context: CanvasRenderingContext2D,
		options: RenderOptions,
	): void {
		const { camera, width, height, mirrored } = options;
		const step = gridSpacing(camera.scale);
		const a = screenToWorld({ x: 0, y: 0 }, camera, width, height, mirrored);
		const b = screenToWorld(
			{ x: width, y: height },
			camera,
			width,
			height,
			mirrored,
		);
		const minX = Math.min(a.x, b.x),
			maxX = Math.max(a.x, b.x),
			minY = Math.min(a.y, b.y),
			maxY = Math.max(a.y, b.y);
		context.fillStyle = "#71888b45";
		for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step)
			for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
				const point = worldToScreen({ x, y }, camera, width, height, mirrored);
				context.fillRect(point.x - 0.6, point.y - 0.6, 1.2, 1.2);
			}
		const origin = worldToScreen(
			{ x: 0, y: 0 },
			camera,
			width,
			height,
			mirrored,
		);
		context.strokeStyle = "#71888b32";
		context.lineWidth = 1;
		context.beginPath();
		context.moveTo(origin.x, 0);
		context.lineTo(origin.x, height);
		context.moveTo(0, origin.y);
		context.lineTo(width, origin.y);
		context.stroke();
	}

	hitTest(layers: readonly SceneLayer[], point: Point, tolerance: number) {
		return hitTestScene(this.compiler, layers, point, tolerance);
	}

	dispose(): void {
		this.scratch.width = 0;
		this.scratch.height = 0;
	}
}
