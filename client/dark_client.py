import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

from solders.instruction import AccountMeta, Instruction
from solders.pubkey import Pubkey


REPO_ROOT = Path(__file__).resolve().parents[1]
CIRCUITS_DIR = REPO_ROOT / "circuits"
NETWORKS_PATH = REPO_ROOT / "NETWORKS.json"
DEFAULT_ZKEY_PATH = CIRCUITS_DIR / "null_proof_final.zkey"
DEFAULT_WASM_PATH = CIRCUITS_DIR / "null_proof_js" / "null_proof.wasm"
DEFAULT_VK_PATH = CIRCUITS_DIR / "vk.json"
NETWORKS = json.loads(NETWORKS_PATH.read_text(encoding="utf8"))
SUPPORTED_NETWORKS = NETWORKS["supportedNetworks"]

PROGRAM_ID = Pubkey.from_string(NETWORKS["canonicalProgramId"])
TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
SYSTEM_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")
VAULT_SEED = b"merkle_vault"
ROOT_AUTHORITY_SEED = b"root_authority"


def anchor_discriminator(name: str) -> bytes:
    return hashlib.sha256(f"global:{name}".encode("utf8")).digest()[:8]


def encode_anchor_bytes(value: bytes) -> bytes:
    return len(value).to_bytes(4, "little") + value


def coerce_bytes32(value) -> bytes:
    if isinstance(value, bytes):
        raw = value
    elif isinstance(value, bytearray):
        raw = bytes(value)
    elif isinstance(value, str):
        text = value[2:] if value.startswith("0x") else value
        raw = bytes.fromhex(text) if len(text) == 64 and all(ch in "0123456789abcdefABCDEF" for ch in text) else int(text).to_bytes(32, "big")
    elif isinstance(value, int):
        raw = value.to_bytes(32, "big")
    else:
        raw = bytes(value)

    if len(raw) != 32:
        raise ValueError(f"Expected 32 bytes, received {len(raw)}")
    return raw


def list_supported_networks():
    return list(SUPPORTED_NETWORKS.keys())


def resolve_network_config(network=None, rpc_url=None, wallet_path=None):
    selected_network = network or os.environ.get("DARK_NULL_NETWORK") or NETWORKS["defaultNetwork"]
    definition = SUPPORTED_NETWORKS.get(selected_network)
    if definition is None:
        known_networks = ", ".join(list_supported_networks())
        raise ValueError(f"Unknown network: {selected_network}. Expected one of {known_networks}")

    return {
        "network": selected_network,
        "label": definition["label"],
        "cluster": definition["cluster"],
        "anchor_cluster": definition["anchorCluster"],
        "rpc_url": rpc_url or os.environ.get("DARK_NULL_RPC_URL") or definition["rpcUrl"],
        "ws_url": definition.get("wsUrl"),
        "wallet_path": wallet_path or os.environ.get("DARK_NULL_WALLET_PATH"),
        "program_id": NETWORKS["canonicalProgramId"],
        "manifest_key": definition["manifestKey"],
    }


