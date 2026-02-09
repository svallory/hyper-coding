---
to: "output/{{ name }}.ts"
---
// Generated for {{ name }}

@ai()
  @context()
    The {{ name }} model has these fields:
    {{ JSON.stringify(fields, null, 2) }}
  @end

  @prompt()
    Which fields are most relevant for a quick-view card?
  @end

  @output({ key: 'mainFields' })
    ["fieldName1", "fieldName2"]
  @end
@end
