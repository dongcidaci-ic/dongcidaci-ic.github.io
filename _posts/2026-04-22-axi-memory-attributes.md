---
title: "1.1.2&nbsp;&nbsp;AXI Memory Attributes – AxCACHE Decoded"
date: 2026-04-22
categories: [AMBA, AXI]
tags: [axi, cache, memory-attributes, axcache]
---

## 1. 🧭 Introduction

In a complex SoC, a transaction doesn't travel alone — it carries **metadata** telling every component along the path how to handle it. The **AxCACHE** signals (AWCACHE / ARCACHE) are 4-bit fields that act as the "passport" 🛂 of each transaction, controlling:

- Whether the response can come from an **intermediate buffer** or must reach the **final destination**
- Whether the transaction can be **modified** (split, merged, prefetch)
- Whether the data should be **cached** and **allocated**
- Whether writes must be **visible** at the final destination

Understanding AxCACHE is essential for correct interconnect design and system-level performance tuning 🎯

---

## 2. 📦 AxCACHE Bit Encoding

AxCACHE is a 4-bit signal. The bit definitions **differ between read and write**:

| Bit | AWCACHE (Write) | ARCACHE (Read) |
|-----|-----------------|----------------|
| [0] | Bufferable | Bufferable |
| [1] | Modifiable | Modifiable |
| [2] | Other Allocate | Allocate |
| [3] | Allocate | Other Allocate |

⚠️ **Important:** Allocate and Other Allocate are **swapped** for reads vs writes! This is a common source of bugs 🐛

---

## 3. 🔍 Bit-by-Bit Breakdown

### 3.1 Bufferable — AxCACHE[0]

The Bufferable bit controls **where the response can come from**:

| | Non-Bufferable (0) | Bufferable (1) |
|---|---|---|
| **Write response** | Must come from the **final destination** | Can come from an **intermediate buffer** |
| **Read data** | Must come from the **final destination** | Can come from the final destination **or a write in progress** |
| **Meaning** | "I know the data arrived" ✅ | "I know the data was accepted, it'll arrive eventually" ⏳ |

**Example:** Writing to a UART TX register → Non-bufferable (must confirm the byte was sent). Writing to a DMA buffer → Bufferable (no need to wait for memory confirmation).

### 3.2 Modifiable — AxCACHE[1]

This bit determines whether an **interconnect** can change the transaction characteristics:

| | Non-Modifiable (0) | Modifiable (1) |
|---|---|---|
| Can split into multiple transactions? | ❌ (unless LEN > 16) | ✅ |
| Can merge with other transactions? | ❌ | ✅ |
| Can change Address/Size/Length/Burst? | ❌ | ✅ |
| Can prefetch read data? | ❌ | ✅ |
| **Typical use** | Device register access 📟 | Normal RAM access 🧠 |

**Device memory is always Non-modifiable!** Each peripheral register access has specific side effects — you can't merge two register writes into one 🚫

For Non-modifiable transactions, the following parameters are **fixed**:
- Address (AxADDR, AxREGION)
- Size (AxSIZE)
- Length (AxLEN)
- Burst type (AxBURST)
- Protection attributes (AxPROT, AxNSE, AxPAS, AxINST, AxPRIV)

The only allowed AxCACHE change for Non-modifiable: Bufferable → Non-bufferable (stricter is OK).

### 3.3 Allocate & Other Allocate — AxCACHE[3:2]

These bits provide **allocation hints** to the memory system. They are recommendations, not hard requirements 💡

| Allocate | Other Allocate | Meaning |
|----------|---------------|---------|
| 0 | 0 | No Allocate — not expected to be accessed again, cache lookup **not required** |
| 1 | 0 | Allocate — data might already be cached, **lookup required**, recommended to allocate |
| 0 | 1 | Other Allocate — data might be cached, **lookup required**, but NOT recommended to allocate |
| 1 | 1 | Both — lookup required, allocation recommended from both read and write perspectives |

**Key distinction:** When Allocate = 1, the component recommends caching this line for future use. When Other Allocate = 1, the component says "it might be cached, look it up, but I don't think it'll be reused."

---

## 4. 🗂️ Memory Type Encoding

The combination of all 4 AxCACHE bits defines a **Memory Type**:

| ARCACHE[3:0] | AWCACHE[3:0] | Memory Type |
|-------------|-------------|-------------|
| 0b0000 | 0b0000 | Device Non-bufferable |
| 0b0001 | 0b0001 | Device Bufferable |
| 0b0010 | 0b0010 | Normal Non-cacheable Non-bufferable |
| 0b0011 | 0b0011 | Normal Non-cacheable Bufferable |
| 0b1010 | 0b0110 | Write-Through No-Allocate |
| 0b1110 | 0b0110 | Write-Through Read-Allocate |
| 0b1010 | 0b1110 | Write-Through Write-Allocate |
| 0b1110 | 0b1110 | Write-Through Read and Write-Allocate |
| 0b1011 | 0b0111 | Write-Back No-Allocate |
| 0b1111 | 0b0111 | Write-Back Read-Allocate |
| 0b1011 | 0b1111 | Write-Back Write-Allocate |
| 0b1111 | 0b1111 | Write-Back Read and Write-Allocate |

