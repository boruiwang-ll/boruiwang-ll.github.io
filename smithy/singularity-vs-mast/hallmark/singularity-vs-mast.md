---
layout: post
title: "Singularity vs MAST: Two Philosophies for Scheduling GPUs Across the Planet"
date: 2026-05-03
---

I've had the pleasure to collaborate on compute infra of Singularity during my time at Microsoft. Going into the new space of Meta's global ML training platform, there's much to learn and as I spent time on learning about MAST, I can't help comparing the two. Here it goes, my learning notes based on publicly available information.

Even tech giants can't solve all ML training, so they attack the problems from different layers and angles. Microsoft's **Singularity** (arXiv 2022) asks: *how do we make every job so fungible that scheduling becomes trivial?* Meta's **MAST** (OSDI 2024) asks: *how do we make the scheduler so smart that jobs don't need to change at all?*

Both systems operate at truly global scale. Both aim for hight utilization.

## Singularity: Make Every Job a Liquid

Singularity's thesis is radical and elegant: if every job is transparently preemptible, migratable, and elastically resizable — without any user code changes — then scheduling reduces to a fluid dynamics problem. You just pour jobs into available capacity anywhere on Earth.

### The Device-Proxy: Where the Magic Happens

The core technical innovation is the **device-proxy**, a separate process that interposes between the user's training code and the GPU. Every CUDA call your PyTorch job makes gets intercepted via `LD_PRELOAD` and shipped over shared memory to this proxy process. The user's CPU address space never touches CUDA directly.

This sounds like it should be expensive. It isn't — overhead is under 3% for most models, including multi-billion parameter GPT-2 configurations with 3D parallelism. The trick is intercepting at the narrow driver-level API (`cudaLaunchKernel`) rather than trying to wrap every higher-level library, plus aggressive optimizations like delayed error notification and piggybacked `cudaGetLastError` responses.

The device-proxy architecture unlocks three capabilities simultaneously:

**1. Transparent Checkpointing.** Because the CPU address space is clean of GPU mappings, CRIU (Checkpoint/Restore in Userspace) can snapshot it. The device-proxy handles GPU state separately — it knows exactly which buffers are allocated (because it controls the memory allocator), so checkpoint sizes are comparable to hand-written user-level checkpointing. Device handles are virtualized so they survive migration to different hardware.

**2. Distributed Barrier.** Before checkpointing a multi-node job, all workers must reach a consistent state — no in-flight allreduce calls. Singularity's barrier algorithm piggybacks tiny 2-byte meta-allreduces on the job's existing communication, avoiding new failure paths from out-of-band coordination. The barrier completes within two mini-batches with negligible steady-state overhead. For pipeline/tensor-parallel jobs, they identify mini-batch boundaries (a domain-specific insight) to checkpoint at naturally quiescent points.

**3. Transparent Elasticity via Replica Splicing.** This is the most novel part. To scale a job from 4 GPUs down to 1, Singularity doesn't restart it with a different world size. Instead, it time-slices 4 workers on 1 GPU. The world size stays the same — the user's code is oblivious.

### Replica Splicing: The Deep Trick

Naively, time-slicing 4 workers on one GPU would require swapping 32GB+ of GPU memory per context switch — a catastrophic overhead. Replica splicing exploits the fact that data-parallel replicas have **identical** parameters (P) and optimizer state (O) after each mini-batch. So during context switches:

- **Swap-out is skipped** for P and O buffers whose content checksums match what's already in host memory
- **Swap-in is skipped** when the GPU already holds matching buffers
- A **bidirectional memory allocator** ensures stable buffers (P, O) get the same addresses across replicas, so no device-to-device copies are needed
- **Operation squashing** lets only the "root" rank execute parameter updates — other ranks skip those GPU kernels entirely, since they'd produce identical results

The result: <3% overhead for time-slicing, even at 4-way. For large model-parallel jobs, they actually observe a *net performance gain* because squashing eliminates redundant GPU operations.

There's a beautiful safety net here: if the squashing invariants don't hold (validated by periodic un-squashed mini-batches with checksum verification), Singularity falls back to full swapping — never correctness failure, only performance degradation.

### What Singularity Doesn't Tell You

The paper is admirably focused on the mechanisms — checkpointing, barrier, elasticity — but says almost nothing about the scheduling *policy*. There's a brief mention of a three-level hierarchy (global, regional, workload schedulers) and a GPU-fraction SLA with Premium/Standard/Basic tiers. But how does the global scheduler decide which job to preempt? How does it handle data locality? What MIP formulation or heuristic drives placement decisions? The paper is silent. This is by design — the argument is that with perfect fungibility, scheduling becomes a much easier problem — but it leaves a significant gap.

