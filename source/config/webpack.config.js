import warning from '../utils/warning'
import path from 'path'
import webpack from 'webpack'
import HTMLWebpackPlugin from 'html-webpack-plugin'
import ExtractTextPlugin from 'extract-text-webpack-plugin'
import HTMLCustomWritePlugin from '../plugins/HTMLCustomWritePlugin'
import LoaderSitepackPlugin from '../plugins/LoaderSitepackPlugin'


function getResolveConfig(paths) {
  return {
    resolve: {
      modules: ['node_modules'].concat(paths.nodePaths),
      
      extensions: ['.js', '.json', '.jsx'],

      alias: {
        'sitepack': path.resolve(__dirname, '..'),
        'sitepack-virtual-main': paths.main,
        'sitepack-virtual-createSite': paths.createSite,
      },
    },

    resolveLoader: {
      modules: [
        paths.loaders,
        paths.ownLoaders,
        'node_modules',
        paths.ownNodeModules,
      ],
      moduleExtensions: [
        '-loader',
      ],
    },
  }
}


function transformLoaders(environment, loaders, extract) {
  let i = 0
  const transformed = []
  while (i < loaders.length) {
    let loader = loaders[i++]
    if (typeof loader === 'string') {
      loader = { loader: loader }
    }
    else if (!loader || typeof loader !== 'object') {
      throw new Error(`Expected each set of loader options in your sitepack config to be a string or object. Instead received "${loader}".`)
    }
    
    if (loader.loader === 'sitepack-css') {
      if (environment === 'static') {
        return extract.extract({
          fallback: 'style',
          use: ["css"].concat(transformLoaders(environment, loaders.slice(i))),
        })
      }
      else if (environment !== 'production') {
        transformed.push('style', { ...loader, loader: 'css'})
      }
      else {
        // The generated CSS needs to take into account CSS files for every
        // possible page. Because of this, our build CSS is generated with the
        // site object -- not with the application.
        return ['null']
      }
    }
    else {
      transformed.push(loader)
    }
  }
  return transformed
}
function transformRule(environment, rule, extract) {
  if (!rule || typeof rule !== 'object') {
    throw new Error(`Expected each rule in your sitepack config to be an object. Instead received a "${rule}".`)
  }

  const keys = Object.keys(rule)
  const { loader, options, ...other } = rule

  if (rule.oneOf) {
    return { ...other, oneOf: transformRules(environment, rule.oneOf, extract) }
  }

  if (rule.rules) {
    return { ...other, rules: transformRules(environment, rule.rules, extract) }
  }

  if (rule.use) {
    return { ...other, use: transformLoaders(environment, rule.use, extract) }
  }
  else {
    return { ...other, use: transformLoaders(environment, [{ loader, options }], extract) }
  }
}
function transformRules(environment, rules, extract) {
  if (!Array.isArray(rules)) {
    throw new Error(`Expected the "rules" export of your sitepack config to be an Array. Instead received "${rules}".`)
  }

  return rules.map(rule => {
    return transformRule(environment, rule, extract)
  })
}


export function getSiteConfig({ config, paths }) {
  const extract = new ExtractTextPlugin({ filename: 'site-bundle.[contenthash:8].css', allChunks: true })

  return {
    entry: {
      app: [
        require.resolve('./polyfills'),
        require.resolve('../entries/siteEntry'),
      ],
    },

    output: {
      path: '/',
      pathinfo: true,
      publicPath: '/',
      library: 'Junctions',
      libraryTarget: 'commonjs2',
      filename: `site-bundle.js`,
    },

    // Every non-relative module other than "sitepack" that is not prefixed with "sitepack/virtual/" is external
    externals: function(context, request, callback) {
      if (request !== 'sitepack' && !/^sitepack\/virtual\//.test(request) && /^[a-z\-0-9][a-z\-0-9\/]+(\.[a-zA-Z]+)?$/.test(request)) {
        return callback(null, request);
      }
      callback();
    },

    ...getResolveConfig(paths),

    module: {
      rules: transformRules('static', config.rules, extract),
    },

    plugins: [
      new LoaderSitepackPlugin({ environment: 'static', packageRoot: paths.packageRoot }),

      // The site bundle will only ever be run by the build system, and the
      // build system fails on Webpack's dynamic import implementation.
      // Setting this ensures there will be no dynamic imports, so the build
      // will work.
      new webpack.optimize.LimitChunkCountPlugin({
          maxChunks: 1
      }),

      extract
    ],
  }
}

export function getAppConfig({ config, environment, paths, writeWithAssets }) {
  const isProduction = environment === 'production'

  return {
    devtool: isProduction ? false : 'source-map',

    entry: {
      entry: 
        (!isProduction
          ? [require.resolve('react-dev-utils/webpackHotDevClient')]
          : [])
        .concat([
          require.resolve('./polyfills'),
          require.resolve('../entries/webEntry'),
        ]),
      vendor: config.vendor || [],
    },

    output: {
      path: paths.output,
      pathinfo: !isProduction,
      filename: `[name]-[chunkHash].js`,
      chunkFilename: `[name]-[chunkHash].js`,
      publicPath: '/',
    },

    ...getResolveConfig(paths),

    module: {
      rules: transformRules(environment, config.rules),
    },

    plugins:
      [
        new LoaderSitepackPlugin({ environment, packageRoot: paths.packageRoot }),
        new webpack.DefinePlugin({ 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV) }),
        new webpack.optimize.CommonsChunkPlugin({
          name: 'vendor', 
          filename: `vendor-[chunkHash].js`
        }),
        new HTMLWebpackPlugin({
          inject: false,
          template: '!!sitepack-template!'+paths.html,
          page: { title: 'sitepack App' },
          content: '',
        }),
      ]
      .concat(isProduction ? [
        new webpack.optimize.DedupePlugin(),
        new webpack.optimize.OccurrenceOrderPlugin(),
        new webpack.optimize.UglifyJsPlugin(),
      ] : [])
      .concat(writeWithAssets
        // Prevent HTMLWebpackPlugin from writing any HTML files to disk,
        // as we'd like to handle that ourself
        ? [new HTMLCustomWritePlugin(writeWithAssets)]
        : []
      ),

    node: {
      fs: "empty",
      module: "empty",
      net: "empty",
    },
  }
}
