/**
 * Strip resize lock — boolean flag latched when the user manually sizes the
 * coaching strip via the edit-mode corner grip. Persists across launches via
 * the same settings JSON the renderer uses, so a restart can't override the
 * user's custom size on the next content-driven auto-fit.
 *
 * The lock has no associated dimensions of its own; the strip window is named
 * (`champ-sage-strip-v2`) so Overwolf already persists bounds across launches.
 * What was missing was the *flag* that tells main "auto-fit is suppressed."
 */

const STRIP_USER_SIZED_KEY = "stripUserSized";

export interface SettingsIO {
  read(): Record<string, unknown>;
  write(data: Record<string, unknown>): void;
}

export interface StripResizeLock {
  get(): boolean;
  set(value: boolean): void;
}

export function createStripResizeLock(io: SettingsIO): StripResizeLock {
  return {
    get: () => io.read()[STRIP_USER_SIZED_KEY] === true,
    set: (value: boolean) => {
      const data = io.read();
      const present = STRIP_USER_SIZED_KEY in data;
      if (value) {
        data[STRIP_USER_SIZED_KEY] = true;
      } else if (present) {
        delete data[STRIP_USER_SIZED_KEY];
      } else {
        return;
      }
      io.write(data);
    },
  };
}

export { STRIP_USER_SIZED_KEY };
