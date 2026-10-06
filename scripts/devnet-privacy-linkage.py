#!/usr/bin/env python3
"""Read-only devnet reproduction of the deposit-to-withdrawal linkage.

Scans recent transactions of the canonical root program, decodes every
`deposit_wsol_and_whisper` and `prepare_phantom_withdraw_v2` instruction from
public instruction data, and matches each withdrawal to deposits by
commitment equality (withdrawal `public_inputs[0]` == deposit `commitment`).

Only reads public chain data (getSignaturesForAddress, getTransaction); sends
no transactions and needs no key. Python 3 standard library only.

Usage:
  DEVNET_RPC_URL=<rpc url> python3 scripts/devnet-privacy-linkage.py [--limit N] [--out FILE]

The RPC URL is read from DEVNET_RPC_URL (default: the public devnet endpoint)
and is never printed or written to the output.
"""

import argparse
import datetime
import hashlib
import json
import os
import subprocess
import sys
import urllib.request

PROGRAM_ID = "35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV"
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58decode(s):
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    body = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\x00" * (len(s) - len(s.lstrip("1"))) + body


def discriminator(name):
    return hashlib.sha256(("global:" + name).encode()).digest()[:8]


DEPOSIT = discriminator("deposit_wsol_and_whisper")
WITHDRAW_V2 = discriminator("prepare_phantom_withdraw_v2")


class Rpc:
    def __init__(self, url):
        self.url = url

    def call(self, method, params):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        req = urllib.request.Request(self.url, body, {"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                out = json.load(resp)
        except Exception as exc:  # never echo the URL
            sys.exit(f"rpc {method} failed: {type(exc).__name__}")
        if "error" in out:
            sys.exit(f"rpc {method} error: {out['error'].get('message')}")
        return out["result"]


def decode_tx(rpc, sig):
    tx = rpc.call("getTransaction", [sig, {"encoding": "json", "maxSupportedTransactionVersion": 0,
                                           "commitment": "confirmed"}])
    if tx is None or tx["meta"]["err"] is not None:
        return []
    msg = tx["transaction"]["message"]
    loaded = tx["meta"].get("loadedAddresses") or {}
    keys = msg["accountKeys"] + loaded.get("writable", []) + loaded.get("readonly", [])
    signers = msg["accountKeys"][: msg["header"]["numRequiredSignatures"]]
    events = []
    for ix in msg["instructions"]:
        if keys[ix["programIdIndex"]] != PROGRAM_ID:
            continue
        data = b58decode(ix["data"])
        acc = [keys[i] for i in ix["accounts"]]
        if data[:8] == DEPOSIT:
            # args: amount u64, commitment [u8;32], ...
            # accounts: vault, user (signer), user_wsol, vault_wsol, token_program
            events.append({
                "kind": "deposit", "sig": sig, "slot": tx["slot"],
                "amount": int.from_bytes(data[8:16], "little"),
                "commitment": data[16:48].hex(),
                "depositor": acc[1], "depositor_token_account": acc[2],
            })
        elif data[:8] == WITHDRAW_V2:
            # args: amount u64, nullifier_hash 32, root 32, proof_a 64, proof_b 128,
            # proof_c 64, public_inputs [[u8;32];8]
            # accounts: vault, mint, vault_token, receiver_token, receiver (signer), token_program
            off = 8 + 8 + 32 + 32 + 64 + 128 + 64
            pi = [data[off + 32 * i: off + 32 * (i + 1)] for i in range(8)]
            events.append({
                "kind": "withdraw_v2", "sig": sig, "slot": tx["slot"],
                "amount": int.from_bytes(data[8:16], "little"),
                "public_inputs_0_commitment": pi[0].hex(),
                "public_inputs_1_nullifier": pi[1].hex(),
                "public_inputs_3_amount": int.from_bytes(pi[3], "big"),
                "receiver_token_account": acc[3], "receiver": acc[4],
                "receiver_is_tx_signer": acc[4] in signers, "mint": acc[1],
            })
    return events


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--out")
    args = ap.parse_args()
    rpc = Rpc(os.environ.get("DEVNET_RPC_URL", "https://api.devnet.solana.com"))

    sigs = rpc.call("getSignaturesForAddress", [PROGRAM_ID, {"limit": args.limit}])
    deposits, withdrawals = [], []
    for s in sigs:
        if s.get("err") is not None:
            continue
        for ev in decode_tx(rpc, s["signature"]):
            (deposits if ev["kind"] == "deposit" else withdrawals).append(ev)

    pairs = []
    for w in withdrawals:
        by_commitment = [d for d in deposits if d["commitment"] == w["public_inputs_0_commitment"]]
        by_amount = [d for d in deposits if d["amount"] == w["amount"]]
        pairs.append({
            "withdrawal": w,
            "candidates_by_amount": len(by_amount),
            "candidates_by_commitment": len(by_commitment),
            "linked_deposits": by_commitment,
        })

    try:
        commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        commit = None
    linked = [p for p in pairs if p["candidates_by_commitment"] == 1]
    report = {
        "suite": "darknull-privacy-linkage-devnet",
        "repo": f"Dark-Null-Protocol@{commit}" if commit else "Dark-Null-Protocol",
        "cluster": "devnet",
        "rpc": "DEVNET_RPC_URL (not recorded)",
        "programId": PROGRAM_ID,
        "mode": "read-only: getSignaturesForAddress + getTransaction, no transactions sent",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "signatures_scanned": len(sigs),
        "deposits_decoded": len(deposits),
        "withdrawals_v2_decoded": len(withdrawals),
        "withdrawals_linked_to_exactly_one_deposit": len(linked),
        "result": "LINKABLE" if pairs and len(linked) == len(pairs) else "NOT_REPRODUCED",
        "observer_rule": "withdrawal public_inputs[0] == deposit instruction arg commitment",
        "pairs": pairs,
    }
    text = json.dumps(report, indent=2) + "\n"
    if args.out:
        with open(args.out, "w") as fh:
            fh.write(text)
    sys.stdout.write(text)
    return 0 if report["result"] == "LINKABLE" else 1


if __name__ == "__main__":
    sys.exit(main())
