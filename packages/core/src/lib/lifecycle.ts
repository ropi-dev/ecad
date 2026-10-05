import { Effect, Either, Exit, Scope } from "effect";

/** An Effect scope for framework lifetimes whose setup and teardown are synchronous. */
export function createLifecycle() {
	const scope = Effect.runSync(Scope.make());
	let disposed = false;
	return {
		acquire<A>(acquire: () => A, release: (resource: A) => void): A {
			if (disposed)
				throw new Error("The resource lifecycle is already disposed.");
			const result = Effect.runSync(
				Effect.acquireRelease(
					Effect.try({ try: acquire, catch: (error) => error }),
					(resource) => Effect.sync(() => release(resource)),
				).pipe(Scope.extend(scope), Effect.either),
			);
			if (Either.isLeft(result)) throw result.left;
			return result.right;
		},
		addFinalizer(finalize: () => void): void {
			Effect.runSync(Scope.addFinalizer(scope, Effect.sync(finalize)));
		},
		listen<E extends Event>(
			target: EventTarget,
			type: string,
			listener: (event: E) => void,
		): void {
			if (disposed)
				throw new Error("The resource lifecycle is already disposed.");
			target.addEventListener(type, listener as EventListener);
			Effect.runSync(
				Scope.addFinalizer(
					scope,
					Effect.sync(() =>
						target.removeEventListener(type, listener as EventListener),
					),
				),
			);
		},
		dispose(): void {
			disposed = true;
			Effect.runSync(Scope.close(scope, Exit.void));
		},
	};
}
