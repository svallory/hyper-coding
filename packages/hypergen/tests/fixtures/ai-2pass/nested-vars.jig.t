---
to: "output/{{ name }}.ts"
---
@ai()
  @context()
    Model name: {{ name }}
    Table name: {{ snakeCase(name) }}
  @end

  @prompt()
    Generate a migration for the {{ name }} model with table {{ snakeCase(name) }}
  @end

  @output({ key: 'migration' })
    CREATE TABLE {{ snakeCase(name) }} (...);
  @end
@end
