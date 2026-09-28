/**
 * True in the read-only Firebase build (see `npm run build:readonly` and `firebase.json`).
 * That build has no dev-server API behind it, so it loads `design/house.json` bundled at
 * build time instead of fetching it, and disables everything that would try to save.
 */
export const READONLY = import.meta.env.VITE_READONLY === 'true';
