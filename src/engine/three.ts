/// <reference types="@webgpu/types" />

import { Effect, Exit, type Scope } from "effect";
import {
	attribute,
	float,
	int,
	ivec2,
	mix,
	texture,
	textureLoad,
	uniform,
	uv,
	varying,
	vec2,
	vec3,
	vec4,
} from "three/tsl";
import {
	AdditiveBlending,
	BufferGeometry,
	Color,
	DataTexture,
	DoubleSide,
	FloatType,
	InterleavedBuffer,
	InterleavedBufferAttribute,
	Mesh,
	NoBlending,
	NodeMaterial,
	NoToneMapping,
	OrthographicCamera,
	QuadMesh,
	RedFormat,
	RenderTarget,
	Scene,
	UnsignedByteType,
	Vector2,
	WebGPUBackend,
	WebGPURenderer,
} from "three/webgpu";
import { runEffect } from "#/lib/effect";
import { createLifecycle } from "#/lib/lifecycle";
import { gridSpacing } from "./camera";
import { curveTolerance, GeometryCompiler, hitTestScene } from "./geometry";
import {
	hoverLayerColor,
	UNFOCUSED_FILL_OPACITY,
	UNFOCUSED_OUTLINE_OPACITY,
	UNFOCUSED_OUTLINE_WIDTH,
	UNFOCUSED_XRAY_COLOR,
} from "./layer-style";
import type { MeshRequest, MeshResult } from "./mesh";
import { type RendererError, rendererError } from "./renderer-error";
import type {
	GraphicsRenderer,
	Point,
	RenderOptions,
	SceneLayer,
	SceneObject,
} from "./types";

interface LayerMesh {
	objects: SceneObject[];
	mesh: Mesh<BufferGeometry, NodeMaterial>;
	selection: DataTexture;
	selectionFlags: Float32Array;
	selectedIds?: ReadonlySet<string>;
	tolerance: number;
	requestedTolerance: number;
	revision: number;
	building: boolean;
	failed: boolean;
}

export class ThreeRenderer implements GraphicsRenderer {
	private lifecycle = createLifecycle();
	private compiler = new GeometryCompiler();
	private layers = new Map<string, LayerMesh>();
	private meshWorker: Worker;
	private nextRevision = 0;
	private disposed = false;
	private lost = false;
	private camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
	private scene = new Scene();
	private mask = new RenderTarget(1, 1, {
		samples: 4,
		depthBuffer: false,
		type: UnsignedByteType,
	});
	private backgroundMaterial = Object.assign(new NodeMaterial(), {
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});
	private compositeMaterial = Object.assign(new NodeMaterial(), {
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});
	private xrayMaterial = Object.assign(new NodeMaterial(), {
		transparent: true,
		blending: AdditiveBlending,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});
	private quad = new QuadMesh(this.backgroundMaterial);
	private backgroundColor = uniform(new Color());
	private layerColor = uniform(new Color());
	private hoverColor = uniform(new Color());
	private layerOpacity = uniform(1);
	private unfocusedLayer = uniform(0);
	private outlineStep = uniform(new Vector2());
	private viewport = uniform(new Vector2(1, 1));
	private center = uniform(new Vector2());
	private scale = uniform(1);
	private mirror = uniform(1);
	private gridStep = uniform(1);
	private showGrid = uniform(0);
	private maxTextureSize: number;
	readonly backend: "WebGPU" | "WebGL 2";

