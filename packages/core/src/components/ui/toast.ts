export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastNotification {
	id: string;
	revision: number;
	type: ToastType;
	title: string;
	description?: string;
	duration?: number;
}

const listeners = new Set<() => void>();
const empty: readonly ToastNotification[] = [];
let notifications = empty;
let sequence = 0;

function publish(next: readonly ToastNotification[]) {
	notifications = next;
	for (const listener of listeners) listener();
}

export const toastManager = {
	add(
		notification: Omit<ToastNotification, "id" | "revision"> & { id?: string },
	) {
		const revision = ++sequence;
		const id = notification.id ?? `toast-${revision}`;
		publish(
			[
				...notifications.filter((entry) => entry.id !== id),
				{ ...notification, id, revision },
			].slice(-5),
		);
		return id;
	},
	close(id: string) {
		publish(notifications.filter((entry) => entry.id !== id));
	},
	subscribe(listener: () => void) {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
	getSnapshot: () => notifications,
	getServerSnapshot: () => empty,
};
