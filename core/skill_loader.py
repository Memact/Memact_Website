from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import yaml


@dataclass(frozen=True)
class Skill:
    name: str
    triggers: tuple[str, ...]
    filters: tuple[str, ...]
    priority: str | None
    instructions: str
    path: Path


_SKILLS_CACHE: list[Skill] | None = None


def _coerce_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        items = [str(item).strip() for item in value]
        return [item for item in items if item]
    text = str(value).strip()
    return [text] if text else []


def _split_frontmatter(text: str) -> tuple[str | None, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, text.strip()
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            frontmatter = "\n".join(lines[1:index])
            body = "\n".join(lines[index + 1 :]).strip()
            return frontmatter, body
    return None, text.strip()


def _load_skill(path: Path) -> Skill | None:
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return None
    frontmatter_text, body = _split_frontmatter(content)
    metadata: dict[str, object] = {}
    if frontmatter_text:
        try:
            metadata = yaml.safe_load(frontmatter_text) or {}
        except yaml.YAMLError:
            metadata = {}
    name = str(metadata.get("name") or path.parent.name).strip()
    triggers = tuple(_coerce_list(metadata.get("triggers")))
    filters = tuple(_coerce_list(metadata.get("filters")))
    priority = metadata.get("priority")
    priority_value = str(priority).strip() if priority is not None else None
    instructions = body.strip()
    if not name:
        return None
    return Skill(
        name=name,
        triggers=triggers,
        filters=filters,
        priority=priority_value or None,
        instructions=instructions,
        path=path,
    )


def load_skills(skills_root: Path | None = None) -> list[Skill]:
    root = skills_root or (Path(__file__).resolve().parents[1] / "skills")
    if not root.exists():
        return []
    skills: list[Skill] = []
    for skill_file in sorted(root.glob("*/SKILL.md")):
        skill = _load_skill(skill_file)
        if skill:
            skills.append(skill)
    return skills


def get_skills() -> list[Skill]:
    global _SKILLS_CACHE
    if _SKILLS_CACHE is None:
        _SKILLS_CACHE = load_skills()
    return _SKILLS_CACHE


def reload_skills() -> list[Skill]:
    global _SKILLS_CACHE
    _SKILLS_CACHE = load_skills()
    return _SKILLS_CACHE

