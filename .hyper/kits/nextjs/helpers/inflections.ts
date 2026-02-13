/**
 * String inflection utilities for code generation
 */

/**
 * Convert string to PascalCase
 * @example pascalCase('user-profile') // 'UserProfile'
 */
export function pascalCase(str: string): string {
  return str
    .replace(/[_-\s]+(.)?/g, (_, chr) => (chr ? chr.toUpperCase() : ''))
    .replace(/^(.)/, (chr) => chr.toUpperCase())
}

/**
 * Convert string to camelCase
 * @example camelCase('user-profile') // 'userProfile'
 */
export function camelCase(str: string): string {
  const pascal = pascalCase(str)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

/**
 * Convert string to kebab-case
 * @example kebabCase('UserProfile') // 'user-profile'
 */
export function kebabCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
}

/**
 * Convert string to snake_case
 * @example snakeCase('UserProfile') // 'user_profile'
 */
export function snakeCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

/**
 * Convert string to Title Case
 * @example titleCase('user profile') // 'User Profile'
 */
export function titleCase(str: string): string {
  return str
    .replace(/[_-]/g, ' ')
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase())
}

/**
 * Pluralize a word (simple English rules)
 * @example pluralize('user') // 'users'
 * @example pluralize('category') // 'categories'
 */
export function pluralize(word: string): string {
  const irregular: Record<string, string> = {
    person: 'people',
    man: 'men',
    woman: 'women',
    child: 'children',
    tooth: 'teeth',
    foot: 'feet',
    mouse: 'mice',
    goose: 'geese',
  }

  const lower = word.toLowerCase()
  if (irregular[lower]) {
    return word[0] === word[0].toUpperCase()
      ? irregular[lower].charAt(0).toUpperCase() + irregular[lower].slice(1)
      : irregular[lower]
  }

  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) {
    return word.slice(0, -1) + 'ies'
  }

  if (/(s|ss|sh|ch|x|z)$/i.test(word)) {
    return word + 'es'
  }

  if (/[^aeiou]o$/i.test(word)) {
    return word + 'es'
  }

  return word + 's'
}

/**
 * Singularize a word (simple English rules)
 * @example singularize('users') // 'user'
 * @example singularize('categories') // 'category'
 */
export function singularize(word: string): string {
  const irregular: Record<string, string> = {
    people: 'person',
    men: 'man',
    women: 'woman',
    children: 'child',
    teeth: 'tooth',
    feet: 'foot',
    mice: 'mouse',
    geese: 'goose',
  }

  const lower = word.toLowerCase()
  if (irregular[lower]) {
    return word[0] === word[0].toUpperCase()
      ? irregular[lower].charAt(0).toUpperCase() + irregular[lower].slice(1)
      : irregular[lower]
  }

  if (word.endsWith('ies')) {
    return word.slice(0, -3) + 'y'
  }

  if (word.endsWith('es')) {
    if (/(ss|sh|ch|x|z)es$/i.test(word)) {
      return word.slice(0, -2)
    }
    if (/[^aeiou]oes$/i.test(word)) {
      return word.slice(0, -2)
    }
  }

  if (word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1)
  }

  return word
}
