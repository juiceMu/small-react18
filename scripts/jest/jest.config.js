const { defaults } = require('jest-config');

module.exports = {
	...defaults,
	// 命令执行的根文件路径
	rootDir: process.cwd(),
	modulePathIgnorePatterns: ['<rootDir>/.history'],
	// 第三方依赖的包该从哪里解析
	moduleDirectories: [
		// 对于 React ReactDOM
		'dist/node_modules',
		// 对于第三方依赖
		...defaults.moduleDirectories
	],
	testEnvironment: 'jsdom'
};
