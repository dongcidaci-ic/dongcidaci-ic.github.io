---
title: "2.4 🏷️ CHI Transaction Classification: The Naming Rules Behind 60+ Transactions"
tags: [CHI, AMBA, Cache, Coherence]
order: 9
last_modified_at: 2026-05-21
---

Open the CHI spec, flip to the transaction classification table, and you're hit with **60+ transaction names**. It looks overwhelming — until you realize they're all built from a small set of naming rules. Master the rules, and you can infer what *any* CHI transaction does just by reading its name.

This post breaks down all seven transaction classes in CHI, explains the naming conventions, and highlights the five transactions that cover the vast majority of coherence flows.

---

## 1. 🔤 The Naming Rules

CHI transaction names are **compositional** — each word carries a specific meaning:

| Modifier | Meaning |
|----------|---------|
| **NoSnp** | No Snoop required (non-coherent address space) |
| **Once** | Read once, no caching / cache at weakest state |
| **Clean** | Want data in Clean state (no write-back responsibility) |
| **Shared** | Want Shared state (can coexist in other caches) |
| **Unique** | Want Unique state (exclusive, preparing to write) |
| **Ptl** | Partial write (not a full cache line) |
| **Full** | Complete 64-byte write |
| **Zero** | Write all zeros — no data payload needed, saves bandwidth! |
| **Back** | Write-back (dirty data eviction from cache) |
| **Stash** | Push data to another RN proactively (prefetch hint) |
| **Fwd** | Allow snoop target to forward data directly to requester |
| **Sep** | Separate — data and response travel on separate channels |
| **Invalid** | Invalidate other copies |
| **Persist** | Guarantee persistence to Point of Persistence (PoP) |
| **Def** | Definite write (not speculative) |

Once you know these building blocks, `WriteUniquePtlCleanSh` is no longer scary: it's a **coherent partial write** that also **cleans and shares** other copies — a Combined Write transaction.

---

## 2. 📖 Read Transactions

**Core question: What cache state do you want after reading?**

| Transaction | Target State | Typical Use Case | Importance |
|-------------|-------------|------------------|------------|
| **ReadShared** | SC | Most common read — just reading, not writing | ⭐⭐⭐⭐⭐ |
| **ReadUnique** | UC → UD | Preparing to write — need exclusive ownership | ⭐⭐⭐⭐⭐ |
| **ReadClean** | UC | Want clean data (no write-back responsibility) | ⭐⭐⭐ |
| **ReadNotSharedDirty** | UC or SC | Don't want SD state landing on this cache | ⭐⭐ |
| **ReadOnce\*** | No cache / weakest | Just looking — won't cache | ⭐⭐⭐ |
| **ReadNoSnp** | N/A | Read non-coherent address (MMIO / device registers) | ⭐⭐⭐ |
| **ReadNoSnpSep** | N/A | Same as ReadNoSnp, data and response separated | ⭐⭐ |
| **ReadPreferUnique** | UC (preferred) / SC | Want Unique but can accept Shared | ⭐⭐ |
| **MakeReadUnique** | UC | Already have Shared → upgrade to Unique (no data return) | ⭐⭐⭐ |

### 💡 Key Insights

**ReadShared vs ReadUnique** — the most fundamental distinction:
- `ReadShared`: "I just want to read, others can keep their copies."
- `ReadUnique`: "I'm about to write, I need exclusive ownership. Invalidate everyone else."

**ReadOnce** — "I'm just looking." After reading, the line is not cached or cached in an empty state. Saves snoop overhead because the Home knows you won't retain the data.

**MakeReadUnique** — you already have the data (SC), you just need the *permission* upgrade. The Home doesn't need to send data back — it only performs snoop to invalidate other copies.

**ReadNoSnp** — bypasses the entire coherence flow. Used for non-coherent address spaces like memory-mapped I/O.

### 🔍 ReadOnce Variants

- `ReadOnceCleanInvalid`: After reading, clean and invalidate other cache copies
- `ReadOnceMakeInvalid`: After reading, invalidate all copies (including your own)
- Used in DMA and other one-shot access scenarios

