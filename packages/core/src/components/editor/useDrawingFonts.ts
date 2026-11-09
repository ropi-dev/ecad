import { useEffect, useState } from "react";
import {
	drawingFontsLoaded,
	loadDrawingFonts,
} from "#/engine/drawing/fonts.ts";

/** False until the schematic font can be measured and painted on a canvas. */
export function useDrawingFonts() {
	const [ready, setReady] = useState(drawingFontsLoaded);
	useEffect(() => {
		if (ready) return;
		let active = true;
		void loadDrawingFonts().then(() => {
			if (active) setReady(true);
		});
		return () => {
			active = false;
		};
	}, [ready]);
	return ready;
}
