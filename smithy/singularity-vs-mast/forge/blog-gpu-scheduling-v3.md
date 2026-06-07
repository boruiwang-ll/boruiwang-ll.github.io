---
layout: post
title: "Singularity vs MAST: What It Takes to Schedule GPUs Across the Planet"
date: 2026-05-04
version: 3
---

Microsoft and Meta both operate GPU fleets at a scale where "just use Kubernetes" stops being a joke and starts being a liability. Both published papers on how they schedule AI training across geo-distributed datacenters — Microsoft's **Singularity** (arXiv 2022) and Meta's **MAST** (OSDI 2024). Reading them side by side, you'd think they're solving the same problem. They're not.

Singularity is an execution-mechanisms paper. MAST is a scheduling-policy paper. They occupy **different layers of the same stack** — and this isn't an accident. It's a direct consequence of building for a public cloud versus a private cloud.

## The Seven Pillars

Before comparing the systems, it helps to lay out what a complete planet-scale GPU training system actually needs. From reading both papers (and filling in the gaps), I see seven pillars:

1. **Job Lifecycle** — preemption, migration, elasticity of running jobs
2. **Data-Compute Colocation** — ensuring training data is where the GPUs are
3. **Scheduling Policy** — deciding *where* to run jobs and *what* to preempt
4. **Fault Tolerance** — recovering from hardware failures without losing work
5. **Scheduler Scalability** — the scheduler itself must scale to the fleet
6. **Resource Utilization** — maximizing useful GPU time, minimizing waste
7. **User Experience** — how much the user needs to know about the infrastructure

Neither paper covers all seven. And *where* each paper goes deep tells you everything about why it was built the way it was.

## Pillar 1: Job Lifecycle — The Deepest Divergence

This is Singularity's home turf and the starkest contrast between the two systems.

### Singularity: Infrastructure-transparent

Singularity's thesis is that every job should be preemptible, migratable, and elastically resizable — **without any user code changes**. The scheduler treats jobs like processes in an OS: it can suspend, move, and resize them at will.

The core innovation is the **device-proxy** — a separate process that interposes between the user's PyTorch code and the GPU via `LD_PRELOAD`. Every CUDA call gets intercepted and shipped over shared memory to this proxy. This keeps the CPU address space clean of GPU mappings, enabling CRIU (Checkpoint/Restore in Userspace) to snapshot the full process state — instruction pointer, stack, heap, everything.

The device-proxy also enables **transparent elasticity** via a technique called **replica splicing**. To scale a 4-GPU job down to 1 GPU, Singularity doesn't restart it with a different world size. Instead, it time-slices all 4 workers on 1 GPU. The trick is that data-parallel replicas have identical parameters and optimizer state after each mini-batch, so context switches skip most memory swaps via content-checksum dedup. A bidirectional memory allocator ensures stable buffers get the same addresses across replicas. Operation squashing lets only the "root" rank execute parameter updates; other ranks skip those GPU kernels entirely. The result: <3% overhead even at 4-way time-slicing.

Before checkpointing a distributed job, all workers must reach a consistent state. Singularity's **distributed barrier** piggybacks tiny 2-byte meta-allreduces on the job's existing communication — no out-of-band coordination, no new failure paths. The barrier completes within two mini-batches.

### MAST: Application-cooperative

