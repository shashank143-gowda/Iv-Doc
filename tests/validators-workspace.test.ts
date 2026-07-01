import assert from "node:assert/strict";
import test from "node:test";
import {
  validateBIC,
  validateIBAN,
  validateRequired,
  runSanityChecks,
  runValidationShield,
  type FieldDetailsMap,
} from "../src/lib/validators";
import { runPackageValidation } from "../src/lib/workspace";

test("validates IBAN checksum and BIC structure", () => {
  assert.equal(validateIBAN("GB82 WEST 1234 5698 7654 32").status, "pass");
  assert.equal(validateIBAN("GB82 TEST 1234").status, "fail");
  assert.equal(validateBIC("BOFAUS3N").status, "pass");
  assert.equal(validateBIC("BAD").status, "fail");
});

test("invalid IBAN preserves the original value and never generates a replacement", () => {
  const bad = "AE320260001015432870201";
  const check = validateIBAN(bad);
  assert.equal(check.status, "fail");
  assert.match(check.detail ?? "", /checksum failed/i);
  // The detail must echo the exact extracted value — no corrected IBAN.
  assert.ok(
    (check.detail ?? "").includes(bad),
    "validator must preserve the original extracted IBAN verbatim",
  );

  // Run through the full shield and ensure no check emits a "corrected"
  // IBAN — every IBAN-bearing detail string must contain the original.
  const checks = runValidationShield("swift_mt103", {
    sender: "ACME",
    beneficiary: "Globex",
    amount: "1000",
    currency: "AED",
    iban: bad,
  });
  const ibanCheck = checks.find((c) => c.id === "iban");
  assert.ok(ibanCheck);
  assert.equal(ibanCheck!.status, "fail");
  assert.ok((ibanCheck!.detail ?? "").includes(bad));
  // No check should surface a different IBAN-shaped string than the original.
  for (const c of checks) {
    const matches = (c.detail ?? "").match(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g);
    if (!matches) continue;
    for (const m of matches) {
      assert.equal(
        m,
        bad,
        `validator emitted an alternative IBAN (${m}) instead of preserving the original`,
      );
    }
  }
});

test("payslip bank identifiers are preserved without IBAN checksum failure", () => {
  const raw = "AE320260001015432870201";
  const checks = runValidationShield("payslip", {
    employee_name: "Maya Shah",
    net_pay: "12000",
    currency: "AED",
    iban: raw,
  });
  const ibanCheck = checks.find((c) => c.id === "iban");
  assert.ok(ibanCheck);
  assert.equal(ibanCheck!.status, "skipped");
  assert.equal(ibanCheck!.label, "Payslip bank identifier");
  assert.ok((ibanCheck!.detail ?? "").includes(raw));
  assert.doesNotMatch(ibanCheck!.detail ?? "", /checksum failed/i);
});

test("routes failed document validation to exception review", () => {
  const checks = runValidationShield("swift_mt103", {
    sender: "ACME",
    beneficiary: "ACME",
    amount: "250000",
    currency: "USD",
  });

  assert.ok(
    checks.some(
      (check) =>
        check.id === "x:sender-vs-beneficiary" && check.status === "fail",
    ),
  );
});

test("runs package-level name consistency checks across completed documents", () => {
  const result = runPackageValidation([
    {
      id: "passport",
      fileName: "passport.pdf",
      fields: { full_name: "Maya Shah", document_number: "P1234567" },
      fieldConfidence: {},
      validation: [],
      decision: "auto_approve",
    },
    {
      id: "payslip",
      fileName: "payslip.pdf",
      fields: {
        employee_name: "Maya Shah",
        net_pay: "12000",
        deposit_amount: "11800",
      },
      fieldConfidence: {},
      validation: [],
      decision: "auto_approve",
    },
  ]);

  assert.equal(result.decision, "auto_approve");
  assert.ok(
    result.checks.some(
      (check) => check.id === "pkg:name-consistency" && check.status === "pass",
    ),
  );
});

test("warns package review when applicant names conflict", () => {
  const result = runPackageValidation([
    {
      id: "passport",
      fileName: "passport.pdf",
      fields: { full_name: "Maya Shah" },
      fieldConfidence: {},
      validation: [],
      decision: "auto_approve",
    },
    {
      id: "payslip",
      fileName: "payslip.pdf",
      fields: { employee_name: "Noor Khan" },
      fieldConfidence: {},
      validation: [],
      decision: "auto_approve",
    },
  ]);

  assert.equal(result.decision, "exception_queue");
  assert.ok(
    result.checks.some(
      (check) => check.id === "pkg:name-consistency" && check.status === "warn",
    ),
  );
});

test("validateRequired: required field with value passes", () => {
  const checks = validateRequired(
    { customer_name: "Maya Shah" },
    ["customer_name"],
  );
  const c = checks.find((c) => c.id === "req:customer_name");
  assert.ok(c);
  assert.equal(c!.status, "pass");
});

test("validateRequired: required field marked redacted does not fail as missing", () => {
  const details: FieldDetailsMap = {
    customer_name: { status: "redacted", value: null, page: 1, confidence: 0.9 },
  };
  const checks = validateRequired({}, ["customer_name"], details);
  const c = checks.find((c) => c.id === "req:customer_name");
  assert.ok(c);
  assert.equal(c!.status, "skipped");
  assert.match(c!.detail ?? "", /redacted/i);
});

test("validateRequired: required field marked not_present fails", () => {
  const details: FieldDetailsMap = {
    customer_name: { status: "not_present", value: null, page: null, confidence: 1 },
  };
  const checks = validateRequired({}, ["customer_name"], details);
  const c = checks.find((c) => c.id === "req:customer_name");
  assert.ok(c);
  assert.equal(c!.status, "fail");
});

test("validateRequired: required field absent from both fields and field_details fails", () => {
  const checks = validateRequired({}, ["customer_name"], {});
  const c = checks.find((c) => c.id === "req:customer_name");
  assert.ok(c);
  assert.equal(c!.status, "fail");
});

test("runSanityChecks: redacted required fields don't fail completeness and emit a skipped check", () => {
  const fields = {
    contract_number: "C-1",
    id_number: "X",
    loan_amount: "1000",
    profit_rate: "5",
    number_of_installments: "12",
    installment_amount: "100",
    contract_date: "2025-01-01",
    maturity_date: "2026-01-01",
  };
  const details: FieldDetailsMap = {
    customer_name: { status: "redacted", value: null, page: 1, confidence: 0.9 },
  };
  const checks = runSanityChecks({
    docType: "loan_contract",
    rawText: "x".repeat(500),
    pageCount: 1,
    fields,
    fieldDetails: details,
  });
  const completeness = checks.find((c) => c.id === "sanity:field-completeness");
  assert.ok(completeness);
  assert.equal(completeness!.status, "pass");
  const redactedCheck = checks.find((c) => c.id === "sanity:redacted:customer_name");
  assert.ok(redactedCheck);
  assert.equal(redactedCheck!.status, "skipped");
});
