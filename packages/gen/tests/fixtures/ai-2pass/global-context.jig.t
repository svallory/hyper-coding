---
to: "output/{{ name }}.ts"
---
@context()
  This project uses TypeScript with strict mode.
  Database: PostgreSQL.
@end

@ai({ key: 'repository' })
  @prompt()
    Generate a repository for {{ name }}
  @end

  @output()
    @example()
    class NameRepository { ... }
    @end
  @end
@end
