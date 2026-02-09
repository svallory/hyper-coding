---
to: "output/{{ name }}.ts"
---
@context()
  This project uses TypeScript with strict mode.
  Database: PostgreSQL.
@end

@ai()
  @prompt()
    Generate a repository for {{ name }}
  @end

  @output({ key: 'repository' })
    class NameRepository { ... }
  @end
@end
