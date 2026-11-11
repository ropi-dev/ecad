import { type ComponentProps, lazy, Suspense, useState } from "react";

const SettingsDialog = lazy(() =>
	import("#/settings/SettingsDialog.tsx").then((module) => ({
		default: module.SettingsDialog,
	})),
);

export function LazySettingsDialog(
	props: ComponentProps<typeof SettingsDialog>,
) {
	const [loaded, setLoaded] = useState(props.open);
	if (props.open && !loaded) setLoaded(true);
	return loaded ? (
		<Suspense fallback={null}>
			<SettingsDialog {...props} />
		</Suspense>
	) : null;
}
