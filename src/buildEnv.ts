/**
 * Configuration baked into the bundle at build time.
 *
 * End users don't have SENTRY_DSN etc. in their environment, so reading
 * process.env alone leaves those features off in shipped builds. webpack
 * injects an allowlisted set of variables as __BUILD_ENV__ (see
 * webpack.plugins.ts). A real environment variable still takes precedence,
 * so developers and CI can override any value. Safe in a renderer without
 * Node access (no `process` there).
 */

declare const __BUILD_ENV__: Record<string, string> | undefined;

const baked: Record<string, string> =
  typeof __BUILD_ENV__ !== "undefined" ? __BUILD_ENV__ : {};

/**
 * Runtime value if the variable is set at all (an empty value deliberately
 * overrides, e.g. SENTRY_DSN= disables Sentry), else the baked-in value.
 */
export function getEnv(name: string): string | undefined {
  const runtime =
    typeof process !== "undefined" && process.env ? process.env : {};
  if (name in runtime) return runtime[name] || undefined;
  return baked[name] || undefined;
}
