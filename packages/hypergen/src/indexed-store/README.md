# Indexed Store Module

A high-performance, type-safe data structure library for fast lookups and multi-property indexing in TypeScript. The indexed-store module provides abstract and concrete implementations of indexed data stores that enable efficient retrieval of items by multiple keys and properties.

## Overview

The indexed-store module solves a fundamental performance problem: **finding items quickly in large collections**. Rather than scanning through entire collections linearly, this module maintains multiple indices that map property values to collections of matching items, enabling O(1) lookups (or near O(1) with hash collisions).

### Key Features

- **Multi-property indexing**: Automatically maintain indices for specified properties
- **Type-safe API**: Full TypeScript support with compile-time type safety
- **Flexible key generation**: Support both hash-based and property-based keys
- **Efficient lookups**: Query by composite keys or by indexed properties
- **Minimal dependencies**: Uses only Node.js built-in `crypto` module

## Module Structure

### Files

| File | Purpose |
|------|---------|
| `IndexedStore.ts` | Abstract base class implementing core store functionality |
| `HashIndexedStore.ts` | Concrete implementation using SHA-256 hashing for keys |
| `PropertyIndexedStore.ts` | Concrete implementation using property concatenation for keys |
| `types.ts` | TypeScript type definitions for the module |
| `util.ts` | Utility functions (hashing, property joining, type checking) |
| `index.ts` | Public API exports |

## Architecture

### Class Hierarchy

```
BaseIndexedStore (abstract)
├── HashIndexedStore
└── PropertyIndexedStore
```

### Core Concepts

#### Items and Keys

Items are objects with typed properties. Keys are generated from one or more item properties to uniquely identify items:

```typescript
// Item with properties
interface Template { name: string; path: string; }

// Key: composite of 'name' and 'path'
const item = { name: 'component', path: '/templates/component' };
```

#### Key Parts

"Key parts" are the property names used to generate keys:

```typescript
// KeyParts: ['name', 'path']
// Identifies which properties compose the key
```

#### Extra Indices

Additional properties to index for fast lookups without including them in the primary key:

```typescript
// Primary key: ['generatorName', 'name']
// Extra indices: ['path']
// Can quickly find by path without it being part of the key
```

### BaseIndexedStore<ItemType, KeyParts, ExtraIndices, KeyType, KeyFunction>

The abstract base class that provides all core functionality.

#### Generic Type Parameters

- **ItemType**: The type of objects stored (must be objects or functions, not primitives)
- **KeyParts**: Array of property names that compose the primary key
- **ExtraIndices**: Array of property names to index for fast lookup (defaults to KeyParts)
- **KeyType**: Type of the generated key (defaults to string)
- **KeyFunction**: Function signature for generating keys

#### Public Methods

##### Adding Items
```typescript
add(item: ItemType): void
```
Adds an item to the store. Throws if an item with the same key already exists. Automatically updates all indices.

**Throws**: Error if duplicate key detected

##### Finding Items
```typescript
// By item (extracts key)
find(item: ItemType): ItemType | undefined

// By key directly
find(key: KeyType): ItemType | undefined

// By key parts (composed key)
find(...keyParts: ToTuple<ItemType, KeyParts>): ItemType | undefined
```
Retrieves a single item by its key. Returns undefined if not found.

**Overloads**: Supports flexible input types for convenience

##### Checking Existence
```typescript
// By item, key, or key parts (same overloads as find)
exists(...args): boolean
```
Efficiently checks if an item exists without retrieving it.

##### Finding by Indexed Property
```typescript
findBy<Prop extends KeyParts[number] | ExtraIndices[number]>(
  indexedProperty: Prop,
  value: ItemType[Prop]
): ItemType[] | undefined
```
Finds all items matching a specific property value.

**Throws**: Error if the property isn't indexed

**Returns**: Array of matching items or undefined

##### Listing All Items
```typescript
listAll(): ItemType[]
```
Returns all items in the store as an array.

