import { type JSX, Portal } from "@solidjs/web";
import {
	type Accessor,
	children,
	createContext,
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
	omit,
	onFlush,
	onSettled,
	Show,
	useContext,
} from "solid-js";

export type Side = "top" | "right" | "bottom" | "left";
export type Align = "start" | "center" | "end";

interface PlacementProps {
	side?: Side;
	align?: Align;
	sideOffset?: number;
	alignOffset?: number;
	collisionPadding?: number;
}

type OutsideEvent<E extends Event> = CustomEvent<{ originalEvent: E }>;

interface DismissProps {
	onEscapeKeyDown?: (event: KeyboardEvent) => void;
	onPointerDownOutside?: (event: OutsideEvent<PointerEvent>) => void;
	onFocusOutside?: (event: OutsideEvent<FocusEvent>) => void;
	onInteractOutside?: (
		event: OutsideEvent<PointerEvent> | OutsideEvent<FocusEvent>,
	) => void;
}

interface FocusProps {
	onOpenAutoFocus?: (event: Event) => void;
	onCloseAutoFocus?: (event: Event) => void;
}

type ContentProps = PlacementProps &
	DismissProps &
	FocusProps &
	Omit<JSX.HTMLAttributes<HTMLDivElement>, "ref" | "onKeyDown"> & {
		ref?: JSX.Ref<HTMLDivElement>;
		onKeyDown?: JSX.EventHandler<HTMLDivElement, KeyboardEvent>;
	};

interface OpenProps {
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
}

const isNode = (value: unknown): value is Node =>
	typeof value === "object" && value !== null && "nodeType" in value;
const isElement = (value: unknown): value is HTMLElement =>
	isNode(value) && value.nodeType === 1;

/** Open menus, popovers, tooltips, dialogs and toasts, in the order they opened. */
export interface Layer {
	element?: HTMLElement;
	parent: Layer | null;
	children: Set<Layer>;
	escape?: (event: KeyboardEvent) => void;
	pointerDownOutside?: (event: PointerEvent) => void;
	focusOutside?: (event: FocusEvent) => void;
}

const layers: Layer[] = [];
const branches = new Set<Element>();
const watched = new Map<Document, { count: number; stop: () => void }>();
const modality = new WeakSet<Document>();
let keyboard = false;

const LayerContext = createContext<Layer | null>(null);

const within = (layer: Layer, node: Node): boolean =>
	!!layer.element?.contains(node) ||
	[...layer.children].some((child) => within(child, node));

const inBranch = (node: Node) =>
	[...branches].some((branch) => branch.contains(node));

function trackModality(doc: Document) {
	if (modality.has(doc)) return;
	modality.add(doc);
	doc.addEventListener("keydown", () => (keyboard = true), true);
	const pointer = () => (keyboard = false);
	doc.addEventListener("pointerdown", pointer, true);
	doc.addEventListener("pointermove", pointer, true);
}

let focusGeneration = 0;

export function returnFocusLater(target: Element | null) {
	if (!(target instanceof HTMLElement || target instanceof SVGElement)) return;
	const generation = focusGeneration;
	setTimeout(() => {
		if (generation !== focusGeneration || !target.isConnected) return;
		const active = target.ownerDocument.activeElement;
		if (active && active !== target.ownerDocument.body) return;
		target.dataset.quietFocus = "true";
		target.focus({ preventScroll: true });
		delete target.dataset.quietFocus;
	});
}

function watch(doc: Document) {
	const entry = watched.get(doc);
	if (entry) {
		entry.count++;
		return;
	}
	const inDocument = (layer: Layer) => layer.element?.ownerDocument === doc;
	const keydown = (event: KeyboardEvent) => {
		if (event.key !== "Escape") return;
		if (isNode(event.target) && inBranch(event.target)) return;
		for (let index = layers.length - 1; index >= 0; index--) {
			if (!inDocument(layers[index])) continue;
			layers[index].escape?.(event);
			return;
		}
	};
	const outside = <E extends Event>(
		event: E,
		handler: (layer: Layer) => ((event: E) => void) | undefined,
	) => {
		const target = event.target;
		if (!isNode(target) || inBranch(target)) return;
		for (const layer of [...layers].reverse()) {
			if (inDocument(layer) && !within(layer, target)) handler(layer)?.(event);
		}
	};
	let pendingClick: (() => void) | undefined;
	const pointerdown = (event: PointerEvent) => {
		if (pendingClick) doc.removeEventListener("click", pendingClick, true);
		pendingClick = undefined;
		if (event.pointerType !== "touch") {
			outside(event, (layer) => layer.pointerDownOutside);
			return;
		}
		const click = () => {
			pendingClick = undefined;
			outside(event, (layer) => layer.pointerDownOutside);
		};
		pendingClick = click;
		doc.addEventListener("click", click, { capture: true, once: true });
	};
	const focusin = (event: FocusEvent) =>
		outside(event, (layer) => layer.focusOutside);
	doc.addEventListener("keydown", keydown, true);
	doc.addEventListener("pointerdown", pointerdown, true);
	doc.addEventListener("focusin", focusin, true);
	watched.set(doc, {
		count: 1,
		stop: () => {
			doc.removeEventListener("keydown", keydown, true);
			doc.removeEventListener("pointerdown", pointerdown, true);
			if (pendingClick) doc.removeEventListener("click", pendingClick, true);
			doc.removeEventListener("focusin", focusin, true);
		},
	});
}

