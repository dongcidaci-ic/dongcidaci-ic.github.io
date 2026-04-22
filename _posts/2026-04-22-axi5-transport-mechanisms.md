---
title: AXI5 Transport Mechanisms – Valid-Ready Handshake vs Credit-Based Transport
date: 2026-04-22
categories: [AMBA, AXI]
tags: [axi5, amba, protocol, credited-transport, valid-ready]
---

## 📜 Preface

AXI5 (IHI0022 Issue L) is the most significant update to the AXI protocol since its inception in 2003. While it introduces several new features — Atomic transaction extensions, CMO enhancements, Memory Tagging Extension (MTE), and more — the most impactful addition is undoubtedly **Credit-Based Transport** 🚀.

Why? Because it changes the fundamental flow control model of AXI.

For over 20 years, AXI has relied solely on the Valid-Ready handshake. Credit-Based Transport is the **first new flow control paradigm** in the protocol's history, with far-reaching implications:

- ⏱️ **Timing closure**: In high-frequency designs (>1 GHz), combinational paths between VALID and READY are a critical bottleneck. Credit-based flow control eliminates these paths entirely.
- 🏗️ **Architectural flexibility**: Resource Planes enable traffic isolation within Interconnects, simplifying deadlock analysis and enabling QoS.
- ⚡ **Power optimization**: The PENDING signal enables fine-grained, transfer-level clock gating at the SoC level.
- 🌍 **Ecosystem impact**: IP interface definitions, VIP verification, and Interconnect designs all need to adapt to the new flow control model.

In short, while other AXI5 additions are "new features," Credit-Based Transport is a "new engine." 🔥

This post provides a detailed comparison of the two transport mechanisms.

---

## 📖 Introduction

AXI5 (AMBA 5 AXI Protocol) is the latest on-chip bus protocol specification from ARM (IHI0022 Issue L), defining the communication interface between Managers (Masters) and Subordinates (Slaves). In AXI5, channel data transport supports **two flow control mechanisms**:

1. 🤝 **Valid-Ready Handshake** — the classic bidirectional handshake
2. 💳 **Credit-Based Transport** — a credit-driven approach introduced in Issue L

This post provides a comparative analysis of both mechanisms.

---

## 1. 🤝 Valid-Ready Handshake

### 1.1 Basic Principle

Valid-Ready is the classic transport method used since the original AXI specification. The core idea is a **bidirectional handshake**:

- **VALID** (driven by the transmitter): indicates that valid data is ready to be transferred
- **READY** (driven by the receiver): indicates that the receiver is able to accept data

**Transfer condition:** A transfer occurs when both VALID and READY are HIGH on the **same rising clock edge** ⬆️.

```
        ┌───┐   ┌───┐   ┌───┐   ┌───┐   ┌───┐
CLK     │   │   │   │   │   │   │   │   │   │
      ──┘   └───┘   └───┘   └───┘   └───┘   └──
                ┌───────────────┐
VALID   ────────┘               └───────────────
          ┌─────────────┐
READY   ──┘             └───────────────────────
                ↑
          Transfer occurs here
```

### 1.2 Key Rules

| Rule | Description |
|------|-------------|
| ⚠️ VALID must not wait for READY | Once asserted, VALID cannot depend on READY being asserted |
| ✅ READY may wait for VALID | The receiver is permitted to wait for VALID before asserting READY |
| 🚫 VALID cannot be deasserted prematurely | Once asserted, VALID must remain HIGH until the transfer completes (VALID && READY) |

### 1.3 Pros and Cons

**👍 Advantages:**
- Simple to implement, clear semantics
- No additional signal overhead
- Suitable for most low-to-medium speed scenarios

**👎 Disadvantages:**
- Combinational paths may exist between VALID and READY, impacting timing
- No support for independent traffic streams — transfers on the same channel block each other
- No clock gating support, limiting power optimization opportunities

---

## 2. 💳 Credit-Based Transport

### 2.1 Basic Principle

Credit-Based Transport is a new mechanism introduced in AXI5 Issue L. The core idea is **receiver pre-allocates credits; transmitter sends based on available credits**:

- **CRDT** (driven by the receiver): the receiver grants credits to the transmitter
- **VALID** (driven by the transmitter): the transmitter consumes one credit per transfer

```
        ┌───┐   ┌───┐   ┌───┐   ┌───┐   ┌───┐   ┌───┐
CLK     │   │   │   │   │   │   │   │   │   │   │   │
      ──┘   └───┘   └───┘   └───┘   └───┘   └───┘   └──
                    ┌───┐           ┌───┐
CRDT    ────────────┘   └───────────┘   └───────────────
                            ┌───┐           ┌───┐
VALID   ────────────────────┘   └───────────┘   └───────
```

