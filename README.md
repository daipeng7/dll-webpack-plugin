![Build Status](https://travis-ci.org/daipeng7/dll-webpack-plugin.svg?branch=main)
![https://webpack.docschina.org/configuration/](https://img.shields.io/badge/webpack-v4-blue.svg)
## @daipeng7/dll-webpack-plugin

> a simple plugin for dll bundle

## Install
    npm i -D @daipeng7/dll-webpack-plugin
    or
    yarn add -D @daipeng7/dll-webpack-plugin
## Example
```js
    new DllWebpackPlugin({
        mode: process.env.NODE_ENV,
        context: resolve(''),
        entry: {
            vue: [
                require.resolve('vue/dist/vue.esm.js'),
                'vue-router',
                'vuex',
            ],
            utils: ['axios']
        },
        output: {
            path: resolve('./dll'),
            filename: '[name]/[name].dll.js',
            library: '[name]_library'
        },
        asset: {
            publicPath: '/static/dll',
            outputPath: 'static/dll',
            hash: true
        }
    })
```

## Options
### mode
- **condition**: `mode` is environment variable, default `development`
### context
- **condition**: `context` is process cwd, default `process.cwd()`
### entry  
- **condition**: `entry` is same of [webpack](https://webpack.docschina.org/configuration/) config (just boject mode)
### output 
- **condition**: `output` is same of [webpack](https://webpack.docschina.org/configuration/) config

### asset
- **condition**: `asset` is same of [add-asset-html-webpack-plugin](https://www.npmjs.com/package/add-asset-html-webpack-plugin) config



