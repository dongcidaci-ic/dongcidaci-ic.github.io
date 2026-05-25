---
title: "2.3 🏛️ CHI Architecture Overview: Three Layers, Four Nodes, Seven States"
tags: [CHI, AMBA, Cache, Coherence]
order: 9
last_modified_at: 2026-05-25
---

You've heard of AXI. You've maybe heard of ACE. But **CHI** — the Coherent Hub Interface — is where ARM's on-chip interconnect story gets serious. It's the protocol that powers ARM Neoverse servers, and it's fundamentally different from anything that came before in the AMBA family.

This post covers the foundations from **Chapter A and B1** of the CHI spec (ARM IHI 0050 Issue H): why CHI exists, how it's structured, and the core concepts you need before diving into transaction flows.

---

## 1. 🏗️ Where CHI Fits in the AMBA Family

| Protocol | AMBA Gen | Coherence | Design Philosophy |
|----------|----------|-----------|-------------------|
| AXI4 | AMBA 4 | ❌ No | Point-to-point, simple |
| ACE | AMBA 4 | ✅ Yes | AXI + coherence patches (backward compatible) |
| **CHI** | **AMBA 5** | **✅ Yes** | **Clean-slate design for scalability** |

ACE bolted coherence onto AXI. CHI started from scratch. The result: a protocol that scales from 4-core mobile SoCs to 128+ core servers — with **packet-based** communication instead of AXI's signal-level handshaking.

> 💡 **Analogy**: If AXI is USB 2.0, ACE is USB 2.0 with a 3.0 adapter. CHI is USB-C — a fresh connector designed for the future.

---

## 2. 🥞 The Three Architecture Layers

CHI splits its functionality into three independent layers, just like the OSI model splits networking:

| Layer | Granularity | Responsibility | Analogy |
|-------|-------------|----------------|---------|
| **Protocol** | Transaction | *What* to do: read, write, cache state transitions | "Ship this book to Zhang San" |
| **Network** | Packet | *How* to route: add SrcID/TgtID, pick a path | Courier sorts and plans route |
| **Link** | Flit | *Deliver* reliably: flow control between adjacent nodes | Truck driver confirms each leg |

The critical simplification in CHI:

> **1 Packet = 1 Flit = 1 Phit**

No fragmentation, no reassembly. Each packet is one flow-control unit, which is one physical transfer. This is far simpler than traditional NoC protocols where packets split into multiple flits.

**What this means for hardware**: Your link-layer FIFO depth is simply the number of L-Credits outstanding. No need for packet reassembly buffers or out-of-order flit tracking.

---

## 3. 🌐 Topology: CHI Doesn't Pick Sides

CHI is **topology-independent** — the protocol works over any physical arrangement. The spec highlights three common choices:

| Topology | Latency | Wiring | Scale |
|----------|---------|--------|-------|
| **Crossbar** | Low | Heavy | Small (4–8 nodes) |
| **Ring** | Linear with N | Efficient | Medium (8–16 nodes) |
| **Mesh** | Log with N | Heavy | Large (64+ nodes) |

```
Crossbar          Ring              Mesh
 ┌───┬──┐        ┌─0─┐            0  1  2  3
 │ ╳ ╳ │        │   │            4  5  6  7
 │ ╳ ╳ │        3   1            8  9 10 11
 └───┴──┘        │   │           12 13 14 15
                 └─2─┘
```

**Real-world note**: ARM's CMN-700 is a 2D Mesh — the de facto choice for Neoverse server SoCs. Phone SoCs typically use Ring or small Crossbar.

---

## 4. 🎭 The Four Node Types

Every component in a CHI system plays one of four roles:

| Node | Role | Plain English |
|------|------|---------------|
| **RN** (Request Node) | Issues requests | "I'm a customer" |
| **HN** (Home Node) | Coordinates coherence | "I'm the manager" |
| **SN** (Subordinate Node) | Executes requests | "I'm the warehouse" |
| **MN** (Misc Node) | Handles DVM (TLB ops) | "I'm the mailman" |

But not all RNs are created equal:

| Subtype | Has Coherent Cache? | Receives Snoops? | Typical Use |
|---------|---------------------|-------------------|-------------|
| **RN-F** | ✅ Yes | ✅ Yes | CPU cores |
| **RN-D** | ❌ No | ❌ No (gets DVM) | IO + DVM agents |
| **RN-I** | ❌ No | ❌ No | Pure IO agents |

> 💡 **Analogy**: RN-F = full-time employee with building access. RN-I = contractor — can work in designated areas but can't enter the core.

**The golden rule of CHI communication**:
- RN only talks to HN
- HN coordinates everything (snoops, responses, ordering)
- SN only talks to HN
- RN-F nodes don't talk directly to each other (except in DCT — more on that below)

```
  RN-F ──REQ──→ HN-F ──REQ──→ SN-F
                ↑  │
         SNP    │  │RSP/DAT
         ↓      │  ↓
  RN-F ←──SNP───┘
```

---

## 5. 📦 Transaction → Message → Packet → Flit

A single **Transaction** (e.g., "read this cache line") decomposes into multiple **Messages** across different channels:

```
ReadShared Transaction:
  ├── REQ:  Request   (RN→HN: "read address X in Shared state")
  ├── SNP:  Snoop     (HN→RN-F: "anyone have this line?")
  ├── RSP:  Response  (RN-F→HN: "yes, I have it")
  └── DAT:  Data      (HN→RN: "here's 64B of data")
```

