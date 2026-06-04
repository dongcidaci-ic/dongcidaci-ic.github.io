---
title: "2.5 ⚛️ CHI Atomic, Stash, Dataless, Prefetch, DVM & Retry Transactions"
date: 2026-06-04
categories: [Cache]
tags: [chi, amba, protocol, coherence, atomic, stash, dataless, dvm, retry]
order: 11
---

Beyond Read and Write, CHI defines five more transaction categories plus a flow control mechanism. This post covers B2.3.3–B2.3.8 from the CHI specification.

## 1️⃣ Atomic Transactions

**"Read-modify-write in one indivisible operation."**

Atomic transactions implement indivisible read-modify-write operations—the foundation of lock-free programming. Without them, an atomic increment would require three separate transactions: ReadUnique → modify → WriteUnique, which could be interrupted by another RN writing the same address.

**Four transaction types:**

| Transaction | Returns data? | Use case |
|------------|--------------|---------|
| AtomicStore | ❌ No | Atomic assignment: `x = 5` |
| AtomicLoad | ✅ Yes | Atomic read: `tmp = x` |
| AtomicSwap | ✅ Yes | Atomic swap: `tmp = x; x = new_val` |
| AtomicCompare | ✅ Yes | Compare-and-swap (CAS): `if(x==expected) x = desired` |

💡 The two most important: **AtomicStore** (simple atomic write) and **AtomicCompare** (CAS—the foundation of all lock-free data structures).

### Flow 1: AtomicStore (write-only, no return)

```
RN-F ──AtomicStore──→ HN-F

  Alt 1a (separate responses):
  HN-F ──DBIDResp──→ RN-F          ← "send me data"
  HN-F ──Comp──→ RN-F              ← "done"

  Alt 1b (combined response):
  HN-F ──CompDBIDResp──→ RN-F      ← "send me data + done"

RN-F ──NonCopyBackWriteData──→ HN-F
```

This is nearly identical to an Immediate Write—the "read-modify-write" happens internally at Home, and only the "write" phase is visible externally.

### Flow 2: AtomicLoad / AtomicSwap / AtomicCompare (with return)

```
RN-F ──AtomicSwap──→ HN-F
HN-F ──DBIDResp──→ RN-F              ← "send me data"
RN-F ──NonCopyBackWriteData──→ HN-F  ← requester sends new value (must NOT wait for CompData!)
HN-F ──CompData──→ RN-F              ← Home returns old value (result of atomic operation)
```

💡 **Critical timing**: The requester must send NonCopyBackWriteData **immediately after receiving DBIDResp**—it cannot wait for CompData. Home needs both the old value (in its cache/memory) and the new value (from the requester) to complete the atomic operation. It's a "ping-pong": you give me the new value, I give you the old value.

💡 **AtomicCompare (CAS)** is the most complex: the requester sends both an expected value and a desired value. Home compares the current value against the expected value—equal → write desired value; not equal → no write. In either case, Home returns the current value.

**Optional TagMatch response**: Some Atomic transactions can request a TagMatch response—used by ARM's Memory Tagging Extension (MTE, v8.5+) for memory safety.

---

## 2️⃣ Stash Transactions

**"I just wrote this data—by the way, you might need it."**

Stash is a unique CHI optimization. The core idea: **after writing data, proactively "push" a hint to another RN (the Stashee) telling it "you might need this cache line."** The Stashee can optionally pull the data (DataPull) or ignore the hint.

This reduces the Stashee's first-access cache miss latency compared to the traditional "wait until they read it" approach.

**Three Stash transaction flows:**

| Type | Trigger | Has StashDone? | Transactions |
|------|---------|---------------|-------------|
| **1. Write with Stash Hint** | Write + Stash combined | ❌ | WriteUniquePtlStash / WriteUniqueFullStash |
| **2. Independent Stash (no StashDone)** | Standalone Stash | ❌ | StashOnceUnique / StashOnceShared |
| **3. Independent Stash (with StashDone)** | Standalone Stash | ✅ | StashOnceSepUnique / StashOnceSepShared |

### Flow 1: Write with Stash Hint

