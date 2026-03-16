use pdx_dark_protocol::{verifying_key, RootAuthorityConfig, Vault, VERIFYING_KEY, ID};

#[test]
fn canonical_root_is_bound_to_recovered_devnet_program() {
    assert_eq!(ID.to_string(), "2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF");
}

#[test]
fn verifying_key_metadata_is_live_not_placeholder() {
    assert_eq!(verifying_key::NR_PUBINPUTS, 3);
    assert_eq!(verifying_key::VK_IC_COUNT, 4);
    assert_eq!(VERIFYING_KEY.nr_pubinputs, 3);
}

#[test]
fn vault_window_layout_is_stable() {
    assert_eq!(std::mem::size_of::<Vault>(), 8856);
}

#[test]
fn root_authority_config_layout_is_stable() {
    assert_eq!(std::mem::size_of::<RootAuthorityConfig>(), 32);
}
