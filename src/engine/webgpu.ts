/// <reference types="@webgpu/types" />
import { gridSpacing, parseColor } from "./camera";
import { curveTolerance, GeometryCompiler, hitTestScene } from "./geometry";
import type { MeshRequest, MeshResult } from "./mesh";
import type {
	GraphicsRenderer,
	Point,
	RenderOptions,
	SceneLayer,
	SceneObject,
} from "./types";

const VIEW_WGSL = `
struct View {
  camera: vec4f,
  viewport: vec4f,
  background: vec4f,
  flags: vec4f,
};
@group(0) @binding(0) var<uniform> view: View;
`;

const GEOMETRY_WGSL = `${VIEW_WGSL}
@group(1) @binding(0) var<storage, read> selection: array<f32>;
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) coverage: f32,
  @location(1) @interpolate(flat) selected: f32,
};
@vertex fn vertexMain(@location(0) position: vec2f, @location(1) coverage: f32, @location(2) objectIndex: f32) -> VertexOutput {
  var output: VertexOutput;
  let world = (position - view.camera.xy) * view.camera.z;
  output.position = vec4f(world.x * view.camera.w * 2.0 / view.viewport.x, world.y * 2.0 / view.viewport.y, 0.0, 1.0);
  output.coverage = coverage;
  output.selected = selection[u32(objectIndex)];
  return output;
}
@fragment fn maskMain(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(input.coverage, input.coverage * input.selected, 0.0, 0.0);
}

`;

const FULLSCREEN_WGSL = `
struct QuadOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> QuadOutput {
  let uv = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var output: QuadOutput;
  output.position = vec4f(uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  output.uv = uv;
  return output;
}
`;

const BACKGROUND_WGSL = `${VIEW_WGSL}${FULLSCREEN_WGSL}
@fragment fn fragmentMain(input: QuadOutput) -> @location(0) vec4f {
  var color = view.background.rgb;
  if (view.flags.x > 0.5) {
    let pixel = input.uv * view.viewport.xy;
    let world = view.camera.xy + (pixel - view.viewport.xy * 0.5) / view.camera.z * vec2f(view.camera.w, -1.0);
    let step = view.viewport.w;
    let gridDistance = abs(world / step - round(world / step)) * step * view.camera.z;
    let dot = (1.0 - smoothstep(0.4, 1.2, length(gridDistance))) * 0.20;
    let axisDistance = min(abs(world.x), abs(world.y)) * view.camera.z;
    let axis = (1.0 - smoothstep(0.2, 0.9, axisDistance)) * 0.14;
    color = mix(color, vec3f(0.56, 0.69, 0.70), max(dot, axis));
  }
  return vec4f(color, 1.0);
}
`;

const COMPOSITE_WGSL = `${FULLSCREEN_WGSL}
@group(0) @binding(0) var coverageTexture: texture_2d<f32>;
@group(0) @binding(1) var coverageSampler: sampler;
@group(0) @binding(2) var<uniform> color: vec4f;
@fragment fn fragmentMain(input: QuadOutput) -> @location(0) vec4f {
  let mask = textureSample(coverageTexture, coverageSampler, input.uv).rg;
  let rgb = color.rgb * (mask.r - mask.g) + vec3f(mask.g);
  return vec4f(rgb * color.a, mask.r * color.a);
}
`;

interface LayerBuffers {
	objects: SceneObject[];
	tolerance: number;
	vertices: GPUBuffer;
	count: number;
	color: GPUBuffer;
	selection: GPUBuffer;
	selectionBindGroup: GPUBindGroup;
	selectionFlags: Float32Array<ArrayBuffer>;
	selectedIds?: ReadonlySet<string>;
	revision: number;
	building: boolean;
	failed: boolean;
	requestedTolerance: number;
}

/** GPU triangle rasterization and ordered, isolated layer compositing. */
export class WebGPURenderer implements GraphicsRenderer {
	private compiler = new GeometryCompiler();
	private layers = new Map<string, LayerBuffers>();
	private meshWorker: Worker;
	private nextRevision = 0;
	private maskTexture?: GPUTexture;
	private multisampleTexture?: GPUTexture;
	private maskView?: GPUTextureView;
	private multisampleView?: GPUTextureView;
	private width = 0;
	private height = 0;
	private lost = false;
	private disposed = false;
	private viewBuffer: GPUBuffer;
	private viewLayout: GPUBindGroupLayout;
	private viewBindGroup: GPUBindGroup;
	private maskPipeline!: GPURenderPipeline;
	private backgroundPipeline!: GPURenderPipeline;
	private compositePipeline!: GPURenderPipeline;
	private sampler: GPUSampler;

