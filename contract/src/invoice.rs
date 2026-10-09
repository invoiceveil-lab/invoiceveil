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


#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::InvoiceStatus;
    use crate::InvoiceVeilContract;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, BytesN, Env};

    fn sample_invoice(env: &Env, id: u64) -> Invoice {
        Invoice {
            id,
            payer: Address::generate(env),
            payee: Address::generate(env),
            lo_bound: 10_000,
            hi_bound: 50_000,
            commitment: BytesN::from_array(env, &[7u8; 32]),
            status: InvoiceStatus::Pending,
        }
    }

    #[test]
    fn save_then_load_round_trips_every_field() {
        let env = Env::default();
        let contract_id = env.register(InvoiceVeilContract, ());
        let invoice = sample_invoice(&env, 7);

        env.as_contract(&contract_id, || {
            save_invoice(&env, &invoice);
            let loaded = load_invoice(&env, 7);
            assert_eq!(loaded.id, invoice.id);
            assert_eq!(loaded.payer, invoice.payer);
            assert_eq!(loaded.payee, invoice.payee);
            assert_eq!(loaded.lo_bound, invoice.lo_bound);
            assert_eq!(loaded.hi_bound, invoice.hi_bound);
            assert_eq!(loaded.commitment, invoice.commitment);
            assert_eq!(loaded.status, invoice.status);
            assert_eq!(loaded, invoice);
        });
    }

    #[test]
    #[should_panic(expected = "invoice not found")]
    fn load_missing_invoice_panics() {
        let env = Env::default();
        let contract_id = env.register(InvoiceVeilContract, ());
        env.as_contract(&contract_id, || {
            let _ = load_invoice(&env, 42);
        });
    }
}
