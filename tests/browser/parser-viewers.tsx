import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Viewer2DHandle } from "#/components/viewer/types/Viewer2DHandle.ts";
import type { Viewer2DSnapshot } from "#/components/viewer/types/Viewer2DSnapshot.ts";
import { Viewer2D } from "#/components/viewer/Viewer2D.tsx";
import { Viewer3D } from "#/components/viewer/Viewer3D.tsx";
import type { ViewerScene } from "#/engine/scene.ts";
import { parseGerberFile } from "#/formats/parseGerberFile.ts";
import { parseStepFile } from "#/formats/parseStepFile.ts";
import { required } from "../helpers/required.ts";
import "#/styles.css";

function App() {
	const [loaded, setLoaded] = useState<{
		scene: ViewerScene;
		dispose?: () => void;
	}>();
	const current = useRef(loaded);
	const [error, setError] = useState("");
	const [ready, setReady] = useState(false);
	const [snapshot, setSnapshot] = useState<Viewer2DSnapshot>();
	const viewer = useRef<Viewer2DHandle>(null);
	useEffect(() => () => current.current?.dispose?.(), []);
	return (
		<>
			<input
				type="file"
				multiple
				aria-label="Open scene"
				onChange={async (event) => {
					const files = [...(event.target.files ?? [])];
					if (!files.length) return;
					try {
						const results = await Promise.all(
							files.map((file) =>
								/\.(stp|step)$/i.test(file.name)
									? parseStepFile(file)
									: parseGerberFile(file),
							),
						);
						const parsed = {
							scene: results.flatMap((result) => result.scene),
							dispose: () =>
								results.forEach((result) => {
									if ("dispose" in result) result.dispose();
								}),
						};
						current.current?.dispose?.();
						current.current = parsed;
						setLoaded(parsed);
					} catch (error) {
						setError(String(error));
					}
				}}
			/>
			<button type="button" onClick={() => viewer.current?.zoomView(1.25)}>
				Zoom 2D
			</button>
			<output id="ready">{String(ready)}</output>
			<output id="objects">
				{JSON.stringify(loaded?.scene.map((object) => object.type))}
			</output>
			<output id="snapshot" hidden>
				{JSON.stringify(snapshot)}
			</output>
			{error && <p role="alert">{error}</p>}
			{loaded && (
				<div style={{ display: "flex" }}>
					<div
						data-view="2d"
						style={{ position: "relative", width: 600, height: 500 }}
					>
						<Viewer2D
							ref={viewer}
							scene={loaded.scene}
							onChange={setSnapshot}
						/>
					</div>
					<div
						data-view="3d"
						style={{ position: "relative", width: 600, height: 500 }}
					>
						<Viewer3D
							scene={loaded.scene}
							onReady={setReady}
							onError={setError}
						/>
					</div>
				</div>
			)}
		</>
	);
}

createRoot(required(document.getElementById("root"))).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
