import {
	lazy,
	Suspense,
	startTransition,
	useEffect,
	useRef,
	useState,
} from "react";
import type { SymbolDefinition } from "#/drawing/symbols.ts";

const SymbolPreview = lazy(
	() => import("#/components/editor/SymbolPreview.tsx"),
);
const observers = new WeakMap<
	Element,
	{
		observer: IntersectionObserver;
		listeners: Map<Element, () => void>;
	}
>();

function observe(element: Element, onVisible: () => void) {
	const root = element.closest("[data-symbol-picker]");
	if (!root) {
		onVisible();
		return () => {};
	}
	let shared = observers.get(root);
	if (!shared) {
		const listeners = new Map<Element, () => void>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) listeners.get(entry.target)?.();
				}
			},
			{ root, rootMargin: "64px" },
		);
		shared = { observer, listeners };
		observers.set(root, shared);
	}
	shared.listeners.set(element, onVisible);
	shared.observer.observe(element);
	return () => {
		shared.listeners.delete(element);
		shared.observer.unobserve(element);
		if (!shared.listeners.size) {
			shared.observer.disconnect();
			observers.delete(root);
		}
	};
}

function ThumbnailSkeleton() {
	return (
		<span
			aria-hidden="true"
			data-thumbnail-skeleton=""
			className="block h-7 w-11 shrink-0 animate-pulse rounded-sm bg-hover motion-reduce:animate-none"
		/>
	);
}

export function SymbolThumbnail({
	definition,
}: {
	definition: SymbolDefinition;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const [ready, setReady] = useState(false);
	useEffect(() => {
		const element = ref.current;
		if (!element || ready) return;
		return observe(element, () => startTransition(() => setReady(true)));
	}, [ready]);
	return (
		<span ref={ref} className="block h-7 w-11 shrink-0" aria-hidden="true">
			<Suspense fallback={<ThumbnailSkeleton />}>
				{ready ? (
					<SymbolPreview definition={definition} />
				) : (
					<ThumbnailSkeleton />
				)}
			</Suspense>
		</span>
	);
}
