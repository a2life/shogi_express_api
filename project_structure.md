''''
# Project Structure

```
shogi-api/
├── src/
│   ├── index.ts              # Entry point
│   ├── app.ts                # Express app setup
│   ├── config.ts             # Config loader (dotenv + config.json)
│   ├── engine/
│   │   ├── engineProcess.ts  # Spawn & manage the binary process
│   │   ├── usiProtocol.ts    # USI command helpers & parser
│   │   └── commandQueue.ts   # Serial command queue
│   └── routes/
│       ├── health.ts         # GET /
│       ├── usiCommand.ts     # GET /api/usi_command/:command
│       ├── setOption.ts      # GET /api/setoption/:name/:value
│       └── analyze.ts        # POST /api/analyze/:waittime?
├── config.json               # Engine option defaults
├── .env                      # Environment variables
├── package.json
└── tsconfig.json
```
This document outlines the directory structure and key files of the project.