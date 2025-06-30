import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

export const plugins = [
  new HtmlWebpackPlugin({
    template: './public/index.html', 
    filename: 'index.html',
  }),
  new ForkTsCheckerWebpackPlugin({
    logger: 'webpack-infrastructure',
  }),
  new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'public/icons'),
          to: path.resolve(__dirname, '.webpack/renderer/icons'),
        },
      ],
    }),
];
