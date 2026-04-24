---
title: "2.3 🧩 Cache Coherence Basics: Why Multiple Cores Need a Protocol"
tags: [Cache, Coherence, MMU, AMBA]
order: 8
last_modified_at: 2026-04-23
---

You've got a multi-core processor. Each core has its own private cache. They share main memory. What could go wrong?

**Everything** — if you don't have a cache coherence protocol.

This post covers the fundamentals: why incoherence happens, what coherence actually means, and the two invariants every coherence protocol must maintain. Based on Chapter 2 of Sorin, Hill & Wood's *A Primer on Memory Consistency and Cache Coherence*.

---

## 1. 🖥️ The Baseline System

Before we talk about the problem, let's define the system we're reasoning about:

```
┌─────────────────────────────────────────┐
│           Multicore Processor Chip       │
│                                         │
│  ┌──────┐  ┌──────┐       ┌──────────┐ │
│  │Core 0│  │Core 1│  ...  │ Core N   │ │
│  │ ┌──┐ │  │ ┌──┐ │       │ ┌──┐     │ │
│  │ │L1│ │  │ │L1│ │       │ │L1│     │ │
│  │ └──┘ │  │ └──┘ │       │ └──┘     │ │
│  └──┬───┘  └──┬───┘       └──┬───────┘ │
│     │         │              │          │
│     └─────────┴──────┬───────┘          │
│                      │                  │
│              ┌───────┴───────┐          │
│              │  Interconnect │          │
│              │    Network    │          │
│              └───────┬───────┘          │
│                      │                  │
│              ┌───────┴───────┐          │
│              │      LLC      │          │
│              │  (shared,     │          │
│              │  memory-side) │          │
│              └───────┬───────┘          │
└──────────────────────┼──────────────────┘
                       │
               ┌───────┴───────┐
               │  Main Memory  │
               └───────────────┘
```

Key assumptions:
- Each core has a **private L1 data cache** (write-back, physically addressed)
- The **LLC** is shared and logically acts as a "memory-side cache" — it doesn't add another level of coherence problems
- Cores communicate with each other and the LLC through an **interconnection network**

For simplicity, we ignore instruction caches, multi-level private caches, TLBs, and DMA for now. These are real concerns, but they'd obscure the core ideas.

---

## 2. ⚠️ The Problem: How Incoherence Arises

Incoherence has exactly **one root cause**: multiple actors have access to caches and memory. In most systems, these actors are processor cores (but could also be DMA engines or external devices).

Here's the classic example:

```
Time 1:  Memory[A] = 42
         Core 1 loads A → cache1[A] = 42
         Core 2 loads A → cache2[A] = 42
         (Both caches have the same value. So far so good.)

Time 2:  Core 1 loads A → cache1[A] = 42  (unchanged)
         Core 2 loads A → cache2[A] = 42  (unchanged)

Time 3:  Core 1 executes: A = A + 1
         cache1[A] = 43  (Core 1's updated value)
         cache2[A] = 42  ← STALE! INCOHERENT!
```

At Time 3, Core 2 has no idea that Core 1 modified A. Core 2 will happily keep reading the stale value 42. This is **incoherence** — two cores observe different values for the same memory location at the same time.

Without a coherence protocol, nothing prevents this. The caches are private. There's no mechanism to notify Core 2 that its copy is stale.

---

## 3. 📐 Defining Coherence: Two Invariants

The intuitive notion of "no stale values" is a good starting point, but we need something more precise. The preferred definition of coherence relies on **two invariants**:

### Invariant 1: Single-Writer, Multiple-Reader (SWMR)

> For any memory location, at any given (logical) time, there is either:
> - **One core** that may write it (and may also read it), **or**
> - **Some number of cores** that may only read it.
>
> There is **never** a time when one core is writing while another core is reading or writing the same location.

This divides the lifetime of a memory location into **epochs**:

```
     Epoch 1        Epoch 2        Epoch 3        Epoch 4
┌──────────────┬──────────────┬──────────────┬──────────────┐
│  Core 3      │  Cores 1,2,5 │  Core 1      │  Cores 1,2,3 │
│  Read-Write  │  Read-Only   │  Read-Write  │  Read-Only   │
└──────────────┴──────────────┴──────────────┴──────────────┘
   (1 writer)     (3 readers)    (1 writer)     (3 readers)
```

