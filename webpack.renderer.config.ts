import * as path from 'path';
import type { Configuration } from 'webpack';
import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

rules.push({
  test: /\.(png|jpe?g|gif|svg)$/i,
  type: 'asset/resource',
  generator: {
    filename: 'data/[name][ext]'
  }
});

rules.push({
  test: /\.svg$/,
  type: 'asset/resource',
  generator: {
    filename: 'icons/[name][ext]'
  }
});

export const rendererConfig: Configuration = {
  entry: './html/renderer.ts', // <- Your renderer entry point
  output: {
    filename: 'renderer.js',
    path: path.resolve(__dirname, '../dist'),
    publicPath: '/', // Make files available at http://localhost:3000/
  },
  module: { rules },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
  },
  target: 'electron-renderer', // NOT preload unless this is preload
  devtool: 'source-map',
};
