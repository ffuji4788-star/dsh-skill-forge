---
name: normalize-extra
description: A skill carrying frontmatter the universal core does not interpret.
author: Alice
version: 3
reviewed: true
deprecated: null
tags:
  - alpha
  - beta
disable-model-invocation: true
whenToUse: When checking that source frontmatter survives normalization.
---

# Normalize Extra

Everything except `name` and `description` must be preserved verbatim in the IR
source envelope.