---

## 5. ⚔️ The Four Families

### 5.1 Device Memory 📟

| Property | Device Non-bufferable | Device Bufferable |
|----------|----------------------|-------------------|
| Write response from | Final destination | Intermediate point |
| Read data from | Final destination | Final destination |
| Modifiable | ❌ | ❌ |
| Prefetch allowed | ❌ | ❌ |
| Merge allowed | ❌ | ❌ |

**Use case:** Peripheral registers. No caching, no merging, no prefetching — every access must be precise.

💡 **Pro tip:** You can combine Device Bufferable + Device Non-bufferable with the same AXI ID to create a "fence" — the Non-bufferable transaction's response guarantees all prior Bufferable writes have reached the destination! 🧱

### 5.2 Normal Non-cacheable Memory 🧠

| Property | NC Non-bufferable | NC Bufferable |
|----------|-------------------|---------------|
| Write response from | Final destination | Intermediate point |
| Read data from | Final destination | Final destination or in-progress write |
| Modifiable | ✅ | ✅ |
| Prefetch allowed | ✅ | ✅ |
| Merge allowed | ✅ | ✅ |

**Use case:** Memory-mapped I/O or RAM regions that don't benefit from caching. The Bufferable variant allows reads to return data from a write that hasn't reached its destination yet — this is **legal** but you can't tell when the write becomes visible ⏳

### 5.3 Write-Through Cacheable Memory 🔍

| Property | Value |
|----------|-------|
| Write response | Intermediate point ✅ |
| Writes must reach destination? | ✅ Yes, in a timely manner |
| Read data from | Cached copy ✅ |
| Modifiable | ✅ |
| Cache lookup required | ✅ |

Write-Through means **every write goes through to memory** — the cache and memory are always consistent. The allocation hints only affect performance:

| Sub-type | Read Allocate | Write Allocate |
|----------|--------------|----------------|
| No-Allocate | Not recommended | Not recommended |
| Read-Allocate | ✅ Recommended | Not recommended |
| Write-Allocate | Not recommended | ✅ Recommended |
| Read + Write Allocate | ✅ Recommended | ✅ Recommended |

### 5.4 Write-Back Cacheable Memory ⚡

| Property | Value |
|----------|-------|
| Write response | Intermediate point ✅ |
| Writes must reach destination? | ❌ **Not required!** |
| Read data from | Cached copy ✅ |
| Modifiable | ✅ |
| Cache lookup required | ✅ |

Write-Back is the most **performant** but most **complex** type. Writes only update the cache — the memory may be **stale** (dirty lines). A cache line is written back to memory only when it's evicted or explicitly cleaned.

This is the key difference from Write-Through: Write-Back **does not require writes to be visible at the final destination** 🚀

---

## 6. 🆚 Side-by-Side Comparison

| Feature | Device NB | Device B | NC NB | NC B | WT | WB |
|---------|-----------|----------|-------|------|----|----|
| Bufferable | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Modifiable | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Cacheable | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Write must reach dest | ✅ | ✅ (timely) | ✅ | ✅ (timely) | ✅ (timely) | ❌ |
| Read from cache | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Read prefetch | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Write merge | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |

---

## 7. 🎯 Typical Use Cases

| Scenario | Recommended Type | AxCACHE (R/W) | Why? |
|----------|-----------------|---------------|------|
| UART/SPI control registers | Device Non-bufferable | 0b0000 / 0b0000 | Every write must arrive, no merging |
| Interrupt register | Device Bufferable | 0b0001 / 0b0001 | Can buffer, but no merge/prefetch |
| DMA buffer | NC Bufferable | 0b0011 / 0b0011 | No caching needed, can merge |
| Code memory (read-heavy) | WT Read-Allocate | 0b1110 / 0b0110 | Cache reads, writes always visible |
| Main memory (high perf) | WB Read+Write Allocate | 0b1111 / 0b1111 | Maximum performance, cache everything |
| Shared flag (polling) | NC Non-bufferable | 0b0010 / 0b0010 | Must see latest value, no stale cache |

---

## 8. 📝 Key Takeaways

1. **AxCACHE[3:2] are swapped between read and write** — this is the #1 source of bugs! 🐛
2. **Device memory is always Non-modifiable** — interconnects cannot split, merge, or prefetch these transactions
3. **Bufferable ≠ cacheable** — Bufferable means "response can come early", cacheable means "data can be stored for reuse"
4. **Write-Through vs Write-Back:** The critical difference is whether writes **must** reach the final destination
5. **Allocate hints are recommendations** — they improve performance but aren't mandatory
6. **Use Device Bufferable + Device Non-bufferable combo** as a lightweight write fence 🧱

---

📖 **Reference:** ARM IHI0022L, *AMBA AXI Protocol Specification*, Issue L, August 2025, Chapter A4

---

👍 If you enjoyed this post, feel free to give it a like! Comments and discussions are also welcome 💬
