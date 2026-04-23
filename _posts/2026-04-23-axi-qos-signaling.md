---
title: "1.1.4&nbsp;&nbsp;AXI QoS Signaling – Priority, Acceptance and System-Level Coordination"
date: 2026-04-23
last_modified_at: 2026-04-23
order: 4
categories: [AMBA, AXI]
tags: [axi, qos, priority, memory-controller, arbitration]
---

## 1. 🧭 Introduction

In a complex SoC, multiple Managers compete for shared resources — memory bandwidth, interconnect paths, peripheral access. Without a mechanism to prioritize traffic, a low-priority DMA transfer could starve a latency-sensitive CPU cache miss. **Quality of Service (QoS)** is AXI's answer to this problem 🎯

AXI QoS operates at two levels:
- **QoS Identifier (AxQOS)** — "I'm important, treat me well" 📢
- **QoS Acceptance (VAxQOSACCEPT)** — "I'm busy, only high-priority requests please" 🚦

This post covers both mechanisms and how they work together.

---

## 2. 🏷️ QoS Identifier (AxQOS)

### 2.1 Signal Definition

| Signal | Width | Default | Description |
|--------|-------|---------|-------------|
| AWQOS | 4 | 0x0 | QoS identifier for write requests |
| ARQOS | 4 | 0x0 | QoS identifier for read requests |

A 4-bit value gives **16 QoS levels** (0–15). The property `QOS_Present` controls whether these signals exist on an interface:

| QOS_Present | Effect |
|:---:|--------|
| True (default) | AWQOS and ARQOS are present |
| False | AWQOS and ARQOS are not present |

### 2.2 Recommended Usage: Priority Indicator

The protocol does **not** strictly define what AxQOS means — it's implementation-defined. However, the spec **recommends** using it as a **priority indicator**:

> 🔼 **Higher AxQOS value = higher priority**

For example:

| AxQOS | Typical Traffic |
|:---:|-----------------|
| 15 | Real-time interrupt response 🚨 |
| 12 | CPU cache line fill |
| 8 | GPU texture fetch |
| 4 | DMA bulk transfer |
| 0 | Background debug/logging |

### 2.3 Who Generates AxQOS?

There are three possible sources:

**1️⃣ Manager generates its own QoS values**

A Manager that produces multiple traffic streams can assign different QoS values to each. For example, a CPU might assign higher QoS to cache miss requests and lower QoS to prefetch requests.

**2️⃣ Interconnect remaps QoS values**

The spec expects that most interconnect implementations will support **programmable registers** to assign QoS values to connected Managers. These override whatever the Manager provides — the interconnect is the "QoS authority" in the system 👑

**3️⃣ Default behavior: numeric comparison**

When no custom QoS scheme is programmed, the default is simple:
- Any component with multiple transactions to choose from selects the **higher QoS value first**
- **BUT**: AXI ordering rules always take precedence over QoS ordering!

```
Priority: AXI Ordering Rules > QoS Value
```

This means you can't use QoS to reorder transactions that the protocol requires to be in-order 📏

---

## 3. 🚦 QoS Acceptance Indicators (VAxQOSACCEPT)

### 3.1 The Problem QoS Acceptance Solves

Imagine this scenario:

```
CPU (high QoS) ──┐
                  ├──▶ Memory Controller ──▶ DRAM
DMA (low QoS)  ──┘
```

The DMA issues a low-priority request that the memory controller accepts but can't service immediately (DRAM row miss, bank conflict). The CPU then issues a high-priority request, but the interface is **blocked** by the outstanding DMA request.

**QoS Acceptance** solves this: the memory controller tells the world "I'm only accepting QoS ≥ 8 right now", so the DMA holds back, keeping the interface free for the CPU ✅

### 3.2 Signal Definition

| Signal | Width | Default | Description |
|--------|-------|---------|-------------|
| VAWQOSACCEPT | 4 | 0x0 | Minimum QoS the Subordinate accepts on AW channel |
| VARQOSACCEPT | 4 | 0x0 | Minimum QoS the Subordinate accepts on AR channel |

These are **output signals from the Subordinate**, synchronous to ACLK but **unrelated to any other AXI channel** — they're sideband signals, not part of the handshake protocol.

The property `QoS_Accept` controls their presence:

| QoS_Accept | Effect |
|:---:|--------|
| True | VAWQOSACCEPT and VARQOSACCEPT are present |
| False (default) | Signals are not present |

### 3.3 How It Works

The rules are straightforward:

| Condition | Behavior |
|-----------|----------|
| Request QoS ≥ VAxQOSACCEPT | ✅ Accepted by the Subordinate |
| Request QoS < VAxQOSACCEPT | ⚠️ Might be stalled for a significant time |

