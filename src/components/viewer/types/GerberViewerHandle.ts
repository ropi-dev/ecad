export interface GerberViewerHandle {
	resetView(): void;
	zoomView(factor: number): void;
	panView(x: number, y: number): void;
}