---

## 3. ✋ Dataless Transactions

**Core: No data transfer — only change cache state/permissions**

| Transaction | Purpose | Importance |
|-------------|---------|------------|
| **CleanUnique** | SC → UC: Have Shared Clean, upgrade to Unique | ⭐⭐⭐⭐ |
| **MakeUnique** | I → UC: Currently Invalid, get Unique directly | ⭐⭐⭐ |
| **Evict** | Evict cache line (remove from cache) | ⭐⭐⭐⭐ |
| **CleanShared** | CMO: Force dirty copies in other caches to write back | ⭐⭐⭐⭐ |
| **CleanSharedPersist** | Same + guarantee data reaches PoP | ⭐⭐ |
| **CleanInvalid** | CMO: Write back dirty data + invalidate all copies | ⭐⭐⭐ |
| **MakeInvalid** | Invalidate all copies (don't care about data) | ⭐⭐ |
| **StashOnce\*** | Proactively push data to another RN | ⭐⭐⭐ |

### 💡 Key Insights

**CleanUnique = "I want to write, please kill other copies."** You already have SC, so no snoop to yourself — the Home snoops other RNs.

**Evict = "My cache is full, I don't want this line anymore."** If dirty, Home must accept the write-back; if clean, just discard.

**CleanShared / CleanInvalid = CMO (Cache Maintenance Operations).** Software explicitly invokes these to ensure memory consistency for DMA transfers, context switches, etc.

**Stash = Data prefetch push.** "Hey, you might need this data soon — here it is." Reduces subsequent ReadShared latency.

---

## 4. ✏️ Write Transactions

**Core question: Who handles coherence? Is there data? Write-back or write-through?**

| Transaction | Meaning | Importance |
|-------------|---------|------------|
| **WriteUniquePtl** | Coherent write, partial (<64B) | ⭐⭐⭐⭐ |
| **WriteUniqueFull** | Coherent write, full (64B) | ⭐⭐⭐⭐ |
| **WriteUniqueZero** | Coherent write all zeros | ⭐⭐ |
| **WriteNoSnpPtl** | Non-coherent write, partial | ⭐⭐⭐ |
| **WriteNoSnpFull** | Non-coherent write, full | ⭐⭐⭐ |
| **WriteNoSnpZero** | Non-coherent write all zeros | ⭐⭐ |
| **WriteBackPtl** | Write-back dirty data, partial | ⭐⭐⭐ |
| **WriteBackFull** | Write-back dirty data, full | ⭐⭐⭐⭐ |
| **WriteCleanFull** | Write back clean data (retain permission) | ⭐⭐ |
| **WriteEvictFull** | Write-back + release Unique permission | ⭐⭐⭐ |
| **WriteNoSnpDef** | Non-coherent definite write | ⭐⭐ |

### 💡 Key Insights

**WriteUnique = "Write this data and maintain coherence in one step."** The Home snoops other RNs to invalidate them. No need to ReadUnique first — it's an all-in-one operation.

**WriteNoSnp = "This address doesn't need coherence, just write."** For non-coherent address spaces.

**WriteBack = "I'm evicting this line, here's the dirty data for memory."** The companion to Evict — when a dirty line must be written back.

**WriteClean = "Here's a clean copy for memory, but I'm keeping my cache line."** Sharing clean data with memory without releasing your own copy.

**WriteEvict = "Write back dirty data AND release Unique permission."** The full eviction flow — data goes to memory, and the line is no longer exclusively owned.

### 📦 Ptl vs Full vs Zero

- **Ptl (Partial)**: Only writing some bytes of the cache line, requires a byte mask
- **Full**: Writing the complete 64-byte cache line
- **Zero**: Writing all zeros — **no data payload needed!** Only a signal is sent, saving significant bandwidth

---

## 5. 🔗 Combined Write Transactions

**= Write + Cache Maintenance Operation in one transaction**

| Example | Meaning |
|---------|---------|
| WriteNoSnpFullCleanInv | Write full data + clean and invalidate other copies |
| WriteUniquePtlCleanSh | Coherent partial write + clean and share |
| WriteBackFullCleanInv | Write-back + clean and invalidate |

**Why combine?** Without merging, you'd need two separate transactions: write first, then CMO. Combining them **saves one round-trip** — especially valuable in DMA scenarios where the writer knows it should also clean the cache.

---

## 6. ⚛️ Atomic Transactions

| Transaction | Meaning | Importance |
|-------------|---------|------------|
| **AtomicStore** | Atomic read-modify-write, don't return old value | ⭐⭐⭐ |
| **AtomicLoad** | Atomic read-modify-write, return old value | ⭐⭐⭐ |
| **AtomicSwap** | Atomic swap: write new value, return old value | ⭐⭐⭐ |
| **AtomicCompare** | Atomic compare-and-swap (CAS) | ⭐⭐⭐⭐ |

All atomics execute at the **Home Node or Subordinate Node** — no multi-round trips needed.

**AtomicCompare (CAS)** is the foundation of lock implementations. It atomically compares memory against an expected value and writes a new value only if they match.

---

## 7. 🔍 Snoop Transactions

**Issued by Home Node to RN-F, querying/modifying cache line state**

| Transaction | Meaning | Importance |
|-------------|---------|------------|
| **SnpShared** | Query state, retain Shared if present | ⭐⭐⭐ |
| **SnpClean** | Query state, retain Clean if present | ⭐⭐⭐ |
| **SnpUnique** | Invalidate: must surrender data and invalidate | ⭐⭐⭐⭐⭐ |
| **SnpOnce** | Just checking, don't change state | ⭐⭐ |
| **Snp\*Fwd** | Allow snoop target to forward data directly to requester | ⭐⭐⭐⭐ |
| **SnpStash\*** | Hint to RN that it can cache this data | ⭐⭐ |
| **SnpMakeInvalid** | Unconditionally invalidate | ⭐⭐⭐ |

### 💡 The Power of Fwd

Without `Fwd`: Data flows RN → Home → Requester (two hops)
With `Fwd`: Data flows RN → Requester directly (one hop!) = **DCT (Direct Cache Transfer)**

This is a significant latency optimization — the requester gets data from the peer cache without waiting for the Home to relay it.

**SnpUnique is the most important snoop** — "Someone needs Unique ownership, you must surrender your data and invalidate."

---

## 8. 🧠 Quick Reference: Five Transactions You Must Know

You can understand the vast majority of CHI coherence flows with just five transactions:

| # | Transaction | When to Use |
|---|-------------|-------------|
| 1 | **ReadShared** | I want to read data, others can keep copies |
| 2 | **ReadUnique** | I want to write data, I need exclusive ownership |
| 3 | **WriteUnique** | Write + coherence in one step, no prior read needed |
| 4 | **SnpUnique** | Home asks RN to invalidate and surrender data |
| 5 | **CleanUnique** | I have Shared, upgrade to Unique without data transfer |

### Decision Flowchart

```
I want to READ data
  ├── Just reading → ReadShared ⭐
  ├── Preparing to write → ReadUnique ⭐
  └── Just peeking → ReadOnce

I want to CHANGE permissions (no data)
  ├── Shared → Unique → CleanUnique ⭐
  ├── Evict from cache → Evict
  ├── Software cache maintenance → CleanShared / CleanInvalid
  └── Push data to another RN → Stash

I want to WRITE data
  ├── Coherent write, one step → WriteUnique ⭐
  ├── Non-coherent address → WriteNoSnp
  ├── Evicting dirty line → WriteBack
  └── Write + cache clean combined → Combined Write

I need atomic operation → AtomicCompare (CAS) ⭐

Home asks RN → Snoop
  ├── Invalidate RN → SnpUnique ⭐
  └── Allow direct data forward → Snp*Fwd
```

---

📖 **Reference:** ARM IHI 0050, *AMBA CHI Architecture Specification*, Issue H, Chapter B1.4 Transaction Classification

---

👍 If you found this post helpful, give it a like! Questions and discussions are welcome in the comments 💬
