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
	collisionPadding?: number;
}

interface FocusProps {
	onFocusOutside?: (event: CustomEvent<{ originalEvent: FocusEvent }>) => void;
	onOpenAutoFocus?: (event: Event) => void;
	onCloseAutoFocus?: (event: Event) => void;
}

type ContentProps = PlacementProps &
	FocusProps &
	Omit<JSX.HTMLAttributes<HTMLDivElement>, "ref" | "onKeyDown"> & {
		ref?: JSX.Ref<HTMLDivElement>;
		onKeyDown?: JSX.EventHandler<HTMLDivElement, KeyboardEvent>;
	};

interface OpenProps {
	open: boolean;
	onOpenChange?: (open: boolean) => void;
}

const isNode = (value: unknown): value is Node =>
	typeof value === "object" && value !== null && "nodeType" in value;
const isElement = (value: unknown): value is HTMLElement =>
	isNode(value) && value.nodeType === 1;

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

export const LayerContext = createContext<Layer | null>(null);

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

export function attachLayer(layer: Layer, element: HTMLElement) {
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

export function registerBranch(element: Element) {
	branches.add(element);
	return () => {
		branches.delete(element);
	};
}

export function createLayer(
	parent: Layer | null,
	handlers: Omit<Layer, "element" | "parent" | "children">,
): Layer {
	return { ...handlers, parent, children: new Set() };
}

const hiddenBy = new WeakMap<Element, number>();

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
			? refStart
			: options.align === "end"
				? refStart + refSize - size
				: refStart + refSize / 2 - size / 2;
	cross = Math.max(pad, Math.min(cross, limit - pad - size));
	cross = Math.max(refStart - size, Math.min(cross, refStart + refSize));
	const main = start(side);
	content.style.left = `${isVertical ? cross : main}px`;
	content.style.top = `${isVertical ? main : cross}px`;
	content.dataset.side = side;
	content.dataset.align = options.align;
}

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
	current: () => boolean;
	setOpen: (open: boolean) => void;
	trigger?: HTMLElement;
	contentId: string;
}

function createDisclosure(
	open: Accessor<boolean>,
	onOpenChange: (open: boolean) => void,
): Disclosure {
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
			onOpenChange(next);
		},
		contentId: createUniqueId(),
	};
}

const controlled = (props: OpenProps) =>
	createDisclosure(
		() => props.open,
		(next) => props.onOpenChange?.(next),
	);

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
	collisionPadding: props.collisionPadding ?? 0,
});

const contentKeys = [
	"side",
	"align",
	"sideOffset",
	"collisionPadding",
	"onFocusOutside",
	"onOpenAutoFocus",
	"onCloseAutoFocus",
	"ref",
	"onKeyDown",
	"children",
] as const;

