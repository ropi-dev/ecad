import { MOUSE, OrthographicCamera, TOUCH } from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { MAX_ZOOM, MIN_ZOOM } from "./navigation";
import type { Camera } from "./types";

export class ViewportControls {
	readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
	readonly controls: MapControls;
	private baseScale = 1;
	private safariScale: number | null = null;
	private forwardingGesture = false;

	constructor(
		private element: HTMLElement,
		private onChange: (camera: Camera) => void,
	) {
		this.camera.position.z = 1;
		this.controls = new MapControls(this.camera, element);
		this.controls.enableRotate = false;
		this.controls.screenSpacePanning = true;
		this.controls.zoomToCursor = true;
		this.controls.minZoom = MIN_ZOOM;
		this.controls.maxZoom = MAX_ZOOM;
		this.controls.mouseButtons.MIDDLE = MOUSE.PAN;
		this.controls.touches.TWO = TOUCH.DOLLY_PAN;
		this.controls.addEventListener("change", this.publish);
		element.addEventListener("wheel", this.onWheel, {
			capture: true,
			passive: false,
		});
		element.addEventListener("pointerdown", this.focus);
		element.addEventListener("gesturestart", this.onGestureStart, {
			passive: false,
		});
		element.addEventListener("gesturechange", this.onGestureChange, {
			passive: false,
		});
		element.addEventListener("gestureend", this.onGestureEnd, {
			passive: false,
		});
		window.addEventListener("blur", this.onGestureEnd);
	}

	private publish = () => {
		this.onChange({
			x: this.camera.position.x,
			y: this.camera.position.y,
			scale: this.baseScale * this.camera.zoom,
		});
	};

	resize(width: number, height: number) {
		this.camera.left = -width / (2 * this.baseScale);
		this.camera.right = -this.camera.left;
		this.camera.top = height / (2 * this.baseScale);
		this.camera.bottom = -this.camera.top;
		this.camera.updateProjectionMatrix();
	}

	fit(camera: Camera, width: number, height: number) {
		this.baseScale = camera.scale;
		this.camera.position.set(camera.x, camera.y, 1);
		this.camera.zoom = 1;
		this.controls.target.set(camera.x, camera.y, 0);
		this.resize(width, height);
		this.controls.update();
		this.controls.saveState();
		this.publish();
	}

	reset() {
		this.controls.reset();
	}

	zoom(factor: number) {
		if (Number.isFinite(factor) && factor > 0) this.controls.dollyOut(factor);
	}

	pan(x: number, y: number) {
		this.controls.pan(-x, -y);
	}

	private focus = () => {
		this.element.querySelector("canvas")?.focus({ preventScroll: true });
	};

	private onWheel = (event: WheelEvent) => {
		if (this.forwardingGesture) return;
		if (this.safariScale === null && (event.ctrlKey || event.metaKey)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (this.safariScale !== null) return;
		const unit = event.deltaMode === 1 ? 16 : 1;
		this.pan(
			event.deltaX * (event.deltaMode === 2 ? this.element.clientWidth : unit),
			event.deltaY * (event.deltaMode === 2 ? this.element.clientHeight : unit),
		);
	};

	private onGestureStart = (event: Event) => {
		event.preventDefault();
		this.safariScale = 1;
	};

	private onGestureChange = (event: Event) => {
		event.preventDefault();
		const gesture = event as Event & {
			scale: number;
			clientX: number;
			clientY: number;
		};
		if (
			this.safariScale === null ||
			!Number.isFinite(gesture.scale) ||
			gesture.scale <= 0
		)
			return;
		const factor = gesture.scale / this.safariScale;
		this.safariScale = gesture.scale;
		this.forwardingGesture = true;
		try {
			this.element.dispatchEvent(
				new WheelEvent("wheel", {
					clientX: gesture.clientX,
					clientY: gesture.clientY,
					deltaY: (100 * Math.log(factor)) / Math.log(0.95),
					cancelable: true,
				}),
			);
		} finally {
			this.forwardingGesture = false;
		}
	};

	private onGestureEnd = (event: Event) => {
		event.preventDefault();
		this.safariScale = null;
	};

	dispose() {
		this.controls.removeEventListener("change", this.publish);
		this.controls.dispose();
		this.element.removeEventListener("wheel", this.onWheel, true);
		this.element.removeEventListener("pointerdown", this.focus);
		this.element.removeEventListener("gesturestart", this.onGestureStart);
		this.element.removeEventListener("gesturechange", this.onGestureChange);
		this.element.removeEventListener("gestureend", this.onGestureEnd);
		window.removeEventListener("blur", this.onGestureEnd);
	}
}
