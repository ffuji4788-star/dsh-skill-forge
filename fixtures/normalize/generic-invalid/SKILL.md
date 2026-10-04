---
description: A skill that fails generic structure validation and cannot be normalized.
---

# Normalize Generic Invalid

The frontmatter has no `name`, so `validate` fails and `normalize` must refuse to
produce a partial IR.
