export type ThemePreference = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
export const THEME_COOKIE_NAME = "hearth-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const THEME_CHANGE_EVENT = "hearth-theme-change";
export const THEME_BROADCAST_CHANNEL = "hearth-theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark";
}

function readCookiePreference(): ThemePreference | null {
  try {
    const prefix = `${THEME_COOKIE_NAME}=`;
    const part = document.cookie
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(prefix));
    const value = part ? decodeURIComponent(part.slice(prefix.length)) : null;
    return isThemePreference(value) ? value : null;
  } catch {
    return null;
  }
}

export function readThemePreference(): ThemePreference | null {
  const cookiePreference = readCookiePreference();
  if (cookiePreference) return cookiePreference;

  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : null;
  } catch {
    return null;
  }
}

export function getSystemTheme(): ThemePreference {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(theme: ThemePreference) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function persistThemePreference(theme: ThemePreference) {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${THEME_COOKIE_NAME}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    // localStorage remains a fallback when cookies are unavailable.
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The cookie remains a fallback when browser storage is unavailable.
  }

  try {
    const channel = new BroadcastChannel(THEME_BROADCAST_CHANNEL);
    channel.postMessage(theme);
    channel.close();
  } catch {
    // The storage event and focus reconciliation remain as fallbacks.
  }
}

const storageKey = JSON.stringify(THEME_STORAGE_KEY);
const cookieName = JSON.stringify(THEME_COOKIE_NAME);
const cookieMaxAge = JSON.stringify(THEME_COOKIE_MAX_AGE);

export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  var preference = null;
  var cookiePrefix = ${cookieName} + '=';

  try {
    var cookiePart = document.cookie
      .split(';')
      .map(function (value) { return value.trim(); })
      .find(function (value) { return value.indexOf(cookiePrefix) === 0; });
    var cookieValue = cookiePart
      ? decodeURIComponent(cookiePart.slice(cookiePrefix.length))
      : null;
    if (cookieValue === 'light' || cookieValue === 'dark') {
      preference = cookieValue;
    }
  } catch (_) {}

  if (!preference) {
    try {
      var storedValue = localStorage.getItem(${storageKey});
      if (storedValue === 'light' || storedValue === 'dark') {
        preference = storedValue;
      }
    } catch (_) {}
  }

  var resolved = preference || (
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  );
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;

  if (preference) {
    try {
      localStorage.setItem(${storageKey}, preference);
    } catch (_) {}
    try {
      document.cookie = ${cookieName} + '=' + preference
        + '; Path=/; Max-Age=' + ${cookieMaxAge}
        + '; SameSite=Lax'
        + (window.location.protocol === 'https:' ? '; Secure' : '');
    } catch (_) {}
  }
})();
`;
