import path from 'path';
import fs from 'fs';
import ts from 'rollup-plugin-typescript2';
import cjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-babel';
import replace from '@rollup/plugin-replace';

const tsConfig = { tsConfig: 'tsconfig.json' };
// 包路径
const pkgPath = path.resolve(__dirname, '../../packages');
// 打包后产物路径
const distPath = path.resolve(__dirname, '../../dist/node_modules');

/**
 * 设置package路径
 * @param {*} pkgName 报名
 * @param {*} isDist 是否为打包后的路径
 * @returns
 */
export function resolvePkgPath(pkgName, isDist) {
	if (isDist) {
		// 是否为打包后路径
		return `${distPath}/${pkgName}`;
	}
	return `${pkgPath}/${pkgName}`;
}

/**
 * 获取package.json内容
 * @param {*} pkgName 包名
 * @returns
 */
export function getPackageJSON(pkgName) {
	// 包目录下package.json路径
	const path = `${resolvePkgPath(pkgName)}/package.json`;
	const str = fs.readFileSync(path, { encoding: 'utf-8' });
	return JSON.parse(str);
}

/**
 * 基础打包插件
 * @param {*} param
 * @returns
 */
export function getBaseRollupPlugins({
	alias = {
		__DEV__: true,
		preventAssignment: true
	},
	typescript = tsConfig
} = {}) {
	return [replace(alias), ts(typescript), resolve(), cjs()]; // 解析commonjs， 解析ts转移js
}