```
RN-F1 ──WriteUniqueFullStash──→ HN-F
  (WriteUnique proceeds as normal Immediate Write)

  Home optionally sends Stash Snoop to Stashee:

  Alt 1a: SnpUniqueStash (typically for partial writes)
  HN-F ──SnpUniqueStash──→ RN-F2 (Stashee)

    1a1 (No DataPull):
    RN-F2 ──SnpResp──→ HN-F        ← "hint received, but I don't need data"

    1a2 (DataPull):
    RN-F2 ──SnpResp──→ HN-F
    RN-F2 initiates Allocating Read to get data

  Alt 1b: Other Stash Snoops (typically for full writes)
  HN-F ──SnpMakeInvalidStash / SnpStashShared / SnpStashUnique──→ RN-F2
    (same DataPull / No DataPull alternatives)
```

💡 **Both Home and Stashee can ignore Stash**—it's a hint, not a command. Home can decline to send the Snoop; Stashee can decline to pull data.

💡 **SnpUniqueStash vs SnpStashUnique**:
- `SnpUniqueStash`: Home instructs Stashee to take Unique ownership (more "forceful")
- `SnpStashUnique`: Home hints Stashee "you might want Unique access" (advisory)

### Flow 2: Independent Stash (no StashDone)

```
RN-F1 ──StashOnceShared──→ HN-F
  HN-F optionally sends Stash Snoop:
  HN-F ──SnpStashShared──→ RN-F2 (Stashee)
    (DataPull / No DataPull as above)
HN-F ──Comp──→ RN-F1              ← "request accepted"
```

💡 Comp can be sent **before** the Stash completes—Home doesn't need to wait for Stashee's response.

### Flow 3: Independent Stash (with StashDone) ⭐

```
RN-F1 ──StashOnceSepShared──→ HN-F
  HN-F optionally sends Stash Snoop...
    (DataPull / No DataPull as above)

  Alt 3b1 (separate responses):
  HN-F ──Comp──→ RN-F1            ← "request received"
  HN-F ──StashDone──→ RN-F1       ← "Stash operation completed"

  Alt 3b2 (combined response):
  HN-F ──CompStashDone──→ RN-F1   ← "received + completed"
```

💡 **StashDone vs Comp**: Comp = "Home received the request"; StashDone = "Stash actually completed" (Stashee responded). If the requester needs to know whether the Stashee actually pulled data, use the StashDone variant.

---

## 3️⃣ Dataless Transactions

**"Change permissions or perform CMO—no data transfer needed."**

Dataless transactions involve **no data movement**. The requester only wants to change cache line state/permissions or perform cache maintenance operations.

**Three flows covering 11 transactions:**

| Flow | Transactions | CompAck? | Persist? |
|------|------------|----------|----------|
| **1. No CompAck / Persist** | CleanInvalid, CleanInvalidPoPA, CleanInvalidStorage, MakeInvalid, CleanShared, CleanSharedPersist, Evict | ❌ | ❌ |
| **2. With CompAck** | CleanUnique, MakeUnique | ✅ | ❌ |
| **3. With Persist** | CleanSharedPersistSep | ❌ | ✅ |

### Flow 1: Simplest — just Comp

```
RN-F ──CleanInvalid──→ HN-F ──Comp──→ RN-F
```

That's it. Request → Comp. No data, no acknowledgment, no persistence.

💡 **Clean vs Make**:
- **Clean** = if cache line is dirty, write back to memory first, then invalidate
- **Make** = invalidate directly, regardless of dirty state (more "aggressive")

💡 **CleanShared vs CleanInvalid**:
- **CleanShared** = write back dirty data, but keep cache copy (shared state)
- **CleanInvalid** = write back dirty data + invalidate cache copy

### Flow 2: Comp + CompAck

```
RN-F ──CleanUnique──→ HN-F ──Comp──→ RN-F
RN-F ──CompAck──→ HN-F
```

💡 **Why do CleanUnique/MakeUnique need CompAck?** These operations change cache line exclusivity—Home must confirm the requester received Comp before safely updating its directory. If Comp were lost, Home would think the requester has Unique access while the requester doesn't know, potentially causing coherence violations.

💡 **MakeUnique vs MakeReadUnique**: MakeReadUnique is a Read transaction (may return data); MakeUnique is Dataless (never returns data).

### Flow 3: Comp + Persist

