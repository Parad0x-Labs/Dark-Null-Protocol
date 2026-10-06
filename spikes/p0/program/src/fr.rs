//! BN254 scalar field (Fr) arithmetic in Montgomery form, 4 x u64 little-endian limbs.
//! Plain Rust (no syscalls) so it is unit-tested natively against num-bigint.

pub const MODULUS: [u64; 4] = [
    0x43e1f593f0000001,
    0x2833e84879b97091,
    0xb85045b68181585d,
    0x30644e72e131a029,
];
/// -r^-1 mod 2^64
const INV: u64 = 0xc2e1f593efffffff;
/// R^2 mod r, R = 2^256
const R2: [u64; 4] = [
    0x1bb8e645ae216da7,
    0x53fe3ab1e35c59e3,
    0x8c49833d53bb8085,
    0x0216d0b17f4e44a5,
];
/// R mod r (Montgomery one)
const R1: [u64; 4] = [
    0xac96341c4ffffffb,
    0x36fc76959f60cd29,
    0x666ea36f7879462e,
    0x0e0a77c19a07df2f,
];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Fr(pub [u64; 4]);

#[inline(always)]
fn mac(a: u64, b: u64, c: u64, carry: u64) -> (u64, u64) {
    let t = (a as u128) + (b as u128) * (c as u128) + (carry as u128);
    (t as u64, (t >> 64) as u64)
}

#[inline(always)]
fn adc(a: u64, b: u64, carry: u64) -> (u64, u64) {
    let t = (a as u128) + (b as u128) + (carry as u128);
    (t as u64, (t >> 64) as u64)
}

#[inline(always)]
fn sbb(a: u64, b: u64, borrow: u64) -> (u64, u64) {
    let t = (a as u128).wrapping_sub((b as u128) + (borrow as u128));
    (t as u64, ((t >> 64) as u64) & 1)
}

#[inline(always)]
fn geq_mod(a: &[u64; 4]) -> bool {
    for i in (0..4).rev() {
        if a[i] > MODULUS[i] {
            return true;
        }
        if a[i] < MODULUS[i] {
            return false;
        }
    }
    true
}

#[inline(always)]
fn sub_mod_raw(a: &[u64; 4]) -> [u64; 4] {
    let (r0, b) = sbb(a[0], MODULUS[0], 0);
    let (r1, b) = sbb(a[1], MODULUS[1], b);
    let (r2, b) = sbb(a[2], MODULUS[2], b);
    let (r3, _) = sbb(a[3], MODULUS[3], b);
    [r0, r1, r2, r3]
}

fn limbs_from_be(b: &[u8; 32]) -> [u64; 4] {
    let mut l = [0u64; 4];
    for i in 0..4 {
        let mut w = [0u8; 8];
        w.copy_from_slice(&b[(3 - i) * 8..(4 - i) * 8]);
        l[i] = u64::from_be_bytes(w);
    }
    l
}

fn limbs_to_be(l: &[u64; 4]) -> [u8; 32] {
    let mut b = [0u8; 32];
    for i in 0..4 {
        b[(3 - i) * 8..(4 - i) * 8].copy_from_slice(&l[i].to_be_bytes());
    }
    b
}

impl Fr {
    pub const ZERO: Fr = Fr([0, 0, 0, 0]);
    pub const ONE: Fr = Fr(R1);

    /// Canonical big-endian bytes; None if >= r.
    pub fn from_be_canonical(b: &[u8; 32]) -> Option<Fr> {
        let l = limbs_from_be(b);
        if geq_mod(&l) {
            return None;
        }
        Some(Fr(l).mul(&Fr(R2)))
    }

    /// Any 256-bit big-endian value, reduced mod r (used for Fiat-Shamir challenges).
    pub fn from_be_reduce(b: &[u8; 32]) -> Fr {
        let mut l = limbs_from_be(b);
        while geq_mod(&l) {
            l = sub_mod_raw(&l);
        }
        Fr(l).mul(&Fr(R2))
    }

    pub fn from_u64(v: u64) -> Fr {
        Fr([v, 0, 0, 0]).mul(&Fr(R2))
    }

