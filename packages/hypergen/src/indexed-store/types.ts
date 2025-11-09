export type IndexMaps<ItemType> = {
	[P in keyof ItemType]: Map<ItemType[P], ItemType>;
};

export type ToTuple<T, K extends keyof T | Array<keyof T>> = K extends any[]
	? {
			[Index in keyof K]: K[Index] extends keyof T ? T[K[Index]] : never;
		}
	: K extends keyof T
		? [T[K]]
		: never;

/**
 * Callable function type for items that can be stored in IndexedStore
 * More specific than the banned 'Function' type
 */
export type CallableFunction = (...args: unknown[]) => unknown;

export type IndexedStoreItemType = object | CallableFunction;

export type PrimitiveType = string | number | boolean | symbol | bigint;
