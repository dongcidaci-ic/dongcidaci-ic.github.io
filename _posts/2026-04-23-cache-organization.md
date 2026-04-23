---
title: "2.1 🔍 Cache Organization – Lines, Sets, and Set-Associative Mapping"
date: 2026-04-23
last_modified_at: 2026-04-23
categories: [MMU, Cache]
tags: [cache, set-associative, cache-line, replacement-policy, hardware]
order: 6
---

## 1. 🧱 What's Inside a Cache Line?

A cache line (also called cache block) is the minimum unit of data transfer between cache and main memory. It consists of three logical parts:

```
┌──────────┬──────────────┬─────────────────────────────┐
│   Tag    │  Valid/Dirty │         Data                 │
│ (标签位)  │  (状态位)     │       (实际数据)              │
└──────────┴──────────────┴─────────────────────────────┘
```

- **Valid bit**: Is this line holding valid data? On power-up, all valid bits are 0 (cold cache).
- **Tag**: The part of the address used to verify "is this the data I actually requested?"
- **Data**: The actual cached content (e.g., 64 bytes).
- **Dirty bit** (write-back caches only): Has this line been modified? If evicted with Dirty=1, it must be written back to main memory.

## 2. 📐 Address Decomposition: Tag, Index, Offset

When the CPU issues a memory address, the cache hardware slices it into three fields:

```
 Address (32 bits)
┌─────────────┬───────────┬──────────┐
│    Tag      │   Index   │  Offset  │
│  (22 bits)  │ (4 bits)  │ (6 bits) │
└─────────────┴───────────┴──────────┘
```

**How are the bit widths determined?** Let's work through a concrete example:

| Parameter | Value | Calculation |
|-----------|-------|-------------|
| Address width | 32 bits | Given |
| Cache capacity | 4 KB | Given |
| Line size | 64 B | Given |
| Associativity | 4-way | Given |

- **Offset** = log₂(line size) = log₂(64) = **6 bits** → byte within the line
- **Number of lines** = 4 KB / 64 B = 64 lines total
- **Number of sets** = 64 lines / 4 ways = 16 sets
- **Index** = log₂(number of sets) = log₂(16) = **4 bits** → which set to look in
- **Tag** = 32 − 4 − 6 = **22 bits** → which specific line within the set

> **Key insight**: The Index field hard-wires each address to a specific Set. Address `0x0000_0420` always goes to Set 2, never to Set 3 or Set 15. Different addresses with the same Index compete for the same Set.

## 3. 🏗️ Four-Way Set-Associative Structure

```
                  Cache
┌─────────────────────────────────────────┐
│              Set 0                       │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│  │Way 0│ │Way 1│ │Way 2│ │Way 3│      │
│  │V|T|D│ │V|T|D│ │V|T|D│ │V|T|D│      │
│  │data │ │data │ │data │ │data │      │
│  └─────┘ └─────┘ └─────┘ └─────┘      │
├─────────────────────────────────────────┤
│              Set 1                       │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│  │Way 0│ │Way 1│ │Way 2│ │Way 3│      │
│  └─────┘ └─────┘ └─────┘ └─────┘      │
├─────────────────────────────────────────┤
│              ...                         │
├─────────────────────────────────────────┤
│              Set 15                      │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│  │Way 0│ │Way 1│ │Way 2│ │Way 3│      │
│  └─────┘ └─────┘ └─────┘ └─────┘      │
└─────────────────────────────────────────┘
```

Each Set has its own independent PLRU tree. Sets don't share replacement state.

## 4. 🔍 Access Flow: A Worked Example

CPU reads address `0x0000_0420`:

```
Binary: 0000 0000 0000 0000 0000 0100 0010 0000
Split:  ├──── Tag (22bit) ────┤│Idx││Offst│
        0000_0000_0000_0000_0001_00  0010  000000
                                         ↑
                                    Index = 2 → Set 2
```

**Step-by-step**:

