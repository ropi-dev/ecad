import {
	BufferAttribute,
	BufferGeometry,
	type Camera,
	Color,
	CustomBlending,
	DoubleSide,
	Mesh,
	OneFactor,
	OneMinusSrcAlphaFactor,
	PlaneGeometry,
	Points,
	type Scene,
	ShaderMaterial,
	Sphere,
	SrcAlphaFactor,
	Vector2,
	Vector4,
	type WebGLRenderer,
} from "three";
import { gridLayers } from "#/engine/ruler.ts";
import type { Bounds } from "#/engine/types.ts";

export interface ViewportGridOptions {
	unit: "mm" | "mil";
	color: string;
	/** Full opacity inside these world bounds and 30% outside. */
	bounds?: Bounds;
}

const OUTSIDE_OPACITY = 0.3;
/** Dots closer than this, in drawing buffer pixels, would only blur together. */
const MINIMUM_CELL = 2;
/** Most dots a frame draws, so a degenerate view can't flood the GPU. */
const MAXIMUM_DOTS = 1 << 20;

/**
 * Dots at every minor ruler spacing, drawn under the scene as one point per
 * dot, so only the pixels around each dot run the fragment shader.
 *
 * Dot positions are window coordinates, so the grid stays exact in partial
 * renders such as the strips a pan draws.
 */
