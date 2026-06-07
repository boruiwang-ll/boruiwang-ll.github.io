---
layout: post
title: "Singularity vs MAST: What It Takes to Schedule GPUs Across the Planet"
date: 2026-05-04
version: 4.1
---

Microsoft and Meta both operate GPU fleets at a scale where "just use Kubernetes" stops being a joke and starts being a liability. Both published papers on how they schedule AI training across geo-distributed datacenters — Microsoft's **Singularity** (arXiv 2022) and Meta's **MAST** (OSDI 2024). Reading them side by side, you'd think they're solving the same problem. They're not.

Singularity is an execution-mechanisms paper. MAST is a scheduling-policy paper. They occupy **different layers of the same stack** — and this isn't an accident. It's a direct consequence of building for a public cloud versus a private cloud.

## What a Planet-Scale GPU System Needs

Every planet-scale training system must deliver three things: **reliability** (jobs keep running despite failures and preemption), **efficiency** (the world's most expensive hardware isn't wasted), and **scalability** (the system grows with the fleet). Achieving these requires at least seven technical capabilities:

| Goal | Capabilities |
|---|---|
| **Reliability** | Job Lifecycle (preemption, migration, elasticity) and Fault Tolerance (recovering from hardware failures) |
| **Efficiency** | Data-Compute Colocation (data is where the GPUs are), Scheduling Policy (deciding where to run jobs and what to preempt), and Resource Utilization (maximizing useful GPU time) |
| **Scalability** | Scheduler Scalability (the scheduler itself handles hundreds of thousands of GPUs) |

User Experience — how much the user needs to know about the infrastructure — cuts across all three.

These seven capabilities split into two system layers: the **execution layer** (how jobs run — lifecycle, fault tolerance, user experience) and the **decision layer** (where jobs run — data placement, scheduling policy, scalability, utilization). And this is where the story gets interesting: Singularity covers the execution layer. MAST covers the decision layer. Neither covers both — and the reason maps directly to their business models.

The three areas where they diverge most sharply — job lifecycle, data colocation, and scheduling policy — reveal why.

## How Jobs Are Preempted — The Core Divergence

Singularity's thesis is that every job should be preemptible, migratable, and elastically resizable — **without any user code changes**. The core innovation is the **device-proxy**, a separate process that interposes between the user's training code and the GPU via `LD_PRELOAD`. Every CUDA call gets intercepted and shipped over shared memory to this proxy. The user's CPU address space never touches CUDA directly, which lets CRIU (Checkpoint/Restore in Userspace) snapshot the full process state cleanly.

This architecture unlocks three capabilities at once. **Transparent checkpointing** captures both CPU state (via CRIU) and GPU state (via the proxy's memory allocator) without user code. **A distributed barrier** piggybacks tiny 2-byte meta-allreduces on the job's existing communication to reach a consistent state across workers before checkpointing — no out-of-band coordination, no new failure paths. And **replica splicing** enables transparent elasticity: to scale a 4-GPU job down to 1 GPU, Singularity time-slices all 4 workers on a single device rather than restarting with a different world size. Because data-parallel replicas share identical parameters after each mini-batch, context switches skip most memory swaps via content-checksum dedup. Operation squashing lets only the "root" rank execute parameter updates. The result: <3% overhead even at 4-way time-slicing.

Checkpointing also doubles as fault tolerance. Any job — whether or not the user wrote checkpointing logic — can resume from the most recent automatic checkpoint after hardware failure.

**MAST takes the opposite approach.** Jobs checkpoint themselves using application-level APIs. Preemption means: save state, kill the job, restart later from the last save. Work between checkpoints is lost. Elasticity uses PyTorch Elastic (TorchElastic), which is *not* transparent — the job restarts with a new world size, and the training code must handle this. Meta also published **Check-N-Run** (NSDI 2022) for checkpointing massive recommendation models via differential checkpointing and quantization, but this is domain-specific to embedding tables, not a general mechanism.

**Why the divergence?** Microsoft runs a public cloud. They serve external customers running arbitrary code — any training loop, any library. They *cannot* ask customers to modify their code. The device-proxy exists because CUDA is the only guaranteed common interface across all possible user workloads. Meta runs a private cloud. They serve internal teams who use PyTorch (which Meta built). They *can mandate* that engineers follow checkpointing conventions and use supported frameworks. Cooperation is feasible because the "users" are colleagues.

## Where the Data Lives — MAST's Unique Contribution

Most GPU scheduling papers assume data is already where you need it. Singularity is no exception — it says nothing about training data. Cloud customers manage their own storage; the scheduler has no visibility into where data lives.

MAST confronts the ugly reality that Meta's data warehouse is exabytes across tens of regions, with cross-region bandwidth 10× lower than within-region. A single data partition is shared by a median of 3 workloads (P99: 45). Moving data takes hours. GPU regions and storage regions don't align because hardware was procured at different times.

**Tetris**, MAST's slow-path data placement engine, formulates this as a Mixed-Integer Programming (MIP) problem solved daily via hill-climbing. It soft-balances GPU demand/supply across regions with asymmetric penalties (overload is punished more than underload — hard constraints would be unsolvable because GPUs are always oversubscribed). It enforces hard storage quotas (you can't delete data). And it minimizes cross-region reads by placing tables in the same region as the jobs that use them. The algorithm runs daily, takes ~5 hours, and moves hundreds of petabytes proactively. The result: less than 0.1% of workloads ever need to wait for on-demand data movement.

