import { type Accessor, createSignal, onSettled } from "solid-js";
import {
	drawingFontsLoaded,
	loadDrawingFonts,
} from "#/engine/drawing/fonts.ts";

/** False until the schematic font can be measured and painted on a canvas. */
export function useDrawingFonts(): Accessor<boolean> {
	const [ready, setReady] = createSignal(drawingFontsLoaded());
	onSettled(() => {
		if (drawingFontsLoaded()) return;
		let active = true;
		void loadDrawingFonts().then(() => {
			if (active) setReady(true);
		});
		return () => {
			active = false;
		};
	});
	return ready;
}
