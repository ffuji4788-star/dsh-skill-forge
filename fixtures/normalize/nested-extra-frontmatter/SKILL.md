---
name: normalize-nested
description: A skill with nested objects and arrays in its extra frontmatter.
metadata:
  zeta: last
  alpha: first
  nested:
    zulu: 1
    alpha: 2
    list:
      - z
      - a
      - m
counts:
  - 3
  - 1
  - 2
---

# Normalize Nested

Object keys are canonicalized recursively; array order is preserved because it
may carry meaning.