	private constructor(
		private canvas: HTMLCanvasElement,
		private renderer: WebGPURenderer,
	) {
		for (const resource of [
			this.mask,
			this.backgroundMaterial,
			this.compositeMaterial,
			this.xrayMaterial,
		]) {
			this.lifecycle.addFinalizer(() => resource.dispose());
		}
		this.lifecycle.addFinalizer(() => {
			for (const layer of this.layers.values()) this.disposeLayer(layer);
			this.layers.clear();
			this.scene.clear();
		});
		try {
			this.backend =
				renderer.backend instanceof WebGPUBackend ? "WebGPU" : "WebGL 2";
			const context = renderer.getContext();
			this.maxTextureSize =
				this.backend === "WebGPU"
					? ((context as GPUCanvasContext).getConfiguration()?.device.limits
							.maxTextureDimension2D ?? 8192)
					: (context as WebGL2RenderingContext).getParameter(
							(context as WebGL2RenderingContext).MAX_TEXTURE_SIZE,
						);
			renderer.autoClear = false;
			renderer.info.autoReset = false;
			renderer.toneMapping = NoToneMapping;
			this.camera.position.z = 1;
			const world = uv()
				.sub(0.5)
				.mul(this.viewport)
				.div(this.scale)
				.mul(vec2(this.mirror, -1))
				.add(this.center);
			const gridDistance = world
				.div(this.gridStep)
				.sub(world.div(this.gridStep).round())
				.abs()
				.mul(this.gridStep)
				.mul(this.scale);
			const dot = float(1)
				.sub(gridDistance.length().smoothstep(0.4, 1.2))
				.mul(0.2);
			const axis = float(1)
				.sub(
					world.x.abs().min(world.y.abs()).mul(this.scale).smoothstep(0.2, 0.9),
				)
				.mul(0.14);
			this.backgroundMaterial.fragmentNode = vec4(
				mix(
					this.backgroundColor,
					uniform(new Color("#8fb0b3")),
					dot.max(axis).mul(this.showGrid),
				),
				1,
			);
			const mask = texture(this.mask.texture);
			// Derive edges from the final mask to preserve holes and shape unions.
			const step = this.outlineStep;
			const interior = mask.r
				.min(texture(this.mask.texture, uv().add(vec2(step.x, 0))).r)
				.min(texture(this.mask.texture, uv().sub(vec2(step.x, 0))).r)
				.min(texture(this.mask.texture, uv().add(vec2(0, step.y))).r)
				.min(texture(this.mask.texture, uv().sub(vec2(0, step.y))).r);
			const faded = mask.r
				.mul(UNFOCUSED_OUTLINE_OPACITY)
				.sub(interior.mul(UNFOCUSED_OUTLINE_OPACITY - UNFOCUSED_FILL_OPACITY));
			const alpha = mix(mask.r, faded, this.unfocusedLayer);
			const rgb = this.layerColor
				.mul(mask.r.sub(mask.g))
				.add(this.hoverColor.mul(mask.g))
				.div(mask.r.max(0.00001));
			this.compositeMaterial.fragmentNode = vec4(
				rgb,
				alpha.mul(this.layerOpacity),
			);
			// Additive compositing makes overlapping layers resemble denser film.
			this.xrayMaterial.fragmentNode = vec4(
				this.layerColor,
				alpha.mul(this.layerOpacity),
			);
			this.meshWorker = this.lifecycle.acquire(
				() =>
					new Worker(new URL("./mesh.worker.ts", import.meta.url), {
						type: "module",
					}),
				(worker) => worker.terminate(),
			);
			this.meshWorker.onmessage = (event: MessageEvent<MeshResult>) =>
				this.acceptMesh(event.data);
			this.meshWorker.onerror = (event) =>
				this.reportError(event.message || "Geometry worker failed.");
			renderer.onDeviceLost = (info) => {
				this.lost = true;
				this.reportError(
					`${info.api} device lost: ${info.message}. Reload the viewer to reconnect.`,
				);
			};
			renderer.onError = (error: unknown) => {
				const message =
					typeof error === "object" && error !== null && "message" in error
						? String(error.message)
						: String(error);
				this.reportError(`${this.backend}: ${message}`);
			};
		} catch (error) {
			this.lifecycle.dispose();
			throw error;
		}
	}

	static createEffect(
		canvas: HTMLCanvasElement,
		forceWebGL = false,
	): Effect.Effect<ThreeRenderer, RendererError, Scope.Scope> {
		return Effect.acquireRelease(
			ThreeRenderer.initializeEffect(canvas, forceWebGL),
			(renderer) => renderer.disposeEffect(),
		);
	}

	private static initializeEffect(
		canvas: HTMLCanvasElement,
		forceWebGL: boolean,
	): Effect.Effect<ThreeRenderer, RendererError> {
		return Effect.scoped(
			Effect.gen(function* () {
				const renderer = yield* Effect.acquireRelease(
					Effect.try({
						try: () =>
							new WebGPURenderer({
								canvas,
								forceWebGL,
								alpha: false,
								antialias: false,
								powerPreference: "high-performance",
							}),
						catch: rendererError,
					}),
					(renderer, exit) =>
						Exit.isFailure(exit)
							? Effect.tryPromise(() => renderer.dispose()).pipe(
									Effect.catchAll((error) =>
										Effect.logError("Renderer cleanup failed", error),
									),
								)
							: Effect.void,
				);
				yield* Effect.tryPromise({
					try: () => renderer.init(),
					catch: rendererError,
				});
				// A successful renderer owns its resources until its caller disposes it.
				return yield* Effect.try({
					try: () => new ThreeRenderer(canvas, renderer),
					catch: rendererError,
				});
			}),
		).pipe(Effect.uninterruptible);
	}