> 💡 **Key insight**: VAxQOSACCEPT is a **threshold**, not a gate. The Subordinate *may* still accept low-priority requests — it just warns that they might be delayed.

### 3.4 Why Not Just Reject Low-Priority Requests?

The spec deliberately uses "might be stalled" instead of "will be rejected" because:

1. **Adaptation delay** — There's a lag between the QoS acceptance value changing and the component actually adapting to it
2. **Head-of-line blocking** — A low-priority transaction might be blocking a higher-priority one behind it; the Subordinate needs to make progress on it
3. **Starvation prevention** 🍽️ — You can't starve low-priority transactions forever. The spec recommends that even below-threshold requests should eventually be serviced

### 3.5 Manager-Side Usage

A smart Manager uses VAxQOSACCEPT to **avoid blocking its own interface**:

```
Manager has 3 pending requests:
  - Req A: QoS = 4  (VAxQOSACCEPT = 8 → likely stalled)
  - Req B: QoS = 10 (VAxQOSACCEPT = 8 → will be accepted)
  - Req C: QoS = 12 (VAxQOSACCEPT = 8 → will be accepted)

Smart Manager: Issue B and C first, hold A for later
Naive Manager: Issue A first → interface blocked → B and C can't go
```

By issuing only requests that are likely to be accepted, the Manager keeps its interface available for future high-priority requests that might arrive 🚀

---

## 4. 🌐 System-Level QoS Coordination

QoS is not a "set it and forget it" feature. It requires **system-level understanding** and collaboration:

### 4.1 The QoS Chain

```
Manager (generates AxQOS)
    │
    ▼
Interconnect (remaps AxQOS based on programmable registers)
    │
    ▼
Subordinate (uses AxQOS for arbitration, outputs VAxQOSACCEPT)
    │
    ▼
Manager (reads VAxQOSACCEPT, adjusts issuing strategy)
```

### 4.2 Design Recommendations

| Component | Recommendation |
|-----------|---------------|
| **Manager** | Include programmable registers for QoS values, so firmware can adjust per-scenario |
| **Interconnect** | Support QoS remapping registers — override Manager-provided values with system-level policy |
| **Subordinate** (e.g., memory controller) | Implement VAxQOSACCEPT to prevent interface blocking |
| **System designer** | Define a consistent QoS scheme across all components |

### 4.3 Typical QoS Scheme Example

In a mobile SoC, QoS values might be assigned as:

| QoS | Component | Reasoning |
|:---:|-----------|-----------|
| 15 | Display controller | Frame deadline must be met or screen tears 🖥️ |
| 12 | CPU L2 cache refill | Latency-sensitive, affects all software |
| 8 | GPU | Bandwidth-hungry but somewhat tolerant |
| 4 | Video encoder | Can buffer, moderate latency tolerance |
| 2 | USB DMA | Bulk transfers, very tolerant |
| 0 | Debug trace | Best-effort, never affects functionality |

---

## 5. 📊 QoS vs Other AXI Attributes

| Attribute | Purpose | Who Sets It | Enforcement |
|-----------|---------|-------------|-------------|
| **AxCACHE** | Memory type & caching behavior | Manager | Subordinate must respect |
| **AxPROT/AxPAS** | Security & access permission | Manager | Subordinate/interconnect enforces |
| **AxQOS** | Traffic priority | Manager or interconnect | Best-effort, advisory |
| **VAxQOSACCEPT** | Subordinate load indication | Subordinate | Advisory, not a gate |

> 💡 **Key difference**: AxCACHE and AxPROT have strict protocol semantics — violating them causes functional errors. AxQOS is **advisory** — violating QoS expectations only affects performance, never correctness 🎯

---

## 6. 📝 Key Takeaways

1. **AxQOS is a 4-bit priority indicator** — higher value = higher priority (recommended, not mandatory)
2. **QoS is advisory, not mandatory** — it affects performance, not correctness ✅
3. **AXI ordering rules always beat QoS** — you can't use QoS to reorder what must stay ordered
4. **VAxQOSACCEPT is a Subordinate's "busy signal"** — "I'm only accepting QoS ≥ N right now"
5. **Smart Managers use VAxQOSACCEPT** to avoid blocking their interface with requests that will be stalled 🧠
6. **Low-priority requests shouldn't starve** — the spec recommends eventual service even below threshold
7. **System-level coordination is essential** — QoS only works when all components agree on the scheme
8. **Interconnect is typically the QoS authority** — it remaps Manager-provided values with system policy 👑

---

📖 **Reference:** ARM IHI0022L, *AMBA AXI Protocol Specification*, Issue L, August 2025, Chapter A4.8

---

👍 If you enjoyed this post, feel free to give it a like! Comments and discussions are also welcome 💬
