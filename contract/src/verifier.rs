use soroban_sdk::{contracterror, crypto::bn254::Bn254G1Affine, vec, Env};

use crate::types::{Proof, VerificationKey, VerifierInputs};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Groth16Error {
    MalformedVerifyingKey = 1,
}

// Adapted to BN254 using Soroban's native host functions. The verification key
// is supplied separately so it can be populated after exporting the circuit VK.
pub fn verify_groth16(
    env: &Env,
    vk: &VerificationKey,
    proof: &Proof,
    verifier_inputs: &VerifierInputs,
) -> Result<bool, Groth16Error> {
    if verifier_inputs.inputs.len() + 1 != vk.ic.len() {
        return Err(Groth16Error::MalformedVerifyingKey);
    }

    let bn254 = env.crypto().bn254();
    let mut vk_x = if is_identity_g1(&vk.ic.get(0).unwrap()) {
        None
    } else {
        Some(vk.ic.get(0).unwrap())
    };

    for (scalar, point) in verifier_inputs.inputs.iter().zip(vk.ic.iter().skip(1)) {
        if is_identity_g1(&point) {
            continue;
        }

        let prod = bn254.g1_mul(&point, &scalar);
        vk_x = Some(match vk_x {
            Some(acc) => bn254.g1_add(&acc, &prod),
            None => prod,
        });
    }

    let neg_a = -proof.a.clone();
    let mut vp1 = vec![env, neg_a, vk.alpha.clone()];
    let mut vp2 = vec![env, proof.b.clone(), vk.beta.clone()];

    if let Some(acc) = vk_x {
        vp1.push_back(acc);
        vp2.push_back(vk.gamma.clone());
    }

    vp1.push_back(proof.c.clone());
    vp2.push_back(vk.delta.clone());

    Ok(bn254.pairing_check(vp1, vp2))
}

fn is_identity_g1(point: &Bn254G1Affine) -> bool {
    // BN254 G1 points at infinity are encoded as 64 zero bytes
    // (see the Bn254G1Affine serialization contract in soroban-sdk).
    point.to_array() == [0u8; 64]
}


#[cfg(test)]
mod tests {
    use super::{is_identity_g1, verify_groth16, Groth16Error};
    use crate::types::{Proof, VerificationKey, VerifierInputs};
    use soroban_sdk::crypto::bn254::{Bn254G1Affine, Bn254G2Affine};
    use soroban_sdk::{vec, Env};

    // alt_bn128 G1 generator (X = 1, Y = 2), big-endian uncompressed encoding.
    const G1_GEN: [u8; 64] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2];
    // alt_bn128 G2 generator, uncompressed be(c1) || be(c0) per Fp2 coordinate.
    const G2_GEN: [u8; 128] = [25, 142, 147, 147, 146, 13, 72, 58, 114, 96, 191, 183, 49, 251, 93, 37, 241, 170, 73, 51, 53, 169, 231, 18, 151, 228, 133, 183, 174, 243, 18, 194, 24, 0, 222, 239, 18, 31, 30, 118, 66, 106, 0, 102, 94, 92, 68, 121, 103, 67, 34, 212, 247, 94, 218, 221, 70, 222, 189, 92, 217, 146, 246, 237, 9, 6, 137, 208, 88, 95, 240, 117, 236, 158, 153, 173, 105, 12, 51, 149, 188, 75, 49, 51, 112, 179, 142, 243, 85, 172, 218, 220, 209, 34, 151, 91, 18, 200, 94, 165, 219, 140, 109, 235, 74, 171, 113, 128, 141, 203, 64, 143, 227, 209, 231, 105, 12, 67, 211, 123, 76, 230, 204, 1, 102, 250, 125, 170];

    fn g1(env: &Env, bytes: &[u8; 64]) -> Bn254G1Affine {
        Bn254G1Affine::from_array(env, bytes)
    }

    fn g2(env: &Env, bytes: &[u8; 128]) -> Bn254G2Affine {
        Bn254G2Affine::from_array(env, bytes)
    }

    fn infinity(env: &Env) -> Bn254G1Affine {
        g1(env, &[0u8; 64])
    }

    fn fixture_vk(env: &Env) -> VerificationKey {
        let g1_gen = g1(env, &G1_GEN);
        let g2_gen = g2(env, &G2_GEN);
        VerificationKey {
            alpha: g1_gen.clone(),
            beta: g2_gen.clone(),
            gamma: g2_gen.clone(),
            delta: g2_gen.clone(),
            ic: vec![env, infinity(env)],
        }
    }

    #[test]
    fn malformed_verifying_key_returns_error() {
        let env = Env::default();
        let mut vk = fixture_vk(&env);
        // With zero public inputs exactly one ic point is required; dropping it
        // trips the `inputs.len() + 1 != vk.ic.len()` guard.
        vk.ic = vec![&env];
        let proof = Proof {
            a: g1(&env, &G1_GEN),
            b: g2(&env, &G2_GEN),
            c: infinity(&env),
        };
        let inputs = VerifierInputs { inputs: vec![&env] };
        assert_eq!(
            verify_groth16(&env, &vk, &proof, &inputs),
            Err(Groth16Error::MalformedVerifyingKey)
        );
    }

    #[test]
    fn infinity_encoding_is_identity() {
        let env = Env::default();
        assert!(is_identity_g1(&infinity(&env)));
    }

    #[test]
    fn normal_point_is_not_identity() {
        let env = Env::default();
        assert!(!is_identity_g1(&g1(&env, &G1_GEN)));
    }

    #[test]
    fn well_formed_fixture_verifies() {
        let env = Env::default();
        let vk = fixture_vk(&env);
        let proof = Proof {
            a: g1(&env, &G1_GEN),
            b: g2(&env, &G2_GEN),
            c: infinity(&env),
        };
        let inputs = VerifierInputs { inputs: vec![&env] };
        assert_eq!(verify_groth16(&env, &vk, &proof, &inputs), Ok(true));
    }

    #[test]
    fn non_cancelling_proof_is_rejected() {
        let env = Env::default();
        let vk = fixture_vk(&env);
        // A non-infinity C point leaves the pairing product unbalanced.
        let proof = Proof {
            a: g1(&env, &G1_GEN),
            b: g2(&env, &G2_GEN),
            c: g1(&env, &G1_GEN),
        };
        let inputs = VerifierInputs { inputs: vec![&env] };
        assert_eq!(verify_groth16(&env, &vk, &proof, &inputs), Ok(false));
    }
}
