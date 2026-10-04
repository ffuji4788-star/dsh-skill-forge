---
name: Invalid--Name
description: '  '
author: Example Author
---

# Validate Multiple Errors

This fixture breaks several rules at once: the description is whitespace only,
the name is not kebab-case, and `author` is an unknown key. Validation must
report every error and the warning together, in a stable order.
