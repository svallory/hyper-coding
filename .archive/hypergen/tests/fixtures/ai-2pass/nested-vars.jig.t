---
to: "output/{{ name }}.ts"
---
@ai({ key: 'migration' })
  @context()
    Model name: {{ name }}
    Table name: {{ snakeCase(name) }}
  @end

  @prompt()
    Generate a migration for the {{ name }} model with table {{ snakeCase(name) }}
  @end

  @output()
    @example()
    CREATE TABLE {{ snakeCase(name) }} (...);
    @end
  @end
@end
