---
name: dsh-when-to-use-invalid
description: A skill whose whenToUse is not a string.
whenToUse:
  - not
  - a
  - string
---

# DSH whenToUse Invalid

The pinned `optionalString` helper only accepts a string, so a sequence is
dropped. It does not reject the skill.
