import {
	BufferGeometry,
	Color,
	Float32BufferAttribute,
	Points,
	ShaderMaterial,
	type Vector3,
} from "three";

const SIZE = 10;

export function createFocusMarker() {
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3));
	const material = new ShaderMaterial({
		uniforms: {
			size: { value: SIZE },
			color: { value: new Color("#ef4444") },
		},
		vertexShader: /* glsl */ `
			uniform float size;
			void main() {
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				gl_PointSize = size;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float size;
			uniform vec3 color;
			void main() {
				float radius = length(gl_PointCoord - 0.5) * 2.0;
				float edge = 2.0 / size;
				float alpha = 1.0 - smoothstep(1.0 - edge, 1.0, radius);
				if (alpha <= 0.0) discard;
				gl_FragColor = vec4(color, alpha);
			}
		`,
		transparent: true,
		depthTest: false,
		depthWrite: false,
	});
	const marker = new Points(geometry, material);
	marker.name = "viewport-focus-marker";
	marker.frustumCulled = false;
	marker.renderOrder = Number.MAX_SAFE_INTEGER;
	marker.visible = false;
	return {
		object: marker,
		show(point: Vector3 | null, ratio: number) {
			marker.visible = point !== null;
			if (!point) return;
			marker.position.copy(point);
			material.uniforms.size.value = SIZE * ratio;
		},
		dispose() {
			geometry.dispose();
			material.dispose();
		},
	};
}
