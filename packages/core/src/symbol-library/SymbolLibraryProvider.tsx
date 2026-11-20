import type { JSX } from "@solidjs/web";
import {
	ProjectStorageContext,
	StorageContext,
	type SymbolLibraryStorage,
	UpdatesContext,
} from "#/symbol-library/storage.ts";

export function SymbolLibraryProvider(props: {
	storage: SymbolLibraryStorage;
	children: JSX.Element;
	projectStorage?: SymbolLibraryStorage;
}) {
	const listeners = new Set<() => void>();
	const updates = {
		notify() {
			for (const listener of listeners) listener();
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	return (
		<UpdatesContext value={updates}>
			<StorageContext value={props.storage}>
				<ProjectStorageContext value={() => props.projectStorage ?? null}>
					{props.children}
				</ProjectStorageContext>
			</StorageContext>
		</UpdatesContext>
	);
}