function unwatch(doc: Document) {
	const entry = watched.get(doc);
	if (!entry || --entry.count) return;
	entry.stop();
	watched.delete(doc);
}

function attachLayer(layer: Layer, element: HTMLElement) {
	layer.element = element;
	layers.push(layer);
	layer.parent?.children.add(layer);
	watch(element.ownerDocument);
	return () => {
		const index = layers.indexOf(layer);
		if (index >= 0) layers.splice(index, 1);
		layer.parent?.children.delete(layer);
		unwatch(element.ownerDocument);
	};
}

/**
 * Registers an element that escapes, clicks or focus moves outside of. The
 * most recent layer gets Escape. Layers opened from inside another one count
 * as part of it.
 */
export function registerLayer(
	element: HTMLElement,
	handlers: Omit<Layer, "element" | "parent" | "children">,
	parent: Layer | null = null,
) {
	return attachLayer({ ...handlers, parent, children: new Set() }, element);
}

/** Clicks and focus inside a branch, such as the toasts, leave layers open. */
export function registerBranch(element: Element) {
	branches.add(element);
	return () => {
		branches.delete(element);
	};
}

export const useParentLayer = () => useContext(LayerContext);

export function LayerProvider(props: { layer: Layer; children?: JSX.Element }) {
	return <LayerContext value={props.layer}>{props.children}</LayerContext>;
}

export function createLayer(
	parent: Layer | null,
	handlers: Omit<Layer, "element" | "parent" | "children">,
): Layer {
	return { ...handlers, parent, children: new Set() };
}

export { attachLayer };

function outsideEvent<E extends Event>(name: string, originalEvent: E) {
	const event = new CustomEvent(name, {
		cancelable: true,
		detail: { originalEvent },
	});
	originalEvent.target?.dispatchEvent(event);
	return event;
}

const hiddenBy = new WeakMap<Element, number>();

/** Hides everything but `keep` from assistive technology, like a modal does. */
export function hideOthers(keep: Element[]) {
	const body = keep[0]?.ownerDocument.body;
	if (!body) return () => {};
	const hidden: Element[] = [];
	for (const child of body.children) {
		if (
			keep.some((node) => child.contains(node)) ||
			["SCRIPT", "STYLE", "TEMPLATE", "LINK"].includes(child.tagName) ||
			child.hasAttribute("aria-live") ||
			(child.getAttribute("aria-hidden") === "true" && !hiddenBy.has(child))
		)
			continue;
		hiddenBy.set(child, (hiddenBy.get(child) ?? 0) + 1);
		child.setAttribute("aria-hidden", "true");
		hidden.push(child);
	}
	return () => {
		for (const child of hidden) {
			const count = (hiddenBy.get(child) ?? 1) - 1;
			if (count) hiddenBy.set(child, count);
			else {
				hiddenBy.delete(child);
				child.removeAttribute("aria-hidden");
			}
		}
	};
}

const focusableSelector =
	'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex], [contenteditable="true"], a[href]';

export function tabbables(container: HTMLElement, links = true) {
	return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(
		(element) =>
			element.tabIndex >= 0 &&
			(links || element.tagName !== "A") &&
			element.checkVisibility({ visibilityProperty: true }),
	);
}

export function focusElement(element: HTMLElement, select = false) {
	element.focus({ preventScroll: true });
	if (select && element.tagName === "INPUT")
		(element as HTMLInputElement).select();
}

function focusFirst(candidates: HTMLElement[], select = false) {
	const doc = candidates[0]?.ownerDocument;
	for (const candidate of candidates) {
		focusElement(candidate, select);
		if (doc?.activeElement === candidate) return true;
	}
	return false;
}

const opposite = {
	top: "bottom",
	bottom: "top",
	left: "right",
	right: "left",
} as const;

interface PlaceOptions {
	side: Side;
	align: Align;
	sideOffset: number;
	alignOffset: number;
	collisionPadding: number;
}

