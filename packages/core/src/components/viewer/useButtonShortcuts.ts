import { ArrowBigUp, ChevronUp, createElement } from "lucide";
import { useEffect } from "react";
import { measurePerformance } from "#/performance/runtime.ts";

const editorKeys: Record<string, string> = {
	Shapes: "S",
	Connections: "J",
	"History tools": "H",
	"View tools": "B",
	Select: "Q",
	Pan: "P",
	Rectangle: "R",
	Circle: "O",
	Triangle: "3",
	Line: "I",
	Text: "E",
	Wire: "U",
	Pin: "4",
	"Net label": "5",
	"Supply label": "6",
	"Snap to grid": "G",
	"Select locked items": "K",
	Undo: "Z",
	Redo: "Y",
	History: "7",
	Delete: "D",
	"Rotate counterclockwise": "[",
	"Rotate clockwise": "]",
	"Lock selection": "9",
	"Zoom out": "-",
	"Zoom in": "+",
	"Fit drawing": "F",
};
const sidebarKeys: Record<string, string> = {
	"Pin sidebar": "S",
	"Compact sidebar": "S",
	"Show project files": "B",
	"Add file": "N",
};
const labelFor = (button: HTMLButtonElement) =>
	button.getAttribute("aria-label") ??
	button.getAttribute("title") ??
	button.textContent?.trim() ??
	"";
const scopeFor = (button: HTMLButtonElement) =>
	button.closest('[data-shortcut-scope="sidebar"]') ? "sidebar" : "editor";
const keyFor = (event: KeyboardEvent) => {
	if (event.key === "=") return "+";
	if (
		event.shiftKey &&
		/^Digit\d$/.test(event.code) &&
		!/^[A-Z0-9+-]$/i.test(event.key)
	)
		return event.code.slice(5);
	return event.key.toUpperCase();
};

let users = 0;
let dispose: (() => void) | undefined;