export function createViewportGrid() {
	const material = new ShaderMaterial({
		uniforms: {
			color: { value: new Color() },
			// Per layer, in drawing buffer pixels: the dot spacing, the first dot
			// drawn in the current viewport, and dots per row.
			cellA: { value: new Vector2(1, 1) },
			cellB: { value: new Vector2(1, 1) },
			startA: { value: new Vector2() },
			startB: { value: new Vector2() },
			columns: { value: new Vector2(1, 1) },
			countA: { value: 0 },
			opacity: { value: new Vector2() },
			radius: { value: 1 },
			bounds: { value: new Vector4() },
			outside: { value: 1 },
			// The viewport of the current render, which may be a pan strip.
			viewport: { value: new Vector4(0, 0, 1, 1) },
		},
		vertexShader: /* glsl */ `
			uniform vec2 cellA;
			uniform vec2 cellB;
			uniform vec2 startA;
			uniform vec2 startB;
			uniform vec2 columns;
			uniform float countA;
			uniform vec2 opacity;
			uniform float radius;
			uniform vec4 viewport;
			flat out vec2 center;
			flat out float strength;
			void main() {
				float index = float(gl_VertexID);
				bool second = index >= countA;
				float local = second ? index - countA : index;
				float perRow = second ? columns.y : columns.x;
				float row = floor(local / perRow);
				vec2 cell = second ? cellB : cellA;
				center = (second ? startB : startA) +
					vec2(local - row * perRow, row) * cell;
				strength = second ? opacity.y : opacity.x;
				gl_Position = vec4((center - viewport.xy) / viewport.zw * 2.0 - 1.0, 0.0, 1.0);
				gl_PointSize = 2.0 * ceil(radius + 1.0);
			}
		`,
		fragmentShader: /* glsl */ `
			uniform vec3 color;
			uniform float radius;
			uniform vec4 bounds;
			uniform float outside;
			flat in vec2 center;
			flat in float strength;
			void main() {
				vec2 pixel = gl_FragCoord.xy;
				float alpha = strength *
					clamp(radius + 0.5 - length(pixel - center), 0.0, 1.0);
				bool inside = all(greaterThanEqual(pixel, bounds.xy)) &&
					all(lessThanEqual(pixel, bounds.zw));
				alpha *= inside ? 1.0 : outside;
				if (alpha <= 0.0) discard;
				gl_FragColor = vec4(color, alpha);
			}
		`,
		// Opaque in Three's sort, so it draws before the scene, but blended.
		transparent: false,
		blending: CustomBlending,
		blendSrc: SrcAlphaFactor,
		blendDst: OneMinusSrcAlphaFactor,
		blendSrcAlpha: OneFactor,
		blendDstAlpha: OneMinusSrcAlphaFactor,
		depthTest: false,
		depthWrite: false,
	});
	const { uniforms } = material;
	const geometry = new BufferGeometry();
	// The vertex buffer holds no positions, so Three must not derive bounds
	// from it when sorting.
	geometry.boundingSphere = new Sphere();
	const points = new Points(geometry, material);
	points.name = "viewport-grid";
	points.frustumCulled = false;
	points.renderOrder = Number.MIN_SAFE_INTEGER;
	points.visible = false;
	/** Each layer's dot spacing and the position of one dot, in buffer pixels. */
	const layers = [
		{ cell: uniforms.cellA.value, phase: new Vector2(), used: false },
		{ cell: uniforms.cellB.value, phase: new Vector2(), used: false },
	];
	const starts = [uniforms.startA.value, uniforms.startB.value];
	// Only the dots in the current viewport are drawn, so a pan strip draws
	// few of them.
	points.onBeforeRender = (renderer) => {
		const viewport = renderer.getCurrentViewport(uniforms.viewport.value);
		let total = 0;
		layers.forEach(({ cell, phase, used }, index) => {
			const start = starts[index];
			start.set(
				phase.x + cell.x * (Math.floor((viewport.x - phase.x) / cell.x) - 1),
				phase.y + cell.y * (Math.floor((viewport.y - phase.y) / cell.y) - 1),
			);
			const columns = used ? Math.ceil(viewport.z / cell.x) + 3 : 0;
			const rows = used ? Math.ceil(viewport.w / cell.y) + 3 : 0;
			uniforms.columns.value.setComponent(index, Math.max(columns, 1));
			if (index === 0) uniforms.countA.value = columns * rows;
			total += columns * rows;
		});
		geometry.setDrawRange(0, Math.min(total, capacity));
		material.uniformsNeedUpdate = true;
	};
	let capacity = 0;
	/** Sizes the vertex buffer; positions come from the vertex index. */
	const reserve = (count: number) => {
		if (capacity >= Math.min(count, MAXIMUM_DOTS)) return;
		capacity = Math.min(Math.ceil(count * 1.5), MAXIMUM_DOTS);
		geometry.dispose();
		geometry.setAttribute(
			"position",
			// One byte per dot only sets the vertex count.
			new BufferAttribute(new Uint8Array(capacity), 1),
		);
	};
	let options: ViewportGridOptions | null = null;

	return {
		object: points,
		/**
		 * Starts compiling the grid's shader before the first frame. Asking for
		 * its status would wait on the GPU process, so this doesn't.
		 */
		prepare(renderer: WebGLRenderer, camera: Camera, scene: Scene) {
			renderer.compile(points, camera, scene);
		},
		set(next: ViewportGridOptions | null) {
			options = next;
			points.visible = next !== null;
			// Colors are given in display values, so skip color management.
			if (next) uniforms.color.value.setStyle(next.color, "");
		},
		/**
		 * Places the dots for a view of the drawing plane centered on `position`.
		 * `width` and `height` are the drawing buffer size, `scaleX` and
		 * `scaleY` its pixels per world unit, `ratio` its device pixels per CSS
		 * pixel and `rulerScale` the CSS pixels per world unit the rulers show.
		 */
		update({
			position,
			width,
			height,
			scaleX,
			scaleY,
			ratio,
			rulerScale,
		}: {
			position: { x: number; y: number };
			width: number;
			height: number;
			scaleX: number;
			scaleY: number;
			ratio: number;
			rulerScale: number;
		}) {
			if (!options) return;
			const screenX = (x: number) => width / 2 + (x - position.x) * scaleX;
			const screenY = (y: number) => height / 2 + (y - position.y) * scaleY;
			// Match the rulers, which pick layers from CSS pixels per world unit.
			const [first, second] = gridLayers(rulerScale, options.unit);
			let count = 0;
			[first, second].forEach((layer, index) => {
				const { cell, phase } = layers[index];
				layers[index].used = false;
				if (!layer) return;
				cell.set(layer.spacing.minor * scaleX, layer.spacing.minor * scaleY);
				// A canvas not yet sized can map a layer to a fraction of a pixel.
				if (!(cell.x >= MINIMUM_CELL && cell.y >= MINIMUM_CELL)) return;
				layers[index].used = true;
				phase.set(screenX(0), screenY(0));
				// Room for a whole view plus the margin a pan strip adds.
				count +=
					(Math.ceil((width + 32) / cell.x) + 3) *
					(Math.ceil((height + 32) / cell.y) + 3);
			});
			reserve(count);
			if (!first) return;
			uniforms.opacity.value.set(first.opacity, second?.opacity ?? 0);
			uniforms.radius.value = ratio;
			const { bounds } = options;
			if (bounds) {
				uniforms.bounds.value.set(
					screenX(bounds.minX),
					screenY(bounds.minY),
					screenX(bounds.maxX),
					screenY(bounds.maxY),
				);
				uniforms.outside.value = OUTSIDE_OPACITY;
			} else {
				uniforms.bounds.value.set(-1e9, -1e9, 1e9, 1e9);
				uniforms.outside.value = 1;
			}
		},
		dispose() {
			geometry.dispose();
			material.dispose();
		},
	};
}

