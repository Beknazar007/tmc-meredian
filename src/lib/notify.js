/**
 * In-app feedback (toasts + modal confirm/prompt). Implementation is registered
 * by <FeedbackHost />; before mount, falls back to window.alert for errors only.
 */
let impl = {
  toast: (message, variant) => {
    if (typeof window !== "undefined" && variant === "error") window.alert(message);
  },
  confirm: () => Promise.resolve(false),
  prompt: () => Promise.resolve(null),
};

export function registerFeedback(i) {
  impl = { ...impl, ...i };
}

export const notify = {
  info: (message) => impl.toast?.(message, "info"),
  success: (message) => impl.toast?.(message, "success"),
  error: (message) => impl.toast?.(message, "error"),
  warn: (message) => impl.toast?.(message, "warn"),
};

/**
 * @param {{ title: string, message: string, confirmText?: string, cancelText?: string, danger?: boolean }} o
 * @returns {Promise<boolean>}
 */
export function confirmAction(o) {
  return impl.confirm(o);
}

/**
 * @param {{ title: string, message?: string, defaultValue?: string, placeholder?: string, password?: boolean, confirmText?: string, cancelText?: string, label?: string }} o
 * @returns {Promise<string | null>}
 */
export function promptValue(o) {
  return impl.prompt(o);
}