function Floating(props: {
	disclosure: Disclosure;
	content: ContentProps;
	kind: "popover" | "dropdown-menu";
	role: JSX.HTMLAttributes<HTMLDivElement>["role"];
	defaults: { side: Side; align: Align };
	attributes?: JSX.HTMLAttributes<HTMLDivElement>;
	onOpen: (element: HTMLElement) => void;
	onKeyDown?: (
		event: KeyboardEvent & { currentTarget: HTMLDivElement },
	) => void;
	children?: JSX.Element;
}) {
	const rest = omit(props.content, ...contentKeys);
	let element!: HTMLDivElement;
	let interactedOutside = false;
	let floating: ReturnType<typeof float> | undefined;
	const close = () => props.disclosure.setOpen(false);
	const trigger = () => props.disclosure.trigger;
	const onTrigger = (target: EventTarget | null) =>
		isNode(target) && !!trigger()?.contains(target);
	const layer = createLayer(useContext(LayerContext), {
		escape(event) {
			if (event.defaultPrevented) return;
			event.preventDefault();
			close();
		},
		pointerDownOutside(event) {
			if (onTrigger(event.target)) return;
			interactedOutside = true;
			close();
		},
		focusOutside(event) {
			if (onTrigger(event.target)) return;
			const outside = new CustomEvent("dismissableLayer.focusOutside", {
				cancelable: true,
				detail: { originalEvent: event },
			});
			event.target?.dispatchEvent(outside);
			props.content.onFocusOutside?.(outside);
			if (outside.defaultPrevented) return;
			interactedOutside = true;
			close();
		},
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
		focusGeneration++;
		const opening = new Event("openAutoFocus", { cancelable: true });
		props.content.onOpenAutoFocus?.(opening);
		if (!opening.defaultPrevented) props.onOpen(element);
		const onClose = props.content.onCloseAutoFocus;
		return () => {
			floating?.stop();
			floating = undefined;
			detach();
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

let activeTooltip: { hide: () => void } | undefined;

export function TooltipProvider(props: {
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

type TooltipProps = PlacementProps &
	Omit<JSX.HTMLAttributes<HTMLDivElement>, "content" | "children"> & {
		content: JSX.Element;
		children: JSX.Element;
	};

export function Tooltip(props: TooltipProps) {
	const provider = useContext(TooltipProviderContext) ?? defaultTooltipProvider;
	const [open, setOpen] = createSignal(false);
	const disclosure = createDisclosure(open, (next) => {
		const active = document.activeElement;
		if (
			next &&
			active instanceof HTMLElement &&
			active.dataset.quietFocus === "true"
		)
			return;
		setOpen(next);
	});
	const [state, setState] = createSignal<"delayed-open" | "instant-open">(
		"delayed-open",
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let content: HTMLElement | undefined;
	const show = (next: "delayed-open" | "instant-open") => {
		clearTimeout(timer);
		timer = undefined;
		if (activeTooltip && activeTooltip !== root) activeTooltip.hide();
		activeTooltip = root;
		clearTimeout(provider.skipTimer);
		provider.delayed = false;
		setState(next);
		disclosure.setOpen(true);
	};
	const root = {
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
	const trigger = wire(
		disclosure,
		() => props.children,
		(element) => {
			const doc = element.ownerDocument;
			let moved = false;
			let pressed = false;
			const release = () => (pressed = false);
			const listeners = {
				pointermove(event: PointerEvent) {
					if (event.pointerType === "touch" || moved) return;
					moved = true;
					if (!provider.delayed) {
						show("instant-open");
						return;
					}
					clearTimeout(timer);
					timer = setTimeout(
						() => show("delayed-open"),
						provider.delayDuration,
					);
				},
				pointerleave(event: PointerEvent) {
					moved = false;
					clearTimeout(timer);
					timer = undefined;
					const next = event.relatedTarget;
					if (!isNode(next) || !content?.contains(next)) root.hide();
				},
				pointerdown() {
					root.hide();
					pressed = true;
					doc.addEventListener("pointerup", release, { once: true });
				},
				focus() {
					if (!pressed) show("instant-open");
				},
				blur: root.hide,
				click: root.hide,
			};
			for (const [type, listener] of Object.entries(listeners))
				element.addEventListener(type, listener as EventListener);
			return () => {
				for (const [type, listener] of Object.entries(listeners))
					element.removeEventListener(type, listener as EventListener);
				doc.removeEventListener("pointerup", release);
			};
		},
		() => ({
			"aria-describedby": open() ? disclosure.contentId : undefined,
		}),
	);
	const rest = omit(
		props,
		"side",
		"align",
		"sideOffset",
		"collisionPadding",
		"content",
		"children",
	);
	const TooltipContent = () => {
		const parent = useContext(LayerContext);
		let element!: HTMLDivElement;
		let floating: ReturnType<typeof float> | undefined;
		const options = () => placement(props, { side: "top", align: "center" });
		onSettled(() => {
			const anchor = disclosure.trigger;
			const view = element.ownerDocument.defaultView ?? window;
			content = element;
			floating = float(element, anchor, options, "tooltip");
			const detach = attachLayer(
				createLayer(parent, {
					escape(event) {
						if (event.defaultPrevented) return;
						event.preventDefault();
						root.hide();
					},
					pointerDownOutside: root.hide,
				}),
				element,
			);
			const scrolled = (event: Event) => {
				if (anchor && isNode(event.target) && event.target.contains(anchor))
					root.hide();
			};
			view.addEventListener("scroll", scrolled, { capture: true });
			return () => {
				floating?.stop();
				floating = undefined;
				detach();
				view.removeEventListener("scroll", scrolled, { capture: true });
				if (content === element) content = undefined;
			};
		});
		createEffect(options, () => {
			floating?.update();
		});
		return (
			<Portal mount={disclosure.trigger?.ownerDocument.body}>
				<div
					popover="manual"
					role="tooltip"
					id={disclosure.contentId}
					data-state={state()}
					{...rest}
					ref={(node: HTMLDivElement) => (element = node)}
					onPointerLeave={(event) => {
						const next = event.relatedTarget;
						if (isNode(next) && disclosure.trigger?.contains(next)) return;
						root.hide();
					}}
				>
					{props.content}
				</div>
			</Portal>
		);
	};
	return (
		<>
			{trigger}
			<Show when={open()}>
				<TooltipContent />
			</Show>
		</>
	);
}

/* Popover */

const PopoverContext = createContext<Disclosure>();

function PopoverRoot(props: OpenProps & { children?: JSX.Element }) {
	return (
		<PopoverContext value={controlled(props)}>{props.children}</PopoverContext>
	);
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
	Content: PopoverContent,
};

/* Dropdown menu */

interface MenuRootValue extends Disclosure {
	triggerId: string;
}

const MenuRootContext = createContext<MenuRootValue>();

interface MenuContentValue {
	typing: () => boolean;
	focusContent: () => void;
	select: () => void;
}

const MenuContentContext = createContext<MenuContentValue>();

function DropdownMenuRoot(props: OpenProps & { children?: JSX.Element }) {
	const value = { ...controlled(props), triggerId: createUniqueId() };
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
			(item.textContent ?? "").trim().toLowerCase().startsWith(query),
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
		onSelect?: () => void;
		disabled?: boolean;
	},
) {
	const menu = useContext(MenuContentContext);
	const [highlighted, setHighlighted] = createSignal(false);
	const rest = omit(props, "onSelect", "disabled", "children");
	return (
		// biome-ignore lint/a11y/useFocusableInteractive: Biome does not read Solid's lowercase tabindex
		<div
			{...rest}
			role="menuitem"
			tabindex="-1"
			aria-disabled={props.disabled ? "true" : undefined}
			data-disabled={props.disabled ? "" : undefined}
			data-highlighted={highlighted() ? "" : undefined}
			onClick={() => {
				if (props.disabled) return;
				props.onSelect?.();
				menu.select();
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
	Content: DropdownMenuContent,
	Item: DropdownMenuItem,
	Separator: DropdownMenuSeparator,
};
