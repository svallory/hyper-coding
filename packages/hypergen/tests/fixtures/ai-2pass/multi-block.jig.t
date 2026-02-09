---
to: "output/{{ name }}.ts"
---
// Fields:
@ai()
  @prompt()
    List the main fields for {{ name }}
  @end

  @output({ key: 'fields' })
    field1, field2, field3
  @end
@end

// Relations:
@ai()
  @prompt()
    List the relationships for {{ name }}
  @end

  @output({ key: 'relations' })
    hasMany: [], belongsTo: []
  @end
@end
