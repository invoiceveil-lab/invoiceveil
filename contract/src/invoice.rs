use soroban_sdk::{BytesN, Env};

use crate::types::{DataKey, Invoice};

pub fn load_invoice(env: &Env, id: u64) -> Invoice {
    env.storage()
        .persistent()
        .get(&DataKey::Invoice(id))
        .expect("invoice not found")
}

pub fn save_invoice(env: &Env, invoice: &Invoice) {
    let key = DataKey::Invoice(invoice.id);
    env.storage().persistent().set(&key, invoice);
    // Persistent entries can expire; every write pushes the invoice's TTL back
    // out so a settled invoice stays readable (and auditable) long after the
    // settlement transaction lands.
    env.storage().persistent().extend_ttl(
        &key,
        crate::PERSISTENT_TTL_THRESHOLD,
        crate::PERSISTENT_TTL_EXTEND_TO,
    );
}

pub fn empty_commitment(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}
