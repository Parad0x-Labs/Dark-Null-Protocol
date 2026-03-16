#!/usr/bin/env python3

import json
from unittest.mock import Mock, patch

import pytest
from solders.keypair import Keypair

from dark_client import (
    DEFAULT_VK_PATH,
    DEFAULT_WASM_PATH,
    DEFAULT_ZKEY_PATH,
    DarkClient,
    PROGRAM_ID,
    anchor_discriminator,
    list_supported_networks,
    resolve_network_config,
)
from nebula_core import NebulaCore


class TestNebulaCompression:
    def setup_method(self):
        self.nebula = NebulaCore()

    def test_compression_decompression(self):
        original_data = {
            "to": "11111111111111111111111111111112",
            "memo": "Parad0x Dark Protocol Test Transaction",
            "timestamp": 1640995200,
            "amount": "1000000",
            "asset": "SOL",
        }

        compressed = self.nebula.compress(original_data)
        decompressed = self.nebula.decompress(compressed)
        assert decompressed == original_data

    def test_compression_ratio(self):
        large_data = {
            "transaction": {
                "sender": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                "receiver": "So11111111111111111111111111111111111111112",
                "amount": "5000000000",
                "fee": "5000",
                "memo": "Compression still works even though the canonical root moved to the recovered Groth16 track.",
                "timestamp": 1640995200,
            }
        }

        original_size = len(json.dumps(large_data).encode("utf-8"))
        compressed = self.nebula.compress(large_data)
        assert original_size / len(compressed) > 1.2

    def test_invalid_artifact(self):
        with pytest.raises(ValueError, match="Invalid Nebula Artifact"):
            self.nebula.decompress(b"INVALID")


class TestDarkClient:
    def setup_method(self):
        self.client = DarkClient()

    def test_network_config_matches_canonical_root(self):
        devnet = resolve_network_config("devnet")
        localnet = resolve_network_config("localnet")

        assert list_supported_networks() == ["devnet", "localnet"]
        assert devnet["program_id"] == str(PROGRAM_ID)
        assert devnet["rpc_url"] == "https://api.devnet.solana.com"
        assert localnet["rpc_url"] == "http://127.0.0.1:8899"
        assert self.client.program_id == PROGRAM_ID

    def test_build_proof_inputs_requires_seven_level_path(self):
        inputs = self.client.build_proof_inputs(
            amount=1_000_000,
            blinding=7,
            nullifier_secret=99,
            root=123,
            path_elements=[0, 0, 0, 0, 0, 0, 0],
            path_indices=[0, 0, 0, 0, 0, 0, 0],
        )
        assert inputs["amount"] == "1000000"
        assert inputs["pathIndices"] == [0] * 7

        with pytest.raises(ValueError, match="7 path elements"):
            self.client.build_proof_inputs(1, 2, 3, 4, [0], [0])

    def test_resolve_proving_artifacts_uses_canonical_defaults(self):
        zkey_path, wasm_path = self.client._resolve_proving_artifacts()
        assert zkey_path == DEFAULT_ZKEY_PATH
        assert wasm_path == DEFAULT_WASM_PATH
        assert DEFAULT_VK_PATH.exists()
        assert zkey_path.exists()
        assert wasm_path.exists()

    def test_build_prepare_withdraw_instruction_matches_anchor_layout(self):
        receiver = Keypair().pubkey()
        mint = Keypair().pubkey()
        receiver_token = Keypair().pubkey()
        proof_bundle = {
            "proof_a": b"A" * 64,
            "proof_b": b"B" * 128,
            "proof_c": b"C" * 64,
            "public_inputs": [b"D" * 32, b"E" * 32, b"F" * 32],
            "nullifier_hash": b"E" * 32,
            "root": b"F" * 32,
        }

        instruction = self.client.build_prepare_phantom_withdraw_instruction(
            receiver=receiver,
            mint=mint,
            receiver_token=receiver_token,
            amount=42,
            proof_bundle=proof_bundle,
        )

        assert instruction.data[:8] == anchor_discriminator("prepare_phantom_withdraw")
        assert int.from_bytes(instruction.data[8:16], "little") == 42
        assert len(instruction.data) == 432
        assert len(instruction.accounts) == 5

    def test_root_authority_pda_and_root_update_layout_are_canonical(self):
        signer = Keypair().pubkey()
        new_authority = Keypair().pubkey()

        init_instruction = self.client.build_initialize_instruction(user=signer)
        update_instruction = self.client.build_update_root_instruction(
            signer=signer,
            new_root=b"\x03" * 32,
        )
        rotate_instruction = self.client.build_rotate_root_authority_instruction(
            authority=signer,
            new_authority=new_authority,
        )

        assert len(init_instruction.accounts) == 4
        assert len(update_instruction.accounts) == 3
        assert len(rotate_instruction.accounts) == 2
        assert update_instruction.accounts[1].pubkey == self.client.derive_root_authority_pda()
        assert rotate_instruction.data[:8] == anchor_discriminator("rotate_root_authority")

    def test_build_deposit_instruction_serializes_anchor_bytes(self):
        user = Keypair().pubkey()
        user_wsol = Keypair().pubkey()
        vault_wsol = Keypair().pubkey()
        encrypted_note = b"secret-note"

        instruction = self.client.build_deposit_wsol_and_whisper_instruction(
            user=user,
            user_wsol=user_wsol,
            vault_wsol=vault_wsol,
            amount=123,
            commitment=b"\x01" * 32,
            encrypted_note=encrypted_note,
            ephemeral_pubkey=b"\x02" * 32,
            view_tag=7,
        )

        assert instruction.data[:8] == anchor_discriminator("deposit_wsol_and_whisper")
        assert int.from_bytes(instruction.data[8:16], "little") == 123
        payload_len = int.from_bytes(instruction.data[48:52], "little")
        assert payload_len == len(encrypted_note)
        assert len(instruction.accounts) == 5

    @patch("subprocess.run")
    def test_generate_withdraw_proof_parses_sections_and_public_inputs(self, mock_run):
        def write_outputs(cmd, check):
            proof_path = cmd[-2]
            public_path = cmd[-1]
            proof = {
                "pi_a": ["1", "2", "1"],
                "pi_b": [["3", "4"], ["5", "6"], ["1", "0"]],
                "pi_c": ["7", "8", "1"],
            }
            with open(proof_path, "w", encoding="utf8") as handle:
                json.dump(proof, handle)
            with open(public_path, "w", encoding="utf8") as handle:
                json.dump(["11", "12", "13"], handle)
            return Mock()

        mock_run.side_effect = write_outputs

        bundle = self.client.generate_withdraw_proof(
            amount=1_000_000,
            blinding=7,
            nullifier_secret=99,
            root=123456,
            path_elements=[0, 0, 0, 0, 0, 0, 0],
            path_indices=[0, 0, 0, 0, 0, 0, 0],
        )

        assert bundle["proof_a"] == (1).to_bytes(32, "big") + (2).to_bytes(32, "big")
        assert bundle["nullifier_hash"] == (12).to_bytes(32, "big")
        assert bundle["root"] == (13).to_bytes(32, "big")
        assert len(bundle["public_inputs"]) == 3


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
