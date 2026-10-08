#![no_std]

mod invoice;
mod types;
mod verifier;

use invoice::{empty_commitment, load_invoice, save_invoice};
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};
use types::{DataKey, Invoice, InvoiceStatus, Proof, PublicSignals, VerificationKey, VerifierInputs};
use verifier::verify_groth16;

#[contract]
pub struct InvoiceVeilContract;

#[contractimpl]
impl InvoiceVeilContract {
    pub fn configure(env: Env, admin: Address, verification_key: VerificationKey) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::VerificationKey, &verification_key);
    }

    pub fn update_verification_key(env: Env, verification_key: VerificationKey) {
        let admin = Self::admin(&env);
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::VerificationKey, &verification_key);
    }

    pub fn register_invoice(
        env: Env,
        payer: Address,
        payee: Address,
        lo_bound: u64,
        hi_bound: u64,
    ) -> u64 {
        payer.require_auth();
        assert!(lo_bound < hi_bound, "invalid bounds");

        let id = Self::next_id(&env);
        let invoice = Invoice {
            id,
            payer,
            payee,
            lo_bound,
            hi_bound,
            commitment: empty_commitment(&env),
            status: InvoiceStatus::Pending,
        };

        save_invoice(&env, &invoice);
        env.events()
            .publish((Symbol::new(&env, "InvoiceRegistered"),), (id, lo_bound, hi_bound));
        id
    }

    pub fn settle_invoice(
        env: Env,
        payer: Address,
        id: u64,
        proof: Proof,
        signals: PublicSignals,
        verifier_inputs: VerifierInputs,
    ) {
        payer.require_auth();

        let mut invoice = load_invoice(&env, id);
        let verification_key = Self::verification_key(&env);
        assert!(invoice.payer == payer, "payer mismatch");
        assert!(matches!(invoice.status, InvoiceStatus::Pending), "invoice not pending");
        assert!(
            signals.commitment != empty_commitment(&env),
            "commitment cannot be zero"
        );
        assert!(signals.lo_bound == invoice.lo_bound, "lo_bound mismatch");
        assert!(signals.hi_bound == invoice.hi_bound, "hi_bound mismatch");
        assert!(
            verify_groth16(&env, &verification_key, &proof, &verifier_inputs)
                .unwrap_or(false),
            "invalid zk proof"
        );

        invoice.commitment = signals.commitment;
        invoice.status = InvoiceStatus::Settled;
        save_invoice(&env, &invoice);

        env.events()
            .publish((Symbol::new(&env, "InvoiceSettled"),), (id, invoice.commitment));
    }

    pub fn verify_disclosure(env: Env, id: u64, amount: u64, salt: u64) -> bool {
        let _invoice = load_invoice(&env, id);
        let _amount = amount;
        let _salt = salt;

        // Pending: Soroban currently exposes Poseidon through the hazmat interface.
        // Once we wire the BN254 Poseidon parameters safely, this method should
        // recompute the commitment and compare it with the stored invoice value.
        false
    }

    pub fn get_invoice(env: Env, id: u64) -> Invoice {
        load_invoice(&env, id)
    }

    pub fn cancel_invoice(env: Env, payer: Address, id: u64) {
        payer.require_auth();

        let mut invoice = load_invoice(&env, id);
        assert!(invoice.payer == payer, "payer mismatch");
        assert!(matches!(invoice.status, InvoiceStatus::Pending), "invoice not pending");

        invoice.status = InvoiceStatus::Cancelled;
        save_invoice(&env, &invoice);

        env.events()
            .publish((Symbol::new(&env, "InvoiceCancelled"),), (id,));
    }

    /// Returns the next invoice id and advances the stored counter.
    ///
    /// Ids are intentionally 0-based: the very first `register_invoice` call
    /// returns `0`, and each later call returns the previous counter value.
    fn next_id(env: &Env) -> u64 {
        let current: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        env.storage().instance().set(&DataKey::NextId, &(current + 1));
        current
    }

    fn admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not configured")
    }

    fn verification_key(env: &Env) -> VerificationKey {
        env.storage()
            .instance()
            .get(&DataKey::VerificationKey)
            .expect("verification key not configured")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn empty_commitment_is_zeroed_bytes() {
        let env = Env::default();
        let empty = empty_commitment(&env);
        assert_eq!(empty.to_array(), [0u8; 32]);
    }

    #[test]
    fn next_id_is_zero_based_and_advances() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(InvoiceVeilContract, ());
        let client = InvoiceVeilContractClient::new(&env, &contract_id);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        let first = client.register_invoice(&payer, &payee, &1u64, &2u64);
        let second = client.register_invoice(&payer, &payee, &1u64, &2u64);
        assert_eq!(first, 0);
        assert_eq!(second, 1);
        assert_eq!(client.get_invoice(&first).id, 0);
        assert_eq!(client.get_invoice(&second).id, 1);

        let next: u64 = env.as_contract(&contract_id, || {
            env.storage().instance().get(&DataKey::NextId).unwrap()
        });
        assert_eq!(next, 2);
    }
}