    pub fn to_be(&self) -> [u8; 32] {
        limbs_to_be(&self.mul(&Fr([1, 0, 0, 0])).0)
    }

    pub fn is_zero(&self) -> bool {
        self.0 == [0, 0, 0, 0]
    }

    #[inline(never)]
    pub fn add(&self, o: &Fr) -> Fr {
        let (r0, c) = adc(self.0[0], o.0[0], 0);
        let (r1, c) = adc(self.0[1], o.0[1], c);
        let (r2, c) = adc(self.0[2], o.0[2], c);
        let (r3, _) = adc(self.0[3], o.0[3], c);
        let r = [r0, r1, r2, r3];
        // r < 2p < 2^255: no carry out of the top limb
        if geq_mod(&r) {
            Fr(sub_mod_raw(&r))
        } else {
            Fr(r)
        }
    }

    #[inline(never)]
    pub fn sub(&self, o: &Fr) -> Fr {
        let (r0, b) = sbb(self.0[0], o.0[0], 0);
        let (r1, b) = sbb(self.0[1], o.0[1], b);
        let (r2, b) = sbb(self.0[2], o.0[2], b);
        let (r3, b) = sbb(self.0[3], o.0[3], b);
        if b != 0 {
            let (s0, c) = adc(r0, MODULUS[0], 0);
            let (s1, c) = adc(r1, MODULUS[1], c);
            let (s2, c) = adc(r2, MODULUS[2], c);
            let (s3, _) = adc(r3, MODULUS[3], c);
            Fr([s0, s1, s2, s3])
        } else {
            Fr([r0, r1, r2, r3])
        }
    }

    pub fn neg(&self) -> Fr {
        Fr::ZERO.sub(self)
    }

    /// Montgomery multiplication (CIOS).
    #[inline(never)]
    pub fn mul(&self, o: &Fr) -> Fr {
        let a = &self.0;
        let b = &o.0;
        let mut t = [0u64; 6];
        for i in 0..4 {
            let mut c = 0u64;
            for j in 0..4 {
                let (lo, hi) = mac(t[j], a[j], b[i], c);
                t[j] = lo;
                c = hi;
            }
            let (s, c2) = adc(t[4], c, 0);
            t[4] = s;
            t[5] = c2;
            let m = t[0].wrapping_mul(INV);
            let (_, mut c) = mac(t[0], m, MODULUS[0], 0);
            for j in 1..4 {
                let (lo, hi) = mac(t[j], m, MODULUS[j], c);
                t[j - 1] = lo;
                c = hi;
            }
            let (s, c3) = adc(t[4], c, 0);
            t[3] = s;
            t[4] = t[5] + c3;
        }
        let r = [t[0], t[1], t[2], t[3]];
        if t[4] != 0 || geq_mod(&r) {
            Fr(sub_mod_raw(&r))
        } else {
            Fr(r)
        }
    }

    pub fn square(&self) -> Fr {
        self.mul(self)
    }

    /// Inverse via the binary extended Euclidean algorithm on canonical integers.
    /// Variable time (verifier-side only). Returns None for zero.
    pub fn inverse(&self) -> Option<Fr> {
        if self.is_zero() {
            return None;
        }
        let a = self.mul(&Fr([1, 0, 0, 0])).0; // out of Montgomery form
        let mut u = a;
        let mut v = MODULUS;
        let mut x1 = [1u64, 0, 0, 0];
        let mut x2 = [0u64, 0, 0, 0];
        let one = [1u64, 0, 0, 0];
        while u != one && v != one {
            while u[0] & 1 == 0 {
                shr1(&mut u);
                if x1[0] & 1 == 0 {
                    shr1(&mut x1);
                } else {
                    let s = add_raw(&x1, &MODULUS);
                    x1 = s;
                    shr1(&mut x1);
                }
            }
            while v[0] & 1 == 0 {
                shr1(&mut v);
                if x2[0] & 1 == 0 {
                    shr1(&mut x2);
                } else {
                    let s = add_raw(&x2, &MODULUS);
                    x2 = s;
                    shr1(&mut x2);
                }
            }
            if geq(&u, &v) {
                u = sub_raw(&u, &v);
                x1 = Fr(x1).sub(&Fr(x2)).0;
            } else {
                v = sub_raw(&v, &u);
                x2 = Fr(x2).sub(&Fr(x1)).0;
            }
        }
        let r = if u == one { x1 } else { x2 };
        Some(Fr(r).mul(&Fr(R2)))
    }
}