## MAST: Make the Scheduler Omniscient

MAST takes the complementary approach. Rather than making jobs infinitely flexible, it makes the scheduler infinitely informed. The system co-optimizes the placement of *both* training data and compute across all of Meta's geo-distributed regions, using a slow-path optimizer that runs daily and a fast-path scheduler that places jobs in real-time.

### The Data Problem That Everyone Else Ignores

Most GPU scheduling papers assume data is already where you need it. MAST confronts the ugly reality: Meta's data warehouse is exabytes across tens of regions, with limited cross-region bandwidth. A single data partition is shared by a median of 3 (P90: 17, P99: 45) distinct training workloads. Moving data takes hours. GPU regions and storage regions don't align because hardware was procured incrementally at different times.

**Tetris**, MAST's slow-path data placement engine, solves a MIP problem that jointly optimizes:

1. **Minimize cross-region data reads** — tables should be in the same region as the jobs that need them
2. **Soft-balance GPU demand/supply across regions** — with asymmetric penalties that punish overload more than underload
3. **Soft-balance storage demand/supply** — plus hard constraints that storage can't exceed capacity

The key insight is that different resource types need different constraint strategies. For GPUs (always scarce), hard constraints render the problem unsolvable — you can't mandate demand ≤ supply when demand is 2.63× supply. So MAST allows GPU oversubscription and preempts low-priority jobs. For storage, hard quotas are necessary because you can't delete data. CPU gets hard quotas per application.

Tetris uses hill-climbing rather than a commercial MIP solver, for good reasons: scalability, interpretability, and debuggability — critical properties when hyperscale ML scheduling is still evolving and engineers need to understand why a table moved.

### Three Levels of Decoupling

MAST's architecture is built on three design principles:

**Temporal decoupling.** Slow path (Tetris) handles data placement daily. Fast path handles real-time job scheduling. This lets data replication happen in the background — hundreds of petabytes daily — so that when a job arrives, the data is already in the right region.

**Scope decoupling.** This is the most architecturally distinctive idea. Traditional systems (Borg, Kubernetes) handle job queuing, resource allocation, and container orchestration all at the same scope. MAST splits them:

| Responsibility | Scope | Component |
|---|---|---|
| Job queue management | **Global** | GMS |
| Resource allocation | **Regional** | RMS |
| Container orchestration | **Cluster** | CM (Twine) |

Container orchestration is the least scalable (heaviest duties), so it gets the smallest scope. Job queuing is lightweight, so it scales globally. Resource allocation sits in between.

**Exhaustive search.** When a job arrives, *every* RMS in *every* region with the right data computes a placement plan. These plans compete in an auction, and the best one wins. This is expensive — RMS complexity is O(D×J), quadratic in hardware per region — but ML training jobs run long enough on expensive enough hardware that spending milliseconds on placement quality is worthwhile.

### The Numbers

MAST schedules tens of thousands of workloads daily across O(100,000) GPUs. Before MAST, the most overloaded region had a GPU demand-to-supply ratio of **2.63** for high-priority workloads. After MAST, it dropped to **0.98** — effectively eliminating overload. GPU allocation rate sits at **98%**. Less than 0.1% of workloads need to wait for on-demand data movement. The GMS-scan pass takes ~34 seconds for 6,000–10,000 workloads, with room for 8.8× growth before hitting limits. RMS can handle 12× more hardware. The fast-path scheduler places workloads in 1.3ms (without preemption) to 5.5ms (with).

## The Comparison That Almost Works

Here's what's fascinating: **MAST actually cites Singularity** — and dismisses it in one sentence: "the article does not disclose details about the scheduling part, but focuses more on how to provide elasticity to ML training jobs, and thus it's impossible for us to provide a concrete comparison."

That's exactly right, and it perfectly captures the complementary nature of these systems. They operate at different layers of the same problem:

| Dimension | Singularity | MAST |
|---|---|---|
| **Core question** | How to make jobs fungible | How to make placement optimal |
| **Organization** | Microsoft (public cloud) | Meta (private cloud) |
| **Published** | arXiv, Feb 2022 | OSDI, Jul 2024 |
| **Focus** | Mechanisms (checkpoint, migrate, resize) | Policy (data placement, job scheduling) |
| **User change required** | None | None |
| **Data placement** | Not discussed | Core contribution (Tetris MIP) |
| **Job preemption** | Transparent, work-conserving | Checkpoint-based, some lost work |
| **Elasticity** | Transparent (same world-size) | Not discussed |
| **Scheduling policy** | Barely discussed | Core contribution (GMS/RMS/CM) |
| **Scheduling hierarchy** | Global → Regional → Workload | Global → Regional → Cluster |
| **GPU scale** | Hundreds of thousands | O(100,000) |

### Where They Agree

Both systems share several deep convictions:
- **Hierarchical scheduling** is mandatory at planet scale — no single scheduler can handle everything
- **Preemption is not optional** — it's the fundamental mechanism for multiplexing scarce GPUs
- **Jobs should not need to know** about the scheduling infrastructure
- **GPU fraction / allocation rate** (not raw utilization) is the right north-star metric for a scheduler

### Where They Fundamentally Diverge

**On the nature of preemption.** Singularity preempts jobs *transparently* — the job doesn't restart, doesn't lose work, doesn't even know it was preempted. The checkpoint captures the full process state (instruction pointer, stack, GPU buffers), and restoration is exact. MAST relies on application-level checkpointing — the job saves state periodically, and preemption means rolling back to the last checkpoint. Work between checkpoints is lost.

This is a huge difference. Singularity's transparent checkpointing means preemption cost is measured in seconds (tens of seconds for the largest models). MAST's approach means preemption cost includes lost computation since the last checkpoint, plus reinitialization time. MAST acknowledges this: "As we continuously reduce the time needed to save a checkpoint, we are moving towards more frequent checkpoints to minimize the amount of lost work."

**On where the hard problem lives.** Singularity says: the hard problem is making jobs liquid — once that's solved, scheduling is "just" optimization over a pool of fungible resources. MAST says: the hard problem is co-optimizing data and compute placement — once that's solved, jobs run efficiently even without fancy migration.

**On data.** Singularity doesn't mention training data at all. It assumes data is available where the job runs. MAST builds an entire subsystem (Tetris) around the reality that exabytes of training data can't teleport across regions. Data placement is solved by a daily MIP optimization that reasons about table hotness, GPU type availability, storage quotas, and cross-region bandwidth limits. This is arguably the more mature perspective — at Meta's scale, "just move the job" isn't viable if the data isn't there.

**On elasticity.** Singularity's transparent elasticity (same world-size, time-sliced workers) is genuinely novel and has no equivalent in MAST. MAST's workloads are allocated a fixed set of resources and don't dynamically resize. If Singularity's mechanisms were combined with MAST's scheduling intelligence, you'd have something terrifyingly capable.

## What a Combined System Would Look Like

The dream architecture is obvious: **MAST's brain with Singularity's muscles.** 

MAST's Tetris would handle slow-path data placement — the MIP optimization for table-to-region assignment that Singularity ignores entirely. MAST's GMS/RMS/CM hierarchy would handle fast-path scheduling with exhaustive search across regions. But the execution layer would use Singularity's device-proxy for transparent checkpointing, migration, and elasticity.

The synergies are immediate:
- MAST's scheduling quality improves because preemption is nearly free (Singularity's transparent migration vs. MAST's checkpoint-and-restart)
- Singularity's mechanisms become more useful because MAST's global visibility ensures data is already colocated
- Elastic scale-down with Singularity's replica splicing would let MAST reclaim fractional GPUs without killing jobs — a capability neither system has alone

Of course, this is easier to diagram than to build. Singularity's device-proxy assumes a specific relationship with NVIDIA's CUDA stack; MAST runs on Meta's internal Twine infrastructure. The impedance mismatch between Microsoft's and Meta's internal systems is non-trivial.

## The Bigger Picture

These two papers, read together, constitute the most complete picture we have of what it takes to schedule AI workloads at planet scale. Singularity is the deeper *mechanisms* paper — the device-proxy, distributed barrier, and replica splicing are genuinely novel contributions that change what's possible. MAST is the deeper *systems* paper — the MIP formulation for data placement, the scope-decoupling architecture, and the production evaluation at Meta-scale are industrial systems engineering at its finest.

If you're building a GPU scheduling system today, you need ideas from both. Singularity tells you what your execution layer should be capable of. MAST tells you what your scheduling layer needs to reason about. Neither is sufficient alone — and the gap between them is where the next generation of ML infrastructure will be built.
