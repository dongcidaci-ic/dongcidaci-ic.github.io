---
title: "2.4 📖 CHI Read & Write Transactions: From Allocating Reads to CopyBack Writes"
date: 2026-06-03
categories: [Cache]
tags: [chi, amba, protocol, coherence, read, write, transaction]
order: 10
---

CHI defines a rich set of data movement transactions. This post covers the two Read categories and six Write categories from the CHI specification (Chapter B2.3.1–B2.3.2), with flow diagrams and comparison tables.

## 1️⃣ Read Transactions: Two Categories

Read transactions in CHI fall into two categories based on whether the requester caches the returned data.

| Category | Transactions | Key Difference |
|----------|-------------|----------------|
| **Allocating Read** | ReadClean / ReadNotSharedDirty / ReadShared / ReadUnique / ReadPreferUnique / MakeReadUnique | Data **is cached** in the requester's cache |
| **Non-allocating Read** | ReadNoSnp / ReadOnce / ReadOnceCleanInvalid / ReadOnceMakeInvalid | Data is **not cached**; read and discard |

---

### 📥 Allocating Read

This is the most fundamental CHI transaction flow. Once you understand it, everything else is a variation.

**Six Allocating Read requests:**

| Request | Desired cache state | When to use? |
|---------|-------------------|--------------|
| ReadShared | SC | Read-only access; the most common read |
| ReadUnique | UC → UD | Preparing to **write**! Need exclusive ownership |
| ReadClean | UC | Want clean data, don't want writeback responsibility |
| ReadNotSharedDirty | UC or SC | Don't want SD state |
| ReadPreferUnique | UC (can downgrade to SC) | Prefer exclusive but not required |
| MakeReadUnique | UC | Already have SC, just need permission upgrade, **no data return needed** |

💡 **The two most important**: `ReadShared` (read-only) and `ReadUnique` (prepare to write). The rest are edge cases.

**Six Home processing methods:**

```
Requester issues Allocating Read
         │
         ▼
    ┌─── Home ──────────────────────────────────────────┐
    │                                                    │
    │  Method 1:       Method 2:             Method 3:  │
    │  Combined resp   Split resp+data       From SN    │
    │  CompData        RespSepData +          (combined) │
    │  (data+resp      DataSepResp            ReadNoSnp  │
    │   together)      (resp first, data      → CompData │
    │                  later)                            │
    │                                                    │
    │  Method 4:       Method 5:             Method 6:  │
    │  From SN         Forwarding Snoop      MakeRead-   │
    │  (split)         (DCT direct            Unique     │
    │  RespSepData      transfer)             Comp only  │
    │  + ReadNoSnpSep  Snp*Fwd →              (no data   │
    │  + DataSepResp   CompData +             needed)    │
    │                  SnpRespFwded                      │
    └────────────────────────────────────────────────────┘
```

**Method 1: Combined response (CompData)**

```
RN-F ──ReadShared──→ HN-F ──CompData──→ RN-F
```

Home has the data locally (internal cache or previously buffered) and sends response + data in one message.

💡 **Analogy**: Going to the library—the librarian finds the book at the front desk and hands it to you directly.

**Method 2: Split response and data (RespSepData + DataSepResp)**

```
RN-F ──ReadShared──→ HN-F ──RespSepData──→ RN-F   ("I can handle this")
                       HN-F ──DataSepResp──→ RN-F   (data follows later)
```

Home quickly confirms it can process the request (sends response), but data isn't ready yet (needs fetching). After receiving RespSepData, the requester can send CompAck without waiting for data.

💡 **Why split?** The requester can release its TxnID upon receiving RespSepData—meaning it can issue new requests without waiting for data. **This is a key throughput optimization.**

**Method 3: Fetch from SN, combined return (DMT)**

```
RN-F ──ReadShared──→ HN-F ──ReadNoSnp──→ SN-F
                       SN-F ──CompData──→ RN-F   (SN sends directly to requester!)
```

Home doesn't have data and fetches from SN (memory controller). The SN sends CompData **directly to the requester**—this is **DMT (Direct Memory Transfer)**.

💡 Note: CompData's TgtID points to the requester, not Home. SN bypasses Home.

**Method 4: Fetch from SN, split return**

