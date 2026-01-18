# Implementation Roadmap

## Overview

This roadmap implements all 5 ADRs in phased releases over 12 weeks. Each phase delivers incremental value and can ship independently.

## Phase 0: Preparation (Week 0)

**Goal:** Set up monorepo infrastructure and validate all ADRs

**Tasks:**

- [ ] Install Turborepo + configure turbo.json
- [ ] Set up Changesets for versioning
- [ ] Configure dependency-cruiser for circular dep detection
- [ ] Create packages/swarm-mail and packages/opencode-swarm-plugin directories
- [ ] Set up TypeScript project references
- [ ] Configure CI/CD with Turborepo caching

**Deliverables:**

- Working monorepo build (`turbo run build`)
- Published ADRs in docs/planning/
- CI pipeline running tests for both packages

**Success Criteria:**

- `bun run build` builds both packages in correct order
- No circular dependencies detected
- CI completes in <2 minutes (with caching)

---

## Phase 1: Package Extraction (Weeks 1-2)

**Goal:** Extract swarm-mail package and publish to npm

**ADRs:** ADR-001, ADR-002

**Tasks:**

- [ ] Move src/streams/\* to packages/swarm-mail/src/streams/
- [ ] Move agent-mail.ts, swarm-mail.ts to swarm-mail
- [ ] Update imports in opencode-swarm-plugin to use swarm-mail
- [ ] Migrate integration tests
- [ ] Write swarm-mail README with examples
- [ ] Add deprecation warnings in opencode-swarm-plugin
- [ ] Publish swarm-mail@0.1.0 to npm

**Deliverables:**

- swarm-mail published on npm
- opencode-swarm-plugin depends on swarm-mail
- Migration guide for existing users
- TypeDoc API documentation

**Success Criteria:**

- All tests pass in both packages
- swarm-mail works in standalone project
- No circular dependencies
- Published tarball <500KB

---

## Phase 2: Performance Optimizations (Weeks 3-4)

**Goal:** Replace polling with live queries and add batch operations

**ADRs:** ADR-003

**Tasks:**

- [ ] Create live query wrapper (src/streams/live-query.ts)
- [ ] Add subscription cleanup tracking
- [ ] Replace polling in watchInbox()
- [ ] Replace polling in watchEvents()
- [ ] Add batch message send API
- [ ] Add batch event append API
- [ ] Write integration tests for live queries
- [ ] Run performance benchmarks (latency, CPU, memory)

**Deliverables:**

- Live queries for inbox, events, file reservations
- Batch APIs for messages and events
- Performance benchmarks showing improvements
- Feature flag for gradual rollout

**Success Criteria:**

- Notification latency <50ms (99th percentile)
- CPU usage <1% in idle state
- Batch operations 10x faster than individual
- Memory usage increase <20%

**Metrics (Before → After):**

- Latency: 250-500ms → <10ms (25-50x improvement)
- CPU: 5-10% → <1% (5-10x reduction)
- Queries/sec: 2-4 → 0 (eliminated)

---

## Phase 3: Message Queue Features (Weeks 5-7)

**Goal:** Add priority queues, DLQ, TTL, pub/sub

**ADRs:** ADR-004

**Tasks:**

**Week 5: Priority Queues + DLQ**

- [ ] Add priority column to messages table
- [ ] Update getInbox() to ORDER BY priority DESC
- [ ] Create failed_messages table
- [ ] Implement retry logic with exponential backoff
- [ ] Add DLQ viewer to CLI

**Week 6: TTL + Pub/Sub**

- [ ] Add expires_at column to messages
- [ ] Implement background TTL cleanup job
- [ ] Add topic column to messages
- [ ] Implement subscribeToTopic() using live queries
- [ ] Support wildcard topic subscriptions

**Week 7: Testing + Documentation**

- [ ] Write integration tests for all features
- [ ] Add examples to README
- [ ] Document retry/DLQ behavior
- [ ] Document pub/sub patterns

**Deliverables:**

- Priority queues (4 levels: 0=urgent, 3=low)
- DLQ with retry tracking
- TTL with background cleanup
- Pub/sub with wildcard topics

**Success Criteria:**

- Priority messages processed first
- Failed messages retry 3x before DLQ
- Expired messages cleaned up within 5 minutes
- Topic subscriptions work with wildcards

---

## Phase 4: DevTools + CLI (Weeks 8-10)

**Goal:** Build DevTools UI and CLI for observability

**ADRs:** ADR-005

**Tasks:**

**Week 8: CLI**

- [ ] Add @effect/cli dependency
- [ ] Implement `swarm events` command
- [ ] Implement `swarm messages` command
- [ ] Implement `swarm locks` command
- [ ] Implement `swarm replay` command
- [ ] Add `--tail` mode for real-time updates

**Week 9: DevTools UI**

- [ ] Scaffold SvelteKit app in apps/devtools
- [ ] Build event stream viewer
- [ ] Build message inbox/outbox viewer
- [ ] Build file reservation timeline
- [ ] Add SSE endpoint for real-time updates

**Week 10: Integration + Polish**

- [ ] Static export of DevTools UI
- [ ] Embed UI in plugin (serve at /\_swarm/devtools)
- [ ] Add screenshots to README
- [ ] Write user guide

