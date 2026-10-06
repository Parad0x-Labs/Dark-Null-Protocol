//! spike-x402-batch: throwaway devnet measurement program (2026-10-06).
//!
//! Settles K payer-signed x402 vouchers in one transaction against a program-owned
//! ledger. Two verification paths are measured side by side:
//!   op 1  SettlePrecompile  - vouchers checked by the ed25519 precompile (instruction 0),
//!                             this program re-reads them via the instructions sysvar.
//!   op 2  SettleInProgram   - vouchers checked inside the program with the
//!                             sol_sha512 syscall (SIMD-0512) + curve25519 edwards MSM.
//!
//! Ledger page = program-owned account whose data is an array of 48-byte slots:
//!   [owner pubkey 32][balance u64 LE][nonce u64 LE]
//! Voucher message (56 bytes), signed by the payer slot owner:
//!   "DNX4BAT1" || payee_owner(32) || amount u64 LE || nonce u64 LE
//! nonce must equal stored nonce + 1 (strictly sequential, replay-safe).
//!
//! No dependencies. Not for production use: no deposit/withdraw path, the spike
//! authority funds slots directly, and small-order key checks are omitted.
#![cfg_attr(target_os = "solana", no_std)]

pub const DOMAIN: &[u8; 8] = b"DNX4BAT1";
pub const SLOT: usize = 48;
pub const MSG_LEN: usize = 56;

// test-payer (devnet burner) is the only key allowed to init / close slots.
pub const AUTHORITY: [u8; 32] = [
    229, 192, 253, 96, 35, 82, 140, 5, 81, 194, 31, 0, 214, 58, 142, 116, 22, 78, 36, 145, 74, 8,
    12, 96, 152, 52, 98, 81, 141, 92, 18, 226,
];
pub const ED25519_PROGRAM: [u8; 32] = [
    3, 125, 70, 214, 124, 147, 251, 190, 18, 249, 66, 143, 131, 141, 64, 255, 5, 112, 116, 73, 39,
    244, 138, 100, 252, 202, 112, 68, 128, 0, 0, 0,
];
pub const IX_SYSVAR: [u8; 32] = [
    6, 167, 213, 23, 24, 123, 209, 102, 53, 218, 212, 4, 85, 253, 194, 192, 193, 36, 198, 143, 33,
    86, 117, 165, 219, 186, 203, 95, 8, 0, 0, 0,
];
// compressed ed25519 basepoint
pub const BASEPOINT: [u8; 32] = [
    0x58, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66,
    0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66,
];

// ---------------------------------------------------------------------------
// Scalar arithmetic mod L (radix 2^52 Montgomery, same structure as
// curve25519-dalek's u64 backend; constants derived and checked with a script).
// ---------------------------------------------------------------------------
const MASK: u64 = (1u64 << 52) - 1;
const L52: [u64; 5] = [0x2631a5cf5d3ed, 0xdea2f79cd6581, 0x14def9, 0, 0x100000000000];
const R52: [u64; 5] = [0xf48bd6721e6ed, 0x3bab5ac67e45a, 0xfffffeb35e51b, 0xfffffffffffff, 0xfffffffffff];
const RR52: [u64; 5] = [0x9d265e952d13b, 0xd63c715bea69f, 0x5be65cb687604, 0x3dceec73d217f, 0x9411b7c309a];
const LFACTOR: u64 = 0x51da312547e1b;
const L64: [u64; 4] = [0x5812631a5cf5d3ed, 0x14def9dea2f79cd6, 0, 0x1000000000000000];

#[inline(always)]
fn m(a: u64, b: u64) -> u128 {
    (a as u128) * (b as u128)
}

fn sub52(a: &[u64; 5], b: &[u64; 5]) -> [u64; 5] {
    let mut d = [0u64; 5];
    let mut borrow: u64 = 0;
    for i in 0..5 {
        borrow = a[i].wrapping_sub(b[i] + (borrow >> 63));
        d[i] = borrow & MASK;
    }
    let under = 0u64.wrapping_sub(borrow >> 63);
    let mut carry: u64 = 0;
    for i in 0..5 {
        carry = (carry >> 52) + d[i] + (L52[i] & under);
        d[i] = carry & MASK;
    }
    d
}

fn add52(a: &[u64; 5], b: &[u64; 5]) -> [u64; 5] {
    let mut s = [0u64; 5];
    let mut carry: u64 = 0;
    for i in 0..5 {
        carry = a[i] + b[i] + (carry >> 52);
        s[i] = carry & MASK;
    }
    sub52(&s, &L52)
}