```
RN-F ──CleanSharedPersistSep──→ HN-F

  Alt 3a (separate):
  HN-F ──Comp──→ RN-F               ← "CMO complete"
  HN-F ──Persist──→ RN-F            ← "persistence confirmed"

  Alt 3b (combined):
  HN-F ──CompPersist──→ RN-F        ← "CMO complete + persistence confirmed"

  Alt 3c (via Subordinate):
  HN-F ──CleanSharedPersistSep──→ SN-F
  SN-F ──Comp──→ HN-F
  HN-F ──Comp──→ RN-F
  SN-F ──Persist──→ RN-F            ← SN sends Persist directly to requester
```

💡 **CleanSharedPersist vs CleanSharedPersistSep**: The former bundles persistence into Comp; the latter separates them—more flexible but requires an extra message.

---

## 4️⃣ Prefetch Transactions

**"You might need this address soon—prepare ahead."**

The simplest CHI transaction—so simple the spec describes it in half a page.

```
RN-F ──PrefetchTgt──→ SN-F
```

That's it. **No response. No acknowledgment. Nothing.**

💡 **Fire-and-forget**: PrefetchTgt goes directly to the Subordinate (bypassing Home). It's purely a "suggestion" that the SN may ignore entirely. No response means no wasted bandwidth on acknowledgment.

---

## 5️⃣ DVM Transactions

**"Broadcast TLB invalidation across the entire system."**

DVM (Distributed Virtual Memory) transactions broadcast TLB/Cache invalidation operations system-wide. Typical use case: after the OS modifies page tables, it must invalidate stale TLB entries in all cores.

**DVMOp is the only transaction**, but operates in two modes:

| Mode | Response style | Use case |
|------|---------------|---------|
| **Non-sync DVMOp** | Separate or combined | TLB invalidation (no ordering guarantee needed) |
| **Sync DVMOp** | Separate responses only | TLB invalidation (must complete before proceeding) |

### Non-sync DVMOp

```
RN-F ──DVMOp──→ HN-F

  Alt 1a (separate responses):
  HN-F ──DBIDResp──→ RN-F              ← "send me data"
  RN-F ──NonCopyBackWriteData──→ HN-F  ← DVM operation data (TLBI opcode)
  HN-F ──Comp──→ RN-F                  ← "done"

  Alt 1b (combined response):
  HN-F ──CompDBIDResp──→ RN-F          ← "send me data + done"
  RN-F ──NonCopyBackWriteData──→ HN-F
```

### Sync DVMOp

```
RN-F ──DVMOp──→ HN-F
HN-F ──DBIDResp──→ RN-F              ← must be separate!
RN-F ──NonCopyBackWriteData──→ HN-F
HN-F ──Comp──→ RN-F                  ← only after receiving write data
```

💡 **Why does DVMOp need data?** The DVM operation code (e.g., `TLBI VMALLE1IS` = invalidate all EL1 TLB entries) travels via NonCopyBackWriteData. Home receives the opcode and broadcasts it to all relevant RNs.

💡 **Sync vs Non-sync**: Sync DVMOp **requires separate responses** (no CompDBIDResp). This ensures the requester doesn't consider the operation complete until all RNs have processed the invalidation—a critical ordering guarantee for OS page table updates.

💡 **Snoop broadcasts are independent**: After receiving DVMOp, Home sends Snoop requests to all relevant RNs—but these Snoops are independent transactions, not part of the DVMOp flow.

**Common DVM operations:**

| ARM instruction | DVM operation | Effect |
|----------------|---------------|--------|
| `TLBI VMALLE1IS` | Invalidate all EL1 TLB entries | Inner Shareable |
| `TLBI VAE1IS, X0` | Invalidate specific VA TLB entry | Inner Shareable |
| `TLBI ALLE2IS` | Invalidate all EL2 TLB entries | Hypervisor |

These appear frequently in Linux kernel page table update code.

---

## 6️⃣ Retry (Flow Control)

**"I can't handle your request right now—come back with a credit later."**

Retry is CHI's flow control mechanism. When the Completer (typically Home) temporarily cannot accept a request, it doesn't drop the request—it tells the requester "I'm busy, try again" and later provides a **Protocol Credit (P-Credit)** guaranteeing acceptance on retry.

**Why Retry instead of Stall?**

| Approach | Behavior | Problem |
|----------|---------|---------|
| Drop request | Discard silently | Requester doesn't know; needs timeout + retransmit |
| Stall (AXI-style) | Hold the link until ready | Blocks the entire link for all traffic |
| **CHI Retry** ✅ | Reject + issue credit | Link stays free; credit guarantees retry success |

