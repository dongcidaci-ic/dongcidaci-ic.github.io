---
title: "2.2&nbsp;&nbsp;PLRU Replacement Policy – Hardware Implementation of Pseudo Least Recently Used"
date: 2026-04-23
last_modified_at: 2026-04-23
categories: [MMU, Cache]
tags: [plru, replacement-policy, tlb, cache, hardware, rtl]
password: 190625
password_hash: 56d754f1
order: 7
---

## 1. 🧭 Introduction

In cache and TLB design, when a set is full and a new entry must be inserted, **which entry should be evicted?** The ideal answer is "the least recently used one" (LRU), but true LRU requires tracking the complete access order of every entry — expensive in both area and timing 🔥

**Pseudo LRU (PLRU)**, also known as **Tree-PLRU**, is the most popular approximation. It uses a binary tree of 1-bit direction flags to track recency, requiring only **N-1 bits** for N ways instead of O(N log N) for true LRU. This post dissects a real RTL implementation and explains every bit of how it works 🌳

---

## 2. 🌳 The PLRU Tree Structure

For an N-way associative set, PLRU uses a **complete binary tree** with N-1 internal nodes:

```
              node[0]          ← Level 0 (root)
             /      \
         node[1]   node[2]    ← Level 1
         /   \     /    \
       [3]  [4]  [5]   [6]   ← Level 2
       /\   /\   /\    /\
      0 1  2 3  4 5  6  7    ← Way indices (leaves)
```

**Key idea**: Each node stores a **1-bit direction flag**:
- `0` → points to the **left** subtree as "least recently used"
- `1` → points to the **right** subtree as "least recently used"

For 8 ways, we need 7 bits (nodes 0–6). For 4 ways, 3 bits. For 16 ways, 15 bits.

---

## 3. 🔍 How Replacement Works (Finding the Victim)

To find the replacement victim, **traverse the tree from root to leaf**, following the direction flags:

```
Example: plru_org = 7'b1_0_1_0_1_0 (nodes 0-6)

Step 1: node[0] = 1 → go RIGHT
Step 2: node[2] = 1 → go RIGHT
Step 3: node[6] = 0 → go LEFT
Result: Way 6 is the victim
```

The traversal path directly encodes the victim way index! Each bit of the way number is determined by one level of the tree 🎯

### RTL Implementation

```systemverilog
generate
  genvar m;
  for (m=0; m<ENTRY_W; m=m+1) begin: GEN_RPL
    if (m==0) begin: GEN_BIT0
      assign plru_rpl_o[ENTRY_W-1-m] = plru_org_i[0];  // MSB from root
    end
    else begin: GEN_BIT
      // Use previously computed bits to index into next level
      assign plru_rpl_o[ENTRY_W-1-m] = plru_org_i[2**m - 1 + plru_rpl_o[ENTRY_W-1 : ENTRY_W-m]];
    end
  end
endgenerate
```

**How it works step by step** (8-way, ENTRY_W=3):

| Step (m) | Computing | Meaning |
|:---:|-----------|---------|
| 0 | `plru_rpl_o[2] = plru_org_i[0]` | MSB of way index from root node |
| 1 | `plru_rpl_o[1] = plru_org_i[1 + plru_rpl_o[2]]` | Level 1 node selected by MSB |
| 2 | `plru_rpl_o[0] = plru_org_i[3 + plru_rpl_o[2:1]]` | Level 2 node selected by bits [2:1] |

This is a **sequential dependency chain** — each bit depends on the previously computed bits, just like walking down the tree level by level 👣

---

## 4. ✏️ How Update Works (After a Hit)

When a way is accessed (hit), we must update the tree to mark it as "most recently used." The rule is simple:

> **At every level, point the direction flag AWAY from the hit way**

If the hit way is on the left → set flag to 1 (point right, meaning "left was just used")
If the hit way is on the right → set flag to 0 (point left, meaning "right was just used")

### Quick Example: Way 7 vs Way 6

Consider an 8-way set with initial tree all 1s (pointing right):

```
              [0]=1
             /     \
          [1]=1   [2]=1
          / \     / \
        [3] [4] [5] [6]
         1   1   1   1
        /\  /\  /\  /\
       0 1 2 3 4 5 6 7
```

**If way 7 is hit** — direction flags point AWAY from way 7:

```
              [0]=0         ← flipped! was 1
             /     \
          [1]=1   [2]=0    ← flipped! was 1
          / \     / \
        [3] [4] [5] [6]=0  ← flipped! was 1
         1   1   1
```
Result: `[0,2,6] = (0, 0, 0)` — all three nodes on the path flip to 0 (point left, away from way 7)

**If way 6 is hit** — same upper path, but different leaf-level direction:

```
              [0]=0         ← flipped! same as way7
             /     \
          [1]=1   [2]=0    ← flipped! same as way7
          / \     / \
        [3] [4] [5] [6]=1  ← flipped to 1! different from way7
         1   1   1
```
Result: `[0,2,6] = (0, 0, 1)` — same upper bits, but node[6]=1 because way 6 is on the LEFT of node[6], so we point RIGHT