```
RN-F ──ReadShared──→ HN-F ──RespSepData──→ RN-F   (Home sends response first)
                       HN-F ──ReadNoSnpSep──→ SN-F  (request pure data from SN)
                       SN-F ──DataSepResp──→ RN-F   (SN sends data directly to requester)
```

The difference from Method 3: Method 3 has SN send CompData (combined response+data), Method 4 has SN send only DataSepResp (pure data, response already sent by Home separately).

💡 **Method 4 advantage**: Home can send RespSepData sooner (even before SN confirms), letting the requester release resources earlier.

**Method 5: Forwarding Snoop (DCT) ⭐⭐⭐⭐**

The most interesting part! Home discovers **another RN-F holds this cache line** and instructs that RN-F to forward data directly to the requester—bypassing Home!

```
RN-F1 ──ReadShared──→ HN-F ──Snp*Fwd──→ RN-F2
                        RN-F2 ──CompData──→ RN-F1   (RN-F2 sends directly to RN-F1!)
                        RN-F2 ──SnpRespFwded──→ HN-F  (notify Home "I forwarded")
```

Snoopee (RN-F2) has four sub-methods:

| Sub-method | Snoopee → Requester | Snoopee → Home | Meaning |
|------------|-------------------|---------------|---------|
| **5a** | CompData | SnpRespFwded | Forward data, just notify Home |
| **5b** | CompData | SnpRespDataFwded | Forward data + **send copy to Home** (e.g., Home needs to update memory) |
| **5c** | ❌ | SnpResp | Forward failed (RSP channel), Home must use another method |
| **5d** | ❌ | SnpRespData / SnpRespDataPtl | Forward failed (DAT channel), Home must use another method |

💡 **5a is most common**: RN-F2 sends data directly to RN-F1 and just tells Home "done". Home updates its directory.

💡 **When to use 5b?** RN-F2 holds **dirty data** (UD/SD) and must also supply data to Home for writeback or directory update.