class DarkClient:
    def __init__(self, snarkjs_path=None, zkey_path=None, wasm_path=None, vk_path=None, network=None, rpc_url=None, wallet_path=None):
        self.network_config = resolve_network_config(network=network, rpc_url=rpc_url, wallet_path=wallet_path)
        self.program_id = Pubkey.from_string(self.network_config["program_id"])
        self.rpc_url = self.network_config["rpc_url"]
        self.wallet_path = self.network_config["wallet_path"]
        self.snarkjs_path = snarkjs_path or os.environ.get("DARK_NULL_SNARKJS")
        self.zkey_path = Path(zkey_path) if zkey_path else Path(os.environ.get("DARK_NULL_ZKEY_PATH", DEFAULT_ZKEY_PATH))
        self.wasm_path = Path(wasm_path) if wasm_path else Path(os.environ.get("DARK_NULL_WASM_PATH", DEFAULT_WASM_PATH))
        self.vk_path = Path(vk_path) if vk_path else Path(os.environ.get("DARK_NULL_VK_PATH", DEFAULT_VK_PATH))

    def derive_vault_pda(self, program_id=None):
        program_id = program_id or self.program_id
        return Pubkey.find_program_address([VAULT_SEED], program_id)[0]

    def derive_root_authority_pda(self, program_id=None):
        program_id = program_id or self.program_id
        return Pubkey.find_program_address([ROOT_AUTHORITY_SEED], program_id)[0]

    def build_proof_inputs(self, amount, blinding, nullifier_secret, root, path_elements, path_indices):
        if len(path_elements) != 7 or len(path_indices) != 7:
            raise ValueError("null_proof requires 7 path elements and 7 path indices")

        return {
            "amount": str(int(amount)),
            "blinding": str(int(blinding)),
            "nullifier_secret": str(int(nullifier_secret)),
            "root": str(int(root)),
            "pathElements": [str(int(value)) for value in path_elements],
            "pathIndices": [int(value) for value in path_indices],
        }

    def generate_withdraw_proof(self, amount, blinding, nullifier_secret, root, path_elements, path_indices):
        proof_inputs = self.build_proof_inputs(amount, blinding, nullifier_secret, root, path_elements, path_indices)
        zkey_path, wasm_path = self._resolve_proving_artifacts()

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            input_path = temp_path / "input.json"
            proof_path = temp_path / "proof.json"
            public_path = temp_path / "public.json"

            input_path.write_text(json.dumps(proof_inputs), encoding="utf8")

            subprocess.run(
                [
                    self._resolve_snarkjs_command(),
                    "groth16",
                    "fullprove",
                    str(input_path),
                    str(wasm_path),
                    str(zkey_path),
                    str(proof_path),
                    str(public_path),
                ],
                check=True,
            )

            proof = json.loads(proof_path.read_text(encoding="utf8"))
            public_signals = json.loads(public_path.read_text(encoding="utf8"))
            proof_a, proof_b, proof_c = self._proof_to_sections(proof)
            public_inputs = self._public_signals_to_bytes(public_signals)

            return {
                "proof": proof,
                "public_signals": public_signals,
                "proof_a": proof_a,
                "proof_b": proof_b,
                "proof_c": proof_c,
                "public_inputs": public_inputs,
                "commitment": public_inputs[0],
                "nullifier_hash": public_inputs[1],
                "root": public_inputs[2],
            }

    def verify_proof_locally(self, proof, public_signals):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            proof_path = temp_path / "proof.json"
            public_path = temp_path / "public.json"

            proof_path.write_text(json.dumps(proof), encoding="utf8")
            public_path.write_text(json.dumps(public_signals), encoding="utf8")

            subprocess.run(
                [
                    self._resolve_snarkjs_command(),
                    "groth16",
                    "verify",
                    str(self.vk_path),
                    str(public_path),
                    str(proof_path),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            return True

    def build_initialize_instruction(self, user, vault=None, program_id=None):
        program_id = program_id or self.program_id
        vault = vault or self.derive_vault_pda(program_id)
        root_authority = self.derive_root_authority_pda(program_id)
        return Instruction(
            program_id,
            anchor_discriminator("initialize"),
            [
                AccountMeta(vault, False, True),
                AccountMeta(root_authority, False, True),
                AccountMeta(user, True, True),
                AccountMeta(SYSTEM_PROGRAM_ID, False, False),
            ],
        )

    def build_update_root_instruction(self, signer, new_root, vault=None, program_id=None):
        program_id = program_id or self.program_id
        vault = vault or self.derive_vault_pda(program_id)
        root_authority = self.derive_root_authority_pda(program_id)
        data = bytearray(anchor_discriminator("update_root"))
        data.extend(coerce_bytes32(new_root))
        return Instruction(
            program_id,
            bytes(data),
            [
                AccountMeta(vault, False, True),
                AccountMeta(root_authority, False, False),
                AccountMeta(signer, True, False),
            ],
        )

    def build_rotate_root_authority_instruction(self, authority, new_authority, program_id=None):
        program_id = program_id or self.program_id
        root_authority = self.derive_root_authority_pda(program_id)
        data = bytearray(anchor_discriminator("rotate_root_authority"))
        data.extend(bytes(new_authority))
        return Instruction(
            program_id,
            bytes(data),
            [
                AccountMeta(root_authority, False, True),
                AccountMeta(authority, True, False),
            ],
        )

    def build_deposit_wsol_and_whisper_instruction(
        self,
        user,
        user_wsol,
        vault_wsol,
        amount,
        commitment,
        encrypted_note,
        ephemeral_pubkey,
        view_tag,
        vault=None,
        program_id=None,
    ):
        program_id = program_id or self.program_id
        vault = vault or self.derive_vault_pda(program_id)
        data = bytearray(anchor_discriminator("deposit_wsol_and_whisper"))
        data.extend(int(amount).to_bytes(8, "little"))
        data.extend(coerce_bytes32(commitment))
        data.extend(encode_anchor_bytes(bytes(encrypted_note)))
        data.extend(coerce_bytes32(ephemeral_pubkey))
        data.append(int(view_tag) & 0xFF)

        return Instruction(
            program_id,
            bytes(data),
            [
                AccountMeta(vault, False, True),
                AccountMeta(user, True, True),
                AccountMeta(user_wsol, False, True),
                AccountMeta(vault_wsol, False, True),
                AccountMeta(TOKEN_PROGRAM_ID, False, False),
            ],
        )

    def build_prepare_phantom_withdraw_instruction(
        self,
        receiver,
        mint,
        receiver_token,
        amount,
        proof_bundle,
        vault=None,
        program_id=None,
    ):
        program_id = program_id or self.program_id
        vault = vault or self.derive_vault_pda(program_id)
        proof_a = bytes(proof_bundle["proof_a"])
        proof_b = bytes(proof_bundle["proof_b"])
        proof_c = bytes(proof_bundle["proof_c"])
        public_inputs = [coerce_bytes32(value) for value in proof_bundle["public_inputs"]]
        root = coerce_bytes32(proof_bundle["root"])
        nullifier_hash = coerce_bytes32(proof_bundle["nullifier_hash"])

        if len(proof_a) != 64 or len(proof_b) != 128 or len(proof_c) != 64:
            raise ValueError("Groth16 sections must be 64/128/64 bytes")
        if len(public_inputs) != 3:
            raise ValueError("prepare_phantom_withdraw requires exactly 3 public inputs")
        if public_inputs[1] != nullifier_hash or public_inputs[2] != root:
            raise ValueError("public_inputs must match the nullifier_hash/root instruction arguments")

        data = bytearray(anchor_discriminator("prepare_phantom_withdraw"))
        data.extend(int(amount).to_bytes(8, "little"))
        data.extend(nullifier_hash)
        data.extend(root)
        data.extend(proof_a)
        data.extend(proof_b)
        data.extend(proof_c)
        for value in public_inputs:
            data.extend(value)

        return Instruction(
            program_id,
            bytes(data),
            [
                AccountMeta(vault, False, True),
                AccountMeta(mint, False, True),
                AccountMeta(receiver_token, False, True),
                AccountMeta(receiver, True, False),
                AccountMeta(TOKEN_PROGRAM_ID, False, False),
            ],
        )

    def build_burn_and_whisper_instruction(
        self,
        user,
        mint,
        user_token,
        amount,
        commitment,
        encrypted_note,
        ephemeral_pubkey,
        view_tag,
        vault=None,
        program_id=None,
    ):
        program_id = program_id or self.program_id
        vault = vault or self.derive_vault_pda(program_id)
        data = bytearray(anchor_discriminator("burn_and_whisper"))
        data.extend(int(amount).to_bytes(8, "little"))
        data.extend(coerce_bytes32(commitment))
        data.extend(encode_anchor_bytes(bytes(encrypted_note)))
        data.extend(coerce_bytes32(ephemeral_pubkey))
        data.append(int(view_tag) & 0xFF)

        return Instruction(
            program_id,
            bytes(data),
            [
                AccountMeta(vault, False, True),
                AccountMeta(user, True, True),
                AccountMeta(mint, False, True),
                AccountMeta(user_token, False, True),
                AccountMeta(TOKEN_PROGRAM_ID, False, False),
            ],
        )

    def _proof_to_sections(self, proof):
        proof_json = proof["proof"] if "proof" in proof else proof

        proof_a = self._snarkjs_int_to_bytes(proof_json["pi_a"][0]) + self._snarkjs_int_to_bytes(proof_json["pi_a"][1])
        proof_b = (
            self._snarkjs_int_to_bytes(proof_json["pi_b"][0][0])
            + self._snarkjs_int_to_bytes(proof_json["pi_b"][0][1])
            + self._snarkjs_int_to_bytes(proof_json["pi_b"][1][0])
            + self._snarkjs_int_to_bytes(proof_json["pi_b"][1][1])
        )
        proof_c = self._snarkjs_int_to_bytes(proof_json["pi_c"][0]) + self._snarkjs_int_to_bytes(proof_json["pi_c"][1])

        return proof_a, proof_b, proof_c

    def _public_signals_to_bytes(self, public_signals):
        if len(public_signals) != 3:
            raise ValueError(f"Expected 3 public signals, received {len(public_signals)}")
        return [self._snarkjs_int_to_bytes(value) for value in public_signals]

    def _snarkjs_int_to_bytes(self, value):
        if isinstance(value, str) and value.startswith("0x"):
            return int(value, 16).to_bytes(32, "big")
        return int(value).to_bytes(32, "big")

    def _resolve_snarkjs_command(self):
        if getattr(self, "snarkjs_path", None):
            return self.snarkjs_path

        local_binary = REPO_ROOT / "node_modules" / ".bin" / "snarkjs"
        if local_binary.exists():
            return str(local_binary)

        return "snarkjs"

    def _resolve_proving_artifacts(self):
        missing = [str(path) for path in (self.zkey_path, self.wasm_path, self.vk_path) if not path.exists()]
        if missing:
            raise FileNotFoundError(
                "Missing canonical proving artifacts: "
                + ", ".join(missing)
                + ". Set DARK_NULL_ZKEY_PATH, DARK_NULL_WASM_PATH, and DARK_NULL_VK_PATH if they live elsewhere."
            )
        return self.zkey_path, self.wasm_path