	private constructor(
		private canvas: HTMLCanvasElement,
		private device: GPUDevice,
		private context: GPUCanvasContext,
		private format: GPUTextureFormat,
	) {
		this.meshWorker = new Worker(new URL("./mesh.worker.ts", import.meta.url), {
			type: "module",
		});
		this.meshWorker.onmessage = (event: MessageEvent<MeshResult>) =>
			this.acceptMesh(event.data);
		this.meshWorker.onerror = (event) => {
			if (!this.disposed)
				this.canvas.dispatchEvent(
					new CustomEvent("renderererror", {
						detail: event.message || "Geometry worker failed.",
					}),
				);
		};
		this.viewBuffer = device.createBuffer({
			label: "Camera and grid",
			size: 64,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		this.viewLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});
		this.viewBindGroup = device.createBindGroup({
			layout: this.viewLayout,
			entries: [{ binding: 0, resource: { buffer: this.viewBuffer } }],
		});
		this.sampler = device.createSampler({
			magFilter: "linear",
			minFilter: "linear",
		});
		void device.lost.then((info) => {
			this.lost = true;
			if (!this.disposed)
				canvas.dispatchEvent(
					new CustomEvent("renderererror", {
						detail: `WebGPU device lost: ${info.message || info.reason}. Reload the viewer to reconnect.`,
					}),
				);
		});
		device.addEventListener("uncapturederror", (event) => {
			if (!this.disposed)
				canvas.dispatchEvent(
					new CustomEvent("renderererror", {
						detail: `WebGPU: ${event.error.message}`,
					}),
				);
		});
	}