💡 **Retry advantages**: doesn't block the link (other traffic unaffected), doesn't lose the request (credit guarantees success), requester decides when to retry (flexibility).

### Complete Flow

```
RN-F ──Request (without credit)──→ HN-F
HN-F ──RetryAck──→ RN-F              ← "I can't handle this now"
  ... time passes ...
HN-F ──PCrdGrant──→ RN-F             ← "You can come now, bring this credit"

  After receiving BOTH RetryAck + PCrdGrant:

  Alt 1: Resend with credit
  RN-F ──Request (with credit)──→ HN-F   ← guaranteed acceptance!

  Alt 2: Cancel and return credit
  RN-F ──PCrdReturn──→ HN-F             ← "I won't resend, here's your credit back"
```

💡 **The requester must receive both RetryAck AND PCrdGrant before acting**—cannot act on just one.

💡 **PCrdGrant can arrive before RetryAck** (rare but legal). The requester must handle this out-of-order scenario.

**Three signals explained:**

| Signal | Direction | Meaning | Analogy |
|--------|----------|---------|---------|
| **RetryAck** | Completer → Requester | "Request not accepted" | Bank: "counter is full, take a number" |
| **PCrdGrant** | Completer → Requester | "You may proceed" | Bank: "number 123, please come to counter 3" |
| **PCrdReturn** | Requester → Completer | "Never mind, return the credit" | "I don't need this anymore, give my turn to someone else" |

💡 **When would the requester cancel?**
- The operation is no longer needed (e.g., CPU branch misprediction rollback)
- Higher-priority work to do; don't want to waste bandwidth on retry
- Planning to issue a different request with different parameters

**Retry vs other flow control mechanisms:**

| Feature | CHI Retry | AXI Stall | PCIe Flow Control |
|---------|-----------|-----------|-------------------|
| Blocks link? | ❌ No | ✅ Yes | ❌ No |
| Request lost? | ❌ No (credit guarantee) | N/A | ❌ No (Buffer Credits) |
| Retry guaranteed? | ✅ With credit | N/A | ✅ With buffer |
| Can cancel? | ✅ PCrdReturn | ❌ No | ❌ No |

💡 **CHI Retry's unique advantage**: the requester can **cancel and return the credit**—invaluable for CPU speculation rollback scenarios where AXI's Stall mechanism cannot abort.

💡 **Design implications**:
1. Requester must buffer rejected requests until PCrdGrant arrives
2. Requester must handle PCrdGrant arriving before RetryAck
3. Credit-bearing requests must use the same virtual channel—guaranteeing ordering
4. PCrdGrant implies **resource reservation**—Home has already allocated buffer space, so acceptance is guaranteed

---

## 📊 B2.3.3–B2.3.8 Quick Reference

| Transaction | Data transfer? | CompAck? | Persist? | Core purpose | Importance |
|------------|---------------|----------|----------|-------------|-----------|
| **Atomic** | ✅ (bidirectional) | ❌ | ❌ | Atomic RMW operations (CAS/FetchAdd) | ⭐⭐⭐ |
| **Stash** | Optional (DataPull) | ❌ | ❌ | Data prefetch push hint | ⭐⭐⭐⭐ |
| **Dataless** | ❌ | Partial | Partial | CMO / permission changes | ⭐⭐⭐⭐ |
| **Prefetch** | ❌ | ❌ | ❌ | SN-side prefetch hint | ⭐ |
| **DVM** | ✅ (opcode) | ❌ | ❌ | TLB invalidation broadcast | ⭐⭐ |
| **Retry** | ❌ | ❌ | ❌ | Flow control (credit-based) | ⭐⭐⭐ |

**Importance ranking**: Dataless > Stash > Atomic > Retry > DVM > Prefetch

- **Dataless** is extremely common—every permission upgrade (CleanUnique/MakeUnique) is Dataless
- **Stash** is critical in multi-core collaboration—reduces cache miss latency
- **Atomic** enables lock-free programming primitives
- **Retry** is essential for robust flow control in high-concurrency systems
- **DVM** is frequently used by the OS kernel but only needs correct broadcast in hardware
- **Prefetch** is simplest with the fewest use cases

📖 **Reference:** ARM IHI 0050H, *AMBA CHI Architecture Specification*, Chapter B2.3.3–B2.3.8

---

👍 If you found this post helpful, give it a like! Questions and discussions are welcome in the comments 💬