> 💡 **Key observation**: Way 6 and Way 7 share the same root path, but diverge at the last node. Way 6 → node[6]=1 (point right), Way 7 → node[6]=0 (point left). The left-child hit encoding naturally captures this!

Now let's see how the RTL implements this logic precisely ✨

---

## 5. 🧮 The Update Logic: Bottom-Up

The RTL uses two generate blocks to compute the update. Let's break them down.

### 5.1 Block 1: Compute Hit Propagation (Bottom-Up)

```systemverilog
generate
  genvar i, j;
  for (i=0; i<=ENTRY_W; i=i+1) begin: GEN_UPD
    if (i==ENTRY_W) begin: GEN_LAST_LVL
      // Leaf level: node = hit vector for that way
      for (j=0; j<2**i; j=j+1) begin
        assign w_plru_upd_node[2**i - 1 + j] = lkup_hit_i[j];
      end
    end
    else begin: GEN_UP_LVL
      // Internal level: node = OR of its two children
      for (j=0; j<2**i; j=j+1) begin
        assign w_plru_upd_node[2**i - 1 + j] = 
            w_plru_upd_node[(2**i - 1 + j)*2 + 1] || 
            w_plru_upd_node[(2**i - 1 + j)*2 + 2];
      end
    end
  end
endgenerate
```

This builds a **"hit tree"** from bottom up:

```
Leaf level (i=3, 8 nodes):  Each node = lkup_hit_i[way]  (1 if that way was hit)
Level 2   (i=2, 4 nodes):  Each node = OR of its two children
Level 1   (i=1, 2 nodes):  Each node = OR of its two children
Level 0   (i=0, 1 node):   Root = OR of all hits (should be 1 for a valid hit)
```

**Purpose**: For each tree node, `w_plru_upd_node[x] = 1` means "a hit occurred in this subtree." This tells us whether we need to update the direction flag at this node 📢

### 5.2 Block 2: Compute New Direction Flags

```systemverilog
generate
  genvar k, l;
  for (k=0; k<ENTRY_W; k=k+1) begin: GEN_PLRU
    for (l=0; l<2**k; l=l+1) begin: GEN_NODE
      assign plru_upd_o[2**k - 1 + l] = 
          w_plru_upd_node[2**k - 1 + l] ? 
          w_plru_upd_node[(2**k - 1 + l)*2 + 1] :   // Hit in this subtree → point away
          plru_org_i[2**k - 1 + l];                   // No hit → keep original
    end
  end
endgenerate
```

For each internal node:

| Condition | New Value | Meaning |
|-----------|-----------|---------|
| Hit in this subtree | `left_child_hit` | If left child's subtree was hit → 1 (point right, away from left) |
| No hit in this subtree | `plru_org_i` (unchanged) | No access, don't change direction |

**This is the key insight**: when a hit occurs in a node's subtree, the new direction flag equals the **left child's hit status**:
- Left child hit = 1 → new flag = 1 → "point right" (left was just used)
- Left child hit = 0 (right child hit) → new flag = 0 → "point left" (right was just used)

This elegantly encodes "point away from the hit" in a single combinational expression! 🎯

### 5.3 Walkthrough 1: Way 7 is Hit (initial tree all 1s)

```
lkup_hit_i = 8'b1000_0000  (way 7 hit)
```

**Step 1 - Build hit propagation tree (bottom-up):**

```
           w[0]=1               ← hit somewhere in subtree
          /      \
      w[1]=0    w[2]=1          ← left subtree NOT hit!
      /   \     /   \
   w[3]=0 w[4]=0 w[5]=0 w[6]=1  ← only right path propagates
   /  \   /  \  /  \   /  \
  0   0  0   0  0   0  0   1    ← only way7=1
```

> ⚠️ **Important**: w[1]=0, w[3]=0, w[4]=0, w[5]=0 — the LEFT subtrees have NO hit. This is crucial for Block 2!

**Step 2 - Compute new direction flags:**

| Node | Subtree hit? | Left child hit? | New value |
|:----:|:---:|:---:|:---:|
| [0] | w[0]=1 ✅ | w[1]=**0** | **0** (point LEFT, away from right where way7 is) |
| [1] | w[1]=0 ❌ | — | Keep original = 1 |
| [2] | w[2]=1 ✅ | w[5]=**0** | **0** (point LEFT, away from right where way7 is) |
| [3] | w[3]=0 ❌ | — | Keep original = 1 |
| [4] | w[4]=0 ❌ | — | Keep original = 1 |
| [5] | w[5]=0 ❌ | — | Keep original = 1 |
| [6] | w[6]=1 ✅ | w[13]=**0** | **0** (point LEFT, away from right where way7 is) |

Result: `plru_tree_n[0, 2, 6] = (0, 0, 0)` ✅ — matches the code comment!

### 5.4 Walkthrough 2: Way 6 is Hit (initial tree all 1s)

```
lkup_hit_i = 8'b0100_0000  (way 6 hit)
```

**Step 1 - Build hit propagation tree:**

