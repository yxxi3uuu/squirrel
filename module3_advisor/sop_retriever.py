"""Simple local SOP retriever for Module 3.

Module 3 is a what-if advisory chatbot, so it retrieves from SOP and contract
documents instead of depending on the traffic snapshot module.
"""

from pathlib import Path
import re
from typing import Iterable, List

from .schemas import SopSource

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SEARCH_DIRS = (PROJECT_ROOT / "sop", PROJECT_ROOT / "docs")
SUPPORTED_SUFFIXES = {".md", ".txt", ".json", ".csv"}


def retrieve_sop_context(message: str, limit: int = 5) -> List[SopSource]:
    keywords = _keywords(message)
    candidates: List[SopSource] = []

    for path in _iter_sop_files(DEFAULT_SEARCH_DIRS):
        text = _read_text(path)
        if not text.strip():
            continue

        score = _score(text, keywords)
        if score <= 0:
            continue

        candidates.append(
            SopSource(
                path=str(path.relative_to(PROJECT_ROOT)),
                score=score,
                excerpt=_excerpt(text, keywords),
            )
        )

    candidates.sort(key=lambda item: item.score, reverse=True)
    return candidates[:limit]


def format_sop_context(sources: List[SopSource]) -> str:
    if not sources:
        return "目前沒有檢索到相關 SOP 內容。"

    chunks = []
    for index, source in enumerate(sources, start=1):
        chunks.append(
            f"[來源 {index}: {source.path}, score={source.score}]\n{source.excerpt}"
        )
    return "\n\n".join(chunks)


def _iter_sop_files(search_dirs: Iterable[Path]) -> Iterable[Path]:
    for directory in search_dirs:
        if not directory.exists():
            continue
        for path in directory.rglob("*"):
            if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES:
                yield path


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="ignore")


def _keywords(message: str) -> List[str]:
    tokens = re.findall(r"[A-Za-z_]+\d*|\d+|[\u4e00-\u9fff]{2,}", message)
    return [token.lower() for token in tokens if len(token.strip()) >= 2]


def _score(text: str, keywords: List[str]) -> int:
    lowered = text.lower()
    return sum(lowered.count(keyword) for keyword in keywords)


def _excerpt(text: str, keywords: List[str], max_chars: int = 900) -> str:
    lowered = text.lower()
    first_hit = min(
        (lowered.find(keyword) for keyword in keywords if keyword in lowered),
        default=0,
    )
    start = max(first_hit - 250, 0)
    excerpt = text[start : start + max_chars].strip()
    return excerpt.replace("\r\n", "\n")
