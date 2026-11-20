import {
	OrthographicCamera,
	type PerspectiveCamera,
	Quaternion,
	TOUCH,
	Vector3,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
	isMouseWheel,
	mouseWheelSteps,
	wheelDelta,
} from "#/engine/navigation.ts";

const UNLOCK_DISTANCE = 4;
const MOUSE_WHEEL_ZOOM = 1.15;

export type OrbitGesture = "shift" | "alt-shift";

export function create3DControls(
	camera: PerspectiveCamera | OrthographicCamera,
	canvas: HTMLElement,
	fit: () => void,
	{
		lockTop = false,
		unlock,
		unlockGesture = "shift",
		focus,
		onFocus,
	}: {
		lockTop?: boolean;
		unlock?: () => boolean;
		unlockGesture?: OrbitGesture;
		focus?: (clientX: number, clientY: number) => Vector3 | null;
		onFocus?: (point: Vector3 | null) => void;
	} = {},
) {
	const controls = new OrbitControls(camera, null);
	controls.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: null };
	controls.zoomToCursor = true;
	controls.touches.ONE = null;
	const panFirst = lockTop;
	let rotationLocked = lockTop;
	const setRotationLocked = (locked: boolean) => {
		rotationLocked = locked;
		if (!panFirst) return;
		controls.enableRotate = false;
		controls.minPolarAngle = locked ? Math.PI / 2 : 0;
		controls.maxPolarAngle = locked ? Math.PI / 2 : Math.PI;
		controls.minAzimuthAngle = locked ? 0 : Number.NEGATIVE_INFINITY;
		controls.maxAzimuthAngle = locked ? 0 : Number.POSITIVE_INFINITY;
		controls.touches.ONE = locked ? TOUCH.PAN : null;
	};
	setRotationLocked(lockTop);
	const pointers = new Map<number, { x: number; y: number; touch: boolean }>();
	let orbitPointer: number | null = null;
	let orbitRequiresAlt = false;
	let panPointer: number | null = null;
	let pivot: Vector3 | null = null;
	let gestureStart: { x: number; y: number } | null = null;
	let lastWheel = Number.NEGATIVE_INFINITY;
	let lastWheelMode: "zoom" | "pan" | "orbit" | null = null;
	let wheelTravel = 0;
	let wheelEnd: ReturnType<typeof setTimeout> | undefined;
	let focusShown = false;
	const showFocus = () => {
		if (!pivot || focusShown) return;
		focusShown = true;
		onFocus?.(pivot);
	};
	const hideFocus = () => {
		if (!focusShown) return;
		focusShown = false;
		onFocus?.(null);
	};
	const beginGesture = (clientX: number, clientY: number) => {
		gestureStart = { x: clientX, y: clientY };
		hideFocus();
		pivot = focus?.(clientX, clientY) ?? null;
		if (!pivot) return;
		const camera = controls.object;
		const forward = camera.getWorldDirection(new Vector3());
		const depth = pivot.clone().sub(camera.position).dot(forward);
		if (depth < controls.minDistance || depth > controls.maxDistance) return;
		controls.target.copy(camera.position).addScaledVector(forward, depth);
	};
	const panRight = new Vector3();
	const panUp = new Vector3();
	const panOffset = new Vector3();
	const pan = (deltaX: number, deltaY: number) => {
		if (!controls.enabled || !controls.enablePan) return;
		if (deltaX === 0 && deltaY === 0) return;
		const camera = controls.object;
		camera.updateMatrixWorld();
		panRight.setFromMatrixColumn(camera.matrix, 0);
		panUp.setFromMatrixColumn(camera.matrix, 1);
		panOffset.set(0, 0, 0);
		const speed = controls.panSpeed;
		if (camera instanceof OrthographicCamera) {
			panOffset
				.addScaledVector(
					panRight,
					(-deltaX * speed * (camera.right - camera.left)) /
						camera.zoom /
						Math.max(canvas.clientWidth, 1),
				)
				.addScaledVector(
					panUp,
					(deltaY * speed * (camera.top - camera.bottom)) /
						camera.zoom /
						Math.max(canvas.clientHeight, 1),
				);
		} else {
			const targetDistance =
				camera.position.distanceTo(controls.target) *
				Math.tan(((camera.fov / 2) * Math.PI) / 180);
			const scale =
				(2 * targetDistance * speed) / Math.max(canvas.clientHeight, 1);
			panOffset
				.addScaledVector(panRight, -deltaX * scale)
				.addScaledVector(panUp, deltaY * scale);
		}
		camera.position.add(panOffset);
		controls.target.add(panOffset);
		camera.updateMatrixWorld();
		controls.dispatchEvent({ type: "change" });
	};
	const zoomAt = (clientX: number, clientY: number, factor: number) => {
		if (!controls.enabled || !controls.enableZoom) return;
		if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
		const camera = controls.object;
		camera.updateMatrixWorld();
		const rect = canvas.getBoundingClientRect();
		const ndcX = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
		const ndcY = -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
		if (camera instanceof OrthographicCamera) {
			const before = new Vector3(ndcX, ndcY, 0).unproject(camera);
			const prevZoom = camera.zoom;
			camera.zoom = Math.max(
				controls.minZoom,
				Math.min(controls.maxZoom, camera.zoom * factor),
			);
			if (camera.zoom === prevZoom) return;
			camera.updateProjectionMatrix();
			const after = new Vector3(ndcX, ndcY, 0).unproject(camera);
			const shift = before.sub(after);
			camera.position.add(shift);
			controls.target.add(shift);
			camera.updateMatrixWorld();
			controls.dispatchEvent({ type: "change" });
			return;
		}
		const prevRadius = camera.position.distanceTo(controls.target);
		const nextRadius = Math.max(
			controls.minDistance,
			Math.min(controls.maxDistance, prevRadius / factor),
		);
		const radiusDelta = prevRadius - nextRadius;
		if (radiusDelta === 0) return;
		const forward = new Vector3(0, 0, -1).transformDirection(camera.matrix);
		const rayDirection = new Vector3(ndcX, ndcY, 1)
			.unproject(camera)
			.sub(camera.position)
			.normalize();
		const alignment = Math.max(rayDirection.dot(forward), 0.1);
		camera.position.addScaledVector(rayDirection, radiusDelta / alignment);
		camera.updateMatrixWorld();
		controls.target.copy(camera.position).addScaledVector(forward, nextRadius);
		controls.dispatchEvent({ type: "change" });
	};
	const orbit = (deltaX: number, deltaY: number) => {
		if (!controls.enabled || (!panFirst && !controls.enableRotate)) return;
		if (Math.hypot(deltaX, deltaY) === 0) return;
		if (rotationLocked) {
			if (!unlock?.()) return;
			if (gestureStart) beginGesture(gestureStart.x, gestureStart.y);
		}
		const camera = controls.object;
		showFocus();
		const scale =
			(2 * Math.PI * controls.rotateSpeed) / Math.max(canvas.clientHeight, 1);
		const center = (pivot ?? controls.target).clone();
		const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
		const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
		const turn = new Quaternion().setFromAxisAngle(
			new Vector3(0, 0, 1),
			deltaX * scale * (up.z < 0 ? -1 : 1),
		);
		right.applyQuaternion(turn);
		const rotation = new Quaternion()
			.setFromAxisAngle(right, deltaY * scale)
			.multiply(turn);
		const rotateAround = (point: Vector3) =>
			point.sub(center).applyQuaternion(rotation).add(center);
		rotateAround(camera.position);
		rotateAround(controls.target);
		camera.up.copy(up).applyQuaternion(rotation).normalize();
		camera.lookAt(controls.target);
		camera.updateMatrixWorld();
		controls.dispatchEvent({ type: "change" });
	};
	const onWheel = (event: WheelEvent) => {
		if (event.ctrlKey || event.metaKey) {
			if (rotationLocked || !controls.enabled) return;
			if (event.timeStamp - lastWheel > 200 || lastWheelMode !== "zoom") {
				beginGesture(event.clientX, event.clientY);
				wheelTravel = 0;
			}
			lastWheel = event.timeStamp;
			lastWheelMode = "zoom";
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		if (!controls.enabled) return;
		const mouseWheel = isMouseWheel(event);
		if (!rotationLocked && mouseWheel && !event.shiftKey) {
			if (event.timeStamp - lastWheel > 200 || lastWheelMode !== "zoom") {
				beginGesture(event.clientX, event.clientY);
				wheelTravel = 0;
			}
			lastWheel = event.timeStamp;
			lastWheelMode = "zoom";
			const steps = mouseWheelSteps(event);
			if (steps !== 0)
				zoomAt(event.clientX, event.clientY, MOUSE_WHEEL_ZOOM ** -steps);
			return;
		}
		const delta = wheelDelta(event, canvas);
		const orbitIntent =
			event.shiftKey && (!rotationLocked || (!mouseWheel && !!unlock));
		const mode = orbitIntent ? "orbit" : "pan";
		if (
			(!rotationLocked || orbitIntent) &&
			(event.timeStamp - lastWheel > 200 || lastWheelMode !== mode)
		) {
			beginGesture(event.clientX, event.clientY);
			wheelTravel = 0;
		}
		lastWheel = event.timeStamp;
		lastWheelMode = mode;
		const orbitX =
			event.deltaMode === 2
				? event.deltaX * Math.max(canvas.clientHeight, 1)
				: delta.x;
		if (orbitIntent && !rotationLocked) {
			orbit(orbitX, delta.y);
		} else if (orbitIntent) {
			wheelTravel += Math.hypot(delta.x, delta.y);
			if (wheelTravel >= UNLOCK_DISTANCE) orbit(orbitX, delta.y);
		} else if (controls.enablePan) {
			pan(-delta.x, -delta.y);
		}
		if (!rotationLocked || orbitIntent) {
			clearTimeout(wheelEnd);
			wheelEnd = setTimeout(hideFocus, 200);
		}
	};
	const onPointerDown = (event: PointerEvent) => {
		if (!controls.enabled) return;
		pointers.set(event.pointerId, {
			x: event.clientX,
			y: event.clientY,
			touch: event.pointerType === "touch",
		});
		const touch = event.pointerType === "touch";
		if (pointers.size > 1) {
			orbitPointer = null;
			panPointer = null;
			hideFocus();
		} else if (touch || event.button === 0 || event.button === 1)
			beginGesture(event.clientX, event.clientY);
		if (touch || (event.button !== 0 && event.button !== 1)) return;
		const requiresAlt = event.button === 0 && unlockGesture === "alt-shift";
		const canUnlock =
			!!unlock && event.shiftKey && (!requiresAlt || event.altKey);
		if (event.shiftKey && (!rotationLocked || canUnlock)) {
			orbitPointer = event.pointerId;
			orbitRequiresAlt = requiresAlt;
			panPointer = null;
			return;
		}
		if (panFirst || event.button === 1 || event.ctrlKey || event.metaKey) {
			panPointer = event.pointerId;
			orbitPointer = null;
		}
	};
	const onPointerMove = (event: PointerEvent) => {
		const previous = pointers.get(event.pointerId);
		if (!previous) return;
		const deltaX = previous.x - event.clientX;
		const deltaY = previous.y - event.clientY;
		if (orbitPointer === event.pointerId) {
			if (
				rotationLocked &&
				(!event.shiftKey ||
					(orbitRequiresAlt && !event.altKey) ||
					Math.hypot(deltaX, deltaY) < UNLOCK_DISTANCE)
			)
				return;
			orbit(deltaX, deltaY);
		} else if (panPointer === event.pointerId) {
			pan(-deltaX, -deltaY);
		} else if (previous.touch && pointers.size === 1 && !rotationLocked)
			orbit(deltaX, deltaY);
		previous.x = event.clientX;
		previous.y = event.clientY;
	};
	const onPointerEnd = (event: PointerEvent) => {
		pointers.delete(event.pointerId);
		if (orbitPointer === event.pointerId) orbitPointer = null;
		if (panPointer === event.pointerId) panPointer = null;
		if (pointers.size === 0) hideFocus();
	};
	const onMouseDown = (event: MouseEvent) => {
		if (
			!panFirst &&
			event.button !== 1 &&
			!(
				event.button === 0 &&
				(event.shiftKey || event.ctrlKey || event.metaKey)
			)
		)
			return;
		event.preventDefault();
		canvas.focus({ preventScroll: true });
	};
	const onAuxClick = (event: MouseEvent) => {
		if (event.button !== 1) return;
		event.preventDefault();
		if (
			event.detail === 2 &&
			!event.shiftKey &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey
		)
			fit();
	};
	canvas.addEventListener("pointerdown", onPointerDown, true);
	canvas.addEventListener("pointermove", onPointerMove, true);
	canvas.addEventListener("pointerup", onPointerEnd, true);
	canvas.addEventListener("pointercancel", onPointerEnd, true);
	canvas.addEventListener("lostpointercapture", onPointerEnd, true);
	canvas.addEventListener("wheel", onWheel, { capture: true, passive: false });
	canvas.addEventListener("mousedown", onMouseDown);
	canvas.addEventListener("auxclick", onAuxClick);
	controls.connect(canvas);
	controls.listenToKeyEvents(canvas);
	return {
		controls,
		pan,
		setRotationLocked,
		dispose: () => {
			canvas.removeEventListener("pointerdown", onPointerDown, true);
			canvas.removeEventListener("pointermove", onPointerMove, true);
			canvas.removeEventListener("pointerup", onPointerEnd, true);
			canvas.removeEventListener("pointercancel", onPointerEnd, true);
			canvas.removeEventListener("lostpointercapture", onPointerEnd, true);
			pointers.clear();
			clearTimeout(wheelEnd);
			canvas.removeEventListener("wheel", onWheel, true);
			canvas.removeEventListener("mousedown", onMouseDown);
			canvas.removeEventListener("auxclick", onAuxClick);
			controls.dispose();
		},
	};
}
