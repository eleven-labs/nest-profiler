# GitHub Repository Automation

This folder contains the repository setup script and the JSON configuration it applies through the GitHub CLI.

## Prerequisites

- Install the [`gh` CLI](https://cli.github.com).
- Authenticate with an account that has admin access to the target repository:

```bash
gh auth login
```

## Initial Setup

After pushing the repository to GitHub, run:

```bash
pnpm configure-github
```

The setup command applies:

- issue and pull request labels from `labels.json`
- milestones from `milestones.json`
- the branch ruleset from `rulesets.json`
- repository settings for auto-merge and branch cleanup
- optional `CODEOWNERS` activation

## Updates

To re-sync labels, rulesets, or repository settings later, run:

```bash
pnpm configure-github:update
```

Update mode does not create milestones or change `CODEOWNERS`.
