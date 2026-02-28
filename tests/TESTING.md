# Test Suite — shogi_express_api

## Install dev dependencies

```bash
npm install --save-dev jest ts-jest @types/jest supertest @types/supertest
```

## Add scripts to package.json

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

## Run tests

```bash
npm test              # all tests
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```

---

## File structure

```
tests/
├── unit/
│   ├── usiProtocol.test.ts     # parseLine(), parseAnalysisResult(), VOID/BLOCKED sets
│   └── commandQueue.test.ts    # enqueue(), size, serial execution, error recovery
└── integration/
    └── routes.test.ts          # All 4 HTTP routes via supertest + jest.mock(engine)
jest.config.ts
```

---

## Unit tests

### `usiProtocol.test.ts`

| Subject | Cases |
|---|---|
| `VOID_COMMANDS` | Contains usinewgame/gameover/stop/ponderhit; excludes usi/go/quit |
| `BLOCKED_COMMANDS` | Contains go/go mate/position/setoption/quit; excludes usinewgame/stop |
| `parseLine()` | usiok, readyok, id name/author, option, bestmove+ponder, bestmove alone, resign/win, info with depth+cp+pv, info with mate±, info raw preserve, pv absent, no-field info, unknown line → raw, empty string |
| `parseAnalysisResult()` | bestmove+ponder, ponder=null, bestmove=null, score from last info, ignores earlier lines, score=null when no cp, negative cp, mate=true + mate_length (Math.abs) + mate_moves, score absent on mate, mate_moves="" when no pv, empty array, non-info lines ignored |

### `commandQueue.test.ts`

| Subject | Cases |
|---|---|
| Basic execution | Single resolve, multiple callers each get correct value, sync Promise.resolve |
| Serialization | maxActive===1 across 3 concurrent enqueues, FIFO order |
| Errors | Rejects caller, queue continues after failure, multiple failures don't break queue |
| `size` getter | 0 on fresh queue, counts waiting (not running) tasks, 0 after drain, 0 after failure |

---

## Integration tests (`routes.test.ts`)

Uses `jest.mock('../../src/engine/engineProcess')` to replace the singleton `engine`
with a controllable Jest mock object — no real binary needed.

### `GET /`
- 200 with status/timestamp/engine/api shape
- Timestamp is valid ISO string
- api[] entries have method/path/description
- api includes /api/analyze
- engine.ready=false reflected in body (route always 200)

### `GET /api/usi_command/:command`
- Void commands (usinewgame, stop, gameover) → 200, result: sent, lines: []
- Non-void (usi, isready) → 200, { command, lines }
- Blocked commands (go, go%20mate, position, setoption, quit) → 400
- Engine not ready → 503
- sendAndCollect rejects → 500

### `GET /api/setoption/:name/:value`
- 200 with exact command string and result: sent
- Calls sendVoid with correct setoption string
- Missing value segment → 404
- Engine not ready → 503
- sendVoid rejects → 500

### `POST /api/analyze`
- 200 no-mate shape (sfen, moves, waittime, depth, nodes, lines, bestmove, ponder, mate, score)
- 200 mate shape (mate_length, mate_moves, score absent)
- All args forwarded to engine.analyze in correct order
- sfen omitted → undefined (startpos in response)
- waittime=0 → 400 (use /api/analyze/stream?waittime=0 instead)
- waittime=25001 → 400 (exceeds 25000 ms cap)
- moves as array and as space-separated string
- Empty moves string → undefined
- depth=-1/0/1.5/"fast" → 400
- nodes=0 → 400
- waittime=-5 → 400
- Engine not ready → 503
- engine.analyze rejects → 500

### `GET /api/analyze`
- 200 with result shape
- depth/nodes/sfen/moves query params forwarded
- depth=abc / nodes=-1 → 400
- Engine not ready → 503