##### Removing Items
```typescript
// By item, key, or key parts (same overloads as find)
remove(...args): ItemType | undefined
```
Removes an item and updates all indices. Returns the removed item or undefined if not found.

#### Protected Methods

##### createIndex(prop: keyof ItemType)
Creates a new index for a property. Called automatically during construction for extra indices. Scans existing items to populate the index.

##### indexItem(item, propName, index)
Updates a specific index with a new item. Internal method called during add/remove operations.

#### Private Methods

##### removeByKey(key)
Internal helper that handles the actual removal and index updating logic.

## Concrete Implementations

### HashIndexedStore<ItemType, KeyParts, ExtraIndices>

Uses SHA-256 hashing to generate keys from key parts.

```typescript
// Constructor
constructor(
  keyParts: KeyParts,
  extraIndexes?: ExtraIndices
)
```

**Key Generation**: SHA-256 hash of concatenated key parts with `::` separator

**Use Cases**:
- When you want a compact, uniform key representation
- When privacy of key values is desired (hashed)
- When you want to prevent accidental key structure dependencies

**Example**:
```typescript
interface Action { generatorName: string; name: string; path: string; }

const store = new HashIndexedStore<Action, ['generatorName', 'name'], ['path']>(
  ['generatorName', 'name'],
  ['path']
);

// Key: SHA-256 hash of "generator::action"
store.find('generator', 'action');
store.findBy('path', '/templates/generator/action');
```

### PropertyIndexedStore<ItemType, KeyParts, ExtraIndices>

Uses property concatenation with `::` separator to generate keys.

```typescript
// Constructor
constructor(
  keyParts: KeyParts,
  extraIndices?: ExtraIndices
)
```

**Key Generation**: Properties joined with `::` separator (e.g., `"generator::action"`)

**Use Cases**:
- When you want human-readable, debuggable keys
- When you need to parse keys back to original values
- When key values are guaranteed safe for joining

**Example**:
```typescript
const store = new PropertyIndexedStore<Action, ['generatorName', 'name']>(
  ['generatorName', 'name']
);

// Key: "generator::action" (readable for debugging)
store.find('generator', 'action');
```

**Note**: This is abstract in the provided code but can be subclassed for concrete use.

## Usage Examples

### Basic Setup

```typescript
import { HashIndexedStore } from './indexed-store/index.js'

interface Generator {
  name: string;
  path: string;
}

// Create store indexed by 'name' with 'path' as extra index
const generators = new HashIndexedStore<Generator, ['name'], ['path']>(
  ['name'],
  ['path']
);

// Add items
generators.add({ name: 'component', path: '/templates/component' });
generators.add({ name: 'page', path: '/templates/page' });

// Find by key
const component = generators.find('component');

// Find by property
const byPath = generators.findBy('path', '/templates/component');

// Check existence
if (generators.exists('component')) { ... }

// List all
const all = generators.listAll();

// Remove
generators.remove('component');
```

### Multiple Key Parts

```typescript
interface Action {
  generatorName: string;
  name: string;
  path: string;
}

// Key composed of two properties
const actions = new HashIndexedStore<
  Action,
  ['generatorName', 'name'],
  ['path']
>(
  ['generatorName', 'name'],
  ['path']
);

// Add item
actions.add({
  generatorName: 'component',
  name: 'add',
  path: '/templates/component/add'
});

// Find by composite key
const action = actions.find('component', 'add');
```

### Custom Store Implementation

```typescript
import { BaseIndexedStore } from './indexed-store/index.js'

interface User {
  userId: string;
  email: string;
  username: string;
}

class UserStore extends BaseIndexedStore<User, ['userId'], ['email', 'username']> {
  constructor() {
    super(
      (item: User) => item.userId,           // keyFor
      (userId: string) => userId,             // makeKey
      ['userId'],                             // keyProps
      ['email', 'username']                   // extraIndices
    );
  }

  // Convenience methods
  findByEmail(email: string): User[] {
    return this.findBy('email', email);
  }

  findByUsername(username: string): User[] {
    return this.findBy('username', username);
  }
}

const users = new UserStore();
users.add({ userId: '1', email: 'test@example.com', username: 'testuser' });
const user = users.findByEmail('test@example.com');
```