	static create(
		canvas: HTMLCanvasElement,
		forceWebGL = false,
	): Promise<ThreeRenderer> {
		return runEffect(ThreeRenderer.initializeEffect(canvas, forceWebGL));
	}

	private reportError(message: string): void {
		if (!this.disposed)
			this.canvas.dispatchEvent(
				new CustomEvent("renderererror", { detail: message }),
			);
	}

	private requestMesh(
		layerId: string,
		layer: LayerMesh,
		includeObjects = false,
	): void {
		if (
			layer.building ||
			layer.failed ||
			layer.tolerance <= layer.requestedTolerance
		)
			return;
		layer.building = true;
		const request: MeshRequest = {
			type: "compile",
			layerId,
			revision: layer.revision,
			tolerance: layer.requestedTolerance,
			...(includeObjects
				? {
						objects: layer.objects.map(({ geometry, transform, polarity }) => ({
							geometry,
							transform,
							polarity,
						})),
					}
				: {}),
		};
		this.meshWorker.postMessage(request);
	}

	private acceptMesh(result: MeshResult): void {
		if (this.disposed || this.lost) return;
		const layer = this.layers.get(result.layerId);
		if (!layer || layer.revision !== result.revision) return;
		layer.building = false;
		if (result.error || !result.vertices) {
			layer.failed = true;
			this.reportError(result.error || "Geometry compilation failed.");
			return;
		}
		const geometry = new BufferGeometry();
		const vertices = new InterleavedBuffer(result.vertices, 4);
		geometry.setAttribute(
			"position",
			new InterleavedBufferAttribute(vertices, 2, 0),
		);
		geometry.setAttribute(
			"coverage",
			new InterleavedBufferAttribute(vertices, 1, 2),
		);
		geometry.setAttribute(
			"objectIndex",
			new InterleavedBufferAttribute(vertices, 1, 3),
		);
		layer.mesh.geometry.dispose();
		layer.mesh.geometry = geometry;
		layer.tolerance = result.tolerance;
		this.canvas.dispatchEvent(new Event("renderinvalidated"));
		this.requestMesh(result.layerId, layer);
	}

	private prepareLayer(source: SceneLayer, tolerance: number): LayerMesh {
		let layer = this.layers.get(source.id);
		if (!layer || layer.objects !== source.objects) {
			if (layer) this.disposeLayer(layer);
			const selectionWidth = Math.min(
				this.maxTextureSize,
				Math.max(1, source.objects.length),
			);
			const selectionHeight = Math.max(
				1,
				Math.ceil(source.objects.length / selectionWidth),
			);
			if (selectionHeight > this.maxTextureSize)
				throw new Error("Too many objects for the selection texture.");
			const selectionFlags = new Float32Array(selectionWidth * selectionHeight);
			const selection = new DataTexture(
				selectionFlags,
				selectionWidth,
				selectionHeight,
				RedFormat,
				FloatType,
			);
			selection.needsUpdate = true;
			const material = Object.assign(new NodeMaterial(), {
				depthTest: false,
				depthWrite: false,
				blending: NoBlending,
				side: DoubleSide,
				toneMapped: false,
			});
			material.positionNode = vec3(attribute("position", "vec2"), 0);
			const objectIndex = attribute("objectIndex", "float").toInt();
			const selected = varying(
				textureLoad(
					selection,
					ivec2(
						objectIndex.mod(int(selectionWidth)),
						objectIndex.div(int(selectionWidth)),
					),
				).r,
			);
			const coverage = attribute("coverage", "float");
			material.fragmentNode = vec4(coverage, coverage.mul(selected), 0, 0);
			const mesh = new Mesh(new BufferGeometry(), material);
			mesh.frustumCulled = false;
			layer = {
				objects: source.objects,
				mesh,
				selection,
				selectionFlags,
				tolerance: Infinity,
				requestedTolerance: tolerance,
				revision: ++this.nextRevision,
				building: false,
				failed: false,
			};
			this.layers.set(source.id, layer);
			this.requestMesh(source.id, layer, true);
		} else {
			layer.requestedTolerance = Math.min(layer.requestedTolerance, tolerance);
			this.requestMesh(source.id, layer);
		}
		return layer;
	}