```
           w[0]=1
          /      \
      w[1]=0    w[2]=1          ← same upper structure as way7!
      /   \     /   \
   w[3]=0 w[4]=0 w[5]=0 w[6]=1
   /  \   /  \  /  \   /  \
  0   0  0   0  0   0  1   0    ← way6=1, way7=0
```

**Step 2 - Compute new direction flags:**

| Node | Subtree hit? | Left child hit? | New value |
|:----:|:---:|:---:|:---:|
| [0] | w[0]=1 ✅ | w[1]=**0** | **0** (point LEFT) |
| [1] | w[1]=0 ❌ | — | Keep original = 1 |
| [2] | w[2]=1 ✅ | w[5]=**0** | **0** (point LEFT) |
| [3] | w[3]=0 ❌ | — | Keep original = 1 |
| [4] | w[4]=0 ❌ | — | Keep original = 1 |
| [5] | w[5]=0 ❌ | — | Keep original = 1 |
| [6] | w[6]=1 ✅ | w[13]=**1** | **1** (point RIGHT, away from LEFT where way6 is!) |

Result: `plru_tree_n[0, 2, 6] = (0, 0, 1)` ✅

> 💡 **Compare way6 vs way7**: Same upper path (nodes 0,2 → 0,0), but node[6] differs! Way 6 is on the LEFT of node[6], so w[13]=1 → new flag=1 (point right). Way 7 is on the RIGHT of node[6], so w[13]=0 → new flag=0 (point left). The left-child hit bit naturally distinguishes these two cases!

---

## 6. 🗺️ The Hit Tree as a Side-Effect Filter

A subtle but important detail: the hit tree (`w_plru_upd_node`) serves double duty:

1. **Filters which nodes to update** — only nodes on the path from root to the hit way get updated
2. **Determines the new direction** — the left child's hit bit directly becomes the new flag

This means **unrelated subtrees are completely untouched**, which is critical for correctness — we don't want a hit in way 5 to affect the direction flags for the subtree containing ways 0-3 🛡️

---

## 7. 📊 PLRU vs True LRU vs Other Policies

| Policy | Storage (8-way) | Accuracy vs LRU | Hardware Complexity |
|--------|:---:|---|---|
| **True LRU** | 16 bits (3 bits/way × 8 + overflow) | 100% | High — full order tracking |
| **PLRU (Tree)** | 7 bits | ~90-95% | Low — simple binary tree |
| **Random** | 0 bits | ~60-70% | Minimal — just a counter |
| **FIFO** | 3 bits (one pointer) | ~70-80% | Minimal — circular buffer |

PLRU hits the sweet spot: **near-LRU accuracy at minimal hardware cost**. That's why it's the dominant replacement policy in commercial processor caches and TLBs 👑

### PLRU Limitations

1. **Not strictly LRU** — a just-accessed entry might be evicted before the true least-recently-used one
2. **Only one "recent" bit per tree node** — cannot distinguish "accessed long ago" from "never accessed"
3. **Worst case**: for N ways, PLRU can evict an entry that was accessed only ⌈log₂(N)⌉ steps ago, while true LRU would keep it

---

## 8. 🔄 Integration in TLB/Cache Systems

In a real SMMU TLB, PLRU is stored **per set** in the TLB RAM:

```
┌─────────────────────────────────────────────────┐
│  TLB Set Entry (per way)                        │
│  ┌──────────┬──────────┬─────┬──────────┐       │
│  │  VPN     │  PPN     │ ... │ Valid    │       │
│  └──────────┴──────────┴─────┴──────────┘       │
│                                                  │
│  PLRU bits (shared per set):  [6:0]             │
│  Read with lookup → plru_org_i                  │
│  Write back after hit → plru_upd_o              │
│  Use for miss replacement → plru_rpl_o          │
└─────────────────────────────────────────────────┘
```

**Flow:**
1. **Lookup**: Read PLRU bits from TLB RAM → `plru_org_i`
2. **Hit**: Compute `plru_upd_o` → write back updated tree
3. **Miss**: Use `plru_rpl_o` to select victim way → insert new entry

---

## 9. 📝 Key Takeaways

1. **PLRU uses a binary tree of N-1 bits** — one bit per internal node, pointing to the LRU direction 🌳
2. **Replacement = tree traversal** from root following direction flags, each bit of the way index is determined by one level
3. **Update = point away from hit** — after accessing a way, flip direction flags on the root-to-leaf path to point away
4. **Hit tree enables elegant logic** — bottom-up OR propagation naturally filters which nodes to update and computes the new direction
5. **Only N-1 bits needed** — 7 bits for 8-way, 15 bits for 16-way — much cheaper than true LRU
6. **Near-LRU accuracy at minimal cost** — the dominant choice in commercial caches and TLBs 👑
7. **Sequential dependency in replacement path** — `plru_rpl_o` bits depend on each other level by level, which is the critical timing path

---

📖 **Reference:** SmmuPLRU.sv RTL implementation, *Pseudo Least Recently Used replacement policy controller*

---

👍 If this post helped you understand PLRU, give it a like! Comments and discussions are welcome 💬