Why Meta needs this and Microsoft doesn't: in a private cloud, the platform owns the data warehouse and can co-optimize data and compute placement with full visibility. In a public cloud, customers bring their own storage, and the scheduler has no authority to move it.

## How Placement Decisions Are Made — MAST's Architecture

Singularity describes a three-level scheduling hierarchy (global → regional → workload) and introduces the GPU-fraction SLA — Premium guarantees ≥95% useful GPU time, Standard ≥70%, Basic is best-effort. But the paper deliberately defers the scheduling algorithm itself. No follow-up paper has filled this gap.

MAST's scheduling architecture is its core contribution, built on three principles:

**Temporal decoupling** separates slow-path data placement (Tetris, daily) from fast-path job scheduling (real-time). Data is replicated proactively so that when a job arrives, the data is already in the right region.

**Scope decoupling** splits responsibilities across three tiers: a Global ML Scheduler (GMS) manages the worldwide job queue with priority and credit scoring; Regional ML Schedulers (RMS) compute placement plans within each region; and Cluster Managers (CM) handle container orchestration. The insight: container orchestration is the least scalable task, so it gets the smallest scope. Job queuing is lightweight, so it scales globally.

**Exhaustive search** means that when a job arrives, every RMS in every eligible region computes a placement plan. These plans compete in an auction. This is expensive — O(D×J) per region — but ML training jobs run long enough on costly enough hardware that spending milliseconds on scheduling quality pays for itself.

The numbers back this up. GMS takes ~34 seconds to rank 6,000–10,000 workloads, with 8.8× headroom before hitting limits. RMS places a workload in 1.3–5.5ms. GPU allocation rate is **98%** fleet-wide. Before MAST, the most overloaded region had a GPU demand-to-supply ratio of 2.63 for high-priority workloads. After: **0.98**.

## The Business Model Is the Architecture

The deepest insight from reading these papers together isn't technical — it's organizational.

**Public cloud (Microsoft)** means you cannot control your customers' code. This forces extraordinary depth in the execution-mechanisms layer — device-proxy interception, transparent CRIU checkpointing, distributed barriers, replica splicing. Users need zero code changes. But it also means you can't touch the data layer and you can't mandate framework conventions.

**Private cloud (Meta)** means you must co-optimize everything you own. This forces extraordinary depth in the scheduling-policy layer — MIP-based data placement, scope-decoupled scheduling hierarchies, exhaustive cross-region search. But you don't *need* transparent job lifecycle mechanisms because you can ask your internal users to cooperate.

Neither approach is complete. A truly complete system would need Singularity's transparent preemption and elasticity, MAST's data-compute colocation intelligence, and MAST's scheduling policy rigor. But that would require both infrastructure-level transparency *and* platform-level data visibility — a combination that exists in neither a pure public cloud nor a pure private cloud.

These two papers, read together, are the most complete picture we have of what planet-scale GPU scheduling demands. Singularity tells you what the execution layer must be capable of. MAST tells you what the decision layer must reason about. The gap between them — and the business models that created it — is where the next generation of ML infrastructure will be built.