export function createPlaneGrid() {
	const material = new ShaderMaterial({
		uniforms: {
			color: { value: new Color() },
			spacing: { value: new Vector2(1, 1) },
			opacity: { value: new Vector2() },
			radius: { value: 1 },
			bounds: { value: new Vector4(-1e9, -1e9, 1e9, 1e9) },
			outside: { value: 1 },
		},
		vertexShader: /* glsl */ `
			varying vec2 world;
			void main() {
				vec4 worldPosition = modelMatrix * vec4(position, 1.0);
				world = worldPosition.xy;
				gl_Position = projectionMatrix * viewMatrix * worldPosition;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform vec3 color;
			uniform vec2 spacing;
			uniform vec2 opacity;
			uniform float radius;
			uniform vec4 bounds;
			uniform float outside;
			varying vec2 world;
			float dots(float cell) {
				vec2 perPixel = max(fwidth(world), vec2(1e-9));
				float cellPixels = cell / max(perPixel.x, perPixel.y);
				float across = length(dFdx(world));
				float along = length(dFdy(world));
				float stretch = max(across, along) / max(min(across, along), 1e-9);
				float fade = clamp(cellPixels - ${MINIMUM_CELL.toFixed(1)}, 0.0, 1.0) *
					clamp((6.0 - stretch) / 3.0, 0.0, 1.0);
				vec2 offset = (fract(world / cell + 0.5) - 0.5) * cell / perPixel;
				return fade * clamp(radius + 0.5 - length(offset), 0.0, 1.0);
			}
			void main() {
				float alpha = max(opacity.x * dots(spacing.x), opacity.y * dots(spacing.y));
				bool inside = all(greaterThanEqual(world, bounds.xy)) &&
					all(lessThanEqual(world, bounds.zw));
				alpha *= inside ? 1.0 : outside;
				if (alpha <= 0.0) discard;
				gl_FragColor = vec4(color, alpha);
			}
		`,
		transparent: false,
		blending: CustomBlending,
		blendSrc: SrcAlphaFactor,
		blendDst: OneMinusSrcAlphaFactor,
		blendSrcAlpha: OneFactor,
		blendDstAlpha: OneMinusSrcAlphaFactor,
		depthTest: false,
		depthWrite: false,
		side: DoubleSide,
	});
	const { uniforms } = material;
	const plane = new Mesh(new PlaneGeometry(1, 1), material);
	plane.name = "viewport-plane-grid";
	plane.frustumCulled = false;
	plane.renderOrder = Number.MIN_SAFE_INTEGER;
	plane.visible = false;
	let options: ViewportGridOptions | null = null;
	let shown = false;
	return {
		object: plane,
		set(next: ViewportGridOptions | null) {
			options = next;
			plane.visible = shown && next !== null;
			if (next) uniforms.color.value.setStyle(next.color, "");
		},
		show(visible: boolean) {
			shown = visible;
			plane.visible = visible && options !== null;
		},
		update({
			center,
			extent,
			rulerScale,
			ratio,
		}: {
			center: { x: number; y: number; z: number };
			extent: number;
			rulerScale: number;
			ratio: number;
		}) {
			if (!options) return;
			plane.position.set(center.x, center.y, center.z);
			plane.scale.set(extent, extent, 1);
			const [first, second] = gridLayers(rulerScale, options.unit);
			uniforms.spacing.value.set(
				first?.spacing.minor ?? 1,
				second?.spacing.minor ?? first?.spacing.minor ?? 1,
			);
			uniforms.opacity.value.set(first?.opacity ?? 0, second?.opacity ?? 0);
			uniforms.radius.value = ratio;
			const { bounds } = options;
			if (bounds) {
				uniforms.bounds.value.set(
					bounds.minX,
					bounds.minY,
					bounds.maxX,
					bounds.maxY,
				);
				uniforms.outside.value = OUTSIDE_OPACITY;
			} else {
				uniforms.bounds.value.set(-1e9, -1e9, 1e9, 1e9);
				uniforms.outside.value = 1;
			}
		},
		dispose() {
			plane.geometry.dispose();
			material.dispose();
		},
	};
}