function place(
	content: HTMLElement,
	anchor: HTMLElement,
	options: PlaceOptions,
	kind: string,
) {
	const root = content.ownerDocument.documentElement;
	const width = root.clientWidth;
	const height = root.clientHeight;
	const pad = options.collisionPadding;
	const gap = options.sideOffset;
	const a = anchor.getBoundingClientRect();
	const vertical = (side: Side) => side === "top" || side === "bottom";
	const measure = () => content.getBoundingClientRect();
	let box = measure();
	const start = (side: Side) => {
		if (side === "top") return a.top - gap - box.height;
		if (side === "bottom") return a.bottom + gap;
		if (side === "left") return a.left - gap - box.width;
		return a.right + gap;
	};
	const overflow = (side: Side) => {
		const at = start(side);
		if (side === "top" || side === "left") return pad - at;
		return vertical(side)
			? at + box.height - (height - pad)
			: at + box.width - (width - pad);
	};
	let side = options.side;
	if (overflow(side) > 0 && overflow(opposite[side]) < overflow(side))
		side = opposite[side];
	const availableHeight = vertical(side)
		? side === "top"
			? a.top - gap - pad
			: height - pad - a.bottom - gap
		: height - 2 * pad;
	const availableWidth = vertical(side)
		? width - 2 * pad
		: side === "left"
			? a.left - gap - pad
			: width - pad - a.right - gap;
	content.style.setProperty(
		`--radix-${kind}-content-available-height`,
		`${Math.max(0, availableHeight)}px`,
	);
	content.style.setProperty(
		`--radix-${kind}-content-available-width`,
		`${Math.max(0, availableWidth)}px`,
	);
	box = measure();
	const isVertical = vertical(side);
	const refStart = isVertical ? a.left : a.top;
	const refSize = isVertical ? a.width : a.height;
	const size = isVertical ? box.width : box.height;
	const limit = isVertical ? width : height;
	let cross =
		options.align === "start"
			? refStart + options.alignOffset
			: options.align === "end"
				? refStart + refSize - size - options.alignOffset
				: refStart + refSize / 2 - size / 2 + options.alignOffset;
	cross = Math.max(pad, Math.min(cross, limit - pad - size));
	cross = Math.max(refStart - size, Math.min(cross, refStart + refSize));
	const main = start(side);
	content.style.left = `${isVertical ? cross : main}px`;
	content.style.top = `${isVertical ? main : cross}px`;
	content.dataset.side = side;
	content.dataset.align = options.align;
}

/**
 * Shows `content` in the top layer next to `anchor` and keeps it there while
 * the page scrolls or resizes.
 */
function float(
	content: HTMLElement,
	anchor: HTMLElement | undefined,
	options: () => PlaceOptions,
	kind: string,
) {
	const view = content.ownerDocument.defaultView ?? window;
	content.style.position = "fixed";
	content.style.inset = "auto";
	content.style.margin = "0";
	content.style.outline = "none";
	content.style.left = "0px";
	content.style.top = "0px";
	if (!content.matches(":popover-open")) content.showPopover();
	if (!anchor) return { update: () => {}, stop: () => {} };
	const update = () => {
		if (anchor.isConnected && content.matches(":popover-open"))
			place(content, anchor, options(), kind);
	};
	update();
	const resized = new view.ResizeObserver(update);
	resized.observe(content);
	resized.observe(anchor);
	view.addEventListener("scroll", update, { capture: true, passive: true });
	view.addEventListener("resize", update);
	return {
		update,
		stop: () => {
			resized.disconnect();
			view.removeEventListener("scroll", update, { capture: true });
			view.removeEventListener("resize", update);
		},
	};
}

interface Disclosure {
	open: Accessor<boolean>;
	/** The open state including a change made earlier in this task. */
	current: () => boolean;
	setOpen: (open: boolean) => void;
	trigger?: HTMLElement;
	contentId: string;
}

function createDisclosure(props: OpenProps): Disclosure {
	const [inner, setInner] = createSignal(() => props.defaultOpen ?? false);
	const open = createMemo(() => props.open ?? inner());
	let pending: boolean | undefined;
	const current = () => pending ?? open();
	return {
		open,
		current,
		setOpen(next) {
			if (next === current()) return;
			pending = next;
			queueMicrotask(() => {
				pending = undefined;
			});
			setInner(next);
			props.onOpenChange?.(next);
		},
		contentId: createUniqueId(),
	};
}

/**
 * Resolves a trigger's single element child, hands it to `setup` and keeps
 * `attributes` on it. Attributes the child sets itself are left alone.
 */
