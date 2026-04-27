---
title: "0.1 🎯 Verilog Bit Manipulation Tricks: Finding the First 0 and 1"
tags: [Verilog, Bit Manipulation, RTL, Hardware]
order: 0
last_modified_at: 2026-04-27
---

One line of code to find the first 0. One line to find the first 1. From *any* starting bit position.

These two tricks are incredibly useful in RTL — priority encoders, round-robin arbiters, replacement policies — yet rarely taught in textbooks. Let's break them down step by step.

---

## 1. 🎯 The Core Trick: Find First 0/1 From Bit p

### 🔍 Find the First 0 (from bit p)

```verilog
~x & (x + p)    // p = 1 << bit_position
```

**How it works:** Adding `p` to `x` triggers a carry that "jumps over" consecutive 1s until it hits the first 0. After inverting `x`, the AND isolates that single bit.

**Example:** x = `1010_0011`, find first 0 from bit 0 (p = 1)

```
x       = 1010_0011
p       = 0000_0001
x + p   = 1010_0100  ← carry stops at the first 0 (bit 2)
~x      = 0101_1100
~x & (x+p) = 0000_0100  → bit 2 is the first 0 ✅
```

Find first 0 from bit 4 (p = `0001_0000`):

```
x + p   = 1011_0011  ← carry stops at bit 4
~x      = 0101_1100
~x & (x+p) = 0001_0000  → bit 4 is the first 0 ✅
```

### 🔎 Find the First 1 (from bit p)

```verilog
x & ~(x - p)    // p = 1 << bit_position
```

**How it works:** Subtracting `p` from `x` triggers a borrow that "jumps over" consecutive 0s until it hits the first 1. After inverting the result, the AND isolates that bit.

**Example:** x = `1011_1000`, find first 1 from bit 0 (p = 1)

```
x       = 1011_1000
p       = 0000_0001
x - p   = 1011_0111  ← borrow stops at the first 1 (bit 3)
~(x-p)  = 0100_1000
x & ~(x-p) = 0000_1000  → bit 3 is the first 1 ✅
```

### 💡 The Intuition

> **Carry from addition hunts for 0; borrow from subtraction hunts for 1.**

The parameter `p` sets the starting point of the hunt. This is why it works from *any* bit position, not just bit 0.

---

## 2. 🧱 Basic Variants (p = 1)

The most common form starts from bit 0:

| Operation | Expression | Meaning |
|-----------|-----------|---------|
| Find lowest 0 | `~x & (x + 1)` | Isolate the lowest 0 bit |
| Find lowest 1 | `x & ~(x - 1)` or `x & (-x)` | Isolate the lowest 1 bit |
| Clear lowest 1 | `x & (x - 1)` | Clear the lowest 1 bit (**most used!**) |
| Set lowest 0 | `x \| (x + 1)` | Set the lowest 0 bit |
| Clear trailing 1s | `x & (x + 1)` | Clear all consecutive 1s from LSB |

### 📊 Quick Examples

```
x = 1011_1000

~x & (x+1)  = 0100_0111 & 1011_1001 = 0000_0001  → lowest 0 at bit 0
x  & ~(x-1) = 1011_1000 & 0100_1000 = 0000_1000  → lowest 1 at bit 3
x  &  (x-1) = 1011_1000 & 1011_0111 = 1011_0000  → cleared bit 3
x  |  (x+1) = 1011_1000 | 1011_1001 = 1011_1001  → set bit 0
x  &  (x+1) = 1011_1000 & 1011_1001 = 1011_1000  → no trailing 1s to clear
```

---

## 3. 🔧 Practical Applications

### ⚡ Priority Encoder (Find Lowest 1)

```verilog
// Find the lowest requester in one-hot encoding
wire [N-1:0] lowest_one = req & ~(req - 1);
// Example: req = 10110 → lowest_one = 00010

// Fixed-priority arbitration: grant to lowest index
wire [N-1:0] grant = lowest_one;
```

### 🔄 Round-Robin Arbitration

```verilog
// Find the next valid way starting from the last replaced position
// last_replace is one-hot encoding of the previous replacement
wire [N-1:0] p       = last_replace;           // starting bit
wire [N-1:0] next_ok = valid_mask & ~(valid_mask - p);
// Searches from the last position, wrapping around
```

This is exactly the pattern used in [PLRU replacement logic](/posts/plru-replacement-policy/) — instead of always picking from bit 0, you start from where you left off.

### 🔢 Population Count (Count 1s)

```verilog
// Repeatedly clear the lowest 1 until zero
integer cnt = 0;
temp = x;
while (temp) begin
    temp = temp & (temp - 1);  // clears one 1 each iteration
    cnt = cnt + 1;
end
```

`x & (x - 1)` is the core of Brian Kernighan's bit counting algorithm — each iteration clears exactly one 1, so the loop runs in O(popcount) time.

### ✅ Power-of-Two Detection

```verilog
// A power of two has exactly one 1 bit
wire is_power_of_2 = (x != 0) && ((x & (x - 1)) == 0);
```

---

## 4. 🚀 Advanced Tricks

### 🔀 Gray Code ↔ Binary

```verilog
// Binary → Gray Code (commonly used for cross-clock domain pointers)
wire [N-1:0] gray = bin ^ (bin >> 1);

// Gray Code → Binary (cumulative XOR from MSB)
function [N-1:0] gray2bin(input [N-1:0] gray);
    integer i, j;
    for (i = 0; i < N; i = i + 1) begin
        gray2bin[i] = gray[i];
        for (j = i + 1; j < N; j = j + 1)
            gray2bin[i] = gray2bin[i] ^ gray[j];
    end
endfunction
```

Why Gray Code in hardware? Only **one bit changes** per increment — no glitch risk when crossing clock domains. FIFO pointers almost always use Gray Code.

### ⬆️ Find the Most Significant 1

```verilog
// Step 1: Flood-fill all bits below the highest 1
wire [31:0] fill = x;
assign fill = fill | (fill >> 1);
assign fill = fill | (fill >> 2);
assign fill = fill | (fill >> 4);
assign fill = fill | (fill >> 8);
assign fill = fill | (fill >> 16);
// Now fill looks like 0000_1111_1111 (all 1s below and including MSB)

// Step 2: Isolate the highest 1
wire [31:0] msb_only = fill & ~(fill >> 1);
```

### 📏 Count Leading Zeros (CLZ)

```verilog
// Find MSB position, then subtract from N-1
// Most synthesis tools provide $clog2 or built-in CLZ
// The fill + isolate method above gives you the position
wire [4:0] leading_zeros = 5'd31 - msb_position;
```

---

## 5. 📋 Cheat Sheet

| Need | Expression | Notes |
|------|-----------|-------|
| Find lowest 0 | `~x & (x + 1)` | From bit 0 |
| Find lowest 1 | `x & ~(x - 1)` | From bit 0 |
| Find 0 from bit p | `~x & (x + (1<<p))` | General |
| Find 1 from bit p | `x & ~(x - (1<<p))` | General |
| Clear lowest 1 | `x & (x - 1)` | PopCount core |
| Set lowest 0 | `x \| (x + 1)` | |
| Clear trailing 1s | `x & (x + 1)` | |
| Set trailing 0s | `x \| (x - 1)` | |
| Power of 2 check | `x && !(x & (x-1))` | x ≠ 0 |
| Binary → Gray | `x ^ (x >> 1)` | Cross-clock domain |

---

📖 **Reference:** Henry S. Warren Jr., *Hacker's Delight*, 2nd Edition, Chapter 2 (Basics)

---

👍 If you found these tricks useful, give it a like! More Verilog tips coming in future posts 💬
