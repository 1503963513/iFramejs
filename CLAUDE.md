# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**iframe-js** is a lightweight cross-origin iframe communication library built on `postMessage`. It provides RPC, ACK confirmation, state sync, event bus, and auto-resize capabilities — all in a single-class dual-role architecture (one `Iframe` class serves both parent and child windows).

## Commands

```bash
# No build step required — the library is pure vanilla JS
# No test framework configured (package.json scripts.test is a placeholder)
# No linter configured

# Local demo requires a static file server (e.g., VS Code Live Server on port 5500)
```

## Architecture

### Source Files

- `ejs/index.js` — ES module entry, contains all library logic (~820 lines). Also the `module`/`main` field in package.json.
- `index.js` — Identical logic but without `export` statements (script-tag / CDN usage).
- `index.d.ts` — TypeScript declarations.
- `demo/` — HTML demo pages for manual testing.

### Core Design: Single Class, Dual Role

The `Iframe` class uses `switch(true)` in the constructor to determine whether it's running as **parent** (receives a container/node) or **child** (receives a string name). Role-specific behavior is set by dynamically rebinding `this.sendMessage` and `this.emit` to the parent or child variants at construction time.

### Message Protocol

All communication goes through `window.postMessage` (no MessageChannel). There are 8 message frame types differentiated by flags: plain message, custom event (`action` field), ACK request/response (`ack` field), RPC request/response (`isRpcReq`/`isRpcRes`), state sync (`isStateSync`), and auto-resize (`isAutoResize`). Every frame carries a `source` field with the magic prefix `'Iframe-Child-Screen'` + instance name.

### Promise-Based RPC

`callRemote()` stores `{ resolve, reject }` from a `new Promise` into `_pendingMessages` Map keyed by a unique `callId`. When the remote side responds with `{ isRpcRes, callId, result/error }`, the message listener looks up the pending entry and resolves/rejects the promise — achieving cross-iframe async function calls with `await` syntax.

### Key Internal Data Structures

- `_pendingMessages` (Map) — shared correlation table for both ACK and RPC pending promises, keyed by messageId or callId
- `_rpcMethods` (Map) — methods registered via `expose()`, keyed by method name
- `_messageQueue` (Array) — offline FIFO queue for messages sent before iframe is ready; flushed on `onload`
- `_originCache` (Set) — derived from `Whitelist` (Array), rebuilt on every whitelist mutation
- `_state` / `_stateListeners` (Set) — lightweight reactive state shared across the iframe boundary

### Same-Domain Fast Path

When parent and child are same-origin, `emit` and `action` bypass `postMessage` entirely and use direct `window[eventKey]` property access for synchronous invocation with zero serialization overhead.

### Security Layers (in message listener order)

1. ACK/RPC response matching (before origin check — accepts by callId correlation)
2. StateSync / AutoResize dispatch (before origin check)
3. Origin whitelist validation (auto-learn for child on empty whitelist, or explicit whitelist check)
4. `e.source !== this.iframe` window reference check (unforgeable)
5. Magic prefix `Iframe-Child-Screen` filter
6. Self-message filter by instance name

### Known Bugs

- `removeWhiteList()` (line ~450) is a copy-paste of `addWhiteList()` — it adds URLs instead of removing them.
- `BlockingLog()` globally overrides `console.log` with a no-op.
