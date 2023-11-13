// 在tsconfig.json中作如下配置后，在其他文件使用Container不需要再单独进行import引入相对路径了
// 如果不懂，再看4-2课程
//   "paths": {
// 		"hostConfig":["./packages/react-reconciler/src/hostConfig.ts"]
//   }
// 这样的做的原因是，如果使用import形式，hostConfig就被限制在react-reconciler中了
// 但实际上对于不同的宿主环境，都要实现hostConfig，比如react-dom包中，就是react-dom目录中了
// 所以不能写死路径
export type Container = Element;
export type Instance = Element;

export const createInstance = (type: string): Instance => {
	// TODO 处理props
	const element = document.createElement(type);
	return element;
};

export const appendInitialChild = (
	parent: Instance | Container,
	child: Instance
) => {
	parent.appendChild(child);
};

export const createTextInstance = (content: string) => {
	return document.createTextNode(content);
};

export const appendChildToContainer = appendInitialChild;
