import type IForkTsCheckerWebpackPlugin from "fork-ts-checker-webpack-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";
import CopyWebpackPlugin from "copy-webpack-plugin";
import { DefinePlugin } from "webpack";
import dotenv from "dotenv";
import path from "path";
import { version } from "./package.json";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");

// Real env vars win, then .env.local, then .env (dotenv never overwrites).
dotenv.config({ path: path.resolve(__dirname, ".env.local") });
dotenv.config({ path: path.resolve(__dirname, ".env") });

/**
 * Variables baked into the bundle, read via getEnv() in src/buildEnv.ts.
 * Allowlist only — everything here ships inside the app, so never add
 * secrets (e.g. signing passwords). Sentry DSNs and the Supabase anon key
 * are public by design.
 */
const BUILD_ENV_KEYS = [
  "SENTRY_DSN",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "UPDATER_ENABLED",
  "UPDATER_ALLOW_DEV",
  "UPDATER_AUTO_CHECK",
  "UPDATER_AUTO_DOWNLOAD",
  "UPDATER_FEED_URL",
  "UPDATER_GITHUB_OWNER",
  "UPDATER_GITHUB_REPO",
  "UPDATER_GITHUB_PRIVATE",
];

const buildEnv: Record<string, string> = { APP_VERSION: version };
for (const key of BUILD_ENV_KEYS) {
  const value = process.env[key];
  if (value) buildEnv[key] = value;
}

export const plugins = [
  new DefinePlugin({ __BUILD_ENV__: JSON.stringify(buildEnv) }),
  new HtmlWebpackPlugin({
    template: "./public/index.html",
    filename: "index.html",
  }),
  new ForkTsCheckerWebpackPlugin({
    logger: "webpack-infrastructure",
  }),
  new CopyWebpackPlugin({
    patterns: [
      {
        from: path.resolve(__dirname, "public/icons"),
        to: path.resolve(__dirname, ".webpack/renderer/main_window/icons"),
      },
    ],
  }),
];
