import {
	MOUSE,
	type OrthographicCamera,
	type PerspectiveCamera,
	Quaternion,
	TOUCH,
	Vector3,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { wheelDelta } from "#/engine/navigation.ts";

export function create3DControls(
	camera: PerspectiveCamera | OrthographicCamera,
	canvas: HTMLElement,
	fit: () => void,
	{
		lockTop = false,
		focus,
		onFocus,
	}: {
		lockTop?: boolean;
		focus?: (clientX: number, clientY: number) => Vector3 | null;
		onFocus?: (point: Vector3 | null) => void;
	} = {},
) {
	const controls = new OrbitControls(camera, canvas);
	controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: null };
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
	controls.listenToKeyEvents(canvas);
	const pointers = new Map<number, { x: number; y: number; touch: boolean }>();
	let orbitPointer: number | null = null;
	let pivot: Vector3 | null = null;
	let lastWheel = Number.NEGATIVE_INFINITY;
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
		hideFocus();
		pivot = focus?.(clientX, clientY) ?? null;
		if (!pivot) return;
		const camera = controls.object;
		const forward = camera.getWorldDirection(new Vector3());
		const depth = pivot.clone().sub(camera.position).dot(forward);
		if (depth < controls.minDistance || depth > controls.maxDistance) return;
		controls.target.copy(camera.position).addScaledVector(forward, depth);
	};
	const orbit = (deltaX: number, deltaY: number) => {
		if (
			!controls.enabled ||
			rotationLocked ||
			(!panFirst && !controls.enableRotate)
		)
			return;
		const camera = controls.object;
		const distance = Math.hypot(deltaX, deltaY);
		if (distance === 0) return;
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
		if (event.ctrlKey || event.metaKey) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (!controls.enabled) return;
		const delta = wheelDelta(event, canvas);
		if (event.timeStamp - lastWheel > 200)
			beginGesture(event.clientX, event.clientY);
		lastWheel = event.timeStamp;
		if (event.shiftKey && !rotationLocked) {
			orbit(
				event.deltaMode === 2
					? event.deltaX * Math.max(canvas.clientHeight, 1)
					: delta.x,
				delta.y,
			);
		} else if (controls.enablePan) {
			controls.pan(-delta.x, -delta.y);
		}
		clearTimeout(wheelEnd);
		wheelEnd = setTimeout(hideFocus, 200);
	};
	const onPointerDown = (event: PointerEvent) => {
		if (!controls.enabled) return;
		pointers.set(event.pointerId, {
			x: event.clientX,
			y: event.clientY,
			touch: event.pointerType === "touch",
		});
		const touch = event.pointerType === "touch";
		if (pointers.size > 1) hideFocus();
		else if (touch || event.button === 0 || event.button === 1)
			beginGesture(event.clientX, event.clientY);
		if (touch || (event.button !== 0 && event.button !== 1)) return;
		const button = event.button === 0 ? "LEFT" : "MIDDLE";
		if (panFirst) {
			if (event.shiftKey && !rotationLocked) {
				orbitPointer = event.pointerId;
				controls.mouseButtons[button] = null;
				return;
			}
			controls.mouseButtons[button] =
				event.ctrlKey || event.metaKey || event.shiftKey
					? MOUSE.ROTATE
					: MOUSE.PAN;
			return;
		}
		if (event.shiftKey) {
			orbitPointer = event.pointerId;
			controls.mouseButtons[button] = null;
			return;
		}
		controls.mouseButtons[button] =
			event.ctrlKey || event.metaKey
				? MOUSE.ROTATE
				: event.button === 1
					? MOUSE.PAN
					: null;
	};
	const onPointerMove = (event: PointerEvent) => {
		const previous = pointers.get(event.pointerId);
		if (!previous) return;
		if (
			orbitPointer === event.pointerId ||
			(previous.touch && pointers.size === 1 && !rotationLocked)
		) {
			orbit(previous.x - event.clientX, previous.y - event.clientY);
		}
		previous.x = event.clientX;
		previous.y = event.clientY;
	};
	const onPointerEnd = (event: PointerEvent) => {
		pointers.delete(event.pointerId);
		if (orbitPointer === event.pointerId) orbitPointer = null;
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
	return {
		controls,
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
