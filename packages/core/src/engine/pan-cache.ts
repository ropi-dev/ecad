import {
	Box3,
	type Camera,
	FramebufferTexture,
	Mesh,
	NoBlending,
	type Object3D,
	OrthographicCamera,
	PlaneGeometry,
	Scene,
	ShaderMaterial,
	Vector2,
	Vector4,
	type WebGLRenderer,
} from "three";

/** A camera position and the device pixels per world unit on each axis. */
interface PanFrame {
	x: number;
	y: number;
	width: number;
	height: number;
	scaleX: number;
	scaleY: number;
}

/** Device pixels a strip's viewport extends past its scissor. */
const STRIP_MARGIN = 8;

/** A drawable subtree and its world bounds. */
interface Bounded {
	object: Object3D;
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const drawable = (object: Object3D) =>
	"isMesh" in object ||
	"isLine" in object ||
	"isPoints" in object ||
	"isSprite" in object;

/** Visible drawable subtrees with finite world bounds, found under groups. */
function boundedObjects(scene: Object3D) {
	const found: Bounded[] = [];
	const box = new Box3();
	const visit = (parent: Object3D) => {
		for (const object of parent.children) {
			if (!object.visible) continue;
			if (!drawable(object)) {
				visit(object);
				continue;
			}
			if (!object.frustumCulled) continue;
			box.makeEmpty().expandByObject(object);
			const { min, max } = box;
			if (![min.x, min.y, max.x, max.y].every(Number.isFinite)) continue;
			found.push({
				object,
				minX: min.x,
				minY: min.y,
				maxX: max.x,
				maxY: max.y,
			});
		}
	};
	visit(scene);
	return found;
}

/**
 * The hooks WebGLRenderer calls on the scene it renders. The browser test
 * pages read the camera from `Scene.prototype.onAfterRender`, so a pan frame
 * reports one full view rather than the copy and each strip.
 */
interface SceneHooks {
	onBeforeRender(
		renderer: WebGLRenderer,
		scene: Scene,
		camera: Camera,
		target: null,
	): void;
	onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera): void;
}
const hooks = ["onBeforeRender", "onAfterRender"] as const;
const silenced = new WeakMap<
	Object3D,
	Partial<Pick<Object3D, (typeof hooks)[number]>>
>();
/** Turns off an object's render hooks until `restore`. */
function silence(object: Object3D) {
	const own: Partial<Pick<Object3D, (typeof hooks)[number]>> = {};
	for (const hook of hooks) {
		if (Object.hasOwn(object, hook)) own[hook] = object[hook];
		object[hook] = () => {};
	}
	silenced.set(object, own);
}
function restore(object: Object3D) {
	const own = silenced.get(object);
	if (!own) return;
	silenced.delete(object);
	for (const hook of hooks) {
		const value = own[hook];
		if (value) object[hook] = value;
		else
			delete (object as Partial<Pick<Object3D, (typeof hooks)[number]>>)[hook];
	}
}

const DAMAGE_MARGIN = 4;
const MAX_DAMAGE_RECTS = 8;
const DAMAGE_LIMIT = 0.5;

function damageRects(
	damage: readonly Box3[],
	position: { x: number; y: number },
	{ width, height, scaleX, scaleY }: PanFrame,
) {
	let rects: number[][] = [];
	for (const { min, max } of damage) {
		const left = Math.floor((min.x - position.x) * scaleX + width / 2);
		const right = Math.ceil((max.x - position.x) * scaleX + width / 2);
		const bottom = Math.floor((min.y - position.y) * scaleY + height / 2);
		const top = Math.ceil((max.y - position.y) * scaleY + height / 2);
		const rect = [
			Math.max(0, left - DAMAGE_MARGIN),
			Math.max(0, bottom - DAMAGE_MARGIN),
			Math.min(width, right + DAMAGE_MARGIN),
			Math.min(height, top + DAMAGE_MARGIN),
		];
		if (rect[2] > rect[0] && rect[3] > rect[1]) rects.push(rect);
	}
	if (rects.length > MAX_DAMAGE_RECTS)
		rects = [
			[
				Math.min(...rects.map((rect) => rect[0])),
				Math.min(...rects.map((rect) => rect[1])),
				Math.max(...rects.map((rect) => rect[2])),
				Math.max(...rects.map((rect) => rect[3])),
			],
		];
	const area = rects.reduce(
		(sum, [left, bottom, right, top]) => sum + (right - left) * (top - bottom),
		0,
	);
	if (area > DAMAGE_LIMIT * width * height) return null;
	return rects.map(([left, bottom, right, top]) => [
		left,
		bottom,
		right - left,
		top - bottom,
	]);
}

