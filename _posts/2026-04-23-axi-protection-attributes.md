---
title: "1.1.3&nbsp;&nbsp;AXI Protection Attributes – From AxPROT to AxPAS"
date: 2026-04-23
last_modified_at: 2026-04-23
order: 3
categories: [AMBA, AXI]
tags: [axi, protection, axprot, axpas, rme, security]
---

## 1. 🧭 Introduction

In a secure SoC, not every component should be able to access every memory region. A DMA controller shouldn't read secure kernel memory; an unprivileged application shouldn't touch privileged system registers. **Protection attributes** are the AXI mechanism that carries access permission information alongside every transaction 🛡️

AXI5 introduces a **new generation of protection signals** that supersede the legacy AxPROT/AxNSE scheme. This post explains both the old and new signaling, their relationship, and the security model they enable.

---

## 2. 🔄 The Evolution: Old vs New Signals

### 2.1 Legacy Signals (AxPROT + AxNSE)

The original AXI protection model used two signals:

| Signal | Width | Bits | Meaning |
|--------|-------|------|---------|
| AxPROT | 3 | [0] | Privileged (1) / Unprivileged (0) |
| | | [1] | Non-secure (1) / Secure (0) |
| | | [2] | Instruction (1) / Data (0) |
| AxNSE | 1 | - | Extends AxPROT[1] to support Root and Realm (when RME enabled) |

### 2.2 New Signals (AxPRIV + AxINST + AxPAS)

AXI5 introduces a cleaner decomposition:

| Signal | Width | Default | Meaning |
|--------|-------|---------|---------|
| AxPRIV | 1 | 0 | Privileged (1) / Unprivileged (0). Equivalent to AxPROT[0] |
| AxINST | 1 | 0 | Instruction (1) / Data (0). Equivalent to AxPROT[2] |
| AxPAS | PAS_WIDTH | 0 | Physical Address Space identifier |

### 2.3 The Key Rule: Mutually Exclusive ⚠️

> **An interface must not include both sets of signals!**

| Rule | Reason |
|------|--------|
| If PROT_Present = True → PAS_WIDTH must be 0 | Can't use AxPROT and AxPAS together |
| If PROT_Present = True → INSTPRIV_Present must be False | Can't use AxPROT and AxPRIV/AxINST together |

This is a **hard architectural rule** — you pick one scheme or the other, never both 🚫

### 2.4 Why the Change?

The old AxPROT encoding packed three independent concepts into one 3-bit signal, which made extension difficult:

- AxPROT[1] only distinguishes Secure vs Non-secure — **no room for more security states**
- AxNSE was bolted on as a patch for RME, creating a confusing 2-signal split
- AxPROT[2] (Instruction) is mixed in with security bits — **orthogonal concerns entangled**

The new scheme cleanly separates the three dimensions:

```
AxPRIV  → Who am I? (privilege level)
AxINST  → What am I doing? (instruction vs data)
AxPAS   → Where am I allowed to go? (security domain)
```

Each dimension is an independent signal, making future extensions natural 🎯

---

## 3. 🔐 Physical Address Space (PAS)

The most significant innovation is **AxPAS** — a Physical Address Space identifier that generalizes the old Secure/Non-secure binary into a multi-domain security model.

### 3.1 PAS Encodings

| Physical Address Space | AxPAS | AxPROT[1] | AxNSE | Required Property |
|----------------------|-------|-----------|-------|-------------------|
| **Secure** | 0b000 | 0b0 | 0b0 | — |
| **Non-secure (NS)** | 0b001 | 0b1 | 0b0 | — |
| **Root** | 0b010 | 0b0 | 0b1 | RME_Support |
| **Realm** | 0b011 | 0b1 | 0b1 | RME_Support |
| **System Agent (SA)** | 0b100 | — | — | GDI_Support |
| **Non-secure Protected (NSP)** | 0b101 | — | — | GDI_Support |

> 💡 Notice: Secure and Non-secure exist in both old (AxPROT[1]/AxNSE) and new (AxPAS) encodings. Root, Realm, SA, and NSP are **only available** through AxPAS.

### 3.2 The Security Hierarchy

```
                    ┌─────────────┐
                    │    Root      │  ← Highest privilege, boot firmware
                    │  (RME only)  │
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              │                         │
       ┌──────┴──────┐          ┌───────┴───────┐
       │   Secure    │          │    Realm       │
       │             │          │  (RME only)    │
       └──────┬──────┘          └───────┬────────┘
              │                         │
              └────────────┬────────────┘
                           │
                    ┌──────┴──────┐
                    │ Non-secure  │  ← Normal world, applications
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
       ┌──────┴──────┐          ┌───────┴───────┐
       │  NSP (GDI)  │          │  SA (GDI)     │
       │ Media/DRM   │          │ Isolated DMA  │
       └─────────────┘          └───────────────┘
```

### 3.3 Same Address, Different Worlds

The key concept: **the same physical address in different PAS can map to different physical memory**.