CHI has **four channels** — REQ, RSP, SNP, DAT — and each message travels on exactly one channel. This channel separation is fundamental: it enables independent routing and flow control per channel, which is key to avoiding deadlock in large systems.

---

## 6. 🗺️ The "Point" Series

CHI defines several important points in the memory system. The two you'll encounter most:

| Point | Meaning | In a CHI System |
|-------|---------|-----------------|
| **PoC** (Point of Coherence) | All agents see the same value | = HN-F |
| **PoS** (Point of Serialization) | Ordering is determined | = HN-F |

Others worth knowing: **PoP** (survives power loss), **PoE** (encryption boundary), **PoDP** (survives battery failure), **PoPA** (aliasing across address spaces).

---

## 7. 🔄 The Seven Cache States

CHI uses a **seven-state cache model** — richer than MESI (4 states) or MOESI (5 states):

| State | Valid | Unique | Dirty | Full | MOESI Equivalent | Plain English |
|-------|-------|--------|-------|------|------------------|---------------|
| **I** | ❌ | — | — | — | I | Nothing here |
| **UC** | ✅ | ✅ | ❌ | ✅ | E | Only I have it, clean |
| **UD** | ✅ | ✅ | ✅ | ✅ | M | Only I have it, dirty |
| **UDP** | ✅ | ✅ | ✅ | ❌ | — | Only I have it, partially dirty |
| **SC** | ✅ | ❌ | ❌ | ✅ | S | Others might have it, clean |
| **SD** | ✅ | ❌ | ✅ | ✅ | O | Others might have it, **I owe writeback** |
| **UCE** | ✅ | ✅ | ❌ | ❌ | — | Only I have it, but empty (placeholder) |

**Why SD (Shared Dirty) matters**: This is MOESI's O state. Without it, a cache line in Shared state that's dirty (memory is stale) would need a full writeback before another core can modify it. SD lets the dirty cache keep responsibility for writeback while still allowing others to hold clean copies — avoiding unnecessary memory traffic.

**Why UDP exists**: Partial writes (WritePtl) only modify some bytes of a cache line. UDP tracks "I have exclusive ownership, the line is dirty, but only some bytes are valid." This avoids having to read the full line from memory before a partial write.

**Why UCE exists**: When a cache allocates a line for writing but hasn't written data yet, UCE serves as a placeholder. The cache "owns" the line exclusively, but no bytes are valid yet. This supports write-allocate without an initial read fill.

> 💡 **Roommate analogy**: UC = solo room, clean. UD = solo room, messy. SD = shared room, you're the designated cleaner. UCE = solo room, haven't moved in yet. I = vacant.

---

## 8. ⚡ Direct Transfers: DMT, DCT, DWT

By default, all data flows through the Home Node:

```
Default: RN-F → HN-F → SN-F → HN-F → RN-F   (4 hops)
```

CHI defines three optimizations that cut out the middle hop:

| Optimization | What It Does | Example |
|-------------|--------------|---------|
| **DMT** (Direct Memory Transfer) | SN sends data directly to RN | SN-F ──DAT──→ RN-F (skip HN) |
| **DCT** (Direct Cache Transfer) | Snooped RN sends data directly to requesting RN | RN-F2 ──DAT──→ RN-F1 (skip HN) |
| **DWT** (Direct Write-data Transfer) | RN sends write data directly to SN | RN-F ──DAT──→ SN-F (skip HN) |

**DCT in action**:
```
Default: RN-F1 → HN-F → RN-F2(snoop) → HN-F → RN-F1   (4 hops)
DCT:     RN-F1 → HN-F → RN-F2(snoop) ─────────→ RN-F1   (3 hops!)
```

**⚠️ DCT isn't free**: The data provider must notify HN that data was sent directly, so HN can update its directory. More complexity, but lower latency.

---

## 9. 🧩 Coherence Model: Write-Invalidate

CHI uses a **Write-Invalidate** protocol:

- Before writing a shared line, **invalidate** all other copies first
- Then write exclusively — no notifications needed

This contrasts with **Write-Update** (broadcast new values to all holders). Write-Invalidate typically generates less traffic because:
- Most shared data is read-heavy
- Invalidation is a single message; update would send data N times

**Key guarantee**: If two agents write the same address, **all observers see the writes in the same order**. This ordering is enforced by the PoS (HN-F).

**Important subtlety**: Main memory doesn't need to be up-to-date while any cache holds a valid copy. Memory is only guaranteed correct when no cache has the line. This "lazy writeback" saves enormous bandwidth.

---

## Summary

| Concept | Key Point |
|---------|-----------|
| CHI vs ACE | Clean-slate AMBA 5 design, not an AXI extension |
| Three Layers | Protocol → Network → Link; 1 Packet = 1 Flit = 1 Phit |
| Four Nodes | RN (request) → HN (coordinate) → SN (execute), MN (DVM) |
| Seven States | I/UC/UD/UDP/SC/SD/UCE; SD = MOESI's O |
| Three Optimizations | DMT (memory→RN), DCT (cache→RN), DWT (RN→memory) |
| Coherence Model | Write-Invalidate, 64B granularity, lazy writeback |

📖 **Reference:** ARM IHI 0050, *AMBA CHI Architecture Specification*, Issue H, Chapter B1 Introduction

---

👍 If you found this post helpful, give it a like! Questions and discussions are welcome in the comments 💬
