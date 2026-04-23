---
title: "1.5&nbsp;&nbsp;AXI Transaction Identifiers and Ordering – The Rules of the Road"
date: 2026-04-23
last_modified_at: 2026-04-23
order: 5
categories: [AMBA, AXI]
tags: [axi, transaction-id, ordering, interconnect, out-of-order, interleaving]
---

## 1. 🧭 Introduction

In a pipelined bus like AXI, multiple transactions can be in flight simultaneously. But how do we keep track of who's who? And in what order should responses come back? **Transaction IDs** are the answer — they're the name tags that let a single physical port behave like multiple logical ports, each with its own in-order guarantee 🏷️

This post covers:
- What AXI IDs are and how they work
- The unique ID indicator (AXI5 new feature)
- Ordering rules: what's guaranteed and what's not
- How the interconnect uses IDs to route responses
- Read data interleaving and chunking

---

## 2. 🏷️ Transaction ID Signals (A5.1)

### 2.1 Signal Definition

| Signal | Width | Default | Description |
|--------|-------|---------|-------------|
| AWID | ID_W_WIDTH | 0 | Write request transaction ID |
| BID | ID_W_WIDTH | 0 | Write response transaction ID |
| ARID | ID_R_WIDTH | 0 | Read request transaction ID |
| RID | ID_R_WIDTH | 0 | Read data transaction ID |

ID widths are configurable (0–32 bits), controlled by two properties:

| Property | Range | Description |
|----------|-------|-------------|
| ID_W_WIDTH | 0–32 | Width for AWID and BID |
| ID_R_WIDTH | 0–32 | Width for ARID and RID |

If a width is **0**, the corresponding signals are not present.

### 2.2 The Core Rule: Same ID = In Order

```
┌──────────────────────────────────────────────┐
│  Same ID  →  MUST remain in order            │
│  Different ID  →  NO ordering restriction    │
└──────────────────────────────────────────────┘
```

A single physical port can support **out-of-order** transactions by acting as multiple logical ports, each identified by a different ID value. This enables **parallel processing** — a Manager doesn't have to wait for earlier transactions to complete before issuing new ones 🚀

### 2.3 When Can You Omit ID Signals?

| Scenario | ID Required? |
|----------|:---:|
| Manager doesn't support reordering | ❌ Can omit ID signals |
| Manager has only one outstanding transaction | ❌ Can omit ID signals |
| Subordinate doesn't reorder responses | ❌ Doesn't need to use ID values |

⚠️ **Critical compatibility rule**: If a Subordinate doesn't include ID signals, it **cannot** be connected to a Manager that does have ID signals, because the Manager requires BID and RID to be reflected from AWID and ARID.

---

## 3. 🆔 Unique ID Indicator (A5.2)

AXI5 adds an optional **unique ID indicator** — a 1-bit flag that tells downstream components "this ID is unique among all in-flight transactions."

### 3.1 Signals

| Signal | Width | Default | Description |
|--------|-------|---------|-------------|
| AWIDUNQ / BIDUNQ | 1 | 0 | Unique ID indicator for write channel |
| ARIDUNQ / RIDUNQ | 1 | 0 | Unique ID indicator for read channel |

Enabled by the property `Unique_ID_Support` (default: False).

### 3.2 What Does "Unique In Flight" Mean?

```
AWIDUNQ = 1  →  "No other outstanding write has this same AWID"
ARIDUNQ = 1  →  "No other outstanding read has this same ARID"
```

**Why does this matter?** Downstream components (interconnect, Subordinates) must track and order transactions with the same ID. If an ID is guaranteed unique, there's **nothing to order against** — the downstream component can skip tracking entirely, saving area and power ⚡

### 3.3 Rules Summary

| Request Side | Response Side |
|--------------|---------------|
| AWIDUNQ=1 → no outstanding write with same AWID | BIDUNQ must match AWIDUNQ |
| ARIDUNQ=1 → no outstanding read with same ARID | RIDUNQ must match ARIDUNQ |
| AWIDUNQ=0 → BIDUNQ must be 0 | ARIDUNQ=0 → RIDUNQ must be 0 |
| AWIDUNQ=1 → BIDUNQ must be 1 | ARIDUNQ=1 → RIDUNQ must be 1 |

> 💡 AxIDUNQ is optional — even if there are no outstanding transactions with the same ID, the Manager doesn't have to assert it.

---

## 4. 📏 Request Ordering Rules (A5.3)

### 4.1 What's Guaranteed?

Transactions on the **same channel**, with the **same ID**, to the **same destination** — guaranteed in order ✅

### 4.2 What's NOT Guaranteed?

No ordering guarantee exists between:

| No Guarantee Between | Example |
|----------------------|---------|
| Different Managers | CPU and GPU requests |
| Read and write transactions | A read and a write, even same ID |
| Different IDs | AWID=0 and AWID=1 |
| Different Peripheral regions | UART and Timer registers |
| Different Memory locations | Addr 0x1000 and 0x2000 |

If ordering is required between transactions with no guarantee, the Manager must **wait for the first response before issuing the second** ⏳

### 4.3 Memory vs Peripheral

| | Memory Location | Peripheral Region |
|---|---|---|
| Read returns last written value? | ✅ Yes | ❌ Not necessarily |
| Write updates value for subsequent reads? | ✅ Yes | ❌ Not necessarily |
| Side effects on other locations? | ❌ No | ✅ Possible |
| Ordering granularity | Per location | Per region |

### 4.4 Device vs Normal Transactions

| Type | AxCACHE[1] | Usage |
|------|:---:|--------|
| **Device** | 0 | Access peripheral registers or memory with side effects |
| **Normal** | 1 | Access cacheable memory locations |

> 🔑 **Key insight**: Device ≡ Non-modifiable, Normal ≡ Modifiable — these are the same concepts from Chapter A4!

### 4.5 Manager Ordering Guarantees (Same ID, Same Manager)

**Before completion response:**

| Guarantee | Condition |
|-----------|-----------|
| Device write DW1 arrives before DW2 | Same Peripheral region |
| Device read DR1 arrives before DR2 | Same Peripheral region |
| Write W1 observed by write W2 | Same cacheability + Memory location |
| W1 observed by R2 → W1 observed by R3 | Same cacheability + Memory location |

**From completion response:**

| Transaction Type | Completion Guarantees |
|------------------|-----------------------|
| Read request | Observable to any subsequent request from any Manager |
| Non-bufferable write | Observable to any subsequent request from any Manager |
| Bufferable write (Non-shareable) | Observable to issuing Manager only |
| Bufferable write (Shareable) | Observable to all Managers in Shareable Domain |
| Bufferable write (System) | Observable to all Managers |

### 4.6 Response Ordering

**Within the same ID, responses must return in request order:**

```
Read R1 issued before Read R2 (same ARID)
  → R1 response MUST come before R2 response ✅

Write W1 issued before Write W2 (same AWID)
  → W1 response MUST come before W2 response ✅
```

---

## 5. 🔀 Interconnect Use of IDs (A5.4)

When multiple Managers share a Subordinate through an interconnect, **ID width expands**:

```
Manager 0:  AWID[3:0]  ──┐
                          ├──▶  Interconnect  ──▶  Subordinate: AWID[5:0]
Manager 1:  AWID[3:0]  ──┘        (adds 2-bit            (wider ID)
                                   Manager port ID)
```

**How it works:**

1. **Outbound** (Manager → Subordinate): Interconnect appends a unique Manager port number to the ID
2. **Inbound** (Subordinate → Manager): Interconnect uses the extra bits to route responses back to the correct Manager, then strips them

```
Outbound:  Manager 0 AWID=0x5  →  Subordinate sees AWID=0x05
           Manager 1 AWID=0x5  →  Subordinate sees AWID=0x15

Inbound:   Subordinate BID=0x15 →  Interconnect strips →  Manager 1 gets BID=0x5
           Subordinate BID=0x05 →  Interconnect strips →  Manager 0 gets BID=0x5
```

> 💡 This is why ID width at the Subordinate side is always **wider** than at the Manager side — the extra bits encode the source 👑

---

## 6. ✍️ Write Data Ordering (A5.5)

### 6.1 Basic Rule

A Manager must issue **write data in the same order as write requests**.

### 6.2 Credit-Based Transport Exception

When using credit-based transport (AXI5), this rule applies **per Resource Plane**:

```
Resource Plane 0:  AWID=0 → AWID=2   (data must follow this order within RP0)
Resource Plane 1:  AWID=1              (independent ordering within RP1)
```

This means data for ID1 can be issued before data for ID0 if they use different Resource Plans — and **interleaving** is permitted across Resource Plans 🎉

```
W Channel:  [RP1:ID1_data] [RP0:ID0_data] [RP1:ID1_data] [RP0:ID2_data]
                  ↑              ↑               ↑               ↑
            Different RPs → interleaving OK!
```

### 6.3 Write Response Ordering

- Subordinate: BID must match the AWID of the request it's responding to
- Interconnect: Must ensure write responses with the same AWID targeting different Subordinates are received by the Manager in request order

---

## 7. 📖 Read Data Ordering (A5.6)

### 7.1 Basic Rules

- Subordinate: RID must match the ARID of the request it's responding to
- Interconnect: Must return read data with the same ARID in request order

### 7.2 Read Data Reordering Depth

| Reordering Depth | Behavior |
|:---:|---|
| 1 | In-order only (simplest) |
| >1 | Can reorder responses for different IDs |