/**
 * Reuses the last frame while an orthographic top view only translates.
 *
 * After each full render the canvas is copied to a texture. A later frame with
 * the same scale and size shifts that copy by whole device pixels and renders
 * only the strips that scroll into view, so a pan costs a few draw calls
 * instead of one per scene object. The camera is drawn at the nearest whole
 * pixel offset from the cached frame; the returned position is what the frame
 * shows, so overlays can follow it.
 */
export function createPanCache(renderer: WebGLRenderer) {
	let texture: FramebufferTexture | null = null;
	let cached: PanFrame | null = null;
	// Bounds of the scene's subtrees, found on the first pan after a render.
	let bounded: Bounded[] | null = null;
	const hidden: Object3D[] = [];
	// Samples texel centers of a nearest-filtered texture, so the copy keeps
	// every byte. Pixels shifted in from outside are drawn over by the strips.
	const material = new ShaderMaterial({
		uniforms: {
			source: { value: null },
			offset: { value: new Vector2() },
			size: { value: new Vector2(1, 1) },
		},
		vertexShader: /* glsl */ `
			void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
		`,
		fragmentShader: /* glsl */ `
			uniform sampler2D source;
			uniform vec2 offset;
			uniform vec2 size;
			void main() {
				gl_FragColor = texture2D(source, (gl_FragCoord.xy + offset) / size);
			}
		`,
		blending: NoBlending,
		depthTest: false,
		depthWrite: false,
	});
	const quad = new Mesh(new PlaneGeometry(2, 2), material);
	quad.frustumCulled = false;
	const copyScene = new Scene();
	copyScene.add(quad);
	// The copy is not a view of any scene, so it skips scene render hooks.
	copyScene.onBeforeRender = () => {};
	copyScene.onAfterRender = () => {};
	const copyCamera = new OrthographicCamera();
	const stripCamera = new OrthographicCamera();
	const viewport = new Vector4();
	const scissor = new Vector4();

	const frameOf = (camera: OrthographicCamera): PanFrame => {
		const { width, height } = renderer.domElement;
		return {
			x: camera.position.x,
			y: camera.position.y,
			width,
			height,
			scaleX: (width * camera.zoom) / (camera.right - camera.left),
			scaleY: (height * camera.zoom) / (camera.top - camera.bottom),
		};
	};
	/** Sets the drawing buffer viewport in device pixels. */
	/**
	 * Draws to a scissor rectangle in device pixels, with the viewport grown by
	 * `margin` on each side. Points such as grid dots are dropped when their
	 * center leaves the viewport, so the margin keeps dots on a strip's edge.
	 */
	const setViewport = (
		x: number,
		y: number,
		width: number,
		height: number,
		margin = 0,
	) => {
		// Three multiplies by the pixel ratio and floors; a quarter pixel keeps
		// whole device pixels from rounding down.
		const ratio = renderer.getPixelRatio();
		renderer.setViewport(
			(x - margin + 0.25) / ratio,
			(y - margin + 0.25) / ratio,
			(width + 2 * margin + 0.25) / ratio,
			(height + 2 * margin + 0.25) / ratio,
		);
		renderer.setScissor(
			(x + 0.25) / ratio,
			(y + 0.25) / ratio,
			(width + 0.25) / ratio,
			(height + 0.25) / ratio,
		);
	};

	return {
		/** Starts compiling the copy shader, so the first pan doesn't wait on it. */
		prepare() {
			renderer.compile(copyScene, copyCamera);
		},
		invalidate() {
			cached = null;
		},
		/** Keeps the frame just rendered to the canvas for later pans. */
		capture(camera: OrthographicCamera) {
			const { width, height } = renderer.domElement;
			if (
				!texture ||
				texture.image.width !== width ||
				texture.image.height !== height
			) {
				texture?.dispose();
				texture = new FramebufferTexture(width, height);
			}
			renderer.setRenderTarget(null);
			renderer.copyFramebufferToTexture(texture);
			cached = frameOf(camera);
			bounded = null;
		},
		/**
		 * Draws the scene by shifting the cached frame, when the camera has only
		 * moved. Returns the camera position drawn, or null when a full render
		 * is needed. Scene matrices must be current, as after a full render.
		 */
		pan(
			scene: Scene,
			camera: OrthographicCamera,
			prepare?: (position: { x: number; y: number }) => void,
			damage?: readonly Box3[],
		) {
			if (!texture || !cached) return null;
			const next = frameOf(camera);
			if (
				next.width !== cached.width ||
				next.height !== cached.height ||
				next.scaleX !== cached.scaleX ||
				next.scaleY !== cached.scaleY ||
				camera.view?.enabled
			)
				return null;
			// Device pixels the camera moved, right and up.
			const moveX = Math.round((next.x - cached.x) * next.scaleX);
			const moveY = Math.round((next.y - cached.y) * next.scaleY);
			if (Math.abs(moveX) >= next.width || Math.abs(moveY) >= next.height)
				return null;
			const position = {
				x: cached.x + moveX / next.scaleX,
				y: cached.y + moveY / next.scaleY,
			};
			const { width, height } = next;
			const repaint = damage?.length ? damageRects(damage, position, next) : [];
			if (!repaint) return null;
			// The canvas keeps its last frame when nothing is drawn.
			if (moveX === 0 && moveY === 0 && !repaint.length) return position;
			if (damage?.length) bounded = null;
			const autoUpdate = scene.matrixWorldAutoUpdate;
			// Count every pass of this frame, as one full render would.
			const { info } = renderer;
			const autoReset = info.autoReset;
			info.reset();
			info.autoReset = false;
			const scissorTest = renderer.getScissorTest();
			renderer.getViewport(viewport);
			renderer.getScissor(scissor);
			try {
				renderer.setRenderTarget(null);
				renderer.setScissorTest(true);
				setViewport(0, 0, width, height);
				material.uniforms.source.value = texture;
				material.uniforms.offset.value.set(moveX, moveY);
				material.uniforms.size.value.set(width, height);
				renderer.render(copyScene, copyCamera);
				prepare?.(position);
				stripCamera.copy(camera);
				stripCamera.position.set(position.x, position.y, camera.position.z);
				stripCamera.updateMatrixWorld();
				// Scene hooks see one render of the whole view, not each strip.
				(scene as unknown as SceneHooks).onBeforeRender(
					renderer,
					scene,
					stripCamera,
					null,
				);
				silence(scene);
				scene.matrixWorldAutoUpdate = false;
				bounded ??= boundedObjects(scene);
				// World units per device pixel, with a pixel of margin for edges.
				const marginX = 2 / next.scaleX;
				const marginY = 2 / next.scaleY;
				// Strips in drawing buffer pixels, with y up.
				const strips = [
					moveX > 0
						? [width - moveX, 0, moveX, height]
						: [0, 0, -moveX, height],
					moveY > 0 ? [0, height - moveY, width, moveY] : [0, 0, width, -moveY],
					...repaint,
				].filter(([, , stripWidth, stripHeight]) => stripWidth && stripHeight);
				for (const [x, y, stripWidth, stripHeight] of strips) {
					stripCamera.setViewOffset(
						width,
						height,
						x - STRIP_MARGIN,
						height - y - stripHeight - STRIP_MARGIN,
						stripWidth + 2 * STRIP_MARGIN,
						stripHeight + 2 * STRIP_MARGIN,
					);
					setViewport(x, y, stripWidth, stripHeight, STRIP_MARGIN);
					// Hide whole subtrees outside the strip, so Three neither visits
					// nor culls them one object at a time.
					const left = position.x + (x - width / 2) / next.scaleX - marginX;
					const right = left + stripWidth / next.scaleX + 2 * marginX;
					const bottom = position.y + (y - height / 2) / next.scaleY - marginY;
					const top = bottom + stripHeight / next.scaleY + 2 * marginY;
					for (const entry of bounded)
						if (
							entry.maxX < left ||
							entry.minX > right ||
							entry.maxY < bottom ||
							entry.minY > top
						) {
							entry.object.visible = false;
							hidden.push(entry.object);
						}
					try {
						renderer.render(scene, stripCamera);
					} finally {
						for (const object of hidden.splice(0)) object.visible = true;
					}
				}
			} finally {
				restore(scene);
				scene.matrixWorldAutoUpdate = autoUpdate;
				info.autoReset = autoReset;
				renderer.setScissorTest(scissorTest);
				renderer.setViewport(viewport);
				renderer.setScissor(scissor);
			}
			stripCamera.clearViewOffset();
			(scene as unknown as SceneHooks).onAfterRender(
				renderer,
				scene,
				stripCamera,
			);
			renderer.copyFramebufferToTexture(texture);
			cached = { ...next, ...position };
			return position;
		},
		dispose() {
			texture?.dispose();
			texture = null;
			cached = null;
			bounded = null;
			quad.geometry.dispose();
			material.dispose();
		},
	};
}
