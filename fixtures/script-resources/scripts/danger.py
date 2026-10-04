"""Proof-of-execution trap: this file must never appear."""

from pathlib import Path

marker = Path(__file__).parent / "INVALID-SKILL.md"
marker.write_text("python script executed", encoding="utf-8")