1. **Index selects the Set** → Go to Set 2 (hard-wired, no choice)
2. **Tag comparison in parallel** → Compare the 22-bit Tag against all 4 Ways' tags simultaneously
3. **Hit**: Tag matches and Valid=1 → Return data at Offset
4. **Miss**: No match → Fetch from next-level cache or main memory

## 5. 🧊 Cold Start: How Are Empty Lines Filled?

When a Set is completely empty (all Valid=0), the fill process is straightforward:

```
Initial state (all invalid):
┌───────┬───────┬───────┬───────┐
│ Way 0 │ Way 1 │ Way 2 │ Way 3 │
│V=0    │V=0    │V=0    │V=0    │
└───────┴───────┴───────┴───────┘
    ↑ First miss → fill Way 0 (first invalid)
```

**No replacement policy needed when there are invalid Ways!** The hardware simply picks the first invalid Way (usually the lowest-numbered one).

```
After 4 misses:
┌───────┬───────┬───────┬───────┐
│ Way 0 │ Way 1 │ Way 2 │ Way 3 │
│V=1    │V=1    │V=1    │V=1    │
│Tag=1  │Tag=5  │Tag=7  │Tag=3  │
│Data   │Data   │Data   │Data   │
└───────┴───────┴───────┴───────┘
```

Now all 4 Ways are valid. **The 5th miss activates the replacement policy** (PLRU, LRU, etc.).

> **Important**: The entire 64-byte line is fetched from memory, not just the requested byte. This exploits spatial locality — if you accessed address 0x420, you'll likely need 0x421, 0x422... soon.

## 6. ⚔️ Replacement Strategies Compared

| Strategy | State Bits (4-way) | Accuracy | Hardware Cost | Key Idea |
|----------|-------------------|----------|---------------|----------|
| **Random** | 0 | Low | Minimal | Pick a random Way, no tracking needed |
| **FIFO** | 2 (ring pointer) | Low | Low | Evict the oldest entry by insertion time |
| **LRU** | ≈5 (log₂(4!) = 4.58) | Best | Highest | Track exact access order — true "least recently used" |
| **PLRU** | 3 (binary tree) | Near-LRU | Medium | Tree of 1-bit direction flags; N-1 bits for N ways |

- **LRU** is theoretically optimal but expensive: for 8 ways it needs log₂(8!) ≈ 16 bits of state
- **PLRU** approximates LRU with just N-1 bits using a binary tree — that's the tree in SmmuPLRU.sv 🔧
- **Random** is surprisingly decent in practice and trivial to implement

## 7. 🔄 The Complete Miss Handling Flow

```
CPU requests address A
    │
    ▼
Index → Select Set S
    │
    ▼
Tag compare in Set S
    │
    ├─ Hit → Return data ✓
    │
    └─ Miss ─→ Any V=0 Way?
                  │
                  ├─ Yes → Fill first invalid Way
                  │         (no replacement policy)
                  │
                  └─ No  → Apply replacement policy
                           (PLRU/LRU/...)
                           │
                           ├─ Dirty=1? → Write back evicted line
                           │              to main memory first
                           │
                           └─ Fill new line from lower cache / DRAM
```

## 8. 🎯 Associativity Spectrum

| Type | Sets × Ways | Replacement? | Conflict Misses | Hardware |
|------|-------------|-------------|-----------------|----------|
| **Direct-mapped** | N sets × 1 way | Never (forced) | High | Cheapest |
| **Set-associative** | S sets × W ways | When full | Moderate | Balanced |
| **Fully-associative** | 1 set × N ways | Always | Lowest | Most expensive |

- **Direct-mapped**: Each address maps to exactly one Way. No choice, no replacement policy. Fast but prone to conflict misses.
- **Fully-associative**: Every address can go in any Way. Best hit rate but requires N-way parallel tag comparison — expensive for large N (typically used for TLBs with 32-64 entries).
- **Set-associative** (4-way, 8-way): The sweet spot. Each Set has a small number of Ways, enabling parallel comparison while keeping replacement manageable.

> **Rule of thumb**: In practice, 4-way and 8-way set-associative dominate L1 and L2 cache designs. Going beyond 16-way gives diminishing returns on hit rate while significantly increasing access time and power.
