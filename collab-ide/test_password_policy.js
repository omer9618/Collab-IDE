/**
 * Automated Test Suite for NFR-16: Password Policy Enforcement
 */

const { validateComplexity, checkPwnedPassword, validatePasswordPolicy } = require('./utils/passwordPolicy');

async function runTests() {
  console.log('================================================================');
  console.log(' RUNNING NFR-16 PASSWORD POLICY ENFORCEMENT TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName} - ${details}`);
      failed++;
    }
  }

  // ── TEST 1: Complexity Requirements ──────────────────────────────────────────
  console.log('--- 1. Testing Password Complexity Rules ---');

  const tooShort = validateComplexity('Ab1!');
  assert(!tooShort.isValid && !tooShort.details.length, 'Rejects password shorter than 8 chars');

  const noUpper = validateComplexity('abcdefg1!');
  assert(!noUpper.isValid && !noUpper.details.uppercase, 'Rejects password without uppercase letter');

  const noLower = validateComplexity('ABCDEFG1!');
  assert(!noLower.isValid && !noLower.details.lowercase, 'Rejects password without lowercase letter');

  const noDigit = validateComplexity('Abcdefgh!');
  assert(!noDigit.isValid && !noDigit.details.digit, 'Rejects password without numeric digit');

  const noSpecial = validateComplexity('Abcdefgh1');
  assert(!noSpecial.isValid && !noSpecial.details.special, 'Rejects password without special character');

  const validComplexity = validateComplexity('Abcdefg1!');
  assert(validComplexity.isValid, 'Accepts password meeting all complexity rules (8+ chars, upper, lower, digit, special)');

  // ── TEST 2: HaveIBeenPwned k-Anonymity Breach Detection ───────────────────────
  console.log('\n--- 2. Testing HaveIBeenPwned k-Anonymity Detection ---');

  const breached1 = await checkPwnedPassword('Password123!');
  assert(breached1.isPwned && breached1.breachCount > 1000, `Detects "Password123!" as breached (${breached1.breachCount} times)`);

  const breached2 = await checkPwnedPassword('Admin123!');
  assert(breached2.isPwned && breached2.breachCount > 0, `Detects "Admin123!" as breached (${breached2.breachCount} times)`);

  // Unbreached high-entropy candidate
  const unbreachedCandidate = 'Z9#qL2$mX7!vW4*pK1@t';
  const cleanResult = await checkPwnedPassword(unbreachedCandidate);
  assert(!cleanResult.isPwned && cleanResult.breachCount === 0, 'Confirms strong random password is not in breach database');

  // ── TEST 3: Comprehensive Policy Validation ──────────────────────────────────
  console.log('\n--- 3. Testing validatePasswordPolicy End-to-End ---');

  const policyWeak = await validatePasswordPolicy('weak');
  assert(!policyWeak.isValid && !policyWeak.isPwned, 'Weak password rejected immediately for complexity without breach call');

  const policyBreached = await validatePasswordPolicy('Password123!');
  assert(!policyBreached.isValid && policyBreached.isPwned && policyBreached.breachCount > 0, 'Complex breached password rejected with isPwned=true and breach count');

  const policyValid = await validatePasswordPolicy(unbreachedCandidate);
  assert(policyValid.isValid && !policyValid.isPwned, 'Strong, unique password accepted successfully');

  console.log('\n================================================================');
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