function wire(
	disclosure: Disclosure,
	resolve: () => JSX.Element,
	setup: (element: HTMLElement) => (() => void) | undefined,
	attributes: () => Record<string, string | undefined> = () => ({}),
) {
	const resolved = children(resolve);
	const element = createMemo(() => resolved.toArray().find(isElement));
	createEffect(element, (node) => {
		if (!node) return;
		disclosure.trigger = node;
		trackModality(node.ownerDocument);
		const stop = setup(node);
		return () => {
			stop?.();
			if (disclosure.trigger === node) disclosure.trigger = undefined;
		};
	});
	const authored = new WeakMap<HTMLElement, Set<string>>();
	createEffect(
		() => ({ node: element(), values: attributes() }),
		({ node, values }) => {
			if (!node) return;
			let skip = authored.get(node);
			if (!skip) {
				skip = new Set(
					Object.keys(values).filter((name) => node.hasAttribute(name)),
				);
				authored.set(node, skip);
			}
			for (const [name, value] of Object.entries(values)) {
				if (skip.has(name)) continue;
				if (value === undefined) node.removeAttribute(name);
				else node.setAttribute(name, value);
			}
		},
	);
	return <>{resolved()}</>;
}

const disabled = (element: HTMLElement) =>
	(element as HTMLButtonElement).disabled === true ||
	element.getAttribute("aria-disabled") === "true";

const placement = (
	props: PlacementProps,
	defaults: { side: Side; align: Align },
): PlaceOptions => ({
	side: props.side ?? defaults.side,
	align: props.align ?? defaults.align,
	sideOffset: props.sideOffset ?? 0,
	alignOffset: props.alignOffset ?? 0,
	collisionPadding: props.collisionPadding ?? 0,
});

const contentKeys = [
	"side",
	"align",
	"sideOffset",
	"alignOffset",
	"collisionPadding",
	"onEscapeKeyDown",
	"onPointerDownOutside",
	"onFocusOutside",
	"onInteractOutside",
	"onOpenAutoFocus",
	"onCloseAutoFocus",
	"ref",
	"onKeyDown",
	"children",
] as const;

/**
 * The shared part of a popover or menu: the floating box, dismissal and the
 * focus moving in on open and back to the trigger on close.
 */
function Floating(props: {
	disclosure: Disclosure;
	content: ContentProps;
	kind: "popover" | "dropdown-menu";
	role: JSX.HTMLAttributes<HTMLDivElement>["role"];
	modal: boolean;
	defaults: { side: Side; align: Align };
	attributes?: JSX.HTMLAttributes<HTMLDivElement>;
	onOpen: (element: HTMLElement) => void;
	onKeyDown?: (
		event: KeyboardEvent & { currentTarget: HTMLDivElement },
	) => void;
	children?: JSX.Element;
}) {
	const parent = useParentLayer();
	const rest = omit(props.content, ...contentKeys);
	let element!: HTMLDivElement;
	let interactedOutside = false;
	let floating: ReturnType<typeof float> | undefined;
	const close = () => props.disclosure.setOpen(false);
	const trigger = () => props.disclosure.trigger;
	const onOutside = <E extends PointerEvent | FocusEvent>(
		event: E,
		name: string,
		handler: ((event: OutsideEvent<E>) => void) | undefined,
	) => {
		const target = event.target;
		if (isNode(target) && trigger()?.contains(target)) return;
		if (props.modal && event.type === "focusin") return;
		const outside = outsideEvent(name, event);
		handler?.(outside);
		props.content.onInteractOutside?.(outside);
		if (outside.defaultPrevented) return;
		const pointer = event as PointerEvent;
		const rightClick =
			event.type === "pointerdown" &&
			(pointer.button === 2 || (pointer.button === 0 && pointer.ctrlKey));
		if (!props.modal || rightClick) interactedOutside = true;
		close();
	};
	const layer = createLayer(parent, {
		escape(event) {
			props.content.onEscapeKeyDown?.(event);
			if (event.defaultPrevented) return;
			event.preventDefault();
			close();
		},
		pointerDownOutside: (event) =>
			onOutside(
				event,
				"dismissableLayer.pointerDownOutside",
				props.content.onPointerDownOutside,
			),
		focusOutside: (event) =>
			onOutside(
				event,
				"dismissableLayer.focusOutside",
				props.content.onFocusOutside,
			),
	});
	onSettled(() => {
		const anchor = trigger();
		floating = float(
			element,
			anchor,
			() => placement(props.content, props.defaults),
			props.kind,
		);
		const detach = attachLayer(layer, element);
		const doc = element.ownerDocument;
		let restore = () => {};
		let pointerEvents: string | undefined;
		if (props.modal) {
			restore = hideOthers([element]);
			pointerEvents = doc.body.style.pointerEvents;
			doc.body.style.pointerEvents = "none";
			element.style.pointerEvents = "auto";
		}
		focusGeneration++;
		const opening = new Event("openAutoFocus", { cancelable: true });
		props.content.onOpenAutoFocus?.(opening);
		if (!opening.defaultPrevented) props.onOpen(element);
		const onClose = props.content.onCloseAutoFocus;
		return () => {
			floating?.stop();
			floating = undefined;
			detach();
			restore();
			if (pointerEvents !== undefined)
				doc.body.style.pointerEvents = pointerEvents;
			const returnTo = interactedOutside ? undefined : anchor;
			const generation = focusGeneration;
			setTimeout(() => {
				if (generation !== focusGeneration) return;
				const closing = new Event("closeAutoFocus", { cancelable: true });
				onClose?.(closing);
				if (!closing.defaultPrevented && returnTo?.isConnected)
					returnTo.focus({ preventScroll: true });
			});
		};
	});
	createEffect(
		() => placement(props.content, props.defaults),
		() => {
			floating?.update();
		},
	);
	return (
		<Portal mount={trigger()?.ownerDocument.body}>
			<LayerContext value={layer}>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: the role comes from the caller, a menu or a dialog */}
				<div
					popover="manual"
					role={props.role}
					id={props.disclosure.contentId}
					tabindex="-1"
					data-state="open"
					{...props.attributes}
					{...rest}
					ref={[(node: HTMLDivElement) => (element = node), props.content.ref]}
					onKeyDown={(event) => {
						props.content.onKeyDown?.(event);
						props.onKeyDown?.(event);
					}}
				>
					{props.children}
				</div>
			</LayerContext>
		</Portal>
	);
}