For example, address `0x8000_0000` in Secure PAS and the same address in Non-secure PAS may point to completely different locations. This is how the hardware enforces isolation — even if a Non-secure component guesses a Secure address, it accesses its **own** Non-secure version of that address, not the Secure one 🔒

---

## 4. 👑 Privileged and Instruction Attributes

### 4.1 Privilege Level

| AxPRIV / AxPROT[0] | Meaning |
|:---:|---------|
| 0 | **Unprivileged** — user-level access (application code) |
| 1 | **Privileged** — system-level access (OS kernel, hypervisor) |

AXI only distinguishes two levels. If a processor supports more privilege levels (e.g., EL0–EL3 in ARMv9), the mapping is IMPLEMENTATION DEFINED.

### 4.2 Instruction vs Data

| AxINST / AxPROT[2] | Meaning |
|:---:|---------|
| 0 | **Data access** — reading/writing data |
| 1 | **Instruction access** — fetching instructions |

> ⚠️ This is defined as a **hint**, not a guarantee! A transaction might contain a mix of instruction and data items. It's recommended to indicate data access unless the access is **known** to be an instruction fetch.

**Why does it matter?** Some memory regions (like code ROM) might be instruction-only, or an I-cache might use this hint to decide whether to allocate a line 💡

---

## 5. 🏰 Realm Management Extension (RME)

RME is ARM's hardware-based isolation architecture that extends the traditional Secure/Non-secure dichotomy with two new security states: **Root** and **Realm**.

### 5.1 The Four Worlds

| World | PAS | Purpose | Example |
|-------|-----|---------|---------|
| **Root** | 0b010 | Root of trust, boot firmware | Secure monitor, RME initialization |
| **Secure** | 0b000 | Trusted execution, secrets | TEE, secure peripherals |
| **Realm** | 0b011 | Confidential computing | Cloud VM isolation (CCA) |
| **Non-secure** | 0b001 | Normal operation | Rich OS, applications |

### 5.2 Why RME Matters for AXI

When RME is enabled (RME_Support = True):

- AxNSE signal is added (if using legacy AxPROT) to encode Root/Realm
- AxPAS can directly encode all 4 states (if using new signals)
- Cache maintenance operations are affected
- MPAM (Memory System Resource Partitioning) signals are extended

### 5.3 RME + GDI: The Full Picture

**Granular Data Isolation (GDI)** extends RME with two more PAS:

| PAS | Purpose |
|-----|---------|
| **System Agent (SA)** | Isolated DMA subsystems — fully isolated from PEs, independent memory management |
| **Non-secure Protected (NSP)** | Media pipelines — confidential data flows managed by SMMU on behalf of devices |

PEs cannot directly access SA or NSP (except for cache maintenance through PoPA). This prevents a compromised OS from reading media DRM keys or DMA buffers 🔐

**Dependency chain:** GDI requires RME. If RME_Support = False, GDI_Support must also be False.

---

## 6. 📊 Signal Mapping Summary

### 6.1 Old → New Mapping

| Old Signal | Old Bit | New Signal | Notes |
|-----------|---------|------------|-------|
| AxPROT[0] | Privileged | AxPRIV | Direct 1:1 mapping |
| AxPROT[1] | Non-secure | AxPAS[0] | Part of PAS encoding |
| AxPROT[2] | Instruction | AxINST | Direct 1:1 mapping |
| AxNSE | Root/Realm | AxPAS[1] | Part of PAS encoding |

### 6.2 Which Scheme Should You Use?

| Scenario | Recommended Scheme |
|----------|-------------------|
| Legacy design, no RME | AxPROT (PROT_Present = True) |
| New design with RME | AxPRIV + AxINST + AxPAS (INSTPRIV_Present = True, PAS_WIDTH > 0) |
| New design without RME | Either — but AxPRIV + AxINST is cleaner for future-proofing |

### 6.3 Property Constraints

| Configuration | PROT_Present | INSTPRIV_Present | PAS_WIDTH |
|---------------|:---:|:---:|:---:|
| Legacy only | True | False | 0 |
| New, no RME | False | True | 0 |
| New, with RME | False | True | 1–2 |
| New, with RME + GDI | False | True | 3 |

---

## 7. 📝 Key Takeaways

1. **AxPROT/AxNSE are superseded by AxPRIV/AxINST/AxPAS** — both sets cannot coexist on the same interface 🚫
2. **AxPAS generalizes the Secure/Non-secure binary** into a multi-domain security model supporting up to 6 Physical Address Spaces
3. **Same address, different PAS = different memory** — hardware isolation by design 🔒
4. **RME adds Root and Realm PAS** — enabling confidential computing (ARM CCA)
5. **GDI adds SA and NSP PAS** — isolating DMA and media pipelines from PEs
6. **AxINST is a hint, not a guarantee** — recommend data access unless known to be instruction fetch
7. **GDI depends on RME** — if RME_Support is False, GDI_Support must also be False

---

📖 **Reference:** ARM IHI0022L, *AMBA AXI Protocol Specification*, Issue L, August 2025, Chapter A4.5

---

👍 If you enjoyed this post, feel free to give it a like! Comments and discussions are also welcome 💬
