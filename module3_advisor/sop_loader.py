"""SOP loader for Module 3.

The design document intentionally uses full SOP injection instead of RAG:
the SOP is short, and full injection avoids missing the relevant clause.
"""

from pathlib import Path
from typing import Iterable, List

from .schemas import SopSource

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SEARCH_DIRS = (PROJECT_ROOT / "sop",)
SUPPORTED_SUFFIXES = {".md", ".txt"}


def load_sop_context(message: str, limit: int = 5) -> List[SopSource]:
    del message  # Full SOP injection intentionally does not filter by query.
    sources: List[SopSource] = []
    for path in _iter_sop_files(DEFAULT_SEARCH_DIRS):
        text = _read_text(path)
        if not text.strip():
            continue

        sources.append(
            SopSource(
                path=str(path.relative_to(PROJECT_ROOT)),
                score=1,
                excerpt=text.strip().replace("\r\n", "\n"),
            )
        )

    return sources[:limit]


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
