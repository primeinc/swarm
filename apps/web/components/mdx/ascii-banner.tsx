"use client";

import { cn } from "@/lib/utils";

/**
 * Pre-defined ASCII art banners for Swarm Tools documentation
 */
const BANNERS = {
	swarm: `
███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
`,
	mail: `
┌─────────────────────────────────────┐
│  📬  SWARM MAIL                     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  Event-Sourced Agent Coordination   │
└─────────────────────────────────────┘
`,
	beads: `
┌─────────────────────────────────────┐
│  🔮  BEADS                          │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  Git-Backed Issue Tracking          │
└─────────────────────────────────────┘
`,
	skills: `
┌─────────────────────────────────────┐
│  📚  SKILLS                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  Knowledge Injection System         │
└─────────────────────────────────────┘
`,
	learning: `
┌─────────────────────────────────────┐
│  🧠  LEARNING                       │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  Pattern Maturity & Anti-Patterns   │
└─────────────────────────────────────┘
`,
	architecture: `
┌─────────────────────────────────────────────────────────────┐
│                     SWARM TOOLS STACK                       │
├─────────────────────────────────────────────────────────────┤
│  TIER 3: ORCHESTRATION                                      │
│  └── OpenCode Plugin (beads, swarm, skills, learning)      │
│                                                             │
│  TIER 2: COORDINATION                                       │
│  ├── DurableMailbox - Actor inbox with typed envelopes     │
│  ├── DurableLock - CAS-based mutual exclusion              │
│  └── ask<Req, Res>() - Request/Response (RPC-style)        │
│                                                             │
│  TIER 1: PRIMITIVES                                         │
│  ├── DurableCursor - Checkpointed stream reader            │
│  └── DurableDeferred - Distributed promise                 │
│                                                             │
│  STORAGE                                                    │
│  └── PGLite (Embedded Postgres) + Event Sourcing           │
└─────────────────────────────────────────────────────────────┘
`,
	bee: `
    🐝
   ╱  ╲
  ╱ ◉◉ ╲
 ╱  ──  ╲
╱________╲
   ║║║║
`,
	hive: `
    ⬡ ⬡ ⬡
   ⬡ 🐝 ⬡
    ⬡ ⬡ ⬡
`,
} as const;

type BannerName = keyof typeof BANNERS;

interface AsciiBannerProps {
	/** Pre-defined banner name or custom ASCII art */
	name?: BannerName;
	/** Custom ASCII art (overrides name) */
	children?: string;
	/** Additional CSS classes */
	className?: string;
	/** Whether to show the glow effect */
	glow?: boolean;
}

/**
 * ASCII Banner component for Swarm Tools documentation
 *
 * Usage in MDX:
 * ```mdx
 * <AsciiBanner name="swarm" />
 * <AsciiBanner name="architecture" glow />
 * <AsciiBanner>
 * Custom ASCII art here
 * </AsciiBanner>
 * ```
 */
export function AsciiBanner({
	name,
	children,
	className,
	glow = false,
}: AsciiBannerProps) {
	const content = children ?? (name ? BANNERS[name] : "");

	return (
		<pre
			className={cn(
				"ascii-banner overflow-x-auto text-center",
				glow && "glow-amber",
				className,
			)}
		>
			<code className="text-fd-primary">{content}</code>
		</pre>
	);
}

/**
 * Simple ASCII art display (no banner styling)
 *
 * Usage in MDX:
 * ```mdx
 * <AsciiArt>
 * ┌───────┐
 * │ Hello │
 * └───────┘
 * </AsciiArt>
 * ```
 */
export function AsciiArt({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<pre className={cn("ascii-art", className)}>
			<code>{children}</code>
		</pre>
	);
}

export default AsciiBanner;
