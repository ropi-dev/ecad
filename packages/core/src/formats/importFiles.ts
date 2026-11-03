import { Effect, Either, ExecutionStrategy, Exit, Scope } from "effect";
import type { ImportError } from "./import-effects";

export interface ParsedFile<T> {
	value: T;
	messages?: string[];
}

export type ImportFile<T> = (
	file: File,
) => Effect.Effect<ParsedFile<T>, ImportError, Scope.Scope>;

export interface ExpandedFile {
	files: readonly File[];
	/** Problems with the source file itself, such as skipped archive entries. */
	messages?: readonly string[];
}

export type ExpandFile = (
	file: File,
) => Effect.Effect<ExpandedFile, ImportError>;

/** One scope owns every parsed value until the complete batch is handed off. */
export function importFilesEffect<T>(
	files: readonly File[],
	parse: ImportFile<T>,
	expand?: ExpandFile,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			const scope = yield* Effect.scope;
			const values: T[] = [];
			const messages: string[] = [];
			for (const file of files) {
				const expanded = yield* Effect.either(
					expand ? expand(file) : Effect.succeed({ files: [file] }),
				);
				if (Either.isLeft(expanded)) {
					messages.push(`${file.name}: ${expanded.left.message}`);
					continue;
				}
				messages.push(
					...(expanded.right.messages ?? []).map(
						(message) => `${file.name}: ${message}`,
					),
				);
				// Preserve the archive's physical layer order and partial successes.
				for (const entry of expanded.right.files) {
					const entryScope = yield* Scope.fork(
						scope,
						ExecutionStrategy.sequential,
					);
					const parsed = yield* Effect.either(
						Scope.extend(parse(entry), entryScope).pipe(
							Effect.onExit((exit) =>
								Exit.isFailure(exit)
									? Scope.close(entryScope, exit)
									: Effect.void,
							),
						),
					);
					if (Either.isLeft(parsed)) {
						messages.push(`${entry.name}: ${parsed.left.message}`);
						continue;
					}
					values.push(parsed.right.value);
					messages.push(
						...(parsed.right.messages ?? []).map(
							(message) => `${entry.name}: ${message}`,
						),
					);
				}
			}
			return { values, messages };
		}),
	);
}
