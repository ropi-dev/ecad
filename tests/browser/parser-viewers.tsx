import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Viewer2D } from "../../src/components/viewer/Viewer2D";
import { Viewer3D } from "../../src/components/viewer/Viewer3D";
import type { Viewer2DHandle } from "../../src/components/viewer/types/Viewer2DHandle";
import type { Viewer2DSnapshot } from "../../src/components/viewer/types/Viewer2DSnapshot";
import type { ViewerScene } from "../../src/engine/scene";
import { parseGerberFile } from "../../src/formats/parseGerberFile";
import { parseStepFile } from "../../src/formats/parseStepFile";
import "../../src/styles.css";

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

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
