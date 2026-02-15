---
to: "output/{{ name }}.ts"
---
// Fields:
@ai({ key: 'fields' })
  @prompt()
    List the main fields for {{ name }}
  @end

  @output()
    @example()
    field1, field2, field3
    @end
  @end
@end

// Relations:
@ai({ key: 'relations' })
  @prompt()
    List the relationships for {{ name }}
  @end

  @output()
    @example()
    hasMany: [], belongsTo: []
    @end
  @end
@end
