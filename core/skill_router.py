from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Sequence

from core.skill_loader import Skill


@dataclass(frozen=True)
class SkillMatch:
    skill: Skill
    matched_triggers: tuple[str, ...]
    score: tuple[int, int]


def _normalize_query(query: str) -> str:
    return re.sub(r"\s+", " ", query.strip().casefold())


def _trigger_hits(query: str, trigger: str) -> bool:
    trigger_text = trigger.strip().casefold()
    if not trigger_text:
        return False
    if " " in trigger_text:
        return trigger_text in query
    return re.search(rf"\b{re.escape(trigger_text)}\b", query) is not None


def route_skill(query: str, skills: Sequence[Skill]) -> Skill | None:
    if not query.strip() or not skills:
        return None
    normalized = _normalize_query(query)
    best: SkillMatch | None = None
    ambiguous = False
    for skill in skills:
        matches = [trigger for trigger in skill.triggers if _trigger_hits(normalized, trigger)]
        if not matches:
            continue
        score = (len(matches), max(len(match) for match in matches))
        candidate = SkillMatch(skill=skill, matched_triggers=tuple(matches), score=score)
        if best is None or candidate.score > best.score:
            best = candidate
            ambiguous = False
        elif candidate.score == best.score:
            ambiguous = True
    if ambiguous or best is None:
        return None
    return best.skill

