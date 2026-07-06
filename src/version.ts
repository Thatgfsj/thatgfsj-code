/**
 * Product version (what users see in --version, the TUI header, and
 * the welcome screen). This is SEPARATE from the npm package version
 * (`package.json` `version` field) — see the dual-version scheme docs
 * in CHANGELOG.md (v2.2.2 entry).
 *
 * Bump this when shipping a user-visible change. Bump package.json
 * version (npm version) at the same time. They are both +0.0.1 per
 * release.
 */
export const PRODUCT_VERSION = '0.4.6';

/**
 * Convenience: format with leading "v" for display contexts.
 */
export const PRODUCT_VERSION_DISPLAY = `v${PRODUCT_VERSION}`;