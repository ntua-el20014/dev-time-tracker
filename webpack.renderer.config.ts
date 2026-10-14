import type { Configuration } from "webpack";
import { rules } from "./webpack.rules";
import { plugins } from "./webpack.plugins";

rules.push({
  test: /\.css$/,
  use: [{ loader: "style-loader" }, { loader: "css-loader" }],
});

rules.push({
  test: /\.(png|jpe?g|gif|svg)$/i,
  type: "asset/resource",
  generator: {
    filename: "assets/[name][ext]",
  },
});

rules.push({
  test: /\.svg$/,
  type: "asset/resource",
  generator: {
    filename: "icons/[name][ext]",
  },
});

// Entry points and output paths come from the Forge WebpackPlugin config in
// forge.config.ts. Don't set output.publicPath here: Forge uses "/" for the
// dev server and leaves it unset ("auto") for packaged builds, where the page
// is loaded from file:// and an absolute "/" path resolves to the drive root.
export const rendererConfig: Configuration = {
  module: { rules },
  plugins,
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css"],
  },
  target: "electron-renderer", // NOT preload unless this is preload
  devtool: "source-map",
};
