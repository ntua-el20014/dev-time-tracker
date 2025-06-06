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

  export const rendererConfig: Configuration = {
    module: {
      rules,
    },
    plugins,
    resolve: {
      extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
    },
    target: 'electron-preload',
  };
