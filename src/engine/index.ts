import { Effect, Exit, Scope } from "effect";
import { runEffect } from "#/lib/effect";
import { CanvasRenderer } from "./canvas";
import { type RendererError, rendererError } from "./renderer-error";
import type { GraphicsRenderer } from "./types";

export {
	fitCamera,
	getSceneBounds,
	screenToWorld,
	worldToScreen,
} from "./camera";
export { RendererError } from "./renderer-error";
export * from "./types";

export interface RendererResult {
	renderer: GraphicsRenderer;
	canvas: HTMLCanvasElement;
	backend: "WebGPU" | "WebGL 2" | "Canvas 2D";
	reason?: string;
}

export function createRendererEffect(
	canvas: HTMLCanvasElement,
): Effect.Effect<RendererResult, RendererError, Scope.Scope> {
	return Effect.tryPromise({
		try: () => import("./three"),
		catch: rendererError,
	}).pipe(
		Effect.flatMap(({ ThreeRenderer }) => ThreeRenderer.createEffect(canvas)),
		Effect.map(
			(renderer): RendererResult => ({
				renderer,
				canvas,
				backend: renderer.backend,
			}),
		),
		Effect.catchAll((error) =>
			Effect.acquireRelease(
				Effect.try({
					try: (): RendererResult => {
						const fallback = canvas.ownerDocument.createElement("canvas");
						return {
							renderer: new CanvasRenderer(fallback),
							canvas: fallback,
							backend: "Canvas 2D",
							reason: `Three.js could not initialize: ${error instanceof Error ? error.message : String(error)}. Using Canvas 2D.`,
						};
					},
					catch: rendererError,
				}),
				({ renderer }) => Effect.sync(() => renderer.dispose?.()),
			),
		),
	);
}

export async function createRenderer(
	canvas: HTMLCanvasElement,
): Promise<RendererResult> {
	const scope = Effect.runSync(Scope.make());
	try {
		const result = await runEffect(
			createRendererEffect(canvas).pipe(Scope.extend(scope)),
		);
		const { renderer } = result;
		return {
			...result,
			renderer: {
				render: renderer.render.bind(renderer),
				hitTest: renderer.hitTest.bind(renderer),
				getDiagnostics: renderer.getDiagnostics?.bind(renderer),
				dispose: () => {
					Effect.runFork(Scope.close(scope, Exit.void));
				},
			},
		};
	} catch (error) {
		await runEffect(Scope.close(scope, Exit.void));
		throw error;
	}
}
