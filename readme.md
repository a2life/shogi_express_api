# Shogi Engine API Server

> **This project was created with [Claude](https://claude.ai) by Anthropic.**  
> The full codebase — architecture, TypeScript source files, and this document — was designed and written through a conversational session with Claude.


---

## Overview

This project is an HTTP API server that wraps a **USI-compatible Shogi engine binary** (such as [YaneuraOu](https://github.com/yaneurao/YaneuraOu)) and exposes its capabilities as a simple REST API. It is written in **TypeScript** on **Node.js** using the **Express** framework.

### What it does

A USI engine is a command-line binary that communicates over stdin/stdout using the [USI protocol](http://shogidokoro.starfree.jp/usi.html) — the Shogi equivalent of the UCI protocol used in chess engines. Interacting with it directly requires managing a persistent child process, speaking a line-oriented text protocol, and carefully sequencing commands. This server handles all of that for you and exposes the results as clean JSON over HTTP.

**Key capabilities:**

- **Position analysis** — submit any board position (as a SFEN string or from the opening position) with optional move sequences, and receive the engine's best move, principal variation, and mate detection in a single request.
- **Search control** — tune the analysis with `movetime`, `depth`, and `nodes` limits, or run an infinite search that auto-stops when the engine goes quiet.
- **Engine management** — the server handles the full USI initialisation handshake on startup, applies engine options from a config file, and automatically restarts the engine if it crashes unexpectedly.
- **Raw USI access** — a generic endpoint lets you send arbitrary USI commands directly to the engine for debugging or advanced use.

### Typical use cases

- A personal Shogi study tool that analyses positions from a game record viewer or board UI.
- A backend for a Shogi web app that needs engine suggestions or tsume (mate) solving.
- An analysis helper for game logging or post-game review pipelines.

---

## ⚠️ Concurrency Warning

**This server is not suited for high-concurrency or multi-client deployments.**

A USI Shogi engine binary is inherently single-threaded with respect to position state. The engine holds one active board position at a time, and the `position` + `go` command sequence must be treated as an atomic unit — if a second client's `position` command arrives before the first client's `go` has finished, the analysis will silently run against the wrong position.

This server mitigates the problem with a **serial command queue**: all engine interactions are queued and executed one at a time, so concurrent HTTP requests will queue up and wait their turn rather than interleave. This is safe, but it means:

- Under load, requests wait in a serial queue — throughput is bounded by engine think time.
- A single slow `go infinite` request blocks all other callers until it completes.
- This architecture is appropriate for personal tools, single-user apps, or low-traffic services — **not** for serving many simultaneous users.

If you need to serve multiple users concurrently, consider running multiple isolated instances of this server (one engine process per instance) behind a load balancer.

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Server](#running-the-server)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Response Shapes](#response-shapes)

---

## Requirements

- **Node.js** 18 or later
- **npm** 8 or later
- A USI-compatible Shogi engine binary (e.g. [YaneuraOu](https://github.com/yaneurao/YaneuraOu), [Apery](https://github.com/HiraokaTakuya/apery_rust), [Stockfish with shogi variant](https://github.com/fairy-stockfish/Fairy-Stockfish))

---

## Installation

```bash
git clone <your-repo-url>
cd shogi-api
npm install
```

---

## Configuration

### `.env`

Copy the example and edit as needed:

```bash
cp .env.example .env   # or create .env manually
```

| Variable            | Default               | Description                                      |
|---------------------|-----------------------|--------------------------------------------------|
| `PORT`              | `3000`                | HTTP port the server listens on                  |
| `ENGINE_PATH`       | `/engine/engine.exe`  | Absolute path to the USI engine binary           |
| `ENGINE_CONFIG_PATH`| `./config.json`       | Path to the engine options JSON file             |

### `config.json`

Contains `setoption` parameters sent to the engine during initialisation. Keys become option names, values become option values.

```json
{
  "USI_Hash": 2048,
  "FV_Scale": 24
}
```

This results in the following being sent to the engine on startup:

```
setoption name USI_Hash value 2048
setoption name FV_Scale value 24
```

Add, remove, or change entries freely — no code changes required.

---

## Running the Server

### Development (hot-reload)

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

The server will refuse to accept requests until the engine has completed its initialisation handshake (`usi` → `usiok` → `setoption` loop → `isready` → `readyok`). If the engine binary cannot be found or fails the handshake, the process exits with a non-zero code.

---

## Project Structure

```
shogi-api/
├── src/
│   ├── index.ts                  # Entry point — starts engine, then HTTP server
│   ├── app.ts                    # Express app factory, route wiring
│   ├── config.ts                 # Loads .env (dotenv) and config.json
│   └── engine/
│   │   ├── engineProcess.ts      # Spawns binary, USI handshake, crash/retry, public API
│   │   ├── commandQueue.ts       # Serial promise queue — one command in-flight at a time
│   │   └── usiProtocol.ts        # USI line parser, blocked/void command sets, result enrichment
│   └── routes/
│       ├── health.ts             # GET /
│       ├── usiCommand.ts         # GET /api/usi_command/:command
│       ├── setOption.ts          # GET /api/setoption/:name/:value
│       └── analyze.ts            # GET|POST /api/analyze/:waittime?
├── config.json                   # Engine setoption parameters
├── .env                          # Environment variables (not committed)
├── package.json
└── tsconfig.json
```

---

## Architecture

### Engine lifecycle

On startup `EngineProcess.initialize()` runs the full USI handshake:

```
server → engine : usi
engine → server : id name ...
engine → server : id author ...
engine → server : option ...  (repeated)
engine → server : usiok
server → engine : setoption name <k> value <v>  (repeated, from config.json)
server → engine : isready
engine → server : readyok        ← server begins accepting HTTP requests
```

### Command queue

Every interaction with the engine — including void fire-and-forget commands — passes through a `CommandQueue`. The queue is a simple promise chain that allows only one task to hold the engine at a time. HTTP requests that arrive while the engine is busy are suspended until the queue drains to their turn.

### Crash recovery

If the engine binary exits unexpectedly, `EngineProcess` will attempt to restart it automatically:

- Up to **3 retries** within any rolling **3-minute window**.
- Restart delay backs off: 1 s, 2 s, 3 s.
- If the retry limit is exceeded, the server emits a `fatal` event and exits with code 1.

---

## API Reference

### `GET /`

Health check. Returns engine ready status.

**Response**
```json
{
  "status": "ok",
  "timestamp": "2026-02-25T16:23:45.107Z",
  "engine": {
    "ready": true,
    "name": "YaneuraOu NNUE 9.20git 64AVX2 TOURNAMENT",
    "author": "yaneurao"
  },
  "api": [
    {
      "method": "GET",
      "path": "/",
      "description": "Health check — engine status, engine info, and this endpoint list."
    },
    {
      "method": "GET",
      "path": "/api/usi_command/:command",
      "description": "Send a raw USI command to the engine and return its output lines. Blocked: go, go mate, position, setoption, quit."
    },
    {
      "method": "GET",
      "path": "/api/setoption/:name/:value",
      "description": "Send \"setoption name <name> value <value>\" to the engine."
    },
    {
      "method": "POST",
      "path": "/api/analyze/:waittime?",
      "description": "Analyse a position. Body: { sfen?, moves?, depth?, nodes? }. waittime (ms): omit = go, 0 = go infinite, N = go movetime N."
    },
    {
      "method": "GET",
      "path": "/api/analyze/:waittime?",
      "description": "Analyse a position. Query params: sfen, moves, depth, nodes. waittime (ms): omit = go, 0 = go infinite, N = go movetime N."
    }
  ]
}
```

---

### `GET /api/usi_command/:command`

Sends a raw USI command to the engine and returns its output lines.

**Blocked commands** (use dedicated endpoints instead): `go`, `go mate`, `position`, `setoption`, `quit`

**Void commands** (engine produces no output — resolved immediately): `usinewgame`, `gameover`, `stop`, `ponderhit`

All other commands collect output lines until a terminal token (`usiok`, `readyok`, `bestmove`) or a blank line is received, with a 10-second timeout.

**Examples**
```
GET /api/usi_command/usi
GET /api/usi_command/isready
GET /api/usi_command/usinewgame
```

**Response**
```json
{
  "command": "usi",
  "lines": [
    "id name YaneuraOu",
    "id author yaneurao",
    "option name USI_Hash ...",
    "usiok"
  ]
}
```

---

### `GET /api/setoption/:name/:value`

Sends `setoption name <name> value <value>` to the engine. This is a void command — the engine produces no output.

**Example**
```
GET /api/setoption/USI_Hash/1024
GET /api/setoption/MultiPV/3
```

**Response**
```json
{
  "command": "setoption name USI_Hash value 1024",
  "result": "sent"
}
```

---

### `POST /api/analyze/:waittime?`
### `GET  /api/analyze/:waittime?`

Atomically sends `position` then `go` to the engine and waits for `bestmove`. The position + go sequence is serialized through the command queue to prevent race conditions between concurrent callers.

#### Parameters

| Source | Name | Type | Required | Description |
|--------|------|------|----------|-------------|
| URL path | `waittime` | integer (ms) | No | Controls the `go` command. See table below. |
| Body / Query | `sfen` | string | No | SFEN position string. Omit for `startpos`. |
| Body / Query | `moves` | string or array | No | Space-separated USI moves from the position (e.g. `"7g7f 3c3d"`). POST accepts a JSON array too. |
| Body / Query | `depth` | integer | No | Maximum search depth (`go depth <n>`). |
| Body / Query | `nodes` | integer | No | Maximum nodes to search (`go nodes <n>`). |

#### `go` command truth table

| `waittime` | `depth` | `nodes` | Command sent to engine |
|------------|---------|---------|------------------------|
| omitted | omitted | omitted | `go` |
| `0` | any | any | `go infinite` *(depth/nodes ignored; auto-stop after 10 s of silence)* |
| `3000` | omitted | omitted | `go movetime 3000` |
| `3000` | `20` | omitted | `go movetime 3000 depth 20` |
| `3000` | omitted | `500000` | `go movetime 3000 nodes 500000` |
| `3000` | `20` | `500000` | `go movetime 3000 depth 20 nodes 500000` |
| omitted | `20` | omitted | `go depth 20` |
| omitted | omitted | `500000` | `go nodes 500000` |

#### POST examples

```bash
# Analyse startpos for 3 seconds
curl -X POST http://localhost:3000/api/analyze/3000 \
  -H "Content-Type: application/json" \
  -d '{}'

# Specific position, 2 moves played, depth-limited
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "sfen": "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
    "moves": ["7g7f", "3c3d"],
    "depth": 20
  }'

# Infinite search (auto-stops after 10 s of no output)
curl -X POST http://localhost:3000/api/analyze/0 \
  -H "Content-Type: application/json" \
  -d '{ "sfen": "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1" }'
```

#### GET examples

```bash
# Startpos, 3 seconds
GET /api/analyze/3000

# Position + moves, depth limited
GET /api/analyze?sfen=lnsgkgsnl%2F1r5b1%2F...&moves=7g7f%203c3d&depth=20

# Node-limited search from startpos
GET /api/analyze?nodes=500000
```

---

## Response Shapes

### Analyze — mate found

```json
{
  "sfen": "1+B2+N3l/3kl1R1g/3s1p1p1/p1ppp1S2/2s5p/PP2P4/1KPP1P2P/1G1+p5/LN3s1rL b 2N2Pb2gp 1",
  "moves": [],
  "waittime": 6000,
  "depth": null,
  "nodes": null,
  "lines": [
    "info depth 33 seldepth 12 multipv 1 score mate 11 nodes 797656 nps 5282490 hashfull 1 time 151 pv 8a6c 6b6c 3b5b+ 6c7c N*8e 7c8c L*8d 8c8d S*9c 8d8c 5b8b",
    "bestmove 8a6c ponder 6b6c"
  ],
  "bestmove": "8a6c",
  "ponder": "6b6c",
  "mate": true,
  "mate_length": 11,
  "mate_moves": "8a6c 6b6c 3b5b+ 6c7c N*8e 7c8c L*8d 8c8d S*9c 8d8c 5b8b"
}
```

### Analyze — no mate

```json
{
  "sfen": "startpos",
  "moves": ["7g7f", "3c3d"],
  "waittime": 3000,
  "depth": null,
  "nodes": null,
  "lines": [
    "info depth 18 seldepth 22 multipv 1 score cp 42 ...",
    "bestmove 2g2f ponder 8c8d"
  ],
  "bestmove": "2g2f",
  "ponder": "8c8d",
  "mate": false
}
```

### Error responses

```jsonp
{ "error": "Engine is not ready." }               // 503
{ "error": "\"depth\" must be a positive integer." } // 400
{ "error": "Timeout waiting for response to: \"go movetime 3000\"" } // 500
```