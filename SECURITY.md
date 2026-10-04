# Security

## Untrusted input

Every third-party skill, file, archive and repository is treated as untrusted
input. This applies to content obtained from the network as well as to content
already on disk.

## Never executed automatically

`dsh-skill-forge` does not automatically execute anything that came from a
third-party skill:

- shell commands
- PowerShell commands
- Python code
- npm lifecycle scripts (`preinstall`, `postinstall`, ...)
- executables
- binaries

Third-party content is data to be read and analyzed, never a program to run.

## Status

Phase 0 / Project Bootstrap processes no third-party input at all: no skill is
read, downloaded or executed, and no network request is made. The project
depends on exactly one runtime package (`commander`) for CLI argument parsing.

## Secrets

No API key, token or secret is read, logged or stored in Phase 0. `.env` is
git-ignored and `.env.example` documents no variable, because no code reads one
yet. A secret must never be committed; when a later phase introduces
configuration it belongs in `.env` (ignored) and in the process environment.

## Reporting a vulnerability

Open an issue in this repository describing the problem, or contact the
maintainers privately when public disclosure would put users at risk. Please do
not include real credentials in a report.
