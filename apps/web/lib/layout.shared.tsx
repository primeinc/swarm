import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { BookOpen, Cog, FlaskConical, Github } from "lucide-react";

/**
 * Shared layout options for Swarm Tools docs
 */
export function baseOptions(): BaseLayoutProps {
	return {
		nav: {
			title: (
				<div className="flex items-center gap-2">
					<span className="text-lg">🐝</span>
					<span className="font-semibold">Swarm Tools</span>
				</div>
			),
			transparentMode: "top",
		},
		links: [
			{
				text: "Guide",
				url: "/docs/guide",
				icon: <BookOpen className="size-4" />,
			},
			{
				text: "Reference",
				url: "/docs/reference",
				icon: <Cog className="size-4" />,
			},
			{
				text: "Research",
				url: "/docs/research",
				icon: <FlaskConical className="size-4" />,
			},
			{
				type: "icon",
				text: "GitHub",
				url: "https://github.com/joelhooks/swarm-tools",
				icon: <Github className="size-4" />,
				external: true,
			},
		],
		githubUrl: "https://github.com/joelhooks/swarm-tools",
	};
}
