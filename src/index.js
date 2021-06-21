import webpackConfig from './config';
const path = require('path');
const fsExtra = require('fs-extra');
const webpack = require('webpack');
const merge = require('webpack-merge');
const hash = require('object-hash');
const MemoryFileSystem = require('memory-fs');
const AddAssetHtmlPlugin = require('add-asset-html-webpack-plugin');

class DllWebpackPlugin {
	constructor(options = {}) {
		const {
			entry = {},
			output = {},
			asset = {},
			mode = 'development',
			context = process.cwd()
		} = options;
		const mergeConfig = merge(webpackConfig, {
			context,
			entry,
			output,
			plugins: [
				new webpack.DllPlugin({
					path: path.resolve(output.path, '[name]/[name].manifest.json'), // 生成上文说到清单文件，放在当前build文件下面，这个看你自己想放哪里了。
					name: '[name]_library'
				})
			]
		});

		this.config = {
			context,
			mode: process.env.NODE_ENV || mode,
			identity: 'identity.js',
			asset,
			...options,
			webpack: mergeConfig
		};

		this.dllCompiler = null;
		this.targetDirByMode = path.resolve(output.path, this.config.mode);
		this.targetIdentityPath = path.resolve(this.targetDirByMode, this.config.identity);
		this.logger = console;
	}

	apply(compiler) {
		this.logger = compiler.getInfrastructureLogger(this.config.webpack.name);
		const startTime = Date.now();
		['beforeRun', 'watchRun'].map(name => compiler.hooks[name].tapAsync('DllWebapckPlugin', (params, callback) => {
			this.createManifest().then(({ dllList = [] }) => {
				this.createDllPlugins(compiler, dllList);
				this.logger.info(`compile dll asset success in ${Date.now() - startTime}ms`);
				callback();
			});
		}));
	}

	// 将打包好的dll模块链接到项目中
	createDllPlugins(compiler, dllList = []) {
		dllList.forEach(dll => {
			new webpack.DllReferencePlugin({
				context: compiler.context,
				manifest: require(dll.manifestPath)
			}).apply(compiler);
			// 这个主要是将生成的vendor.dll.js文件加上hash值插入到页面中。
			new AddAssetHtmlPlugin([{
				...this.config.asset,
				filepath: dll.dllPath
			}]).apply(compiler);
		});
	}

	createManifest() {
		return new Promise((resolve, reject) => {
			// 获取dll入口的版本信息
			const currentIdentity = this.getEntryModuleIdentity(this.config.webpack.entry);
			try {
				let oldIndtity;
				try {
					oldIndtity = require(this.targetIdentityPath);
				} catch (error) {
					oldIndtity = {};
				}
				// 通过对缓存的dll文件中的hash值进行比较判断是否需要更新
				const currentIdentityHash = hash(currentIdentity);
				if (currentIdentityHash === oldIndtity.hash) {
					return resolve({ compiler: null, dllList: oldIndtity.dllList });
				}

				this.dllCompiler = webpack(this.config.webpack);
				// 替换文件系统
				this.dllCompiler.outputFileSystem = new MemoryFileSystem();

				this.logger.info('Start compile dll asset service...\n');
				// 生成动态链接文件结束并写入文件中触发事件
				this.dllCompiler.hooks.done.tapAsync('dllFinish', (state, errCallback) => {
					const err = errCallback();
					if (err) {
						this.logger.error(err);
						reject(this.dllCompiler);
					} else {
						this.logger.info(`Stop compile dll asset service。 ${state.endTime - state.startTime}ms\n`);
						const dllConfig = this.createDLL(state.compilation);
						const { context } = this.config.webpack;
						const dllList = Object.values(dllConfig);
						const identityContent = 'const cwd = process.cwd();' + 'module.exports = ' + JSON.stringify({ hash: currentIdentityHash, dllList }).replace(new RegExp(`"${context}`, 'ig'), 'cwd + "');
						fsExtra.writeFileSync(this.targetIdentityPath, identityContent);

						resolve({ compiler: this.dllCompiler, dllList });
					}
				});
				this.dllCompiler.hooks.failed.tap('dllFaild', reject);
				this.dllCompiler.run();
			} catch (error) {
				this.logger.error(error);
			}
		});
	}

	/**
	 * @description: 通过入口文件对象获取该对象下的成员标识
	 * @param {Object} 入口文件对象
	 * @return: Promise
	 */
	getEntryModuleIdentity(entry = {}) {
		return Object.keys(entry).reduce((map, name, index) => {
			map[name] = entry[name].reduce((res, moduleName) => {
				try {
					const modulePath = path.isAbsolute(moduleName) ? moduleName.match(new RegExp(`${path.resolve(this.config.context, 'node_modules')}/(\\w+)`))[0] : path.resolve(this.config.context, 'node_modules', moduleName);
					const tag = require(path.resolve(modulePath, 'package.json')).version;
					res[moduleName] = tag;
					return res;
				} catch (error) {
					throw TypeError(`请安装插件${moduleName}`);
				}
			}, {});
			return map;
		}, {});
	}

	/**
	 * @name: mkdirSync
	 * @description: 创建文件夹
	 * @param {string} solutePath: 文件夹路径
	 * @param {boolean} isClear: 是否删除目录
	 * @return {type}:
	 */
	 mkdirSync(solutePath, isClear = false) {
		try {
			const exists = fsExtra.existsSync(solutePath);
			if (exists && isClear) {
				fsExtra.removeSync(solutePath);
				fsExtra.mkdirpSync(solutePath);
			}
			if (!exists) fsExtra.mkdirpSync(solutePath);
			return solutePath;
		} catch (error) {
			throw error;
		}
	};

	/**
	 * @name: createDLL
	 * @description: 输出dll结果
	 * @param {String} outputDir: 输出目录
	 * @param {Array} chunks: 输出目录
	 * @param {FileSystem} fs: 文件系统
	 * @return {Object}: 结果对象
	 */
	createDLL(compilation) {
		const { outputPath, outputFileSystem } = this.dllCompiler;
		const chunks = compilation.chunks;
		const manifestPath = this.config.webpack.plugins.find(item => item instanceof webpack.DllPlugin).options.path;
		this.mkdirSync(this.targetDirByMode, true);
		const emitedConfig = chunks.reduce((res, chunk) => {
			const { name, hash, files = [] } = chunk;
			const fileRelativePath = files[0];
			const memoManifestPath = compilation.getPath(manifestPath, { hash, chunk });
			const memoDLLPath = path.resolve(outputPath, fileRelativePath);
			const targetChunkDir = path.resolve(this.targetDirByMode, path.dirname(fileRelativePath));
			const targetManifestPath = path.resolve(targetChunkDir, path.basename(memoManifestPath));
			const targetDLLPath = path.resolve(this.targetDirByMode, fileRelativePath);
			this.mkdirSync(targetChunkDir, true);
			fsExtra.writeFileSync(targetDLLPath, outputFileSystem.readFileSync(memoDLLPath));
			fsExtra.writeFileSync(targetManifestPath, outputFileSystem.readFileSync(memoManifestPath));

			res[name] = { hash, dllPath: targetDLLPath, manifestPath: targetManifestPath };
			return res;
		}, {});
		return emitedConfig;
	};
}

module.exports = DllWebpackPlugin;
