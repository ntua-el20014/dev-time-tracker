import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { WebpackPlugin } from "@electron-forge/plugin-webpack";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import dotenv from "dotenv";
import path from "path";

import { mainConfig } from "./webpack.main.config";
import { rendererConfig } from "./webpack.renderer.config";

// Load environment variables from .env.local (for code signing credentials)
dotenv.config({ path: path.resolve(__dirname, ".env.local") });

function getWindowsSignConfig() {
  const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE;

  if (!certificateFile) {
    return undefined;
  }

  return {
    certificateFile,
    certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
    timestampServer: process.env.WINDOWS_TIMESTAMP_SERVER,
    description: "dev-time-tracker",
    website: "https://github.com/ntua-el20014/dev-time-tracker",
  };
}

const windowsSignConfig = getWindowsSignConfig();

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: ["public/icons"],
    appBundleId: "com.ntuael20014.devtimetracker",
    win32metadata: {
      CompanyName: "ntua-el20014",
      FileDescription: "dev-time-tracker",
      InternalName: "dev-time-tracker",
      OriginalFilename: "dev-time-tracker",
      ProductName: "dev-time-tracker",
    },
    ...(windowsSignConfig ? { windowsSign: windowsSignConfig } : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig: mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: "./public/index.html",
            js: "./renderer/renderer.ts",
            name: "main_window",
            preload: {
              js: "./src/preload.ts",
            },
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