/* Tooltip */

interface TooltipProviderValue {
	readonly delayDuration: number;
	readonly skipDelayDuration: number;
	delayed: boolean;
	skipTimer?: ReturnType<typeof setTimeout>;
}

const defaultTooltipProvider: TooltipProviderValue = {
	delayDuration: 700,
	skipDelayDuration: 300,
	delayed: true,
};

const TooltipProviderContext = createContext<TooltipProviderValue | null>(null);

interface TooltipRootValue extends Disclosure {
	state: Accessor<"delayed-open" | "instant-open">;
	enter: () => void;
	leave: (next: EventTarget | null) => void;
	show: () => void;
	hide: () => void;
	content?: HTMLElement;
}

const TooltipRootContext = createContext<TooltipRootValue>();
let activeTooltip: TooltipRootValue | undefined;

function TooltipProvider(props: {
	delayDuration?: number;
	skipDelayDuration?: number;
	children?: JSX.Element;
}) {
	const value: TooltipProviderValue = {
		get delayDuration() {
			return props.delayDuration ?? 700;
		},
		get skipDelayDuration() {
			return props.skipDelayDuration ?? 300;
		},
		delayed: true,
	};
	return (
		<TooltipProviderContext value={value}>
			{props.children}
		</TooltipProviderContext>
	);
}