💡 **5c/5d are fallbacks**: The snoopee cannot forward for some reason (e.g., it's evicting that line). Home must complete the transaction using Methods 1–4. **DCT is not mandatory—the snoopee can decline.**

**Method 6: MakeReadUnique specific**

```
RN-F ──MakeReadUnique──→ HN-F ──Comp──→ RN-F
```

The requester **already has the data in SC state** and only needs permission upgrade from Shared to Unique. No data return is needed—Home just snoops to invalidate other RN copies and replies Comp.

💡 **MakeReadUnique requires no data transfer**—only a **permission change**. This is very efficient in write-heavy scenarios: first ReadShared, then only MakeReadUnique when writing.

**Transaction completion: CompAck**

Allocating Read transactions are completed when the requester sends CompAck to Home.

```
... CompData arrives at RN-F ...
RN-F ──CompAck──→ HN-F    ← transaction formally ends
```

💡 CompAck can be sent after receiving CompData, Comp, or RespSepData. If RespSepData is received, CompAck **need not wait for DataSepResp**—again, reducing latency.

---

### 👁️ Non-allocating Read

Nearly identical to Allocating Read, with these differences:

| Aspect | Allocating Read | Non-allocating Read |
|--------|----------------|---------------------|
| Data cached in requester? | ✅ Yes | ❌ No |
| CompAck | **Must send** | **Optional** (only if ExpCompAck=1) |
| Typical use | CPU core reads memory | IO device reads, debugger peek |
| ReadReceipt | Not needed | Required when ordering matters |

**Non-allocating Read transactions:**

| Request | Meaning |
|---------|---------|
| ReadNoSnp | Read non-coherent address (no snoop) |
| ReadOnce | Read once, don't cache |
| ReadOnceCleanInvalid | Read once + writeback + invalidate other copies |
| ReadOnceMakeInvalid | Read once + force invalidate all copies |

**Key differences from Allocating Read:**

1. **ReadReceipt**: When a Non-allocating Read has ordering requirements (Order != 00), Home must return ReadReceipt to tell the requester "I received your request, ordering guarantee established"—so the requester can release its TxnID.

2. **CompAck is optional**: Allocating Read must always send CompAck. Non-allocating Read only sends it when ExpCompAck=1.

3. **DMT/DCT completion differs**: In Non-allocating Read with DCT, Home confirms completion via SnpRespFwded / SnpRespDataFwded, not CompAck.

💡 **When to use Non-allocating Read?** IO devices (RN-I/RN-D) reading memory → ReadNoSnp. Debug/diagnostic reads → ReadOnce. DMA engine → ReadNoSnp.

💡 **ReadReceipt significance**: In Allocating Read, CompAck tells Home "transaction complete." But Non-allocating Read might not send CompAck—so how does Home know? Answer: ReadReceipt from the subordinate serves as the "receipt" allowing Home to confirm completion.

---

### 📊 Read Transaction Quick Reference

| Feature | Allocating Read | Non-allocating Read |
|---------|----------------|---------------------|
| Cache in requester | ✅ | ❌ |
| Transaction types | ReadShared/ReadUnique/ReadClean/ReadNotSharedDirty/ReadPreferUnique/MakeReadUnique | ReadNoSnp/ReadOnce/ReadOnceCleanInvalid/ReadOnceMakeInvalid |
| CompAck | Must send | Optional (only if ExpCompAck=1) |
| ReadReceipt | Not involved | Home must return when ordering required |
| DMT | ✅ | ✅ |
| DCT | ✅ | ✅ |
| Home completion signal | CompAck | ReadReceipt or SnpRespFwded/SnpRespDataFwded or CompAck |

---

## 2️⃣ Write Transactions: Six Categories

Write transactions are the most complex part of CHI—with more variants than reads. The core questions: **Who is writing? Where to? Does data stay in cache after write? Should we do CMO while we're at it?**

| Write Category | From cache eviction? | Data payload needed? | With CMO? | Typical scenario |
|---------------|---------------------|---------------------|-----------|-----------------|
| **Immediate Write** | ❌ No | ✅ Yes | ❌ No | CPU write, IO DMA |
| **Write Zero** | ❌ No | ❌ No (zeros, no payload!) | ❌ No | memset/bzero |
| **CopyBack Write** | ✅ Yes | ✅ Yes | ❌ No | Cache line eviction writeback |
| **Combined Imm + CMO** | ❌ No | ✅ Yes | ✅ Normal CMO | Write + cache clean in one step |
| **Combined Imm + Persist CMO** | ❌ No | ✅ Yes | ✅ Persist CMO | Write + persistence guarantee |
| **Combined CopyBack + CMO** | ✅ Yes | ✅ Yes | ✅ CMO | Eviction writeback + cache clean |

💡 **One-liner distinctions**:
- **Immediate** = "I need to write now" (active write)
- **CopyBack** = "My cache is full, dirty line must go back" (passive eviction)
- **Zero** = "Write all zeros, no payload needed"
- **Combined** = "Write + CMO in one transaction, save a round trip"

---

### ✏️ Immediate Write

**"I need to write to memory right now, data travels with the request."**

Immediate Write is the most common write transaction. The requester has data to send downstream (Home → SN), and the data travels as a payload with the request.

**Included transactions:**

| Transaction | Meaning | When to use? |
|------------|---------|-------------|
| WriteNoSnpPtl | Write non-coherent address, partial | IO device register write, a few bytes |
| WriteNoSnpFull | Write non-coherent address, full line | IO DMA write full line |
| WriteNoSnpDef | Write non-coherent address, definite | Non-speculative write |
| WriteUniquePtl | Write coherent address, partial, snoop needed | CPU write memory, a few bytes |
| WriteUniqueFull | Write coherent address, full line, snoop needed | CPU write full line |
| WriteUniquePtlStash | Same as WriteUniquePtl + Stash | Write + push data to another RN |
| WriteUniqueFullStash | Same as WriteUniqueFull + Stash | Write + push data to another RN |

💡 **NoSnp vs Unique**:
- **NoSnp**: Write to non-coherent address (Device space), Home doesn't snoop
- **Unique**: Write to coherent address (Normal Cacheable space), Home must snoop to invalidate other RN copies

💡 **Ptl vs Full**:
- **Ptl** (Partial): Write only part of a cache line, needs Byte Enable marking
- **Full**: Write entire 64B cache line

**Three flow paths:**

**Path 1: DWT (Direct Write Transfer)**

```
RN-F ──WriteUniqueFull──→ HN-F ──WriteNoSnpFull(DoDWT=1)──→ SN-F
SN-F ──DBIDResp──→ RN-F          ← SN tells RN "you can send data"
RN-F ──NonCopyBackWriteData──→ SN-F   ← RN sends data directly to SN!
SN-F ──Comp──→ HN-F               ← SN tells Home "write done"
HN-F ──Comp──→ RN-F               ← Home tells RN "transaction complete"
```

💡 **DWT essence**: RN sends data directly to SN, bypassing Home! Just like DMT/DCT for reads. The key signal is `DoDWT=1`.

💡 **DBIDResp before data**: SN first sends DBIDResp telling RN "buffer is ready," then RN can send data. This is CHI's **data buffering protocol**—you can't pour data into an unready buffer.

**Path 2: No DWT, no CompAck**

```
RN-F ──WriteNoSnpFull──→ HN-F
HN-F ──DBIDResp──→ RN-F          ← Home says "give me data"
RN-F ──NonCopyBackWriteData──→ HN-F    ← RN sends data to Home
HN-F ──Comp──→ RN-F               ← Home says "write done"
```

Or the combined version:
```
HN-F ──CompDBIDResp──→ RN-F      ← Combined: "give me data + transaction complete"
RN-F ──NonCopyBackWriteData──→ HN-F
```

💡 **CompDBIDResp = Comp + DBIDResp merged**. A common CHI "merge optimization"—reduces message count.

**Path 3: No DWT, with CompAck**

Same as Path 2, plus:
```
RN-F ──CompAck──→ HN-F            ← RN explicitly confirms "I know transaction completed"
```

Or combined:
```
RN-F ──NonCopyBackWriteDataCompAck──→ HN-F  ← data + confirmation together
```

💡 **CompAck purpose**: Lets Home know "the requester has received Comp," so Home can safely release internal resources. If Home has ordering-dependent transactions pending, CompAck is required.

💡 **WriteDataCancel**: Immediate Write has a special operation—the requester can **cancel** the write (sending WriteDataCancel instead of NonCopyBackWriteData). Used in speculative execution: the CPU speculatively issued a write request, then discovered it shouldn't have.

---

### 🕳️ Write Zero

**"Set an entire line to zeros—without transmitting data!"**

This is a clever CHI optimization: `memset(buf, 0, size)` is extremely common, but the traditional approach requires transmitting an entire 64B all-zero payload, wasting bandwidth.

```
RN-F ──WriteNoSnpZero──→ HN-F    ← Request: set target address to all zeros
HN-F ──DBIDResp──→ RN-F          ← "Acknowledged" (no need to send data!)
HN-F ──Comp──→ RN-F              ← "Already zeroed"
```

Or combined:
```
HN-F ──CompDBIDResp──→ RN-F      ← "Acknowledged + completed"
```

**Included transactions:**
- WriteNoSnpZero: Write non-coherent address to all zeros
- WriteUniqueZero: Write coherent address to all zeros (snoop needed)

💡 **Why no Ptl version?** Write Zero writes an entire line to zero; there's no "partial zero" scenario. If you only want to clear some bytes, use WriteNoSnpPtl + data payload.

💡 **How much is saved?** A 64B cache line data transfer is eliminated; only control messages (DBIDResp + Comp or CompDBIDResp) are needed. In high-bandwidth scenarios (large array zeroing), this optimization significantly reduces interconnect data traffic.

---

### 🔄 CopyBack Write

**"My cache is full, dirty line must be written back to memory."**

The **fundamental difference** between CopyBack Write and Immediate Write:

| Aspect | Immediate Write | CopyBack Write |
|--------|----------------|----------------|
| **Data source** | Requester's newly generated data | Dirty line from cache eviction |
| **Data stays in cache after write?** | Maybe | ❌ No! Evicted means given up |
| **Data type** | NonCopyBackWriteData | CopyBackWriteData |
| **CAH (CopyAtHome)** | Not involved | ⭐ Core field |
| **CompAck** | Determined by ExpCompAck | **Must send** when WriteEvictOrEvict or CAH=1 |

**Included transactions:**

| Transaction | Meaning |
|------------|---------|
| WriteBackPtl | Partial writeback (only some bytes valid, e.g., UDP state) |
| WriteBackFull | Full line writeback |
| WriteCleanFull | Writeback clean data (matches memory, Home can decline) |
| WriteEvictFull | Evict full line |
| WriteEvictOrEvict | Evict or abandon (Home decides whether it wants data) |

💡 **WriteCleanFull vs WriteBackFull**: WriteCleanFull says "my data matches memory," so Home can choose not to receive data (saving bandwidth). WriteBackFull says "I've modified it," so Home must receive it.

💡 **WriteEvictOrEvict**: The most flexible—requester says "I'm evicting this line, take it or leave it." If Home has a local copy (CAH=1), it can reply Comp (don't want data); otherwise CompDBIDResp (want data).

**Core mechanism: CAH (CopyAtHome) ⭐⭐⭐**

CAH is a key field unique to CopyBack Write. It tells Home: "When I last wrote back, did you keep a copy at the Home side?"

```
CAH = 1 (Home has a copy)
┌─────────────────────────────────────────────┐
│  Method 1a: Home doesn't want data           │
│  HN-F ──Comp──→ RN-F                        │
│  RN-F ──CompAck──→ HN-F                     │
│  (Home already has data, no need to resend!) │
│                                              │
│  Method 1b: Home wants data                  │
│  HN-F ──CompDBIDResp──→ RN-F                │
│  RN-F ──CopyBackWriteData──→ HN-F           │
└─────────────────────────────────────────────┘

CAH = 0 (Home doesn't have a copy)
┌─────────────────────────────────────────────┐
│  Only one method:                            │
│  HN-F ──CompDBIDResp──→ RN-F                │
│  RN-F ──CopyBackWriteData──→ HN-F           │
│  (Home must have data)                       │
└─────────────────────────────────────────────┘
```

💡 **CAH=1 significance**: Home previously cached a copy (Copy At Home). When RN evicts this line, Home can choose "I already have a copy, no need to send data"—saving another 64B data transfer!

💡 **CompAck is mandatory in CopyBack** (when CAH=1 or WriteEvictOrEvict), even if ExpCompAck=0. Because Home needs confirmation that "the requester knows Home's decision" (want data or not) before safely updating directory state.

---

### 🧹 Combined Immediate Write and CMO

**"Write data and clean the cache in one step."**

The core idea: write operations and CMO (Cache Maintenance Operation) often appear together. For example, "after writing, ensure other caches' stale copies are invalidated"—doing this in two steps requires two transactions; merging into one saves a round trip.

**Included transactions:**

| Transaction | Write type | CMO type |
|------------|-----------|---------|
| WriteNoSnpPtlCleanInv | Partial write + CMO | Clean & Invalidate |
| WriteNoSnpFullCleanInv | Full line write + CMO | Clean & Invalidate |
| WriteNoSnpPtlCleanSh | Partial write + CMO | Clean to Shared |
| WriteNoSnpFullCleanSh | Full line write + CMO | Clean to Shared |
| WriteUniquePtlCleanSh | Unique partial write + CMO | Clean to Shared |
| WriteUniqueFullCleanSh | Unique full line write + CMO | Clean to Shared |
| WriteNoSnpPtlCleanInvPoPA | Partial write + CMO | CleanInv to PoPA |
| WriteNoSnpFullCleanInvPoPA | Full line write + CMO | CleanInv to PoPA |
| WriteUniqueFullCleanInvStrg | Unique full write + CMO | CleanInv Strong |
| WriteNoSnpFullCleanInvStrg | NoSnp full write + CMO | CleanInv Strong |

💡 **Naming rule**: `Write{Type}{CMOType}`, e.g., `WriteNoSnpFullCleanInv` = WriteNoSnp Full + CleanInv CMO.

**Flow is basically the same as Immediate Write, plus CompCMO:**

```
... normal Immediate Write flow (DBIDResp → data → Comp) ...
HN-F ──CompCMO──→ RN-F            ← CMO completion response (extra message!)
```

💡 **Comp vs CompCMO**: Comp means "write complete," CompCMO means "CMO complete." These are independent—write may complete before CMO (because CMO may involve snooping other RNs).

💡 **Home's three strategies:**

| Strategy | Approach | Applicable when |
|----------|---------|----------------|
| 1. Combined Write to SN + DWT | Merge write + CMO and send to SN | SN supports Combined operations |
| 2. Split: normal Write + DWT | Write data first (DWT), handle CMO separately | SN doesn't support Combined |
| 3. No DWT | Normal Home-relayed write flow + CMO | DWT not desired |

---

### 💾 Combined Immediate Write and Persist CMO

**"Write data + guarantee persistence—survives power loss."**

Difference from Combined Imm + CMO: the CMO is **Persist** type—guaranteeing data has been written to persistent storage (e.g., NVM), surviving power loss.

**Included transactions:**

| Transaction | Meaning |
|------------|---------|
| WriteNoSnpPtlCleanShPerSep | NoSnp partial write + CleanSharedPersistSep CMO |
| WriteNoSnpFullCleanShPerSep | NoSnp full write + CleanSharedPersistSep CMO |
| WriteUniquePtlCleanShPerSep | Unique partial write + CleanSharedPersistSep CMO |
| WriteUniqueFullCleanShPerSep | Unique full write + CleanSharedPersistSep CMO |

**Flow = Combined Imm + CMO + Persist response:**

```
... normal write flow + Comp + CompCMO ...
SN-F ──Persist──→ RN-F            ← Persist response: data is persisted!
```

Or combined (from Home):
```
HN-F ──CompPersist──→ RN-F       ← CompCMO + Persist merged
```

💡 **Three responses in order**: Comp (write complete) → CompCMO (CMO complete) → Persist (persistence confirmed). The requester can only be certain "data won't be lost" after receiving Persist.

💡 **Why Persist?** In systems with NVM (Non-Volatile Memory), write operations may still be in SRAM buffers and would be lost on power failure. Persist confirms data has actually been written to the NVM media.

---

### 🔁 Combined CopyBack Write and CMO

**"Eviction writeback + CMO in the same transaction."**

This combines CopyBack Write with CMO. Essentially CopyBack flow + CompCMO.

**Included transactions:**

| Type | Transaction | Has Persist? |
|------|------------|-------------|
| No Persist | WriteBackFullCleanInv | ❌ |
| No Persist | WriteBackFullCleanSh | ❌ |
| No Persist | WriteCleanFullCleanSh | ❌ |
| No Persist | WriteBackFullCleanInvPoPA | ❌ |
| No Persist | WriteBackFullCleanInvStrg | ❌ |
| With Persist | WriteBackFullCleanShPerSep | ✅ |
| With Persist | WriteCleanFullCleanShPerSep | ✅ |

**No Persist flow** (similar to normal CopyBack + CompCMO):
```
... CopyBack Write flow (CAH determines whether data is sent) ...
HN-F ──CompCMO──→ RN-F            ← CMO complete
```

**With Persist flow** (additional Persist response):
```
... CopyBack Write flow + CompCMO ...
HN-F ──Persist──→ RN-F            ← or from SN
```

Or combined:
```
HN-F ──CompPersist──→ RN-F       ← CompCMO + Persist merged
```

💡 **Why fewer transaction types than Combined Immediate?** CopyBack is an eviction scenario—eviction rarely needs Ptl/Stash variants. Eviction typically writes back a full line, so most are Full versions.

---

## 📊 Write Transaction Quick Reference

| Feature | Immediate | Zero | CopyBack | Imm+CMO | Imm+Persist | CopyBack+CMO |
|---------|-----------|------|----------|---------|-------------|--------------|
| Data source | Active write | All zeros (no payload) | Eviction | Active write | Active write | Eviction |
| Payload needed | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| DWT support | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| CMO response | ❌ | ❌ | ❌ | ✅ CompCMO | ✅ CompCMO | ✅ CompCMO |
| Persist response | ❌ | ❌ | ❌ | ❌ | ✅ Persist | Optional |
| CAH mechanism | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| CompAck | ExpCompAck decides | ❌ | Mandatory when CAH=1 | ExpCompAck decides | ExpCompAck decides | Mandatory when CAH=1 |
| Data type | NonCopyBackWriteData | None | CopyBackWriteData | NonCopyBackWriteData | NonCopyBackWriteData | CopyBackWriteData |
| Typical scenario | CPU/IO write | memset | Cache eviction | Write + cache clean | Write + persistence | Eviction + cache clean |

💡 **Mnemonic**:
- **Immediate** = active write, with data → most common
- **Zero** = all-zero write, no payload → memset optimization
- **CopyBack** = eviction write, CAH decides whether to send → cache replacement
- **+CMO** = cache clean on the side, extra CompCMO → saves a transaction
- **+Persist** = persistence guarantee on the side, extra Persist → NVM scenario

---

📖 **Reference:** ARM IHI 0050H, *AMBA CHI Architecture Specification*, Chapter B2.3

---

👍 If you found this post helpful, give it a like! Questions and discussions are welcome in the comments 💬
