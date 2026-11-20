import { Dynamic, type JSX, Portal } from "@solidjs/web";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Match,
	onSettled,
	Show,
	Switch,
} from "solid-js";
import {
	CircleAlert,
	CircleCheck,
	Info,
	TriangleAlert,
	X,
} from "#/components/ui/icons.tsx";
import { registerBranch } from "#/components/ui/primitives.tsx";
import { type ToastNotification, toastManager } from "#/components/ui/toast.ts";
import { useExternalStore } from "#/lib/external-store.ts";

const icons = {
	success: CircleCheck,
	error: CircleAlert,
	warning: TriangleAlert,
	info: Info,
};

const pinnedHostId = "app-notices-pinned";

/**
 * A notice that stays until the user dismisses it, such as an import report.
 * It joins the toasts' column, so the two never cover each other. Without a
 * Toaster on the page it renders in place with `fallbackClassName`.
 */
export function PinnedNotice(props: {
	children: JSX.Element;
	fallbackClassName?: string;
}) {
	const [host, setHost] = createSignal<HTMLElement | null | undefined>(
		undefined,
	);
	onSettled(() => {
		setHost(document.getElementById(pinnedHostId));
	});
	return (
		<Switch>
			<Match when={host()}>
				{(element) => <Portal mount={element()}>{props.children}</Portal>}
			</Match>
			<Match when={host() === null}>
				<div class={props.fallbackClassName}>{props.children}</div>
			</Match>
		</Switch>
	);
}

export function Toaster() {
	let region!: HTMLElement;
	let viewport!: HTMLOListElement;
	let previousFocus: HTMLElement | null = null;
	const notifications = useExternalStore(toastManager);
	const [hovered, setHovered] = createSignal(false);
	const [focused, setFocused] = createSignal(false);
	const [windowBlurred, setWindowBlurred] = createSignal(false);
	const paused = createMemo(() => hovered() || focused() || windowBlurred());
	onSettled(() => {
		const rememberFocus = (target: EventTarget | null) => {
			if (
				target instanceof HTMLElement &&
				target !== document.body &&
				!region.contains(target)
			)
				previousFocus = target;
		};
		const handleFocus = (event: FocusEvent) => rememberFocus(event.target);
		const hotkey = (event: KeyboardEvent) => {
			if (event.key === "F8" || event.code === "F8") viewport.focus();
		};
		const blur = () => setWindowBlurred(true);
		const focus = () => setWindowBlurred(false);
		rememberFocus(document.activeElement);
		document.addEventListener("focusin", handleFocus, true);
		document.addEventListener("keydown", hotkey);
		window.addEventListener("blur", blur);
		window.addEventListener("focus", focus);
		const unbranch = registerBranch(region);
		return () => {
			document.removeEventListener("focusin", handleFocus, true);
			document.removeEventListener("keydown", hotkey);
			window.removeEventListener("blur", blur);
			window.removeEventListener("focus", focus);
			unbranch();
		};
	});
	createEffect(
		() => notifications().length,
		(count) => {
			if (
				!count &&
				document.activeElement === viewport &&
				previousFocus?.isConnected
			)
				previousFocus.focus();
		},
	);
	const close = (notification: ToastNotification, element: HTMLElement) => {
		if (element.contains(document.activeElement)) viewport.focus();
		toastManager.close(notification.id);
	};
	const candidates = (forward: boolean) => {
		const toasts = [
			...viewport.querySelectorAll<HTMLElement>(":scope > .app-toast"),
		].reverse();
		const list = toasts.flatMap((toast) => [
			toast,
			...toast.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
			),
		]);
		return forward ? list : list.reverse();
	};
	return (
		<div class="app-notices">
			<div id={pinnedHostId} class="app-notices-pinned" />
			<section
				ref={region}
				aria-label="Notifications, press F8 to focus"
				tabindex="-1"
				style={{
					"pointer-events": notifications().length ? undefined : "none",
				}}
				onPointerMove={() => setHovered(true)}
				onPointerLeave={() => setHovered(false)}
				onFocusIn={() => setFocused(true)}
				onFocusOut={(event) => {
					if (!region.contains(event.relatedTarget as Node | null))
						setFocused(false);
				}}
				onKeyDown={(event) => {
					if (
						event.key !== "Tab" ||
						event.altKey ||
						event.ctrlKey ||
						event.metaKey
					)
						return;
					const list = candidates(!event.shiftKey);
					const active = document.activeElement as HTMLElement | null;
					if (active === viewport) {
						if (event.shiftKey) return;
						const first = list[0];
						if (!first) return;
						event.preventDefault();
						first.focus();
						return;
					}
					const index = list.indexOf(active as HTMLElement);
					if (index < 0) return;
					const next = list[index + 1];
					if (!next) return;
					event.preventDefault();
					next.focus();
				}}
			>
				<ol ref={viewport} tabindex="-1" class="app-toast-viewport">
					<For each={notifications()}>
						{(notification) => (
							<Toast
								notification={notification}
								paused={paused()}
								onClose={(element) => close(notification, element)}
							/>
						)}
					</For>
				</ol>
			</section>
		</div>
	);
}