function listen() {
	const overlay = document.createElement("div");
	overlay.className = "button-shortcuts";
	overlay.setAttribute("popover", "manual");
	overlay.setAttribute("aria-hidden", "true");
	document.body.append(overlay);
	let held = false;
	let frame = 0;
	const keys = new Map<HTMLButtonElement, string>();
	let targets = new Map<string, HTMLButtonElement>();
	const hide = () => {
		held = false;
		observer.disconnect();
		keys.clear();
		targets.clear();
		cancelAnimationFrame(frame);
		frame = 0;
		overlay.replaceChildren();
		if (overlay.matches(":popover-open")) overlay.hidePopover();
	};
	const visible = (button: HTMLButtonElement) => {
		if (
			!button.checkVisibility({
				visibilityProperty: true,
				opacityProperty: true,
			}) ||
			button.closest('[inert], [aria-hidden="true"]')
		)
			return false;
		const rect = button.getBoundingClientRect();
		let left = Math.max(0, rect.left);
		let top = Math.max(0, rect.top);
		let right = Math.min(innerWidth, rect.right);
		let bottom = Math.min(innerHeight, rect.bottom);
		for (
			let parent = button.parentElement;
			parent;
			parent = parent.parentElement
		) {
			const style = getComputedStyle(parent);
			const bounds = parent.getBoundingClientRect();
			if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
				left = Math.max(left, bounds.left);
				right = Math.min(right, bounds.right);
			}
			if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
				top = Math.max(top, bounds.top);
				bottom = Math.min(bottom, bounds.bottom);
			}
		}
		return right > left && bottom > top;
	};
	const refresh = () => {
		frame = 0;
		if (!held) return;
		measurePerformance(
			"ui.button-shortcuts",
			() => {
				const dialogs = [
					...document.querySelectorAll<HTMLElement>(
						'dialog[open], [role="dialog"]',
					),
				].filter(
					(dialog) =>
						dialog.checkVisibility({
							visibilityProperty: true,
							opacityProperty: true,
						}) && !dialog.closest('[inert], [aria-hidden="true"]'),
				);
				const scope = dialogs.at(-1) ?? document;
				const buttons = [
					...scope.querySelectorAll<HTMLButtonElement>("button"),
				].filter(visible);
				for (const button of keys.keys()) {
					if (!button.isConnected) keys.delete(button);
				}
				const fragment = document.createDocumentFragment();

				targets = new Map();
				for (const button of buttons) {
					const scope = scopeFor(button);
					const sidebar = scope === "sidebar";
					const label = labelFor(button);
					const preferred = sidebar ? sidebarKeys : editorKeys;
					let key = keys.get(button);
					if (!key) {
						const reserved = new Set(Object.values(preferred));
						const available = (candidate: string) =>
							![...keys].some(
								([other, assigned]) =>
									scopeFor(other) === scope && assigned === candidate,
							);
						const candidates = [
							preferred[label],
							...label.toUpperCase().replace(/[^A-Z0-9]/g, ""),
							..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+-",
							...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
						];
						key = candidates.find(
							(candidate) =>
								candidate &&
								available(candidate) &&
								(candidate === preferred[label] || !reserved.has(candidate)) &&
								(sidebar ||
									!["A", "C", "V", "X", "L", "N", "T", "W"].includes(
										candidate,
									)),
						);
						if (!key) continue;
						keys.set(button, key);
					}
					targets.set(`${scope}:${key}`, button);
					const rect = button.getBoundingClientRect();
					const hint = document.createElement("kbd");
					hint.dataset.slot = "button-shortcut";
					hint.dataset.shortcut = key;
					hint.dataset.scope = scope;
					const modifier = createElement(ChevronUp, {
						class: "lucide lucide-chevron-up",
						"aria-label": "Control",
						"data-slot": "modifier-icon",
					});
					hint.append(modifier);
					if (sidebar) {
						hint.append(
							createElement(ArrowBigUp, {
								class: "lucide lucide-arrow-big-up",
								"aria-label": "Shift",
								"data-slot": "shift-icon",
							}),
						);
					}
					const keyLabel = document.createElement("span");
					keyLabel.textContent = key;
					hint.append(keyLabel);
					hint.title = label;
					hint.setAttribute(
						"aria-label",
						`Control+${sidebar ? "Shift+" : ""}${key}`,
					);
					const width = sidebar ? 32 : 23;
					hint.style.width = `${width}px`;
					hint.style.left = `${Math.max(2, Math.min(innerWidth - width - 2, rect.left + (rect.width - width) / 2))}px`;
					hint.style.top = `${Math.max(2, rect.top - 18)}px`;
					hint.dataset.disabled = String(
						button.disabled || button.getAttribute("aria-disabled") === "true",
					);
					fragment.append(hint);
				}
				overlay.replaceChildren(fragment);
				if (!overlay.matches(":popover-open")) overlay.showPopover();
			},
			{ buttons: targets.size },
		);
	};
	const schedule = () => {
		if (held && !frame) frame = requestAnimationFrame(refresh);
	};
	const keydown = (event: KeyboardEvent) => {
		if (event.key === "Control" && !event.repeat && !held) {
			held = true;
			observer.observe(document.body, observation);
			refresh();
			return;
		}
		if (!held || event.defaultPrevented) return;
		if (event.key === "Escape") {
			hide();
			return;
		}
		if (!event.ctrlKey || event.altKey || event.metaKey || event.isComposing)
			return;
		const key = keyFor(event);
		const target = targets.get(
			`${event.shiftKey && key !== "+" ? "sidebar" : "editor"}:${key}`,
		);
		if (!target) return;
		const active = document.activeElement;
		if (
			active instanceof HTMLElement &&
			active.closest("input, textarea, select, [contenteditable=true]") &&
			["A", "C", "V", "X", "Y", "Z"].includes(key)
		)
			return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (event.repeat) return;
		if (
			target.isConnected &&
			visible(target) &&
			!target.disabled &&
			target.getAttribute("aria-disabled") !== "true"
		) {
			target.focus({ preventScroll: true });
			if (target.getAttribute("aria-haspopup") === "menu") {
				target.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: "Enter",
						code: "Enter",
						bubbles: true,
						cancelable: true,
					}),
				);
			} else target.click();
		}
		schedule();
	};
	const keyup = (event: KeyboardEvent) => {
		if (event.key === "Control" || !event.ctrlKey) hide();
	};
	const observer = new MutationObserver((records) => {
		if (records.some((record) => !overlay.contains(record.target))) schedule();
	});
	const observation: MutationObserverInit = {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: [
			"class",
			"style",
			"hidden",
			"disabled",
			"aria-expanded",
			"aria-modal",
			"aria-hidden",
			"role",
			"open",
			"inert",
		],
	};
	window.addEventListener("keydown", keydown, true);
	window.addEventListener("keyup", keyup, true);
	window.addEventListener("blur", hide);
	document.addEventListener("visibilitychange", hide);
	window.addEventListener("scroll", schedule, true);
	window.addEventListener("resize", schedule);
	return () => {
		hide();
		observer.disconnect();
		overlay.remove();
		window.removeEventListener("keydown", keydown, true);
		window.removeEventListener("keyup", keyup, true);
		window.removeEventListener("blur", hide);
		document.removeEventListener("visibilitychange", hide);
		window.removeEventListener("scroll", schedule, true);
		window.removeEventListener("resize", schedule);
	};
}

export function useButtonShortcuts() {
	useEffect(() => {
		if (users++ === 0) dispose = listen();
		return () => {
			if (--users === 0) {
				dispose?.();
				dispose = undefined;
			}
		};
	}, []);
}
