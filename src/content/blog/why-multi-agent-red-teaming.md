---
title: "Why multi-agent systems need red-teaming"
date: 2026-06-03
description: "A short note on emergent harm in populated agent environments — and why a single-agent safety test won't catch it."
---

Most AI safety testing assumes one agent, one task, one user. But the systems
heading into production look nothing like that. They're *populations* — agents
that coordinate, hand off work, impersonate, negotiate, and act autonomously
across shared environments.

Harm in these settings is **emergent**: it shows up in the interactions, not in
any single agent. An agent that behaves perfectly in isolation can leak private
data, spoof an identity, or report false success the moment it's dropped into a
crowd of other agents under pressure.

That's the gap we work in. We build the environment your agents will run in,
populate it, and run continuous adversarial campaigns against the whole system —
then feed the findings back into the build until what's left is safe to deploy.

This is the first of an occasional series of notes on what we find.