**Deliverables:**

- CLI with 5 commands (events, messages, locks, replay, metrics)
- DevTools UI (embeddable SvelteKit app)
- Real-time updates via SSE
- User guide with screenshots

**Success Criteria:**

- CLI can tail events in real-time
- DevTools UI shows live message stream
- UI works offline (static export)
- Documentation covers all CLI commands

---

## Phase 5: Metrics + Tracing (Weeks 11-12)

**Goal:** Add Prometheus metrics and OpenTelemetry tracing

**ADRs:** ADR-005

**Tasks:**

**Week 11: Metrics**

- [ ] Add prom-client dependency
- [ ] Instrument message send/receive latency
- [ ] Add lock contention histogram
- [ ] Add queue depth gauge
- [ ] Expose /metrics endpoint
- [ ] Add Grafana dashboard template

**Week 12: Tracing**

- [ ] Add @effect/opentelemetry dependency
- [ ] Instrument message send/receive spans
- [ ] Propagate trace context in messages
- [ ] Add trace_id to message metadata
- [ ] Test with Jaeger/Zipkin
- [ ] Write tracing guide

**Deliverables:**

- Prometheus metrics at /metrics endpoint
- OpenTelemetry tracing integration
- Grafana dashboard template
- Tracing guide with Jaeger setup

**Success Criteria:**

- Metrics exposed and scrapeable by Prometheus
- Traces visible in Jaeger UI
- Trace propagation across agents works
- Documentation for all observability tools

---

## Phase 6: Saga Pattern (Future)

**Goal:** Implement saga orchestration for long-running workflows

**ADRs:** ADR-004 (Phase 5)

**Status:** Deferred to v2.0

**Tasks:**

- [ ] Create saga_instances and saga_steps tables
- [ ] Add saga coordinator logic
- [ ] Implement compensation pattern
- [ ] Add saga viewer to DevTools UI
- [ ] Write saga pattern examples

**Deliverables:**

- Saga orchestration pattern
- Compensation (undo) support
- Saga viewer in DevTools
- 3+ example saga workflows

---

## Release Schedule

| Version   | Phase | Features                       | ETA     |
| --------- | ----- | ------------------------------ | ------- |
| **0.1.0** | 1     | swarm-mail package extraction | Week 2  |
| **0.2.0** | 2     | Live queries, batch operations | Week 4  |
| **0.3.0** | 3     | Priority, DLQ, TTL, pub/sub    | Week 7  |
| **0.4.0** | 4     | DevTools UI + CLI              | Week 10 |
| **0.5.0** | 5     | Metrics + tracing              | Week 12 |
| **1.0.0** | All   | Stable release                 | Week 13 |
| **2.0.0** | 6     | Saga pattern (future)          | TBD     |

---

## Dependencies Between Phases

```
Phase 0 (Monorepo)
  └──> Phase 1 (Package Extraction)
         └──> Phase 2 (Performance)
                ├──> Phase 3 (Queue Features)
                └──> Phase 4 (DevTools)
                       └──> Phase 5 (Metrics/Tracing)
                              └──> Phase 6 (Sagas, future)
```

**Critical Path:** Phases 0→1→2 are sequential. Phases 3-5 can partially overlap after Phase 2.

---

## Risk Mitigation

| Risk                                     | Phase | Mitigation                                                |
| ---------------------------------------- | ----- | --------------------------------------------------------- |
| Breaking changes during extraction       | 1     | Feature branch, comprehensive tests, migration guide      |
| Performance regression with live queries | 2     | Feature flag, benchmark before/after, fallback to polling |
| Complexity of saga pattern               | 6     | Defer to v2.0, gather user feedback first                 |
| DevTools UI maintenance burden           | 4     | Keep UI minimal, focus on CLI for power users             |
| Metrics overhead                         | 5     | Make metrics opt-in, minimal instrumentation              |

---

## Success Metrics

**Phase 1 (Package Extraction):**

- swarm-mail used in 3+ external projects within 3 months
- Zero breaking changes reported by users

**Phase 2 (Performance):**

- 25x faster notification latency (500ms → <10ms)
- 5x lower CPU usage (10% → <2%)

**Phase 3 (Queue Features):**

- 95% of messages processed within priority SLA
- <1% messages fail to DLQ

**Phase 4 (DevTools):**

- 80% of developers use DevTools UI for debugging
- CLI used in 50%+ of support cases

**Phase 5 (Metrics/Tracing):**

- Metrics dashboard used in production monitoring
- Distributed traces reduce debugging time by 50%

---

## Post-1.0 Backlog (v2.0+)

**Saga Pattern** (ADR-004 Phase 5)

- Long-running multi-agent workflows
- Compensation (undo) support
- Saga state visualization

**Advanced Pub/Sub**

- Message routing rules
- Filter expressions (SQL-like WHERE clauses)
- At-least-once vs exactly-once delivery guarantees

**Multi-Project Support**

- Cross-project message routing
- Project-level isolation
- Shared infra for mono repos

**Performance Tier 2**

- Connection pooling for multi-DB scenarios
- Message batching optimizations
- SKIP LOCKED for exactly-once semantics

**Security**

- Message encryption at rest
- Agent authentication/authorization
- Audit logging
