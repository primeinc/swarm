#!/usr/bin/env bun

/**
 * Demo script for debug logging.
 *
 * Run with different DEBUG settings:
 * - DEBUG=swarm:* bun src/debug-demo.ts (all logs)
 * - DEBUG=swarm:events bun src/debug-demo.ts (only events)
 * - DEBUG=swarm:events,swarm:messages bun src/debug-demo.ts (multiple)
 * - bun src/debug-demo.ts (no logs)
 */

import { log } from "./debug";

console.log("🐝 Swarm Debug Demo");
console.log("=".repeat(50));
console.log(`DEBUG env: ${process.env.DEBUG || "(not set)"}\n`);

log.events("Event: Worker spawned for task cell-123.1");
log.reservations("Reservation: src/auth/** claimed by BrightRiver");
log.messages("Message: BLOCKED - need database schema");
log.checkpoints("Checkpoint: Auth implementation 75% complete");

console.log("\n✅ Demo complete");
console.log("Try running with different DEBUG values!");
