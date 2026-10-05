export interface Viewer2DHandle {
	resetView(): void;
	zoomView(factor: number): void;
	panView(x: number, y: number): void;
}
