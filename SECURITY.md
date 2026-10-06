# Security

## Untrusted input

The CLI reads local files and directories supplied by the user. Treat their
contents as untrusted data, including third-party skills. The CLI does not
download skill repositories or archives.

## Never executed automatically

`dsh-skill-forge` parses and copies skill content as data. It does not execute
anything that came from a third-party skill:

- shell commands
- PowerShell commands
- Python code
- npm lifecycle scripts (`preinstall`, `postinstall`, ...)
- executables
- binaries

Third-party content is data to be read and analyzed, never a program to run.

## Current behavior

- The CLI operates on local paths and does not fetch remote skills or make
  network requests.
- It does not send skill content to an LLM or install skill dependencies.
- URLs in a Codex `agents/openai.yaml` dependency declaration are parsed as
  input data; they are never fetched, probed, connected to or installed.
- Runtime dependencies are `commander` and `yaml`.

## Secrets

The CLI has no API-key or token configuration and does not read credentials
from environment variables. `.env` is git-ignored; `.env.example` currently
defines no variables. Never commit real credentials or private keys.

## Reporting a vulnerability

Open an issue in this repository describing the problem, or contact the
maintainers privately when public disclosure would put users at risk. Please do
not include real credentials in a report.