function TooltipRoot(
	props: OpenProps & { delayDuration?: number; children?: JSX.Element },
) {
	const provider = useContext(TooltipProviderContext) ?? defaultTooltipProvider;
	const disclosure = createDisclosure(props);
	const [state, setState] = createSignal<"delayed-open" | "instant-open">(
		"delayed-open",
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const open = (next: "delayed-open" | "instant-open") => {
		clearTimeout(timer);
		timer = undefined;
		if (activeTooltip && activeTooltip !== root) activeTooltip.hide();
		activeTooltip = root;
		clearTimeout(provider.skipTimer);
		provider.delayed = false;
		setState(next);
		disclosure.setOpen(true);
	};
	const root: TooltipRootValue = {
		...disclosure,
		state,
		enter() {
			if (!provider.delayed) {
				open("instant-open");
				return;
			}
			clearTimeout(timer);
			timer = setTimeout(
				() => open("delayed-open"),
				props.delayDuration ?? provider.delayDuration,
			);
		},
		leave(next) {
			clearTimeout(timer);
			timer = undefined;
			if (isNode(next) && root.content?.contains(next)) return;
			root.hide();
		},
		show: () => open("instant-open"),
		hide() {
			clearTimeout(timer);
			timer = undefined;
			if (activeTooltip === root) activeTooltip = undefined;
			if (!disclosure.current()) return;
			disclosure.setOpen(false);
			clearTimeout(provider.skipTimer);
			provider.skipTimer = setTimeout(() => {
				provider.delayed = true;
			}, provider.skipDelayDuration);
		},
	};
	onSettled(() => () => {
		clearTimeout(timer);
		if (activeTooltip === root) activeTooltip = undefined;
	});
	return <TooltipRootContext value={root}>{props.children}</TooltipRootContext>;
}

function TooltipTrigger(props: { children: JSX.Element }) {
	const root = useContext(TooltipRootContext);
	return wire(
		root,
		() => props.children,
		(element) => {
			const doc = element.ownerDocument;
			let moved = false;
			let pressed = false;
			const release = () => (pressed = false);
			const listeners: [string, (event: never) => void][] = [
				[
					"pointermove",
					(event: PointerEvent) => {
						if (event.pointerType === "touch" || moved) return;
						moved = true;
						root.enter();
					},
				],
				[
					"pointerleave",
					(event: PointerEvent) => {
						moved = false;
						root.leave(event.relatedTarget);
					},
				],
				[
					"pointerdown",
					() => {
						root.hide();
						pressed = true;
						doc.addEventListener("pointerup", release, { once: true });
					},
				],
				[
					"focus",
					() => {
						if (!pressed) root.show();
					},
				],
				["blur", () => root.hide()],
				["click", () => root.hide()],
			];
			for (const [type, listener] of listeners)
				element.addEventListener(type, listener as EventListener);
			return () => {
				for (const [type, listener] of listeners)
					element.removeEventListener(type, listener as EventListener);
				doc.removeEventListener("pointerup", release);
			};
		},
		() => ({
			"aria-describedby": root.open() ? root.contentId : undefined,
		}),
	);
}

function TooltipContent(
	props: PlacementProps &
		Pick<DismissProps, "onEscapeKeyDown" | "onPointerDownOutside"> &
		Omit<JSX.HTMLAttributes<HTMLDivElement>, "ref"> & {
			ref?: JSX.Ref<HTMLDivElement>;
		},
) {
	const root = useContext(TooltipRootContext);
	return (
		<Show when={root.open()}>
			<TooltipFloating root={root} content={props} />
		</Show>
	);
}

function TooltipFloating(props: {
	root: TooltipRootValue;
	content: Parameters<typeof TooltipContent>[0];
}) {
	const parent = useParentLayer();
	const rest = omit(
		props.content,
		"side",
		"align",
		"sideOffset",
		"alignOffset",
		"collisionPadding",
		"onEscapeKeyDown",
		"onPointerDownOutside",
		"ref",
		"children",
	);
	let element!: HTMLDivElement;
	let floating: ReturnType<typeof float> | undefined;
	const options = () =>
		placement(props.content, { side: "top", align: "center" });
	onSettled(() => {
		const anchor = props.root.trigger;
		const view = element.ownerDocument.defaultView ?? window;
		props.root.content = element;
		floating = float(element, anchor, options, "tooltip");
		const detach = registerLayer(
			element,
			{
				escape: (event) => {
					props.content.onEscapeKeyDown?.(event);
					if (event.defaultPrevented) return;
					event.preventDefault();
					props.root.hide();
				},
				pointerDownOutside: (event) => {
					const outside = outsideEvent(
						"dismissableLayer.pointerDownOutside",
						event,
					);
					props.content.onPointerDownOutside?.(outside);
					if (!outside.defaultPrevented) props.root.hide();
				},
			},
			parent,
		);
		const scrolled = (event: Event) => {
			if (anchor && isNode(event.target) && event.target.contains(anchor))
				props.root.hide();
		};
		view.addEventListener("scroll", scrolled, { capture: true });
		return () => {
			floating?.stop();
			floating = undefined;
			detach();
			view.removeEventListener("scroll", scrolled, { capture: true });
			if (props.root.content === element) props.root.content = undefined;
		};
	});
	createEffect(options, () => {
		floating?.update();
	});
	return (
		<Portal mount={props.root.trigger?.ownerDocument.body}>
			<div
				popover="manual"
				role="tooltip"
				id={props.root.contentId}
				data-state={props.root.state()}
				{...rest}
				ref={[(node: HTMLDivElement) => (element = node), props.content.ref]}
				onPointerLeave={(event) => {
					const next = event.relatedTarget;
					if (isNode(next) && props.root.trigger?.contains(next)) return;
					props.root.hide();
				}}
			>
				{props.content.children}
			</div>
		</Portal>
	);
}

const Passthrough = (props: { children?: JSX.Element }) => (
	<>{props.children}</>
);

export const Tooltip = {
	Provider: TooltipProvider,
	Root: TooltipRoot,
	Trigger: TooltipTrigger,
	Portal: Passthrough,
	Content: TooltipContent,
};

/* Popover */

const PopoverContext = createContext<Disclosure & { modal: boolean }>();

function PopoverRoot(
	props: OpenProps & { modal?: boolean; children?: JSX.Element },
) {
	const disclosure = createDisclosure(props);
	const value = {
		...disclosure,
		get modal() {
			return props.modal ?? false;
		},
	};
	return <PopoverContext value={value}>{props.children}</PopoverContext>;
}

function PopoverTrigger(props: { children: JSX.Element }) {
	const root = useContext(PopoverContext);
	return wire(
		root,
		() => props.children,
		(element) => {
			const click = () => {
				if (!disabled(element)) root.setOpen(!root.current());
			};
			element.addEventListener("click", click);
			return () => element.removeEventListener("click", click);
		},
		() => ({
			"aria-haspopup": "dialog",
			"aria-expanded": root.open() ? "true" : "false",
			"aria-controls": root.open() ? root.contentId : undefined,
			"data-state": root.open() ? "open" : "closed",
		}),
	);
}

function PopoverContent(props: ContentProps) {
	const root = useContext(PopoverContext);
	return (
		<Show when={root.open()}>
			<Floating
				disclosure={root}
				content={props}
				kind="popover"
				role="dialog"
				modal={false}
				defaults={{ side: "bottom", align: "center" }}
				onOpen={(element) => {
					if (!focusFirst(tabbables(element, false), true))
						element.focus({ preventScroll: true });
				}}
			>
				{props.children}
			</Floating>
		</Show>
	);
}

export const Popover = {
	Root: PopoverRoot,
	Trigger: PopoverTrigger,
	Portal: Passthrough,
	Content: PopoverContent,
};

/* Dropdown menu */

interface MenuRootValue extends Disclosure {
	modal: boolean;
	triggerId: string;
}

const MenuRootContext = createContext<MenuRootValue>();

interface MenuContentValue {
	typing: () => boolean;
	focusContent: () => void;
	select: () => void;
}

const MenuContentContext = createContext<MenuContentValue>();

function DropdownMenuRoot(
	props: OpenProps & { modal?: boolean; children?: JSX.Element },
) {
	const disclosure = createDisclosure(props);
	const value: MenuRootValue = {
		...disclosure,
		get modal() {
			return props.modal ?? true;
		},
		triggerId: createUniqueId(),
	};
	return <MenuRootContext value={value}>{props.children}</MenuRootContext>;
}

function DropdownMenuTrigger(props: { children: JSX.Element }) {
	const root = useContext(MenuRootContext);
	return wire(
		root,
		() => props.children,
		(element) => {
			const pointerdown = (event: PointerEvent) => {
				if (disabled(element) || event.button !== 0 || event.ctrlKey) return;
				const open = root.current();
				root.setOpen(!open);
				if (!open) event.preventDefault();
			};
			const keydown = (event: KeyboardEvent) => {
				if (disabled(element)) return;
				if (event.key === "Enter" || event.key === " ")
					root.setOpen(!root.current());
				else if (event.key === "ArrowDown") root.setOpen(true);
				else return;
				event.preventDefault();
			};
			element.addEventListener("pointerdown", pointerdown);
			element.addEventListener("keydown", keydown);
			return () => {
				element.removeEventListener("pointerdown", pointerdown);
				element.removeEventListener("keydown", keydown);
			};
		},
		() => ({
			id: root.triggerId,
			"aria-haspopup": "menu",
			"aria-expanded": root.open() ? "true" : "false",
			"aria-controls": root.open() ? root.contentId : undefined,
			"data-state": root.open() ? "open" : "closed",
		}),
	);
}

const menuItems = (content: HTMLElement) =>
	[...content.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
		(item) => !item.hasAttribute("data-disabled"),
	);

function DropdownMenuContent(props: ContentProps) {
	const root = useContext(MenuRootContext);
	let element: HTMLElement | undefined;
	let search = "";
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	const typeahead = (key: string) => {
		if (!element) return;
		search += key;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => (search = ""), 1000);
		const items = menuItems(element);
		const current = items.find(
			(item) => item === element?.ownerDocument.activeElement,
		);
		const repeated =
			search.length > 1 && [...search].every((c) => c === search[0]);
		const query = (repeated ? search[0] : search).toLowerCase();
		const from = Math.max(current ? items.indexOf(current) : 0, 0);
		let ordered = [...items.slice(from), ...items.slice(0, from)];
		if (query.length === 1)
			ordered = ordered.filter((item) => item !== current);
		const match = ordered.find((item) =>
			(item.dataset.textValue ?? item.textContent ?? "")
				.trim()
				.toLowerCase()
				.startsWith(query),
		);
		match?.focus({ preventScroll: true });
	};
	const menu: MenuContentValue = {
		typing: () => search !== "",
		focusContent: () => element?.focus({ preventScroll: true }),
		select: () => onFlush(() => root.setOpen(false)),
	};
	return (
		<Show when={root.open()}>
			<MenuContentContext value={menu}>
				<Floating
					disclosure={root}
					content={props}
					kind="dropdown-menu"
					role="menu"
					modal={root.modal}
					defaults={{ side: "bottom", align: "center" }}
					attributes={{
						"aria-orientation": "vertical",
						"aria-labelledby": props["aria-label"]
							? undefined
							: root.trigger?.id,
					}}
					onOpen={(node) => {
						element = node;
						node.focus({ preventScroll: true });
						if (keyboard) focusFirst(menuItems(node));
					}}
					onKeyDown={(event) => {
						const content = event.currentTarget;
						element = content;
						const target = event.target as Element;
						if (target.closest('[role="menu"]') !== content) return;
						if (event.key === "Tab") event.preventDefault();
						if (
							!event.ctrlKey &&
							!event.altKey &&
							!event.metaKey &&
							event.key.length === 1
						)
							typeahead(event.key);
						const keys = [
							"ArrowDown",
							"ArrowUp",
							"Home",
							"End",
							"PageUp",
							"PageDown",
						];
						if (!keys.includes(event.key)) return;
						event.preventDefault();
						const items = menuItems(content);
						if (!items.length) return;
						const last = ["ArrowUp", "End", "PageDown"].includes(event.key);
						if (target === content) {
							focusFirst(last ? [...items].reverse() : items);
							return;
						}
						const index = items.indexOf(target as HTMLElement);
						const next =
							event.key === "Home" || event.key === "PageUp"
								? 0
								: event.key === "End" || event.key === "PageDown"
									? items.length - 1
									: Math.max(
											0,
											Math.min(
												items.length - 1,
												index + (event.key === "ArrowDown" ? 1 : -1),
											),
										);
						items[next]?.focus({ preventScroll: true });
					}}
				>
					{props.children}
				</Floating>
			</MenuContentContext>
		</Show>
	);
}