	render(
		_canvas: HTMLCanvasElement,
		layers: readonly SceneLayer[],
		options: RenderOptions,
	): void {
		if (this.disposed || this.lost || options.width <= 0 || options.height <= 0)
			return;
		const ratio = Math.min(
			options.pixelRatio,
			this.maxTextureSize / Math.max(options.width, options.height),
		);
		const width = Math.max(1, Math.floor(options.width * ratio));
		const height = Math.max(1, Math.floor(options.height * ratio));
		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.renderer.setSize(width, height, false);
		}
		this.mask.setSize(width, height);
		this.outlineStep.value.set(
			(UNFOCUSED_OUTLINE_WIDTH * ratio) / width,
			(UNFOCUSED_OUTLINE_WIDTH * ratio) / height,
		);
		const focused = layers.some(
			(layer) =>
				layer.id === options.focusedLayerId &&
				layer.visible &&
				layer.opacity > 0,
		);
		const halfWidth = options.width / options.camera.scale / 2;
		const halfHeight = options.height / options.camera.scale / 2;
		this.camera.left = -halfWidth * (options.mirrored ? -1 : 1);
		this.camera.right = -this.camera.left;
		this.camera.top = halfHeight;
		this.camera.bottom = -halfHeight;
		this.camera.position.set(options.camera.x, options.camera.y, 1);
		this.camera.updateProjectionMatrix();
		this.backgroundColor.value.set(options.background);
		this.viewport.value.set(options.width, options.height);
		this.center.value.set(options.camera.x, options.camera.y);
		this.scale.value = options.camera.scale;
		this.mirror.value = options.mirrored ? -1 : 1;
		this.gridStep.value = gridSpacing(options.camera.scale);
		this.showGrid.value = options.grid ? 1 : 0;
		this.renderer.info.reset();
		this.renderer.setRenderTarget(null);
		this.quad.material = this.backgroundMaterial;
		this.quad.render(this.renderer);
		const existing = new Set(layers.map((layer) => layer.id));
		for (const [id, layer] of this.layers) {
			if (existing.has(id)) continue;
			this.disposeLayer(layer);
			this.meshWorker.postMessage({
				type: "release",
				layerId: id,
				revision: layer.revision,
			} satisfies MeshRequest);
			this.layers.delete(id);
		}
		try {
			for (const source of layers) {
				if (!source.visible || source.opacity <= 0 || !source.objects.length)
					continue;
				const layer = this.prepareLayer(
					source,
					curveTolerance(options.camera.scale * ratio),
				);
				if (!layer.mesh.geometry.getAttribute("position")?.count) continue;
				if (layer.selectedIds !== options.selectedIds) {
					for (let i = 0; i < source.objects.length; i++)
						layer.selectionFlags[i] = options.selectedIds?.has(
							source.objects[i].id,
						)
							? 1
							: 0;
					layer.selection.needsUpdate = true;
					layer.selectedIds = options.selectedIds;
				}
				this.scene.add(layer.mesh);
				this.renderer.setRenderTarget(this.mask);
				this.renderer.setClearColor(0, 0);
				this.renderer.clear();
				this.renderer.render(this.scene, this.camera);
				this.scene.remove(layer.mesh);
				this.renderer.setRenderTarget(null);
				const unfocused = focused && source.id !== options.focusedLayerId;
				this.layerColor.value.set(
					unfocused ? UNFOCUSED_XRAY_COLOR : source.color,
				);
				this.hoverColor.value.set(hoverLayerColor(source.color));
				this.unfocusedLayer.value = unfocused ? 1 : 0;
				this.layerOpacity.value = Math.max(0, Math.min(1, source.opacity));
				this.quad.material = unfocused
					? this.xrayMaterial
					: this.compositeMaterial;
				this.quad.render(this.renderer);
			}
		} finally {
			this.scene.clear();
			this.renderer.setRenderTarget(null);
		}
	}

	getDiagnostics() {
		const { render, memory } = this.renderer.info;
		return {
			drawCalls: render.drawCalls,
			triangles: render.triangles,
			geometries: memory.geometries,
			textures: memory.textures,
		};
	}

	hitTest(layers: readonly SceneLayer[], point: Point, tolerance: number) {
		return hitTestScene(this.compiler, layers, point, tolerance);
	}

	private disposeLayer(layer: LayerMesh): void {
		layer.mesh.geometry.dispose();
		layer.mesh.material.dispose();
		layer.selection.dispose();
	}

	private disposeEffect(): Effect.Effect<void> {
		return Effect.suspend(() => {
			if (this.disposed) return Effect.void;
			this.disposed = true;
			return Effect.sync(() => this.lifecycle.dispose()).pipe(
				Effect.ensuring(
					Effect.tryPromise(() => this.renderer.dispose()).pipe(
						Effect.catchAll((error) =>
							Effect.logError("Renderer cleanup failed", error),
						),
					),
				),
			);
		});
	}

	dispose(): void {
		Effect.runFork(this.disposeEffect());
	}
}