fn mont_mul(a: &[u64; 5], b: &[u64; 5]) -> [u64; 5] {
    let mut z = [0u128; 9];
    for i in 0..5 {
        for j in 0..5 {
            z[i + j] += m(a[i], b[j]);
        }
    }
    #[inline(always)]
    fn part1(sum: u128) -> (u128, u64) {
        let p = (sum as u64).wrapping_mul(LFACTOR) & MASK;
        ((sum + m(p, L52[0])) >> 52, p)
    }
    #[inline(always)]
    fn part2(sum: u128) -> (u128, u64) {
        (sum >> 52, (sum as u64) & MASK)
    }
    let l = &L52;
    let (c, n0) = part1(z[0]);
    let (c, n1) = part1(c + z[1] + m(n0, l[1]));
    let (c, n2) = part1(c + z[2] + m(n0, l[2]) + m(n1, l[1]));
    let (c, n3) = part1(c + z[3] + m(n1, l[2]) + m(n2, l[1]));
    let (c, n4) = part1(c + z[4] + m(n0, l[4]) + m(n2, l[2]) + m(n3, l[1]));
    let (c, r0) = part2(c + z[5] + m(n1, l[4]) + m(n3, l[2]) + m(n4, l[1]));
    let (c, r1) = part2(c + z[6] + m(n2, l[4]) + m(n4, l[2]));
    let (c, r2) = part2(c + z[7] + m(n3, l[4]));
    let (c, r3) = part2(c + z[8] + m(n4, l[4]));
    let r4 = c as u64;
    sub52(&[r0, r1, r2, r3, r4], &L52)
}

fn rd64(b: &[u8], o: usize) -> u64 {
    let mut w = [0u8; 8];
    w.copy_from_slice(&b[o..o + 8]);
    u64::from_le_bytes(w)
}

/// 64-byte little-endian integer reduced mod L, as 52-bit limbs.
pub fn reduce_wide(b: &[u8; 64]) -> [u64; 5] {
    let mut w = [0u64; 8];
    for i in 0..8 {
        w[i] = rd64(b, 8 * i);
    }
    let lo = [
        w[0] & MASK,
        ((w[0] >> 52) | (w[1] << 12)) & MASK,
        ((w[1] >> 40) | (w[2] << 24)) & MASK,
        ((w[2] >> 28) | (w[3] << 36)) & MASK,
        ((w[3] >> 16) | (w[4] << 48)) & MASK,
    ];
    let hi = [
        (w[4] >> 4) & MASK,
        ((w[4] >> 56) | (w[5] << 8)) & MASK,
        ((w[5] >> 44) | (w[6] << 20)) & MASK,
        ((w[6] >> 32) | (w[7] << 32)) & MASK,
        w[7] >> 20,
    ];
    add52(&mont_mul(&hi, &RR52), &mont_mul(&lo, &R52))
}

pub fn limbs_to_bytes(l: &[u64; 5]) -> [u8; 32] {
    let w = [
        l[0] | (l[1] << 52),
        (l[1] >> 12) | (l[2] << 40),
        (l[2] >> 24) | (l[3] << 28),
        (l[3] >> 36) | (l[4] << 16),
    ];
    let mut out = [0u8; 32];
    for i in 0..4 {
        out[8 * i..8 * i + 8].copy_from_slice(&w[i].to_le_bytes());
    }
    out
}

/// -k mod L
pub fn neg52(k: &[u64; 5]) -> [u64; 5] {
    sub52(&[0u64; 5], k)
}

/// true if the 32-byte LE scalar is < L
pub fn is_canonical(s: &[u8]) -> bool {
    for i in (0..4).rev() {
        let v = rd64(s, 8 * i);
        if v < L64[i] {
            return true;
        }
        if v > L64[i] {
            return false;
        }
    }
    false
}

pub fn voucher_msg(payee_owner: &[u8], amount: u64, nonce: u64) -> [u8; MSG_LEN] {
    let mut msg = [0u8; MSG_LEN];
    msg[0..8].copy_from_slice(DOMAIN);
    msg[8..40].copy_from_slice(&payee_owner[0..32]);
    msg[40..48].copy_from_slice(&amount.to_le_bytes());
    msg[48..56].copy_from_slice(&nonce.to_le_bytes());
    msg
}