> ⚠️ This is a **static** value — there's no mechanism for a Manager to dynamically discover a Subordinate's reordering depth at runtime.

### 7.3 Read Data Interleaving

AXI permits read data from **different IDs** to be interleaved:

```
R Channel:  [RID=0 data] [RID=1 data] [RID=0 data] [RID=1 data] ...
                  ↑             ↑            ↑             ↑
            Different IDs → interleaving OK!
```

The property `Read_Interleaving_Disabled` controls this:

| Value | Manager | Subordinate |
|:---:|---------|-------------|
| False (default) | Can receive interleaved data | Might interleave data |
| True | Cannot receive interleaved data | Will not interleave data |

### 7.4 Read Data Chunking (AXI5)

AXI5 adds **read data chunking** — the Subordinate can return 128-bit chunks in any order within a transaction:

| Signal | Width | Description |
|--------|-------|-------------|
| ARCHUNKEN | 1 | Request: "chunking enabled for this read" |
| RCHUNKV | 1 | Response: "chunk number and strobe are valid" |
| RCHUNKNUM | 0–8 bits | Which chunk is being transferred |
| RCHUNKSTRB | 0–8 bits | Which 128-bit lanes are valid |

**Example** (256-bit data bus, 2 transfers, addr 0x00):

```
Transfer 1: addr=0x20, RCHUNKNUM=1, RCHUNKSTRB=0b01, RLAST=0
Transfer 2: addr=0x10, RCHUNKNUM=0, RCHUNKSTRB=0b10, RLAST=0
Transfer 3: addr=0x30, RCHUNKNUM=1, RCHUNKSTRB=0b10, RLAST=0
Transfer 4: addr=0x00, RCHUNKNUM=0, RCHUNKSTRB=0b01, RLAST=1
```

> 💡 Chunking is useful for memory controllers that can fetch different cache lines independently — the Subordinate can return whichever chunk is ready first, instead of waiting for the full sequential order 🧠

**Chunking constraints:**
- ID must be unique-in-flight (ARIDUNQ must be asserted if present)
- Size must equal data width, or Length is 1
- Size ≥ 128 bits, address aligned to 16 bytes
- Burst type: INCR or WRAP only

---

## 8. 🏭 Early Response (A5.3.7)

An intermediate component (like a cache or interconnect) can issue a **response before the transaction reaches its final destination** — this is called an **early response**.

### 8.1 Early Read Response

An intermediate component can respond with read data from a local copy if it's up-to-date. The request doesn't need to propagate further.

### 8.2 Early Write Response

For **Bufferable** writes (AWCACHE[0]=1), an intermediate component can send an early write response, but:
- Must still propagate the write downstream
- Must maintain a local copy until the downstream response is received
- Must maintain ordering and observability guarantees

```
Manager ──▶ Cache (early BRESP) ──▶ Memory Controller (final BRESP)
                  │
                  └─ Responsible for ordering until downstream
                     response is received
```

> ⚠️ For Device Bufferable writes, the intermediate component **cannot** wait for another transaction before propagating — it must forward the write independently.

---

## 9. 🔑 Ordered Write Observation (A5.3.9)

A stronger ordering mode where writes from the same Manager with the same ID are guaranteed to be observed in issue order, **regardless of address or destination**.

| Property | Default | Effect |
|----------|:---:|--------|
| Ordered_Write_Observation | False | Normal ordering rules apply |
| Ordered_Write_Observation | True | Same-ID writes always observed in issue order |

This is useful for the **Producer-Consumer** ordering model — a Manager can issue multiple writes without waiting for responses, and they're guaranteed to be observed in order 📦

---

## 10. 📝 Key Takeaways

1. **Same ID = in order, different ID = no guarantee** — this is the fundamental rule 🎯
2. **IDs enable out-of-order processing** — a single port acts as multiple logical ports
3. **Unique ID indicator (AXI5)** — tells downstream "this ID has no ordering concerns, skip tracking"
4. **ID width grows through the interconnect** — extra bits encode the Manager source
5. **Write data follows request order** (per Resource Plane in credit-based transport)
6. **Read data can be interleaved** across different IDs; chunking (AXI5) allows reordering within a transaction
7. **Early responses** improve performance but the intermediate component takes on ordering responsibility
8. **No ordering between reads and writes** — even with the same ID!
9. **Ordered Write Observation** provides stronger guarantees for Producer-Consumer models
10. **If you need ordering without a guarantee, wait for the response** — the only safe way ⏳

---

📖 **Reference:** ARM IHI0022L, *AMBA AXI Protocol Specification*, Issue L, August 2025, Chapter A5

---

👍 If you found this post helpful, give it a like! Questions and discussions are welcome in the comments 💬