function Toast(props: {
	notification: ToastNotification;
	paused: boolean;
	onClose: (element: HTMLElement) => void;
}) {
	let element!: HTMLLIElement;
	const [announced, setAnnounced] = createSignal("");
	const [announcing, setAnnouncing] = createSignal(true);
	const close = () => props.onClose(element);
	let swipe: { id: number; x: number; y: number } | undefined;
	const finishSwipe = (pointer: number, x?: number) => {
		if (swipe?.id !== pointer) return;
		const moved = x === undefined ? 0 : x - swipe.x;
		swipe = undefined;
		if (!element.dataset.swipe) return;
		if (moved >= 50) {
			element.dataset.swipe = "end";
			close();
			return;
		}
		element.dataset.swipe = "cancel";
		element.style.removeProperty("--radix-toast-swipe-move-x");
	};
	const duration = () =>
		props.notification.duration ??
		(props.notification.type === "error" ? Number.POSITIVE_INFINITY : 5000);
	let remaining: number | undefined;
	let started = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	createEffect(
		() => ({ paused: props.paused, duration: duration() }),
		({ paused, duration }) => {
			remaining ??= duration;
			if (!Number.isFinite(remaining)) return;
			if (paused) {
				if (timer === undefined) return;
				clearTimeout(timer);
				timer = undefined;
				remaining -= Date.now() - started;
				return;
			}
			if (timer !== undefined) return;
			started = Date.now();
			timer = setTimeout(close, Math.max(0, remaining));
		},
	);
	onSettled(() => {
		const frame = requestAnimationFrame(() =>
			setAnnounced(
				[props.notification.title, props.notification.description]
					.filter(Boolean)
					.join(" "),
			),
		);
		const done = setTimeout(() => setAnnouncing(false), 1000);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(done);
			clearTimeout(timer);
		};
	});
	return (
		// biome-ignore lint/a11y/useSemanticElements: a toast is an item of the notifications list and a status at once
		<li
			ref={element}
			class="app-toast"
			data-type={props.notification.type}
			role="status"
			aria-live="off"
			aria-atomic="true"
			tabindex="0"
			onKeyDown={(event) => {
				if (event.key !== "Escape" || event.defaultPrevented) return;
				event.preventDefault();
				close();
			}}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
			}}
			onPointerMove={(event) => {
				if (swipe?.id !== event.pointerId) return;
				const x = Math.max(0, event.clientX - swipe.x);
				if (!element.dataset.swipe) {
					if (Math.abs(event.clientY - swipe.y) > 10) swipe = undefined;
					if (!swipe || x < 10) return;
					element.setPointerCapture(event.pointerId);
				}
				element.dataset.swipe = "move";
				element.style.setProperty("--radix-toast-swipe-move-x", `${x}px`);
			}}
			onPointerUp={(event) => finishSwipe(event.pointerId, event.clientX)}
			onPointerCancel={(event) => finishSwipe(event.pointerId)}
		>
			<Dynamic
				component={icons[props.notification.type]}
				class="app-toast-icon"
				size={18}
				aria-hidden="true"
			/>
			<div class="min-w-0 flex-1">
				<div class="text-sm font-semibold text-fg">
					{props.notification.title}
				</div>
				<Show when={props.notification.description}>
					<div class="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-[1.125rem] text-fg-muted">
						{props.notification.description}
					</div>
				</Show>
			</div>
			<button
				type="button"
				class="app-toast-close"
				aria-label={`Dismiss ${props.notification.title}`}
				onClick={close}
			>
				<X size={14} aria-hidden="true" />
			</button>
			{announcing() && (
				<Portal>
					<output
						aria-live={
							props.notification.type === "error" ? "assertive" : "polite"
						}
						aria-atomic="true"
						class="sr-only"
					>
						<Show when={announced()}>Notification {announced()}</Show>
					</output>
				</Portal>
			)}
		</li>
	);
}
