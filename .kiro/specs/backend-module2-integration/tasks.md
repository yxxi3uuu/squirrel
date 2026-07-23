# Implementation Plan: backend-module2-integration

## Overview

將現有 `backend/` 模組（Module 2：即時事件處置與 SOP 規則引擎）遷移至 `warroom/module2/` 目錄下，遵循 `warroom/module5/` 已建立的子模組目錄結構模式。實作包含目錄建立、程式碼遷移與 import 路徑更新、獨立啟動與整合掛載支援、測試遷移、以及舊模組向後相容處理。

## Tasks

- [x] 1. Set up module2 directory structure and package files
  - [x] 1.1 Create `warroom/module2/` directory structure with all required subdirectories and `__init__.py` files
    - Create `warroom/module2/__init__.py` (empty, makes package importable)
    - Create `warroom/module2/backend/__init__.py`
    - Create `warroom/module2/backend/routers/__init__.py`
    - Create `warroom/module2/backend/services/__init__.py`
    - Create `warroom/module2/backend/store/__init__.py`
    - Create `warroom/module2/tests/__init__.py`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 1.2 Create `warroom/module2/requirements.txt` with pinned dependencies
    - Include fastapi>=0.115.6, uvicorn[standard]>=0.32.1, httpx>=0.27.2, pydantic>=2.10.3
    - Only these 4 direct dependencies, no others
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 2. Migrate core services to `warroom/module2/backend/services/`
  - [x] 2.1 Migrate `sop_engine.py` to `warroom/module2/backend/services/sop_engine.py`
    - Copy `backend/services/sop_engine.py` content
    - Update internal import from `backend.services.llm_mock` to relative import `from .llm_mock import generate_guidance`
    - Keep `shared.schemas` and `shared.lookup` absolute imports unchanged
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.2 Migrate `llm_mock.py` to `warroom/module2/backend/services/llm_mock.py`
    - Copy `backend/services/llm_mock.py` content
    - Keep `shared.schemas` absolute import unchanged (no internal cross-references to update)
    - _Requirements: 2.1, 2.2_

  - [x] 2.3 Migrate `incident_store.py` to `warroom/module2/backend/store/incident_store.py`
    - Copy `backend/store/incident_store.py` content (no imports to update, standalone module)
    - _Requirements: 2.1_

- [x] 3. Migrate router and main entry point
  - [x] 3.1 Migrate `incidents.py` router to `warroom/module2/backend/routers/incidents.py`
    - Copy `backend/routers/incidents.py` content
    - Update `from backend.services.sop_engine import process_incident` to `from warroom.module2.backend.services.sop_engine import process_incident` or relative import
    - Update `from backend.store.incident_store import ...` to relative/absolute import within warroom.module2
    - Keep `data.snapshot` and `shared.schemas` imports unchanged
    - Update `DATA_SOURCE_DIR` path calculation to resolve correctly from new location
    - _Requirements: 2.1, 2.4, 3.3, 3.4_

  - [x] 3.2 Create `warroom/module2/backend/main.py` as standalone FastAPI app
    - Create FastAPI instance with title "Module 2 — Live Incident Response"
    - Add CORS middleware allowing origins: localhost:5173, localhost:3000, localhost:8000
    - Include incidents router
    - Add `/health` endpoint returning `{"status": "ok", "module": "module2-incident-response"}`
    - _Requirements: 3.1, 3.2, 3.5_

- [x] 4. Checkpoint - Verify module2 standalone startup
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update warroom integration layer
  - [x] 5.1 Update `warroom/routers/incidents.py` to import SOP engine from new module2 path
    - Replace `from backend.services.sop_engine import process_incident as _engine_process_incident` with `from warroom.module2.backend.services.sop_engine import process_incident as _engine_process_incident`
    - Remove any remaining `backend.services.*` imports
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 5.2 Update `warroom/server.py` to import module2 router from new path
    - Add or update import for module2 incidents router from `warroom.module2.backend.routers.incidents`
    - Ensure `/health` endpoint still returns modules list containing integer 2
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

- [x] 6. Migrate tests and add deprecation notice
  - [x] 6.1 Create `warroom/module2/tests/test_sop_engine.py` with updated import paths
    - Copy `backend/tests/test_sop_engine.py` content
    - Update `from backend.services.sop_engine import process_incident` to `from warroom.module2.backend.services.sop_engine import process_incident`
    - Update data source path resolution to work from new file location
    - Ensure all three test cases (A, B, C) remain functionally equivalent
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 6.2 Add deprecation notice to `backend/main.py`
    - Add comment at top of file indicating deprecation, new module path (`warroom.module2.backend.main`), and suggested migration target
    - Do NOT delete or modify existing functionality
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 7. Checkpoint - Verify full integration
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Write property-based tests for SOP engine correctness
  - [ ]* 8.1 Write property test: SOP engine always returns well-formed decisions
    - **Property 1: SOP engine always returns well-formed decisions**
    - Use Hypothesis to generate random valid incident dicts and snapshot dicts
    - Assert process_incident() returns non-empty list of TriggerDecision with `triggered` as bool, `basis` as non-empty string, `entity_id` as non-null string
    - **Validates: Requirements 3.3, 4.3, 5.4**

  - [ ]* 8.2 Write property test: Response structure invariant across entry points
    - **Property 2: Response structure invariant across entry points**
    - Use Hypothesis to generate valid IncidentIn payloads
    - Assert /api/incidents/inject response always contains `decisions` (list), `processing_time_ms` (non-negative), and `snapshot` (dict)
    - **Validates: Requirements 3.3, 4.3**

  - [ ]* 8.3 Write property test: ETE formula consistency
    - **Property 3: ETE formula consistency**
    - Use Hypothesis to generate incidents with severity in {Low, Medium, High, Critical} and road segments with saturation 0.0–1.0
    - Assert calculate_ete() returns ete_minutes == base_clearance + max(0, (avg_saturation - 0.5) * 60)
    - **Validates: Requirements 3.3**

  - [ ]* 8.4 Write property test: Non-triggered incidents produce cascade guidance
    - **Property 4: Non-triggered incidents produce cascade guidance**
    - Use Hypothesis to generate incidents that do not match SOP-1/2/5 trigger conditions
    - Assert process_incident() returns exactly one TriggerDecision with triggered=False and non-empty cascade_checks
    - **Validates: Requirements 5.4**

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using Hypothesis (Python PBT framework)
- Unit tests validate specific examples and edge cases (cases A, B, C)
- The `backend/` directory is NOT deleted during this migration — only a deprecation notice is added
- External shared layers (`shared.*`, `data.*`) keep their absolute import paths unchanged

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["3.1", "3.2"] },
    { "id": 3, "tasks": ["5.1", "5.2", "6.1", "6.2"] },
    { "id": 4, "tasks": ["8.1", "8.2", "8.3", "8.4"] }
  ]
}
```