function DropdownMenuItem(
	props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "onSelect"> & {
		onSelect?: (event: Event) => void;
		disabled?: boolean;
		textValue?: string;
	},
) {
	const menu = useContext(MenuContentContext);
	const [highlighted, setHighlighted] = createSignal(false);
	const rest = omit(props, "onSelect", "disabled", "textValue", "children");
	return (
		// biome-ignore lint/a11y/useFocusableInteractive: Biome does not read Solid's lowercase tabindex
		<div
			{...rest}
			role="menuitem"
			tabindex="-1"
			aria-disabled={props.disabled ? "true" : undefined}
			data-disabled={props.disabled ? "" : undefined}
			data-highlighted={highlighted() ? "" : undefined}
			data-text-value={props.textValue}
			onClick={(event) => {
				if (props.disabled) return;
				const item = event.currentTarget;
				const selected = new CustomEvent("menu.itemSelect", {
					bubbles: true,
					cancelable: true,
				});
				item.addEventListener(
					"menu.itemSelect",
					(selectEvent) => props.onSelect?.(selectEvent),
					{ once: true },
				);
				item.dispatchEvent(selected);
				if (!selected.defaultPrevented) menu.select();
			}}
			onKeyDown={(event) => {
				if (props.disabled || (menu.typing() && event.key === " ")) return;
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				event.currentTarget.click();
			}}
			onPointerMove={(event) => {
				if (event.pointerType !== "mouse") return;
				if (props.disabled) {
					menu.focusContent();
					return;
				}
				const item = event.currentTarget;
				if (item.ownerDocument.activeElement !== item)
					item.focus({ preventScroll: true });
			}}
			onPointerLeave={(event) => {
				if (event.pointerType === "mouse") menu.focusContent();
			}}
			onFocus={() => setHighlighted(true)}
			onBlur={() => setHighlighted(false)}
		>
			{props.children}
		</div>
	);
}

function DropdownMenuLabel(props: JSX.HTMLAttributes<HTMLDivElement>) {
	return <div {...props} />;
}

function DropdownMenuSeparator(props: JSX.HTMLAttributes<HTMLDivElement>) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: an hr brings a border that the separator classes do not expect
		// biome-ignore lint/a11y/useFocusableInteractive: a menu separator is not focusable
		// biome-ignore lint/a11y/useAriaPropsForRole: a static separator has no value
		<div role="separator" aria-orientation="horizontal" {...props} />
	);
}

export const DropdownMenu = {
	Root: DropdownMenuRoot,
	Trigger: DropdownMenuTrigger,
	Portal: Passthrough,
	Content: DropdownMenuContent,
	Item: DropdownMenuItem,
	Label: DropdownMenuLabel,
	Separator: DropdownMenuSeparator,
};
