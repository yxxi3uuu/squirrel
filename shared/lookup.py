"""Entity lookup helpers shared by modules that accept human text."""

from typing import Dict, Iterable, List, Optional

# 對齊修正後的 snapshot：官方資料只有兩種實體
ENTITY_COLLECTIONS = {
    "road_segment": "road_segments",   # RD_ 開頭
    "station": "stations",             # BS_ 開頭（捷運站、場館、商圈、轉運站＝基地台）
}


def normalize_name(value: str) -> str:
    """Normalize common Chinese naming variants for loose matching."""
    return (
        value.lower()
        .replace(" ", "")
        .replace("　", "")
        .replace("臺", "台")
        .replace("捷運", "")
        .replace("站", "")
    )


def iter_entity_aliases(entity_id: str, entity: Dict) -> Iterable[str]:
    yield entity_id
    if entity.get("name"):
        yield entity["name"]
    for alias in entity.get("aliases", []):
        yield alias


def build_alias_index(snapshot: Dict) -> Dict[str, Dict[str, str]]:
    """
    Build a normalized alias index.

    Return shape:
    {
      "忠孝東路四段": {"entity_type": "road_segment", "entity_id": "RD_TPE_001"}
    }
    """
    index = {}
    for entity_type, collection_name in ENTITY_COLLECTIONS.items():
        for entity_id, entity in snapshot.get(collection_name, {}).items():
            for alias in iter_entity_aliases(entity_id, entity):
                index[normalize_name(alias)] = {
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                }
    return index


def find_entities_in_text(
    text: str,
    snapshot: Dict,
    allowed_types: Optional[List[str]] = None,
) -> List[Dict]:
    """
    Find entities mentioned in a free-form question.

    This is intentionally simple and deterministic. LLM modules can use it to
    enrich prompts, while dashboard/notification modules can use the same IDs.
    """
    normalized_text = normalize_name(text)
    results = []

    for alias, ref in build_alias_index(snapshot).items():
        if allowed_types and ref["entity_type"] not in allowed_types:
            continue
        if alias and alias in normalized_text:
            collection_name = ENTITY_COLLECTIONS[ref["entity_type"]]
            entity_id = ref["entity_id"]
            entity = snapshot.get(collection_name, {}).get(entity_id, {})
            results.append(
                {
                    "entity_type": ref["entity_type"],
                    "entity_id": entity_id,
                    "name": entity.get("name") or entity_id,
                    "matched_alias": alias,
                    "data": entity,
                }
            )

    return _dedupe_results(results)


def _dedupe_results(results: List[Dict]) -> List[Dict]:
    seen = set()
    unique = []
    for result in results:
        key = (result["entity_type"], result["entity_id"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(result)
    return unique