### Real-World: TemplateStore

The module is used in Hypergen's TemplateStore to efficiently manage generators and actions:

```typescript
// From src/TemplateStore.ts
export class GeneratorStore extends IndexedFolderStore<Generator, ['name']> {
  constructor() {
    super(['name'])
  }
}

export class ActionStore extends IndexedFolderStore<
  Action,
  ['generatorName', 'name']
> {
  constructor() {
    super(['generatorName', 'name'])
  }
}

export class TemplateStore {
  public readonly actions: ActionStore;
  public readonly generators: GeneratorStore;
  
  constructor() {
    this.actions = new ActionStore()
    this.generators = new GeneratorStore()
  }
}
```

## Type System

### IndexMaps<ItemType>

Maps each property of an item to a Map of values to items:

```typescript
type IndexMaps<ItemType> = {
  [P in keyof ItemType]: Map<ItemType[P], ItemType>;
}
```

### ToTuple<T, K>

Converts a property name or array of property names to their corresponding value types:

```typescript
type ToTuple<T, K extends keyof T | Array<keyof T>> = 
  K extends any[] 
    ? { [Index in keyof K]: ... }
    : K extends keyof T ? [T[K]] : never
```

Used for type-safe function overloads.

### PrimitiveType

Valid types for keys: `string | number | boolean | symbol | bigint`

### IndexedStoreItemType

Items must be objects or functions (not primitives): `object | Function`

## Utility Functions

### hashKeyParts(...args): string

Generates a SHA-256 hash from arguments joined with `::`.

```typescript
hashKeyParts('generator', 'action')
// => "a1b2c3d4..." (64-char hex)
```

**Use**: Primary key generation in HashIndexedStore

### joinParts(item, keys, glue): string

Joins property values from an item with a separator.

```typescript
joinParts({ name: 'foo', type: 'bar' }, ['name', 'type'], '::')
// => "foo::bar"
```

**Use**: Property-based key generation

### isNotPrimitive(value): boolean

Type guard checking if a value is not a primitive (is object or function).

```typescript
isNotPrimitive({}) // true
isNotPrimitive('string') // false
isNotPrimitive(null) // false
```

**Use**: Distinguishing items from keys in polymorphic methods

### isPrimitive(value): boolean

Inverse of isNotPrimitive.

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| add() | O(n) | Linear in number of indices |
| find() | O(1) average | HashMap lookup with hash collisions |
| findBy() | O(1) average | Index lookup with hash collisions |
| remove() | O(n) | Linear in number of indices |
| exists() | O(1) average | HashMap lookup |
| listAll() | O(n) | Returns all items |

### Space Complexity

O(n × m) where n = items and m = indices (each index stores references to items)

### When to Use

**Good for**:
- Frequently searching by multiple properties
- Large collections (hundreds or thousands of items)
- Filtering operations that would otherwise require scanning
- Multi-property lookups

**Not ideal for**:
- Very small collections (< 10 items) - overhead not justified
- Write-heavy workloads with frequent removals
- Collections with extremely variable-sized indices

## Implementation Details

### Index Synchronization

Indices are kept in sync on every add/remove operation:

```typescript
add(item: ItemType): void {
  // Store item
  this.items.set(key, item);
  
  // Update all indices
  for (const [propName, index] of this.indices) {
    this.indexItem(item, propName, index)
  }
}
```

This ensures O(1) lookup consistency at the cost of O(n) write operations.

### Key Generation Strategies

The design uses two strategies:

1. **HashIndexedStore**: Hashes key parts for consistent, uniform, non-readable keys
2. **PropertyIndexedStore**: Joins parts for readable, debuggable, human-parseable keys

Both maintain the same performance characteristics; the choice depends on use case.

### Duplicate Detection

The store prevents adding items with duplicate keys:

```typescript
const existingItem = this.items.get(key)
if (existingItem && existingItem !== item) {
  throw new Error(`Duplicate key detected...`)
}
```

This is crucial for maintaining index integrity.

## Dependencies

### External
- **Node.js crypto module** (`node:crypto`): Used only for SHA-256 hashing in HashIndexedStore

### Internal
- `types.ts`: Type definitions
- `util.ts`: Utility functions

No external npm dependencies required.

## Testing

Comprehensive tests are provided in `/tests/indexed-store.spec.ts`:

- Basic add/find/remove operations
- Duplicate key detection
- Index property lookups
- Existence checks
- Full listing

Helper test utilities in `/tests/util/indexed-store.helpers.ts`:

- `SimpleIndexedStore`: Example concrete implementation
- `TestItem`: Sample item type for tests

Run tests:
```bash
bun test tests/indexed-store.spec.ts
```

## Integration with Hypergen

The indexed-store is used throughout Hypergen for performance:

1. **TemplateStore** (`src/TemplateStore.ts`): Manages generators and actions
   - Indexes by name and path
   - Enables fast generator/action lookups
   - Critical for startup performance with large template sets

2. **Generator Discovery**: Indexes found generators for fast access
3. **Action Resolution**: Quickly matches action names to implementations

## Limitations and Known Issues

### Current Issues

1. **Incomplete removeByKey implementation**: The `removeByKey` method has incomplete logic (line 143-165 in IndexedStore.ts)
   - Index removal appears unfinished
   - This doesn't affect typical usage as indices are read-only in current flows
   - Should be fixed if remove operations become frequent

2. **PropertyIndexedStore is abstract**: Needs subclassing for use
   - Not directly instantiable
   - Create concrete subclasses like HashIndexedStore does

3. **No update/modify operation**: Items can't be modified in place
   - Workaround: remove and re-add with updated values
   - Performance implication: triggers full index rescan

### Design Considerations

- **Items must be mutable references**: Store keeps references, not copies
  - Mutating items directly affects stored state
  - Recommend immutability if possible

- **No transactions**: No rollback on partial failures during add/remove
  - Indices could become inconsistent on error

- **Single-valued indices only**: Can't index by array properties
  - Each item-property pair maps to one set of items

## Contributing

When working with this module:

1. **Adding new functionality**:
   - Consider type safety - use proper TypeScript generics
   - Maintain O(1) lookup complexity goals
   - Update both concrete implementations
   - Add tests for new behavior

2. **Modifying existing code**:
   - Ensure duplicate detection still works
   - Keep indices synchronized on mutations
   - Maintain backward compatibility with TemplateStore

3. **Performance changes**:
   - Benchmark against TemplateStore usage
   - Consider impact on startup time
   - Test with large template sets (1000+ items)

4. **Type definition changes**:
   - Update `types.ts` with new generics
   - Ensure method overloads remain type-safe
   - Test complex generic scenarios

## Related Files

- `src/TemplateStore.ts` - Primary consumer of this module
- `src/types.ts` - Item type definitions (Generator, Action)
- `tests/indexed-store.spec.ts` - Test suite
- `tests/util/indexed-store.helpers.ts` - Test utilities

## Future Enhancements

Potential improvements not yet implemented:

1. **Lazy index creation**: Only create indices when first needed
2. **Composite indices**: Index on computed properties
3. **Update operation**: In-place modification with index sync
4. **Remove all matching**: Batch removal by property
5. **Iterator interface**: for...of support for large collections
6. **Serialization**: Save/restore store state
7. **Transaction support**: Atomic multi-item operations
8. **WeakMap variant**: Memory-efficient references for garbage collection