// ---------------------------------------------------------------------------
// On-chain part
// ---------------------------------------------------------------------------
#[cfg(target_os = "solana")]
mod onchain {
    use super::*;
    use core::slice::from_raw_parts;
    use core::slice::from_raw_parts_mut;

    #[repr(C)]
    struct SolBytes {
        addr: *const u8,
        len: u64,
    }

    extern "C" {
        fn sol_log_(msg: *const u8, len: u64);
        fn sol_sha512(vals: *const SolBytes, val_len: u64, hash_result: *mut u8) -> u64;
        fn sol_curve_multiscalar_mul(
            curve_id: u64,
            scalars: *const u8,
            points: *const u8,
            points_len: u64,
            result: *mut u8,
        ) -> u64;
        fn abort() -> !;
    }

    fn log(s: &[u8]) {
        unsafe { sol_log_(s.as_ptr(), s.len() as u64) }
    }

    #[panic_handler]
    fn panic(_: &core::panic::PanicInfo) -> ! {
        log(b"panic");
        unsafe { abort() }
    }

    const MAX_ACC: usize = 64;
    const E_ARGS: u64 = 0x100;
    const E_ACC: u64 = 0x101;
    const E_AUTH: u64 = 0x102;
    const E_SIG: u64 = 0x103;
    const E_NONCE: u64 = 0x104;
    const E_FUNDS: u64 = 0x105;
    const E_MSG: u64 = 0x106;