fn shr1(a: &mut [u64; 4]) {
    a[0] = (a[0] >> 1) | (a[1] << 63);
    a[1] = (a[1] >> 1) | (a[2] << 63);
    a[2] = (a[2] >> 1) | (a[3] << 63);
    a[3] >>= 1;
}

fn add_raw(a: &[u64; 4], b: &[u64; 4]) -> [u64; 4] {
    let (r0, c) = adc(a[0], b[0], 0);
    let (r1, c) = adc(a[1], b[1], c);
    let (r2, c) = adc(a[2], b[2], c);
    let (r3, _) = adc(a[3], b[3], c);
    [r0, r1, r2, r3]
}

fn sub_raw(a: &[u64; 4], b: &[u64; 4]) -> [u64; 4] {
    let (r0, br) = sbb(a[0], b[0], 0);
    let (r1, br) = sbb(a[1], b[1], br);
    let (r2, br) = sbb(a[2], b[2], br);
    let (r3, _) = sbb(a[3], b[3], br);
    [r0, r1, r2, r3]
}

fn geq(a: &[u64; 4], b: &[u64; 4]) -> bool {
    for i in (0..4).rev() {
        if a[i] > b[i] {
            return true;
        }
        if a[i] < b[i] {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use num_bigint::BigUint;

    fn p() -> BigUint {
        BigUint::parse_bytes(
            b"21888242871839275222246405745257275088548364400416034343698204186575808495617",
            10,
        )
        .unwrap()
    }
    fn big(f: &Fr) -> BigUint {
        BigUint::from_bytes_be(&f.to_be())
    }
    fn fr(x: &BigUint) -> Fr {
        let mut b = [0u8; 32];
        let v = x.to_bytes_be();
        b[32 - v.len()..].copy_from_slice(&v);
        Fr::from_be_canonical(&b).unwrap()
    }

    #[test]
    fn constants() {
        let r = BigUint::from(1u8) << 256;
        assert_eq!(BigUint::from_bytes_be(&limbs_to_be(&R1)), &r % p());
        assert_eq!(BigUint::from_bytes_be(&limbs_to_be(&R2)), (&r * &r) % p());
        assert_eq!(BigUint::from_bytes_be(&limbs_to_be(&MODULUS)), p());
        let inv = (BigUint::from(MODULUS[0]) * BigUint::from(INV)) % (BigUint::from(1u8) << 64);
        assert_eq!(inv, (BigUint::from(1u8) << 64) - BigUint::from(1u8));
    }

    #[test]
    fn arithmetic_matches_biguint() {
        let mut x = BigUint::from(7u8);
        let mut y = p() - BigUint::from(3u8);
        for i in 0..200u32 {
            let a = fr(&x);
            let b = fr(&y);
            assert_eq!(big(&a.mul(&b)), (&x * &y) % p());
            assert_eq!(big(&a.add(&b)), (&x + &y) % p());
            assert_eq!(big(&a.sub(&b)), ((&x + p()) - &y) % p());
            let ia = a.inverse().unwrap();
            assert_eq!(big(&ia.mul(&a)), BigUint::from(1u8));
            x = (&x * &x + BigUint::from(i + 11)) % p();
            y = (&y * &x + BigUint::from(3 * i + 5)) % p();
        }
        let mut h = [0xffu8; 32];
        h[0] = 0xff;
        assert_eq!(big(&Fr::from_be_reduce(&h)), BigUint::from_bytes_be(&h) % p());
        assert!(Fr::from_be_canonical(&limbs_to_be(&MODULUS)).is_none());
    }
}
