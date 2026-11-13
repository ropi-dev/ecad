export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;
export const ZOOM_FACTOR = 1.25;

export function handleViewerKeyDown(
	event: Pick<
		KeyboardEvent,
		"key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "preventDefault"
	>,
	{
		fit,
		zoom,
		pan,
		fitOnF6 = false,
	}: {
		fit: () => void;
		zoom: (factor: number) => void;
		pan?: (x: number, y: number) => void;
		fitOnF6?: boolean;
	},
) {
	if (event.ctrlKey || event.metaKey || event.altKey) return;
	const step = event.shiftKey ? 240 : 80;
	switch (event.key) {
		case "+":
		case "=":
			zoom(ZOOM_FACTOR);
			break;
		case "-":
			zoom(1 / ZOOM_FACTOR);
			break;
		case "F6":
			if (!fitOnF6) return;
			fit();
			break;
		case "f":
		case "F":
		case "0":
			fit();
			break;
		case "ArrowLeft":
			if (!pan) return;
			pan(-step, 0);
			break;
		case "ArrowRight":
			if (!pan) return;
			pan(step, 0);
			break;
		case "ArrowUp":
			if (!pan) return;
			pan(0, -step);
			break;
		case "ArrowDown":
			if (!pan) return;
			pan(0, step);
			break;
		default:
			return;
	}
	event.preventDefault();
}

export function wheelDelta(
	event: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">,
	element: Pick<HTMLElement, "clientWidth" | "clientHeight">,
) {
	const unit = event.deltaMode === 1 ? 16 : 1;
	return {
		x:
			event.deltaX *
			(event.deltaMode === 2 ? Math.max(element.clientWidth, 1) : unit),
		y:
			event.deltaY *
			(event.deltaMode === 2 ? Math.max(element.clientHeight, 1) : unit),
	};
}

const WHEEL_TICK = 120;

export function isMouseWheel(
	event: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY"> & {
		wheelDeltaX?: number;
		wheelDeltaY?: number;
	},
) {
	if (event.deltaMode !== 0) return true;
	return (
		[
			[event.wheelDeltaX, event.deltaX],
			[event.wheelDeltaY, event.deltaY],
		] as const
	).some(
		([ticks, delta]) =>
			!!ticks && ticks % WHEEL_TICK === 0 && ticks !== -3 * delta,
	);
}

export function viewerPixelRatio() {
	return Math.min(window.devicePixelRatio || 1, 2);
}