In each epoch, the access mode is unambiguous: either one writer or multiple readers, never both.

### Invariant 2: Data-Value Invariant

> The value of a memory location at the start of an epoch is the same as the value at the end of its last read-write epoch.

The SWMR invariant alone isn't enough. Even if access permissions are correct, the data must be propagated correctly. If Core 3 wrote the value 99 during Epoch 1, then Cores 1, 2, and 5 must all read 99 during Epoch 2. If Core 1 then wrote 100 during Epoch 3, Cores 1, 2, and 3 must all read 100 during Epoch 4.

**Both invariants together** define coherence. Violating either one means the system is incoherent.

---

## 4. 🔒 Maintaining the Invariants: Invalidate Protocols

The vast majority of real-world coherence protocols are **invalidate protocols**, designed explicitly to maintain these two invariants.

The logic is straightforward:

**When a core wants to READ a location:**
1. Send messages to other cores to obtain the current value
2. Ensure no other core has a cached copy in read-write state
3. → This ends any active read-write epoch and begins a read-only epoch

**When a core wants to WRITE a location:**
1. Send messages to obtain the current value (if not already cached)
2. Ensure no other core has a cached copy in **any** state (read-only or read-write)
3. → This ends any active epoch and begins a new read-write epoch

The key action in step 2 of a write is **invalidation** — the writing core tells all other cores to discard their copies. This is why they're called "invalidate protocols." The alternative (update protocols) would broadcast new values instead, but invalidate protocols dominate in practice because they generate less traffic.

---

## 5. 📦 Coherence Granularity: The Cache Block

Coherence is maintained at the granularity of a **cache block** (cache line), not individual bytes or words.

Why? Practical reasons:
- Tags and state bits are per-block
- The interconnect transfers data in blocks
- It would be enormously wasteful to track coherence per-byte

This means the SWMR invariant operates at block granularity. If Core 1 is writing byte 0 of a 64-byte block, no other core can write byte 32 of the same block — even though they're different bytes, they're in the same coherence unit.

**Implication**: False sharing. Two cores writing to different variables that happen to fall in the same cache block will cause mutual invalidations, even though there's no actual data conflict. This is a well-known performance pitfall in parallel programming.

---

## 6. 🔭 The Scope of Coherence

Two important scope considerations:

### Coherence applies to all storage structures that cache shared data

This includes:
- L1 data caches
- L2 caches
- Shared LLC
- Main memory
- L1 instruction caches
- **TLBs** (yes, TLB entries must also be coherent!)

### Coherence is NOT architecturally visible

This is subtle but important:
- A system could theoretically be incoherent and still correctly implement a memory consistency model
- The consistency model places **no explicit constraints** on coherence
- However, most consistency model implementations rely on coherence properties for correctness
- Coherence is a **microarchitectural** property, not an architectural one

The practical takeaway: coherence is a means to an end (implementing the consistency model), not an end in itself.

---

## 7. ⚡ Coherence ≠ Consistency

This distinction is crucial and often confused:

| | Coherence | Consistency |
|---|-----------|-------------|
| **Scope** | Per memory location | All memory locations |
| **Defines** | Whether cached copies are up-to-date | What orderings of memory operations are allowed |
| **Question** | "Can I read the latest value of address A?" | "If I write X then write Y, can another core see Y before X?" |
| **Level** | Microarchitectural | Architectural |

A system can be **coherent but have unexpected behavior**. Consider this example:

```
Core C1:  S1: store data = NEW;    S2: store flag = SET;
Core C2:  L1: load r1 = flag;      L2: load r2 = data;
```

Coherence guarantees that once `flag = SET` is visible to C2, the value is correct. But coherence says **nothing** about whether C2 might see `flag = SET` (S2) **before** `data = NEW` (S1) is visible. That's a **consistency** issue, not a coherence issue.

This is why we need both concepts. Coherence handles per-location correctness; consistency handles cross-location ordering.

---

## 8. 🔀 The Four Reorderings: What Each Consistency Model Allows

Consistency models differ in **which reorderings they permit**. Understanding these four reorderings is the key to understanding the entire SC → TSO → Relaxed spectrum.

**What does "reordering" mean?** When a core executes Op A then Op B in program order, but *another core* observes the effects of B before A — that's a reordering. The core itself always sees its own operations in program order; the issue is how other cores perceive them.

