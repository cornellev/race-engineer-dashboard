// Where RED's backend is. VITE_BACKEND_URL (build time) wins; otherwise port 8000 on the
// host that served this page, so RED works from another laptop on the tailnet or in a
// Docker stack, not only on the machine running it (it used to be hardcoded to localhost).
const configured = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim();

export const BACKEND_URL: string =
  configured && configured.length > 0
    ? configured.replace(/\/+$/, "")
    : `${window.location.protocol}//${window.location.hostname || "localhost"}:8000`;

/** http(s)://host:port/path -> ws(s)://host:port/path */
export function backendWsUrl(path: string): string {
  return `${BACKEND_URL.replace(/^http/, "ws")}${path}`;
}
