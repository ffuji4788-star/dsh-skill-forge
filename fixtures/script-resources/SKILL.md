---
name: script-resources
description: A skill whose resources are executable scripts that must never run.
---

# Script Resources

Every file beside this one is an executable script. The analyzer may enumerate
and stat them, but it must never run them. Each script would leave a
`INVALID-SKILL.md` marker behind if it executed.
