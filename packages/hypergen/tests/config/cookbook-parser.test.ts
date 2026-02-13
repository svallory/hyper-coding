import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { tmpdir } from 'os'
import yaml from 'js-yaml'
import {
  parseCookbookFile,
  discoverCookbooksInKit,
  discoverRecipesInCookbook,
  type ParsedCookbook,
} from '../../src/config/cookbook-parser'

/**
 * Helper to create a temporary directory prefixed for easy identification.
 */
function makeTempDir(prefix = 'cookbook-parser-test-'): string {
  return fs.mkdtempSync(path.join(tmpdir(), prefix))
}

/**
 * Helper to write a cookbook.yml file from a plain object.
 */
function writeCookbookYml(dir: string, content: Record<string, unknown>): string {
  const filePath = path.join(dir, 'cookbook.yml')
  fs.writeFileSync(filePath, yaml.dump(content), 'utf-8')
  return filePath
}

/**
 * Helper to write a recipe.yml file with minimal content.
 */
function writeRecipeYml(dir: string, content: Record<string, unknown> = { name: 'test-recipe' }): string {
  const filePath = path.join(dir, 'recipe.yml')
  fs.writeFileSync(filePath, yaml.dump(content), 'utf-8')
  return filePath
}

describe('Cookbook Parser', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = makeTempDir()
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // parseCookbookFile
  // ──────────────────────────────────────────────────────────────────────────
  describe('parseCookbookFile', () => {
    it('should parse a valid full cookbook.yml with all fields', async () => {
      const filePath = writeCookbookYml(tempDir, {
        name: 'crud',
        description: 'CRUD operations cookbook',
        version: '1.2.0',
        defaults: { recipe: 'create' },
        recipes: ['./create/recipe.yml', './read/recipe.yml', './update/recipe.yml', './delete/recipe.yml'],
      })

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.filePath).toBe(filePath)
      expect(result.dirPath).toBe(tempDir)
      expect(result.config.name).toBe('crud')
      expect(result.config.description).toBe('CRUD operations cookbook')
      expect(result.config.version).toBe('1.2.0')
      expect(result.config.defaults).toEqual({ recipe: 'create' })
      expect(result.config.recipes).toEqual([
        './create/recipe.yml',
        './read/recipe.yml',
        './update/recipe.yml',
        './delete/recipe.yml',
      ])
    })

    it('should parse a minimal cookbook.yml with only name', async () => {
      const filePath = writeCookbookYml(tempDir, { name: 'minimal' })

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.config.name).toBe('minimal')
      expect(result.config.description).toBeUndefined()
      expect(result.config.version).toBeUndefined()
      expect(result.config.defaults).toBeUndefined()
      // When recipes field is absent, defaults to ['./*/recipe.yml']
      expect(result.config.recipes).toEqual(['./*/recipe.yml'])
    })

    it('should return error and isValid=false when name is missing', async () => {
      const filePath = writeCookbookYml(tempDir, {
        description: 'A cookbook without a name',
      })

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(1)
      expect(result.errors.some((e) => e.includes('name'))).toBe(true)
      expect(result.config.name).toBe('')
    })

    it('should return error and isValid=false when name is not a string', async () => {
      const filePath = writeCookbookYml(tempDir, { name: 123 })

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.includes('name'))).toBe(true)
    })

    it('should return error when file does not exist', async () => {
      const fakePath = path.join(tempDir, 'nonexistent', 'cookbook.yml')

      const result = await parseCookbookFile(fakePath)

      expect(result.isValid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('Cookbook file not found')
      expect(result.errors[0]).toContain(fakePath)
      expect(result.filePath).toBe(fakePath)
    })

    it('should return error for an empty file', async () => {
      const filePath = path.join(tempDir, 'cookbook.yml')
      fs.writeFileSync(filePath, '', 'utf-8')

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('Invalid YAML format or empty file')
    })

    it('should return error for a file with only whitespace/comments', async () => {
      const filePath = path.join(tempDir, 'cookbook.yml')
      fs.writeFileSync(filePath, '# just a comment\n\n', 'utf-8')

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('Invalid YAML format or empty file')
    })

    it('should return error for invalid YAML syntax', async () => {
      const filePath = path.join(tempDir, 'cookbook.yml')
      fs.writeFileSync(filePath, ':\n  bad: [yaml\n  broken:', 'utf-8')

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(1)
      expect(result.errors[0]).toContain('Failed to parse cookbook file')
    })

    it('should return error for YAML that parses to a scalar (string)', async () => {
      const filePath = path.join(tempDir, 'cookbook.yml')
      fs.writeFileSync(filePath, 'just a string', 'utf-8')

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(false)
      expect(result.errors).toHaveLength(1)
      // js-yaml parses bare strings as a string, which is not an object
      expect(result.errors[0]).toContain('Invalid YAML format or empty file')
    })

    it('should apply default recipes glob when recipes field is absent', async () => {
      const filePath = writeCookbookYml(tempDir, {
        name: 'no-recipes-field',
        description: 'Should get default recipes glob',
      })

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(true)
      expect(result.config.recipes).toEqual(['./*/recipe.yml'])
    })

    it('should preserve explicit recipes when provided', async () => {
      const customRecipes = ['./alpha/recipe.yml', './beta/recipe.yml']
      const filePath = writeCookbookYml(tempDir, {
        name: 'explicit-recipes',
        recipes: customRecipes,
      })

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(true)
      expect(result.config.recipes).toEqual(customRecipes)
    })

    it('should filter out non-string entries in recipes array', async () => {
      const filePath = writeCookbookYml(tempDir, {
        name: 'mixed-recipes',
        recipes: ['./valid/recipe.yml', 42, null, './also-valid/recipe.yml', true],
      })

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(true)
      expect(result.config.recipes).toEqual(['./valid/recipe.yml', './also-valid/recipe.yml'])
    })

    it('should parse custom defaults.recipe', async () => {
      const filePath = writeCookbookYml(tempDir, {
        name: 'with-defaults',
        defaults: { recipe: 'list' },
      })

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(true)
      expect(result.config.defaults).toBeDefined()
      expect(result.config.defaults!.recipe).toBe('list')
    })

    it('should handle defaults object without recipe key', async () => {
      const filePath = writeCookbookYml(tempDir, {
        name: 'defaults-no-recipe',
        defaults: { someOtherKey: 'value' },
      })

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(true)
      expect(result.config.defaults).toBeDefined()
      expect(result.config.defaults!.recipe).toBeUndefined()
    })

    it('should ignore non-string description', async () => {
      const filePath = writeCookbookYml(tempDir, {
        name: 'bad-desc',
        description: 42,
      })

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(true)
      expect(result.config.description).toBeUndefined()
    })

    it('should ignore non-string version', async () => {
      const filePath = writeCookbookYml(tempDir, {
        name: 'bad-version',
        version: 1.0,
      })

      const result = await parseCookbookFile(filePath)

      expect(result.isValid).toBe(true)
      expect(result.config.version).toBeUndefined()
    })

    it('should set dirPath to the parent directory of the file', async () => {
      const subDir = path.join(tempDir, 'nested', 'cookbook')
      fs.mkdirSync(subDir, { recursive: true })
      const filePath = writeCookbookYml(subDir, { name: 'nested-cookbook' })

      const result = await parseCookbookFile(filePath)

      expect(result.dirPath).toBe(subDir)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // discoverCookbooksInKit
  // ──────────────────────────────────────────────────────────────────────────
  describe('discoverCookbooksInKit', () => {
    it('should discover cookbooks by glob matching cookbook.yml files directly', async () => {
      // Create kit/cookbooks/crud/cookbook.yml
      const crudDir = path.join(tempDir, 'cookbooks', 'crud')
      fs.mkdirSync(crudDir, { recursive: true })
      writeCookbookYml(crudDir, { name: 'crud', description: 'CRUD cookbook' })

      const result = await discoverCookbooksInKit(tempDir, ['cookbooks/*/cookbook.yml'])

      expect(result.size).toBe(1)
      expect(result.has('crud')).toBe(true)
      const crud = result.get('crud')!
      expect(crud.config.name).toBe('crud')
      expect(crud.config.description).toBe('CRUD cookbook')
      expect(crud.isValid).toBe(true)
    })

    it('should discover cookbooks in directories that contain cookbook.yml', async () => {
      // Glob matches the directory itself, function should look for cookbook.yml inside
      const componentDir = path.join(tempDir, 'cookbooks', 'component')
      fs.mkdirSync(componentDir, { recursive: true })
      writeCookbookYml(componentDir, { name: 'component', description: 'Component cookbook' })

      // Glob pattern that matches directories
      const result = await discoverCookbooksInKit(tempDir, ['cookbooks/*'])

      expect(result.size).toBe(1)
      expect(result.has('component')).toBe(true)
    })

    it('should skip directories without cookbook.yml', async () => {
      // One valid cookbook
      const validDir = path.join(tempDir, 'cookbooks', 'valid')
      fs.mkdirSync(validDir, { recursive: true })
      writeCookbookYml(validDir, { name: 'valid' })

      // One directory without cookbook.yml
      const emptyDir = path.join(tempDir, 'cookbooks', 'empty-dir')
      fs.mkdirSync(emptyDir, { recursive: true })

      const result = await discoverCookbooksInKit(tempDir, ['cookbooks/*'])

      expect(result.size).toBe(1)
      expect(result.has('valid')).toBe(true)
      expect(result.has('empty-dir')).toBe(false)
    })

    it('should skip invalid cookbooks (e.g. missing name)', async () => {
      const invalidDir = path.join(tempDir, 'cookbooks', 'bad')
      fs.mkdirSync(invalidDir, { recursive: true })
      writeCookbookYml(invalidDir, { description: 'No name field' })

      const result = await discoverCookbooksInKit(tempDir, ['cookbooks/*/cookbook.yml'])

      expect(result.size).toBe(0)
    })

    it('should merge results from multiple globs', async () => {
      // First location: cookbooks/
      const crudDir = path.join(tempDir, 'cookbooks', 'crud')
      fs.mkdirSync(crudDir, { recursive: true })
      writeCookbookYml(crudDir, { name: 'crud' })

      // Second location: extra/
      const extraDir = path.join(tempDir, 'extra', 'auth')
      fs.mkdirSync(extraDir, { recursive: true })
      writeCookbookYml(extraDir, { name: 'auth' })

      const result = await discoverCookbooksInKit(tempDir, [
        'cookbooks/*/cookbook.yml',
        'extra/*/cookbook.yml',
      ])

      expect(result.size).toBe(2)
      expect(result.has('crud')).toBe(true)
      expect(result.has('auth')).toBe(true)
    })

    it('should return an empty map when no cookbooks are found', async () => {
      const result = await discoverCookbooksInKit(tempDir, ['nonexistent/*/cookbook.yml'])

      expect(result.size).toBe(0)
    })

    it('should handle overlapping globs without duplicating entries', async () => {
      const crudDir = path.join(tempDir, 'cookbooks', 'crud')
      fs.mkdirSync(crudDir, { recursive: true })
      writeCookbookYml(crudDir, { name: 'crud' })

      // Both globs match the same cookbook
      const result = await discoverCookbooksInKit(tempDir, [
        'cookbooks/*/cookbook.yml',
        'cookbooks/crud/cookbook.yml',
      ])

      // Map keyed by name, so duplicates overwrite — still size 1
      expect(result.size).toBe(1)
      expect(result.has('crud')).toBe(true)
    })

    it('should skip non-cookbook files matched by glob', async () => {
      // Create a regular file that is not cookbook.yml
      const randomFile = path.join(tempDir, 'cookbooks', 'readme.txt')
      fs.mkdirSync(path.join(tempDir, 'cookbooks'), { recursive: true })
      fs.writeFileSync(randomFile, 'not a cookbook', 'utf-8')

      const result = await discoverCookbooksInKit(tempDir, ['cookbooks/*'])

      expect(result.size).toBe(0)
    })

    it('should use cookbook name from config as map key, not directory name', async () => {
      const dirName = 'my-directory'
      const dir = path.join(tempDir, 'cookbooks', dirName)
      fs.mkdirSync(dir, { recursive: true })
      writeCookbookYml(dir, { name: 'actual-cookbook-name' })

      const result = await discoverCookbooksInKit(tempDir, ['cookbooks/*'])

      expect(result.has('actual-cookbook-name')).toBe(true)
      expect(result.has(dirName)).toBe(false)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // discoverRecipesInCookbook
  // ──────────────────────────────────────────────────────────────────────────
  describe('discoverRecipesInCookbook', () => {
    it('should discover recipes by recipe.yml in subdirectories', async () => {
      // Create cookbook with two recipe subdirectories
      const createDir = path.join(tempDir, 'create')
      const readDir = path.join(tempDir, 'read')
      fs.mkdirSync(createDir, { recursive: true })
      fs.mkdirSync(readDir, { recursive: true })
      writeRecipeYml(createDir, { name: 'create', steps: [] })
      writeRecipeYml(readDir, { name: 'read', steps: [] })

      const result = await discoverRecipesInCookbook(tempDir, ['./*/recipe.yml'])

      expect(result.size).toBe(2)
      expect(result.has('create')).toBe(true)
      expect(result.has('read')).toBe(true)
    })

    it('should derive recipe name from directory name', async () => {
      const myRecipeDir = path.join(tempDir, 'my-awesome-recipe')
      fs.mkdirSync(myRecipeDir, { recursive: true })
      writeRecipeYml(myRecipeDir, { name: 'ignored-name', steps: [] })

      const result = await discoverRecipesInCookbook(tempDir, ['./*/recipe.yml'])

      // The recipe name comes from the directory, not from the YAML content
      expect(result.has('my-awesome-recipe')).toBe(true)
      expect(result.get('my-awesome-recipe')).toBe(path.join(myRecipeDir, 'recipe.yml'))
    })

    it('should skip directories without recipe.yml', async () => {
      const withRecipe = path.join(tempDir, 'with-recipe')
      const withoutRecipe = path.join(tempDir, 'without-recipe')
      fs.mkdirSync(withRecipe, { recursive: true })
      fs.mkdirSync(withoutRecipe, { recursive: true })
      writeRecipeYml(withRecipe)

      // Glob pattern that matches directories
      const result = await discoverRecipesInCookbook(tempDir, ['./*'])

      expect(result.size).toBe(1)
      expect(result.has('with-recipe')).toBe(true)
      expect(result.has('without-recipe')).toBe(false)
    })

    it('should handle glob matching recipe.yml files directly', async () => {
      const addDir = path.join(tempDir, 'add')
      fs.mkdirSync(addDir, { recursive: true })
      const recipeFile = writeRecipeYml(addDir)

      // Glob that matches the recipe.yml file itself
      const result = await discoverRecipesInCookbook(tempDir, ['./*/recipe.yml'])

      expect(result.size).toBe(1)
      expect(result.has('add')).toBe(true)
      expect(result.get('add')).toBe(recipeFile)
    })

    it('should handle glob matching directories containing recipe.yml', async () => {
      const deleteDir = path.join(tempDir, 'delete')
      fs.mkdirSync(deleteDir, { recursive: true })
      writeRecipeYml(deleteDir)

      // Glob that matches directories
      const result = await discoverRecipesInCookbook(tempDir, ['./*'])

      expect(result.size).toBe(1)
      expect(result.has('delete')).toBe(true)
      expect(result.get('delete')).toBe(path.join(deleteDir, 'recipe.yml'))
    })

    it('should work with the default glob pattern ./*/recipe.yml', async () => {
      const alphaDir = path.join(tempDir, 'alpha')
      const betaDir = path.join(tempDir, 'beta')
      const gammaDir = path.join(tempDir, 'gamma')
      fs.mkdirSync(alphaDir, { recursive: true })
      fs.mkdirSync(betaDir, { recursive: true })
      fs.mkdirSync(gammaDir, { recursive: true })
      writeRecipeYml(alphaDir)
      writeRecipeYml(betaDir)
      // gamma has no recipe.yml

      const result = await discoverRecipesInCookbook(tempDir, ['./*/recipe.yml'])

      expect(result.size).toBe(2)
      expect(result.has('alpha')).toBe(true)
      expect(result.has('beta')).toBe(true)
      expect(result.has('gamma')).toBe(false)
    })

    it('should return an empty map when no recipes are found', async () => {
      const result = await discoverRecipesInCookbook(tempDir, ['./*/recipe.yml'])

      expect(result.size).toBe(0)
    })

    it('should merge results from multiple recipe globs', async () => {
      // Recipes in subdirectories at different levels
      const shallowDir = path.join(tempDir, 'shallow')
      const deepDir = path.join(tempDir, 'nested', 'deep')
      fs.mkdirSync(shallowDir, { recursive: true })
      fs.mkdirSync(deepDir, { recursive: true })
      writeRecipeYml(shallowDir)
      writeRecipeYml(deepDir)

      const result = await discoverRecipesInCookbook(tempDir, [
        './*/recipe.yml',
        './nested/*/recipe.yml',
      ])

      expect(result.size).toBe(2)
      expect(result.has('shallow')).toBe(true)
      expect(result.has('deep')).toBe(true)
    })

    it('should skip non-recipe files matched by glob', async () => {
      // A regular file (not recipe.yml, not a directory)
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Hello', 'utf-8')

      const result = await discoverRecipesInCookbook(tempDir, ['./*'])

      expect(result.size).toBe(0)
    })

    it('should use parent directory name as recipe name when matching recipe.yml files', async () => {
      const updateDir = path.join(tempDir, 'update')
      fs.mkdirSync(updateDir, { recursive: true })
      writeRecipeYml(updateDir)

      const result = await discoverRecipesInCookbook(tempDir, ['./*/recipe.yml'])

      // recipeName = path.basename(path.dirname(match)) when match is a file
      expect(result.has('update')).toBe(true)
    })

    it('should use directory basename as recipe name when matching directories', async () => {
      const patchDir = path.join(tempDir, 'patch')
      fs.mkdirSync(patchDir, { recursive: true })
      writeRecipeYml(patchDir)

      const result = await discoverRecipesInCookbook(tempDir, ['./*'])

      // recipeName = path.basename(match) when match is a directory
      expect(result.has('patch')).toBe(true)
    })

    it('should handle later globs overwriting earlier ones for the same recipe name', async () => {
      // Two directories with the same basename at different paths
      const firstDir = path.join(tempDir, 'level1', 'create')
      const secondDir = path.join(tempDir, 'level2', 'create')
      fs.mkdirSync(firstDir, { recursive: true })
      fs.mkdirSync(secondDir, { recursive: true })
      writeRecipeYml(firstDir)
      writeRecipeYml(secondDir)

      const result = await discoverRecipesInCookbook(tempDir, [
        './level1/*/recipe.yml',
        './level2/*/recipe.yml',
      ])

      // Both have recipeName "create", the second glob's match overwrites the first
      expect(result.size).toBe(1)
      expect(result.has('create')).toBe(true)
      expect(result.get('create')).toBe(path.join(secondDir, 'recipe.yml'))
    })
  })
})
