import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	BoxGeometry,
	Group,
	Scene,
	Vector3,
	Mesh,
	MeshStandardMaterial,
	type Object3D,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { SceneLayer } from "#/engine/types.ts";
import { createPlanarObject } from "#/engine/scene.ts";
import { Viewer2D } from "#/components/viewer/Viewer2D.tsx";
import { Viewer3D } from "#/components/viewer/Viewer3D.tsx";
import type { Viewer3DHandle } from "#/components/viewer/types/Viewer3DHandle.ts";
import type { Viewer2DSnapshot } from "#/components/viewer/types/Viewer2DSnapshot.ts";
import type { Viewer2DHandle } from "#/components/viewer/types/Viewer2DHandle.ts";
import "#/styles.css";

const layer: SceneLayer = {
	id: "shapes",
	name: "Shapes",
	color: "#e8b77e",
	visible: true,
	opacity: 1,
	bounds: { minX: -17, maxX: 17, minY: -5, maxY: 5 },
	metadata: {},
	objects: [-12, 12].map((x, index) => ({
		id: String(index),
		geometry: { type: "rect", x, y: 0, width: 10, height: 10 },
		bounds: { minX: x - 5, maxX: x + 5, minY: -5, maxY: 5 },
		polarity: "dark",
		attributes: {},
	})),
};
const drawingScene = [createPlanarObject(layer)];
const cameraTargets = new WeakMap<Object3D, number[]>();
const updateControls = OrbitControls.prototype.update;
OrbitControls.prototype.update = function (...args) {
	const changed = updateControls.apply(this, args);
	cameraTargets.set(this.object, this.target.toArray());
	return changed;
};
Scene.prototype.onAfterRender = function (_renderer, _scene, camera) {
	document.querySelector("#camera")!.textContent = JSON.stringify({
		type: camera.type,
		projectionY: camera.projectionMatrix.elements[5],
		target: cameraTargets.get(camera),
		direction: camera.getWorldDirection(new Vector3()).toArray(),
		up: new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).toArray(),
		position: camera.position.toArray(),
	});
};
const snapshot = (value: Viewer2DSnapshot) => {
	document.querySelector("#snapshot")!.textContent = JSON.stringify(value);
};

function Drawing() {
	const viewer = useRef<Viewer2DHandle>(null);
	return (
		<>
			<button type="button" onClick={() => viewer.current?.panView(80, 40)}>
				Pan
			</button>
			<button type="button" onClick={() => viewer.current?.resetView()}>
				Reset
			</button>
			<div style={{ position: "relative", width: 800, height: 600 }}>
				<Viewer2D scene={drawingScene} onChange={snapshot} ref={viewer} />
			</div>
		</>
	);
}

const lifetime = {
	created: 0,
	disposed: 0,
	geometriesDisposed: 0,
	materialsDisposed: 0,
};
const publishLifetime = () => {
	document.querySelector("#lifetime")!.textContent = JSON.stringify(lifetime);
};

function Model() {
	const [revision, setRevision] = useState(0);
	const [visible, setVisible] = useState(true);
	const [mounted, setMounted] = useState(true);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState("");
	const [empty, setEmpty] = useState(false);
	const viewer = useRef<Viewer3DHandle>(null);
	const createScene = useCallback(() => {
		const geometry = new BoxGeometry(2 + revision, 3, 4);
		const material = new MeshStandardMaterial({ color: "#e8b77e" });
		geometry.addEventListener("dispose", () => lifetime.geometriesDisposed++);
		material.addEventListener("dispose", () => lifetime.materialsDisposed++);
		lifetime.created++;
		publishLifetime();
		return {
			object: empty ? new Group() : new Mesh(geometry, material),
			dispose: () => {
				geometry.dispose();
				material.dispose();
				lifetime.disposed++;
				publishLifetime();
			},
		};
	}, [revision, empty]);
	const [scene, setScene] =
		useState<import("#/engine/scene.ts").ViewerScene>();
	useEffect(() => {
		const result = createScene();
		setScene([{ type: "spatial", object: result.object }]);
		return result.dispose;
	}, [createScene]);
	const updateScene = useCallback(
		(object: Object3D) => {
			object.visible = visible;
		},
		[visible],
	);
	return (
		<>
			<button type="button" onClick={() => setVisible((value) => !value)}>
				Visibility
			</button>
			<button type="button" onClick={() => setRevision((value) => value + 1)}>
				Replace scene
			</button>
			<button type="button" onClick={() => setEmpty((value) => !value)}>
				Empty scene
			</button>
			<button type="button" onClick={() => setMounted((value) => !value)}>
				Mount
			</button>
			<button
				type="button"
				disabled={!ready}
				onClick={() => viewer.current?.zoom(1.25)}
			>
				Zoom
			</button>
			{error && <p role="alert">{error}</p>}
			<div style={{ position: "relative", width: 800, height: 600 }}>
				{mounted && scene && (
					<Viewer3D
						ref={viewer}
						scene={scene}
						updateScene={updateScene}
						onReady={(value) => setReady(value)}
						onError={(message) => setError(message)}
					/>
				)}
			</div>
		</>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		{location.search.includes("3d") ? <Model /> : <Drawing />}
	</StrictMode>,
);
