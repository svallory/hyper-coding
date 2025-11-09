import { BaseIndexedStore } from './IndexedStore.js';
import type { CallableFunction } from './types.js';
import { joinParts } from './util.js';

export abstract class PropertyIndexedStore<
	ItemType extends object | CallableFunction,
	KeyParts extends Array<keyof ItemType>,
	ExtraIndices extends Array<keyof ItemType>,
> extends BaseIndexedStore<ItemType, KeyParts, ExtraIndices> {
	constructor(
		protected readonly keyParts: KeyParts,
		extraIndices: ExtraIndices = [] as ExtraIndices,
	) {
		super(
			(item: ItemType) => joinParts(item, keyParts, '::'),
			(...args: any) => args.join('::'),
			[...keyParts, ...extraIndices],
		);
	}
}