**Core constraint:** VALID may only be asserted when the **credit count > 0**; otherwise, VALID must remain LOW.

### 2.2 Credited Flow Control Rules

| Rule | Description |
|------|-------------|
| 🔄 Reset state | Tx has zero credits; Rx holds all available credits |
| ➕ Credit acquisition | Each CRDT bit asserted HIGH grants Tx one credit |
| ➖ Credit consumption | Each cycle VALID is asserted consumes one credit |
| 📊 Credit limits | Minimum 1 credit per RP; maximum 15 per RP + 15 shared credits |
| 🚫 No combinational paths | Credit signals and other channel signals must not have combinational paths |

A critical distinction: credits **cannot be granted and consumed in the same cycle**, which eliminates combinational paths and is highly beneficial for timing closure 🎯.

### 2.3 Resource Planes

One of the most significant features of Credit-Based Transport is **Resource Planes (RP)** 🔀. Each channel can be configured with **1–8 Resource Planes**:

- Each RP has an **independent credit pool** 💎
- Transfers on different RPs **do not block each other**
- The `RP` signal indicates which RP a transfer belongs to
- AW and W transfers within the same transaction must use the same RP number

**Use cases:** deadlock avoidance, QoS traffic separation. For example, assigning high-priority and low-priority traffic to different RPs ensures that high-priority traffic is never blocked by low-priority traffic.

### 2.4 Shared Credits

When throughput varies significantly across RPs, shared credits improve buffer utilization 📦:

- **CRDTSH**: the receiver grants one shared credit
- **SHAREDCRD**: the transmitter indicates that the current transfer is using a shared credit
- Shared credits can be used by **any RP**
- It is recommended to prefer dedicated credits and reserve shared credits for RPs that have exhausted their dedicated pool

### 2.5 PENDING Signal and Clock Gating

Credit-Based Transport introduces the **PENDING** signal for transfer-level clock gating ⚡:

- PENDING is asserted one cycle before VALID, providing advance notice of an upcoming transfer
- The receiver can use this to proactively enable its clock, saving power
- PENDING is independent of the credit mechanism — false previews are permitted (PENDING asserted without a subsequent VALID)

---

## 3. ⚖️ Comparison

| Feature | Valid-Ready 🤝 | Credit-Based 💳 |
|---------|-------------|--------------|
| **Flow control** | Bidirectional handshake | Rx grants credits; Tx consumes credits |
| **Back-pressure** | READY deasserted | Credits withheld |
| **Combinational paths** | Possible between VALID/READY | None on credit signals |
| **Timing friendliness** | Moderate | Excellent (no combo paths) |
| **Independent traffic streams** | Not supported | Supported via RPs (1–8) |
| **Buffer flexibility** | Fixed | Shared credits improve utilization |
| **Clock gating** | Not supported | PENDING signal support |
| **Signal overhead** | Low (VALID + READY) | Higher (VALID + CRDT + PENDING + RP + SHAREDCRD) |
| **Typical use case** | Simple, low-speed links | High-performance, multi-stream, low-power |
| **Since version** | Original AXI | AXI5 Issue L |

---

## 4. 🤔 How to Choose?

**Use Valid-Ready when:**
- 📎 Simple point-to-point connections
- 🐢 Timing is not critical
- 🚫 No need for traffic isolation
- 📉 Minimizing signal count is a priority

**Use Credit-Based when:**
- ⏱️ High-frequency designs requiring elimination of combinational paths
- 🔀 Traffic isolation is needed (deadlock avoidance or QoS)
- ⚡ Transfer-level clock gating is desired for power reduction
- 🌐 Interconnect scenarios requiring flexible buffer management

---

## 5. 🎯 Conclusion

AXI5 retains the classic Valid-Ready handshake while introducing Credit-Based Transport — a significant evolution for high-performance SoC design. The credit mechanism improves timing by eliminating combinatic paths, Resource Planes provide traffic isolation, Shared Credits optimize buffer utilization, and the PENDING signal enables fine-grained clock gating.

For next-generation high-performance SoC designs, Credit-Based Transport offers a more flexible and performant alternative 🚀.

---

📖 **Reference:** ARM IHI0022L, *AMBA AXI Protocol Specification*, Issue L, August 2025

---

👍 If you enjoyed this post, feel free to give it a like! Comments and discussions are also welcome 💬