	static async create(
		canvas: HTMLCanvasElement,
		adapter: GPUAdapter,
	): Promise<WebGPURenderer> {
		const device = await adapter.requestDevice();
		// Compile all pipelines before claiming this canvas, so initialization failures can use 2D.
		const format = navigator.gpu.getPreferredCanvasFormat();
		const geometryModule = device.createShaderModule({
			label: "Vector geometry",
			code: GEOMETRY_WGSL,
		});
		const backgroundModule = device.createShaderModule({
			label: "World grid",
			code: BACKGROUND_WGSL,
		});
		const compositeModule = device.createShaderModule({
			label: "Layer compositor",
			code: COMPOSITE_WGSL,
		});
		const viewLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});
		const layout = device.createPipelineLayout({
			bindGroupLayouts: [viewLayout],
		});
		const selectionLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX,
					buffer: { type: "read-only-storage" },
				},
			],
		});
		const geometryLayout = device.createPipelineLayout({
			bindGroupLayouts: [viewLayout, selectionLayout],
		});
		const vertex: GPUVertexState = {
			module: geometryModule,
			entryPoint: "vertexMain",
			buffers: [
				{
					arrayStride: 16,
					attributes: [
						{ shaderLocation: 0, offset: 0, format: "float32x2" },
						{ shaderLocation: 1, offset: 8, format: "float32" },
						{ shaderLocation: 2, offset: 12, format: "float32" },
					],
				},
			],
		};
		try {
			const [maskPipeline, backgroundPipeline, compositePipeline] =
				await Promise.all([
					device.createRenderPipelineAsync({
						label: "Ordered dark and clear geometry",
						layout: geometryLayout,
						vertex,
						fragment: {
							module: geometryModule,
							entryPoint: "maskMain",
							targets: [{ format: "rgba8unorm" }],
						},
						primitive: { topology: "triangle-list" },
						multisample: { count: 4 },
					}),
					device.createRenderPipelineAsync({
						label: "Background and millimetre grid",
						layout,
						vertex: { module: backgroundModule, entryPoint: "vertexMain" },
						fragment: {
							module: backgroundModule,
							entryPoint: "fragmentMain",
							targets: [{ format }],
						},
					}),
					device.createRenderPipelineAsync({
						label: "Layer color and opacity",
						layout: "auto",
						vertex: { module: compositeModule, entryPoint: "vertexMain" },
						fragment: {
							module: compositeModule,
							entryPoint: "fragmentMain",
							targets: [
								{
									format,
									blend: {
										color: {
											srcFactor: "one",
											dstFactor: "one-minus-src-alpha",
										},
										alpha: {
											srcFactor: "one",
											dstFactor: "one-minus-src-alpha",
										},
									},
								},
							],
						},
					}),
				]);
			const context = canvas.getContext("webgpu");
			if (!context)
				throw new Error("This canvas does not support a WebGPU context.");
			const renderer = new WebGPURenderer(canvas, device, context, format);
			renderer.maskPipeline = maskPipeline;
			renderer.backgroundPipeline = backgroundPipeline;
			renderer.compositePipeline = compositePipeline;
			return renderer;
		} catch (error) {
			device.destroy();
			throw error;
		}
	}

	private resize(width: number, height: number): void {
		if (this.width === width && this.height === height) return;
		this.width = width;
		this.height = height;
		this.canvas.width = width;
		this.canvas.height = height;
		this.maskTexture?.destroy();
		this.multisampleTexture?.destroy();
		this.maskTexture = this.device.createTexture({
			label: "Isolated layer coverage",
			size: [width, height],
			format: "rgba8unorm",
			usage:
				GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		this.multisampleTexture = this.device.createTexture({
			label: "Four sample vector coverage",
			size: [width, height],
			format: "rgba8unorm",
			sampleCount: 4,
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});
		this.maskView = this.maskTexture.createView();
		this.multisampleView = this.multisampleTexture.createView();
	}

	private requestMesh(
		layerId: string,
		buffers: LayerBuffers,
		includeObjects = false,
	): void {
		if (
			buffers.building ||
			buffers.failed ||
			buffers.tolerance <= buffers.requestedTolerance
		)
			return;
		buffers.building = true;
		const request: MeshRequest = {
			type: "compile",
			layerId,
			revision: buffers.revision,
			tolerance: buffers.requestedTolerance,
			...(includeObjects
				? {
						objects: buffers.objects.map(
							({ geometry, transform, polarity }) => ({
								geometry,
								transform,
								polarity,
							}),
						),
					}
				: {}),
		};
		this.meshWorker.postMessage(request);
	}

	private acceptMesh(result: MeshResult): void {
		if (this.disposed || this.lost) return;
		const buffers = this.layers.get(result.layerId);
		if (!buffers || buffers.revision !== result.revision) return;
		buffers.building = false;
		if (result.error || !result.vertices) {
			buffers.failed = true;
			this.canvas.dispatchEvent(
				new CustomEvent("renderererror", {
					detail: result.error || "Geometry compilation failed.",
				}),
			);
			return;
		}
		const data = result.vertices;
		const vertices = this.device.createBuffer({
			size: Math.max(12, data.byteLength),
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		});
		if (data.byteLength)
			this.device.queue.writeBuffer(
				vertices,
				0,
				data as Float32Array<ArrayBuffer>,
			);
		buffers.vertices.destroy();
		buffers.vertices = vertices;
		buffers.count = data.length / 4;
		buffers.tolerance = result.tolerance;
		this.canvas.dispatchEvent(new Event("renderinvalidated"));
		// At most one job per layer is in flight. Skip intermediate zoom levels.
		this.requestMesh(result.layerId, buffers);
	}

	private prepareLayer(layer: SceneLayer, tolerance: number): LayerBuffers {
		let buffers = this.layers.get(layer.id);
		if (!buffers || buffers.objects !== layer.objects) {
			buffers?.vertices.destroy();
			buffers?.color.destroy();
			buffers?.selection.destroy();
			const selection = this.device.createBuffer({
				size: Math.max(4, layer.objects.length * 4),
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			});
			buffers = {
				objects: layer.objects,
				selection,
				selectionFlags: new Float32Array(layer.objects.length),
				selectionBindGroup: this.device.createBindGroup({
					layout: this.maskPipeline.getBindGroupLayout(1),
					entries: [{ binding: 0, resource: { buffer: selection } }],
				}),
				tolerance: Infinity,
				requestedTolerance: tolerance,
				revision: ++this.nextRevision,
				building: false,
				failed: false,
				count: 0,
				vertices: this.device.createBuffer({
					size: 12,
					usage: GPUBufferUsage.VERTEX,
				}),
				color: this.device.createBuffer({
					size: 16,
					usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
				}),
			};
			this.layers.set(layer.id, buffers);
			this.requestMesh(layer.id, buffers, true);
		} else {
			buffers.requestedTolerance = Math.min(
				buffers.requestedTolerance,
				tolerance,
			);
			this.requestMesh(layer.id, buffers);
		}
		return buffers;
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
			this.device.limits.maxTextureDimension2D /
				Math.max(options.width, options.height),
		);
		this.resize(
			Math.max(1, Math.round(options.width * ratio)),
			Math.max(1, Math.round(options.height * ratio)),
		);
		// Async initialization can overlap during React remounts or hot reloads. Only
		// a renderer that actually draws claims the shared canvas context.
		if (this.context.getConfiguration?.()?.device !== this.device)
			this.context.configure({
				device: this.device,
				format: this.format,
				alphaMode: "opaque",
			});
		const { camera } = options;
		const uniforms = new Float32Array([
			camera.x,
			camera.y,
			camera.scale,
			options.mirrored ? -1 : 1,
			options.width,
			options.height,
			ratio,
			gridSpacing(camera.scale),
			...parseColor(options.background),
			options.grid ? 1 : 0,
			0,
			0,
			0,
		]);
		this.device.queue.writeBuffer(this.viewBuffer, 0, uniforms);
		const encoder = this.device.createCommandEncoder({ label: "CAD frame" });
		const output = this.context.getCurrentTexture().createView();
		const background = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: output,
					clearValue: parseColor(options.background),
					loadOp: "clear",
					storeOp: "store",
				},
			],
		});
		background.setPipeline(this.backgroundPipeline);
		background.setBindGroup(0, this.viewBindGroup);
		background.draw(3);
		background.end();
		const existing = new Set(layers.map((layer) => layer.id));
		for (const [id, buffers] of this.layers)
			if (!existing.has(id)) {
				buffers.vertices.destroy();
				buffers.color.destroy();
				buffers.selection.destroy();
				const release: MeshRequest = {
					type: "release",
					layerId: id,
					revision: buffers.revision,
				};
				this.meshWorker.postMessage(release);
				this.layers.delete(id);
			}
		for (const layer of layers) {
			if (!layer.visible || layer.opacity <= 0 || !layer.objects.length)
				continue;
			const buffers = this.prepareLayer(
				layer,
				curveTolerance(camera.scale * ratio),
			);
			if (!buffers.count) continue;
			if (buffers.selectedIds !== options.selectedIds) {
				for (let i = 0; i < layer.objects.length; i++)
					buffers.selectionFlags[i] = options.selectedIds?.has(
						layer.objects[i].id,
					)
						? 1
						: 0;
				this.device.queue.writeBuffer(
					buffers.selection,
					0,
					buffers.selectionFlags,
				);
				buffers.selectedIds = options.selectedIds;
			}
			const mask = encoder.beginRenderPass({
				label: layer.name,
				colorAttachments: [
					{
						view: this.multisampleView!,
						resolveTarget: this.maskView!,
						clearValue: [0, 0, 0, 0],
						loadOp: "clear",
						storeOp: "discard",
					},
				],
			});
			mask.setPipeline(this.maskPipeline);
			mask.setBindGroup(0, this.viewBindGroup);
			mask.setBindGroup(1, buffers.selectionBindGroup);
			mask.setVertexBuffer(0, buffers.vertices);
			mask.draw(buffers.count);
			mask.end();
			const color = parseColor(layer.color);
			color[3] = Math.max(0, Math.min(1, layer.opacity));
			this.device.queue.writeBuffer(buffers.color, 0, new Float32Array(color));
			const bindGroup = this.device.createBindGroup({
				layout: this.compositePipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: this.maskView! },
					{ binding: 1, resource: this.sampler },
					{ binding: 2, resource: { buffer: buffers.color } },
				],
			});
			const composite = encoder.beginRenderPass({
				colorAttachments: [{ view: output, loadOp: "load", storeOp: "store" }],
			});
			composite.setPipeline(this.compositePipeline);
			composite.setBindGroup(0, bindGroup);
			composite.draw(3);
			composite.end();
		}
		this.device.queue.submit([encoder.finish()]);
	}

	hitTest(layers: readonly SceneLayer[], point: Point, tolerance: number) {
		return hitTestScene(this.compiler, layers, point, tolerance);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.meshWorker.terminate();
		for (const buffers of this.layers.values()) {
			buffers.vertices.destroy();
			buffers.color.destroy();
			buffers.selection.destroy();
		}
		this.layers.clear();
		this.viewBuffer.destroy();
		this.maskTexture?.destroy();
		this.multisampleTexture?.destroy();
		if (this.context.getConfiguration?.()?.device === this.device)
			this.context.unconfigure();
		this.device.destroy();
	}
}