    #[derive(Clone, Copy)]
    struct Acc(*mut u8);
    impl Acc {
        fn signer(&self) -> bool {
            unsafe { *self.0.add(1) != 0 }
        }
        fn writable(&self) -> bool {
            unsafe { *self.0.add(2) != 0 }
        }
        fn key(&self) -> &'static [u8] {
            unsafe { from_raw_parts(self.0.add(8), 32) }
        }
        fn owner(&self) -> &'static [u8] {
            unsafe { from_raw_parts(self.0.add(40), 32) }
        }
        fn lamports(&self) -> *mut u64 {
            unsafe { self.0.add(72) as *mut u64 }
        }
        fn data_len(&self) -> usize {
            unsafe { *(self.0.add(80) as *const u64) as usize }
        }
        fn data(&self) -> &'static mut [u8] {
            unsafe { from_raw_parts_mut(self.0.add(88), self.data_len()) }
        }
    }

    struct Ctx<'a> {
        accs: [Acc; MAX_ACC],
        n: usize,
        ix: &'a [u8],
        program_id: &'a [u8],
    }

    unsafe fn parse<'a>(input: *mut u8) -> Result<Ctx<'a>, u64> {
        let n = *(input as *const u64) as usize;
        if n > MAX_ACC {
            return Err(E_ACC);
        }
        let mut accs = [Acc(core::ptr::null_mut()); MAX_ACC];
        let mut off = 8usize;
        for i in 0..n {
            let dup = *input.add(off);
            if dup == 0xff {
                accs[i] = Acc(input.add(off));
                let dl = *(input.add(off + 80) as *const u64) as usize;
                off += 88 + dl + 10240;
                off = (off + 7) & !7;
                off += 8;
            } else {
                accs[i] = accs[dup as usize];
                off += 8;
            }
        }
        let ix_len = *(input.add(off) as *const u64) as usize;
        let ix = from_raw_parts(input.add(off + 8), ix_len);
        let program_id = from_raw_parts(input.add(off + 8 + ix_len), 32);
        Ok(Ctx { accs, n, ix, program_id })
    }

    impl<'a> Ctx<'a> {
        fn slot(&self, acct: u8, idx: u8) -> Result<&'static mut [u8], u64> {
            let a = acct as usize;
            if a >= self.n {
                return Err(E_ACC);
            }
            let acc = self.accs[a];
            if acc.owner() != self.program_id || !acc.writable() {
                return Err(E_ACC);
            }
            let o = idx as usize * SLOT;
            let d = acc.data();
            if o + SLOT > d.len() {
                return Err(E_ACC);
            }
            Ok(&mut d[o..o + SLOT])
        }
    }

    fn get_u64(b: &[u8], o: usize) -> u64 {
        rd64(b, o)
    }
    fn get_u16(b: &[u8], o: usize) -> usize {
        u16::from_le_bytes([b[o], b[o + 1]]) as usize
    }

    /// debit payer slot, credit payee slot, enforce nonce == stored + 1
    fn apply(ctx: &Ctx, r: &[u8; 4], amount: u64, nonce: u64) -> Result<(), u64> {
        {
            let p = ctx.slot(r[0], r[1])?;
            let bal = get_u64(p, 32);
            let stored = get_u64(p, 40);
            if nonce != stored + 1 {
                return Err(E_NONCE);
            }
            if bal < amount {
                return Err(E_FUNDS);
            }
            p[32..40].copy_from_slice(&(bal - amount).to_le_bytes());
            p[40..48].copy_from_slice(&nonce.to_le_bytes());
        }
        let q = ctx.slot(r[2], r[3])?;
        let b = get_u64(q, 32).checked_add(amount).ok_or(E_FUNDS)?;
        q[32..40].copy_from_slice(&b.to_le_bytes());
        Ok(())
    }

    // op 0: [0][n] n x (acct u8, slot u8, owner 32, balance u64); accs[0] = authority signer
    fn init(ctx: &Ctx) -> Result<(), u64> {
        let auth = ctx.accs[0];
        if ctx.n == 0 || !auth.signer() || auth.key() != AUTHORITY {
            return Err(E_AUTH);
        }
        let n = ctx.ix[1] as usize;
        let body = &ctx.ix[2..];
        if body.len() != n * 42 {
            return Err(E_ARGS);
        }
        for i in 0..n {
            let e = &body[42 * i..42 * i + 42];
            let s = ctx.slot(e[0], e[1])?;
            if s[0..32].iter().any(|b| *b != 0) {
                return Err(E_ACC);
            }
            s[0..32].copy_from_slice(&e[2..34]);
            s[32..40].copy_from_slice(&e[34..42]);
            s[40..48].copy_from_slice(&0u64.to_le_bytes());
        }
        Ok(())
    }

    // op 1: [1][n] n x (payer_acct, payer_slot, payee_acct, payee_slot); accs[0] = instructions sysvar.
    // The ed25519 precompile instruction must be instruction 0 and carry n inline entries.
    fn settle_precompile(ctx: &Ctx) -> Result<(), u64> {
        let n = ctx.ix[1] as usize;
        let refs = &ctx.ix[2..];
        if refs.len() != 4 * n || ctx.n == 0 || ctx.accs[0].key() != IX_SYSVAR {
            return Err(E_ARGS);
        }
        let sv = ctx.accs[0].data();
        let num_ix = get_u16(sv, 0);
        if num_ix < 2 {
            return Err(E_SIG);
        }
        let mut o = get_u16(sv, 2); // instruction 0
        let na = get_u16(sv, o);
        o += 2 + 33 * na;
        if sv[o..o + 32] != ED25519_PROGRAM {
            return Err(E_SIG);
        }
        o += 32;
        let dl = get_u16(sv, o);
        let ed = &sv[o + 2..o + 2 + dl];
        if ed[0] as usize != n {
            return Err(E_SIG);
        }
        for i in 0..n {
            let e = 2 + 14 * i;
            // sig_off, sig_ix, pk_off, pk_ix, msg_off, msg_size, msg_ix
            if get_u16(ed, e + 2) != 0xffff || get_u16(ed, e + 6) != 0xffff || get_u16(ed, e + 12) != 0xffff {
                return Err(E_SIG);
            }
            let pk_off = get_u16(ed, e + 4);
            let msg_off = get_u16(ed, e + 8);
            if get_u16(ed, e + 10) != MSG_LEN {
                return Err(E_MSG);
            }
            let pk = &ed[pk_off..pk_off + 32];
            let msg = &ed[msg_off..msg_off + MSG_LEN];
            let r: [u8; 4] = [refs[4 * i], refs[4 * i + 1], refs[4 * i + 2], refs[4 * i + 3]];
            {
                let p = ctx.slot(r[0], r[1])?;
                if &p[0..32] != pk {
                    return Err(E_SIG);
                }
            }
            {
                let q = ctx.slot(r[2], r[3])?;
                if &msg[0..8] != DOMAIN || msg[8..40] != q[0..32] {
                    return Err(E_MSG);
                }
            }
            apply(ctx, &r, get_u64(msg, 40), get_u64(msg, 48))?;
        }
        Ok(())
    }

    fn verify_ed25519(pk: &[u8], msg: &[u8], sig: &[u8]) -> bool {
        let s = &sig[32..64];
        if !is_canonical(s) {
            return false;
        }
        let parts = [
            SolBytes { addr: sig.as_ptr(), len: 32 },
            SolBytes { addr: pk.as_ptr(), len: 32 },
            SolBytes { addr: msg.as_ptr(), len: msg.len() as u64 },
        ];
        let mut h = [0u8; 64];
        unsafe { sol_sha512(parts.as_ptr(), 3, h.as_mut_ptr()) };
        let k = reduce_wide(&h);
        let negk = limbs_to_bytes(&neg52(&k));
        let mut scalars = [0u8; 64];
        scalars[0..32].copy_from_slice(s);
        scalars[32..64].copy_from_slice(&negk);
        let mut points = [0u8; 64];
        points[0..32].copy_from_slice(&BASEPOINT);
        points[32..64].copy_from_slice(pk);
        let mut out = [0u8; 32];
        let rc = unsafe { sol_curve_multiscalar_mul(0, scalars.as_ptr(), points.as_ptr(), 2, out.as_mut_ptr()) };
        rc == 0 && out[..] == sig[0..32]
    }

    // op 2: [2][n] n x (payer_acct, payer_slot, payee_acct, payee_slot, amount u64, sig 64)
    fn settle_in_program(ctx: &Ctx) -> Result<(), u64> {
        let n = ctx.ix[1] as usize;
        let body = &ctx.ix[2..];
        if body.len() != 76 * n {
            return Err(E_ARGS);
        }
        for i in 0..n {
            let e = &body[76 * i..76 * i + 76];
            let r: [u8; 4] = [e[0], e[1], e[2], e[3]];
            let amount = get_u64(e, 4);
            let sig = &e[12..76];
            let (pk, nonce) = {
                let p = ctx.slot(r[0], r[1])?;
                let mut pk = [0u8; 32];
                pk.copy_from_slice(&p[0..32]);
                (pk, get_u64(p, 40) + 1)
            };
            let payee = {
                let q = ctx.slot(r[2], r[3])?;
                let mut k = [0u8; 32];
                k.copy_from_slice(&q[0..32]);
                k
            };
            let msg = voucher_msg(&payee, amount, nonce);
            if !verify_ed25519(&pk, &msg, sig) {
                return Err(E_SIG);
            }
            apply(ctx, &r, amount, nonce)?;
        }
        Ok(())
    }

    // op 3: close pages. accs[0] = authority signer, accs[1] = destination, accs[2..] = pages
    fn close(ctx: &Ctx) -> Result<(), u64> {
        let auth = ctx.accs[0];
        if ctx.n < 3 || !auth.signer() || auth.key() != AUTHORITY {
            return Err(E_AUTH);
        }
        let dest = ctx.accs[1];
        for i in 2..ctx.n {
            let a = ctx.accs[i];
            if a.owner() != ctx.program_id || !a.writable() {
                return Err(E_ACC);
            }
            unsafe {
                let l = *a.lamports();
                *a.lamports() = 0;
                *dest.lamports() += l;
            }
            for b in a.data().iter_mut() {
                *b = 0;
            }
        }
        Ok(())
    }

    #[no_mangle]
    pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
        let ctx = match parse(input) {
            Ok(c) => c,
            Err(e) => return e,
        };
        if ctx.ix.len() < 2 && !(ctx.ix.len() == 1 && ctx.ix[0] == 3) {
            return E_ARGS;
        }
        let r = match ctx.ix[0] {
            0 => init(&ctx),
            1 => settle_precompile(&ctx),
            2 => settle_in_program(&ctx),
            3 => close(&ctx),
            _ => Err(E_ARGS),
        };
        match r {
            Ok(()) => 0,
            Err(e) => {
                log(b"x402batch: rejected");
                e
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hx(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }
    #[test]
    fn reduce_matches_python_vectors() {
        let v: &[(&str, &str)] = &include!("../scalar_vectors.in");
        for (wide, red) in v {
            let w: [u8; 64] = hx(wide).try_into().unwrap();
            assert_eq!(limbs_to_bytes(&reduce_wide(&w)).to_vec(), hx(red));
            let k = reduce_wide(&w);
            let s = add52(&k, &neg52(&k));
            assert_eq!(limbs_to_bytes(&s), [0u8; 32]);
            assert!(is_canonical(&hx(red)));
        }
        let mut lb = [0u8; 32];
        lb.copy_from_slice(&limbs_to_bytes(&L52));
        assert!(!is_canonical(&lb));
    }
}