### Store → Store Reordering

```
Core 1:  S1: store data = NEW
         S2: store flag  = SET

Core 2:  L1: r1 = flag → SET
         L2: r2 = data → OLD    ← flag written, but data hasn't arrived yet!
```

**Why it happens:** Stores go into a write buffer before reaching the cache. If the buffer doesn't guarantee FIFO ordering — or if stores to different cache lines are merged — S2 can reach the cache before S1.

**Allowed by:** Relaxed (ARM, RISC-V, PowerPC)
**Forbidden by:** SC, TSO

### Load → Load Reordering

```
Core 1:  S1: store data = NEW
         S2: store flag  = SET

Core 2:  L1: r1 = flag    (cache miss → waiting...)
         L2: r2 = data    (cache hit → executes first!)

Result: r2 = OLD, r1 = SET   ← sees flag but not data
```

**Why it happens:** Out-of-order execution. If L1 misses in the cache but L2 hits, the processor may execute L2 first. From another core's perspective, the loads appear reordered.

**Allowed by:** Relaxed
**Forbidden by:** SC, TSO

### Store → Load Reordering ⭐ The Most Important One

```
Core 1:  S1: store A = 1
         L1: load  r = B

Core 2:  S2: store B = 1
         L2: load  r = A

If S→L reordered: both cores read 0 — each thinks the other hasn't written yet!
```

**Why it happens:** The **store buffer**. S1 writes A=1 into the store buffer (not yet in cache), then L1 reads B directly from cache — it doesn't wait for the buffer to drain. From Core 2's perspective, S1 hasn't happened yet when L1 executes.

This is the **only reordering TSO allows**. It's also the most commonly encountered pitfall on x86. Programmers must insert `MFENCE` or use locked instructions when this reordering is problematic.

**Allowed by:** TSO, Relaxed
**Forbidden by:** SC

### Load → Store Reordering

```
Core 1:  L1: load  r = A    (cache miss → waiting...)
         S1: store B = r    (enters write buffer → takes effect first!)
```

**Why it happens:** When a load misses, the processor doesn't stall. It lets subsequent stores enter the write buffer. From another core's perspective, S1 appears to happen before L1.

**Allowed by:** Relaxed
**Forbidden by:** SC, TSO

### Summary Table

| Reordering | SC | TSO | Relaxed | Hardware Cause |
|------------|----|-----|---------|---------------|
| Store → Store | ❌ | ❌ | ✅ | Write buffer not FIFO / store merging |
| Load → Load | ❌ | ❌ | ✅ | Out-of-order execution (miss → hit reordering) |
| Store → Load | ❌ | ✅ | ✅ | **Store buffer** (write not yet visible) |
| Load → Store | ❌ | ❌ | ✅ | Load miss lets store enter buffer first |

The core intuition: **all reorderings exist because hardware doesn't want to wait** — for the store buffer to drain, for cache misses to resolve. The more a model allows the hardware to skip waiting, the higher the performance, but the more careful the programmer must be.

---

## 📋 Summary

| Concept | Key Point |
|---------|-----------|
| Root cause of incoherence | Multiple actors with private caches |
| SWMR invariant | At any time: one writer OR multiple readers (never both) |
| Data-value invariant | Epochs must propagate the last written value |
| Invalidate protocol | Writer invalidates all other copies; dominates in practice |
| Granularity | Cache block (typically 64 bytes) |
| Coherence ≠ Consistency | Coherence = per-location; Consistency = cross-location ordering |
| Four reorderings | SC forbids all; TSO allows only S→L (store buffer); Relaxed allows all |
| Reordering root cause | Hardware avoids waiting (store buffer, cache miss, out-of-order execution) |

The next post will dive into snooping coherence protocols — how the SWMR invariant is actually implemented in hardware with MESI/MOESI state machines and a broadcast interconnect.

---

📖 **Reference:** Daniel J. Sorin, Mark D. Hill, and David A. Wood, *A Primer on Memory Consistency and Cache Coherence*, 2nd Edition, 2020, Chapter 2 (Coherence Basics) & Chapter 3 (Sequential Consistency)

---

👍 If you found this post helpful, give it a like! Questions and discussions are welcome in the comments 💬
