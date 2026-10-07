# cells - AI-Native Issue Tracking

Welcome to cells! This repository uses **cells** for issue tracking - a modern, AI-native tool designed to live directly in your codebase alongside your code.

## What is cells?

cells is issue tracking that lives in your repo, making it perfect for AI coding agents and developers who want their issues close to their code. No web UI required - everything works through the CLI and integrates seamlessly with git.

**Learn more:** [github.com/steveyegge/cells](https://github.com/steveyegge/cells)

## Quick Start

### Essential Commands

```bash
# Create new issues
bd create "Add user authentication"

# View all issues
bd list

# View issue details
bd show <issue-id>

# Update issue status
bd update <issue-id> --status in_progress
bd update <issue-id> --status done

# Sync with git remote
bd sync
```

### Working with Issues

Issues in cells are:
- **Git-native**: Stored in `.cells/issues.jsonl` and synced like code
- **AI-friendly**: CLI-first design works perfectly with AI coding agents
- **Branch-aware**: Issues can follow your branch workflow
- **Always in sync**: Auto-syncs with your commits

## Why cells?

✨ **AI-Native Design**
- Built specifically for AI-assisted development workflows
- CLI-first interface works seamlessly with AI coding agents
- No context switching to web UIs

🚀 **Developer Focused**
- Issues live in your repo, right next to your code
- Works offline, syncs when you push
- Fast, lightweight, and stays out of your way

🔧 **Git Integration**
- Automatic sync with git commits
- Branch-aware issue tracking
- Intelligent JSONL merge resolution

## Get Started with cells

Try cells in your own projects:

```bash
# Install cells
curl -sSL https://raw.githubusercontent.com/steveyegge/cells/main/scripts/install.sh | bash

# Initialize in your repo
bd init

# Create your first issue
bd create "Try out cells"
```

## Learn More

- **Documentation**: [github.com/steveyegge/cells/docs](https://github.com/steveyegge/cells/tree/main/docs)
- **Quick Start Guide**: Run `bd quickstart`
- **Examples**: [github.com/steveyegge/cells/examples](https://github.com/steveyegge/cells/tree/main/examples)

---

*cells: Issue tracking that moves at the speed of thought* ⚡
