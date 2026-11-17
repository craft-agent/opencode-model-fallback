# Security policy

opencode-model-fallback is an OpenCode plugin that changes which models a
coding agent runs on, and it can give agents tools that act as the person
running them. A flaw in it can let an agent do more than that person agreed to, so
please report one privately.

## Supported versions

Fixes go into the latest release. Consumers pin an npm version, so they get a
fix by moving to the new version.

## Reporting a vulnerability

Report it through [GitHub Security Advisories](https://github.com/craft-agent/opencode-model-fallback/security/advisories/new). Do not open a public issue or pull request for it. opencode-model-fallback has no bug bounty.

A useful report says:

- what an attacker can do, and what they need to do it
- the tool or hook affected and the OpenCode version, and the file and lines
  where it goes wrong
- the version (the npm version the consumer pins), or the commit
- the steps to reproduce it

## What opencode-model-fallback trusts

- **The tools run as you.** A tool reaches whatever it reaches with the
  credentials of the person running the agent, and can do no more than they
  may.
- **OpenCode decides what runs.** A tool that writes is marked as one, and
  the plugin asks OpenCode for permission before it runs; OpenCode's own
  permission rules decide whether a call runs.
- **Content a tool reads is untrusted.** Text read from files or services is
  data for the agent, never instructions to it.

## Scope

In scope:

- A tool doing more than its documentation says, or writing while it is
  marked or documented as read-only.
- A write that skips the confirmation the tool documents, or runs against a
  target other than the one confirmed.
- A secret or token leaking into a tool's output or a log.

Out of scope:

- What an agent does with a tool after the person running it approved the
  call, including changes that are wrong. Review its work as you would
  anyone's.
- OpenCode configured to approve every call unasked.
- Flaws in OpenCode or a runtime; report those to their maintainers.

Hardening ideas that are not vulnerabilities are welcome as ordinary issues.

## Disclosure

We aim to confirm a report within a week, keep you informed in the advisory,
and publish the advisory once a fixed release is out. Reporters are credited
in it unless they ask not to be.