Meta takes the opposite approach. Jobs checkpoint themselves using application-level APIs (PyTorch's Distributed Checkpoint, or custom logic for recommendation models). Preemption means: save a checkpoint, kill the job, restart later from the last save. Work between checkpoints is lost.

Elasticity uses **PyTorch Elastic** (also known as TorchElastic), which *is not transparent* — the job restarts with a new world size, and the training code must be written to handle this. The user is aware of the resize.

Meta also published **Check-N-Run** (NSDI 2022) for checkpointing their massive recommendation models, using differential checkpointing and quantization to reduce write bandwidth by 6–17×. But this is a domain-specific optimization for embedding tables, not a general transparency mechanism.

### Why the divergence?

**Microsoft runs a public cloud.** They serve external customers running arbitrary code — any PyTorch script, any custom training loop, any third-party library. They *cannot ask customers to modify their code*. Transparency isn't a nice-to-have; it's the only option. The device-proxy exists because CUDA is the only guaranteed common interface across all possible user workloads.

**Meta runs a private cloud.** They serve internal teams who use PyTorch (which Meta built). They *can mandate* that engineers follow checkpointing conventions, use PyTorch Elastic, and structure code in supported ways. Cooperation is feasible because the "users" are colleagues.

## Pillar 2: Data-Compute Colocation — MAST's Home Turf

If Pillar 1 is about what happens *after* a job lands on hardware, Pillar 2 is about ensuring the job can land there at all.

Singularity says nothing about training data. Cloud customers manage their own storage; the scheduler has no visibility into where data lives.

MAST builds an **entire subsystem** — Tetris — around this problem. Meta's data warehouse is exabytes across tens of regions, and the cross-region bandwidth is 10× lower than within-region. A single data partition is shared by a median of 3 workloads (P99: 45). You can't "just move the job" if the data isn't there, and moving data takes hours.

Tetris formulates data placement as a Mixed-Integer Programming (MIP) problem, solved daily via hill-climbing:

- **Soft-balance GPU demand/supply** across regions — with asymmetric penalties that punish overload more severely than underload. Hard constraints would render the problem unsolvable because GPUs are always oversubscribed.
- **Hard-quota storage capacity** — you can't delete data when demand exceeds supply.
- **Minimize cross-region data reads** — tables should be in the same region as the jobs that use them.

The hill-climbing approach was chosen over commercial MIP solvers for interpretability and debuggability — critical properties when the problem formulation is still evolving and engineers need to understand *why* a table moved. The algorithm runs daily, takes ~5 hours, and moves hundreds of petabytes across regions proactively.

### Why Meta needs this and Microsoft doesn't

In a private cloud, the platform owns the data warehouse. It can co-optimize data placement and compute placement because it has full visibility into both. In a public cloud, customers bring their own storage (Azure Blob, S3, etc.), and the scheduler has no authority — or even visibility — to move it.

## Pillar 3: Scheduling Policy — The Decision Layer

Data placement sets the stage; scheduling policy runs the show. This is where MAST's architecture is most distinctive.

Singularity describes a three-level hierarchy (global → regional → workload schedulers) and introduces the **GPU-fraction SLA** — a throughput guarantee expressed as T_ideal / T_real. Premium tier guarantees ≥95% GPU time fraction; Standard ≥70%; Basic is best-effort. But the paper deliberately defers the scheduling algorithm details. No follow-up paper has filled this gap.

MAST's scheduling policy is its core contribution, built on three principles:

**Temporal decoupling.** Slow path (Tetris) handles data placement daily. Fast path schedules jobs in real-time. This separation lets data replication happen proactively in the background.

**Scope decoupling.** Traditional systems (Borg, Kubernetes) handle job queuing, resource allocation, and container orchestration all at the same scope. MAST splits them:
- **Global ML Scheduler (GMS):** manages the global job queue — priority, credit, quota enforcement across all regions
- **Regional ML Scheduler (RMS):** computes resource allocation plans — bin-packing, preemption decisions, locality optimization within one region
- **Cluster Manager (CM / Twine):** handles container orchestration — the least scalable task gets the smallest scope

**Exhaustive search.** When a job arrives, *every* RMS in *every* eligible region computes a placement plan. These compete in an auction. This is expensive — O(D×J) per region, where D is the number of dynamic clusters and J is the number of jobs — but worthwhile because ML training jobs run long enough on costly enough hardware that milliseconds of scheduling time pay for themselves.

## Pillar 4: Fault Tolerance — Closely Tied to Pillar 1

The choices made in Pillar 1 cascade directly into fault tolerance. A system that can transparently checkpoint a job can also transparently recover from failure — and one that can't, can't.

Singularity's transparent checkpointing doubles as fault tolerance. Any job — whether or not the user wrote checkpointing logic — can resume from the most recent automatic checkpoint after a GPU, node, or network failure. Checkpoint sizes are comparable to hand-written user-level checkpointing thanks to per-buffer content deduplication and temporal incremental CRIU snapshots.

MAST relies on the application to checkpoint periodically. The Cluster Manager detects failures and restarts the workload on a replacement machine. Recovery means reloading from the last save, with work since that checkpoint lost. Meta acknowledges this gap and is "moving towards more frequent checkpoints to minimize the amount of lost work" — but this is an arms race against ever-larger models.

The divergence maps to the business model again: Microsoft can't assume user code has checkpointing logic, so it must provide it transparently. Meta can mandate it.

## Pillar 5: Scheduler Scalability — MAST Is More Rigorous

Scalability is what separates a research prototype from a production system. Here MAST is far more forthcoming.

Singularity mentions its hierarchy but doesn't quantify scalability.

MAST provides detailed numbers:
- **GMS** takes ~34 seconds to rank 6,000–10,000 workloads. Running the scan every 5 minutes gives 8.8× headroom. A Python→C++ rewrite could add another 10–100×.
- **RMS** places a workload in 1.3ms (no preemption) to 5.5ms (with preemption). A negative cache with ~80% hit rate filters out unsuccessful placement attempts early. The system can handle 12× more hardware before hitting limits.
- **Scope decoupling** ensures each component operates at the appropriate scope — container orchestration (heaviest duty) gets the smallest scope; job queuing (lightest) gets global scope.

## Pillar 6: Resource Utilization — Different Metrics, Both Strong

Both systems achieve impressive utilization, but they measure it differently — and the metrics themselves reveal their priorities.

Singularity measures **GPU time fraction** — the ratio of ideal completion time to actual completion time. With preemption and elasticity, the system guarantees ≥95% for Premium jobs. Device-proxy overhead is <3%. Replica splicing overhead is <3%. Migration latency is tens of seconds for most models.

MAST measures **GPU allocation rate** — the fraction of available GPU-hours actually assigned to workloads. They achieve **98%** fleet-wide. Before MAST, the most overloaded region had a GPU demand-to-supply ratio of 2.63 for high-priority workloads. After MAST: **0.98**, effectively eliminating overload.

These metrics aren't directly comparable — allocation rate counts any assigned GPU, while GPU fraction measures whether the job actually got useful time — but both indicate systems operating near the efficiency frontier.

## Pillar 7: User Experience — Singularity Wins Cleanly

Singularity requires **zero code changes**. The user writes a standard PyTorch script for a fixed world size. Checkpointing, migration, elasticity, and SLA enforcement are all invisible. The scheduler treats the user's code like an OS treats an unmodified process.

MAST abstracts away **region selection** — users submit workloads without choosing a datacenter, and MAST places both data and compute. But users must still write elastic-aware code (PyTorch Elastic), follow checkpointing conventions, and structure their workloads within the supported hierarchy (workload → job → task). The framework cooperation tax is real, but manageable for internal teams.

## The Business Model Is the Architecture

The deepest insight from reading these papers together isn't technical — it's organizational.

**Public cloud (Microsoft)** imposes a constraint: you cannot control your customers' code. This forces you to solve the execution-mechanisms layer with extraordinary depth — device-proxy interception, transparent CRIU checkpointing, distributed barriers, replica splicing. But it also means you can't touch the data layer (customers own their storage) and you can't mandate framework conventions (customers use whatever they want).

**Private cloud (Meta)** imposes a different constraint: you must co-optimize everything you own. This forces you to solve the scheduling-policy layer with extraordinary depth — MIP-based data placement, scope-decoupled scheduling hierarchies, exhaustive cross-region search. But you don't *need* transparent job lifecycle mechanisms because you can ask your internal users to cooperate.

Neither approach is complete. A truly complete system would need:
- Singularity's transparent preemption, migration, and elasticity (Pillars 1, 4, 7)
- MAST's data-compute colocation intelligence (Pillar 2)
- MAST's scheduling policy and scalability rigor (Pillars 3, 5)
- Both systems' utilization engineering (Pillar 6)

But such a system would require both infrastructure-level transparency *and* platform-level data visibility — a combination that exists in neither a pure public cloud nor a pure private cloud. Perhaps this is the real argument for hybrid architectures: the only way to fill all seven pillars is to control enough of the stack to co-optimize data and compute, while still treating user code as opaque.

These two papers, read together, are the most complete picture we have of what planet-scale GPU scheduling demands. Singularity tells you what the execution layer must be capable of. MAST tells you what the decision layer must reason about. The gap between them — and the business models that created it — is where the next generation of ML infrastructure will be built.
