"""Lightweight request and response shapes for Module 3."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class SopSource:
    path: str
    score: int
    excerpt: str


@dataclass
class AdvisoryResponse:
    answer: str
    mode: str = "module-3-advisor"
    llm_mode: str = "mock"
    sources: List[SopSource] = field(default_factory=list)
    scenario: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "mode": self.mode,
            "llm_mode": self.llm_mode,
            "answer": self.answer,
            "sources": [
                {"path": source.path, "score": source.score, "excerpt": source.excerpt}
                for source in self.sources
            ],
            "scenario": self.scenario,
        }
