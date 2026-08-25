use pdx_dark_protocol::{verifying_key, RootAuthorityConfig, Vault, VERIFYING_KEY, ID};

#[test]
fn canonical_root_is_bound_to_recovered_devnet_program() {
    assert_eq!(ID.to_string(), "35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV");
}

#[test]
fn verifying_key_metadata_is_live_not_placeholder() {
    assert_eq!(verifying_key::NR_PUBINPUTS, 8);
    assert_eq!(verifying_key::VK_IC_COUNT, 9);
    assert_eq!(VERIFYING_KEY.nr_pubinputs, 8);
}

#[test]
fn vault_window_layout_is_stable() {
    // H1 fix moved nullifiers out of the fixed 128-slot window into page PDAs,
    // shrinking the vault account; the layout must stay pinned at this size.
    assert_eq!(std::mem::size_of::<Vault>(), 5784);
}

#[test]
fn root_authority_config_layout_is_stable() {
    assert_eq!(std::mem::size_of::<RootAuthorityConfig>(), 32);
}
