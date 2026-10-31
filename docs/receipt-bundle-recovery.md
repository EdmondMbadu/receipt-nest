# Recovering a reviewed receipt bundle

This is an admin recovery procedure for a PDF already confirmed to contain one
receipt per page. It is not automatic multi-receipt detection. Receipts spanning
multiple pages must be reviewed and grouped separately before using a different
recovery procedure.

Keep the customer PDF and the reviewed manifest outside version control. The
repository's `output/` directory is ignored. A recovery directory contains
`original.pdf`, `manifest.json`, and `pdf/receipt-01.pdf`, etc.

For every page, visually verify the merchant, transaction date, currency, amount
paid and category. Preserve ambiguous annotations in notes. Do not confuse
tendered cash, change, account balance, inclusive GST or attached payment slips
with another purchase. Bind the reviewed source and split files to SHA-256
checksums in the manifest, and compare each rendered split against its source
page. The manifest validator in `scripts/lib/receipt-bundle-recovery.mjs` defines
the required fields.

Use the existing Firebase CLI login for the project. The connector can inspect
documents but cannot upload the split PDFs or perform the required atomic
recovery transaction, so the admin script uses the installed Google Cloud SDKs
with the CLI account. Credentials are never printed or written into the recovery
directory.

```sh
node scripts/recover-receipt-bundle.mjs --dry-run --manifest /absolute/path/manifest.json
node scripts/recover-receipt-bundle.mjs --apply --manifest /absolute/path/manifest.json
node scripts/recover-receipt-bundle.mjs --verify --manifest /absolute/path/manifest.json
```

The first receipt retains the existing document ID; later pages receive stable
IDs. Each receipt's primary file is its individual one-page PDF. `sourceBundle`
holds the unchanged original's path, checksum, filename and page provenance, and
the receipt detail views offer a separate original-bundle link. The original PDF
is never overwritten or deleted and is not retained as an extra expense record.
Recovered one-page PDFs render through the existing PDF thumbnail service so
browser PDF-plugin restrictions cannot leave a blank embedded preview. Downloads
still return the individual PDF. Admin original-bundle links use the existing
authorized preview callable with `sourceBundle: true`; the server selects the
stored source path and validates ownership, without relying on cross-user client
Storage metadata access.

Uploads use generation preconditions and verify existing content on retries.
The transaction checks the original receipt revision and account receipt count,
then writes all receipts, their history, issue resolution and an audit record
together. `receiptBundleRecoveries/{recoveryId}` contains the complete original
receipt snapshot and reviewed manifest; it has no client access under the
existing default-deny rules. Recovery does not modify existing authentication,
billing, preferences or notification settings.

Recovered receipts contain verified manual values and `skipProcessing: true`
to prevent creation events from running extraction over them. Existing receipt
creation triggers increment the account count for the additional records. Allow
those triggers to finish, then require `--verify` to pass, including the profile
count. The verification downloads every saved PDF again, checks its checksum
and one-page structure, reads every saved value and history event, reconciles
totals, checks source provenance, and verifies the original checksum again.
`verification.json` records the result. A completed recovery can be rerun without
creating more records; a changed manifest is rejected.

No recovery command sends email or invokes customer-message functions. Contact
the customer separately after recovery has been verified.

## Checks

```sh
node --test scripts/test/receipt-bundle-recovery.test.mjs
npm --prefix functions run build
node --test functions/test/receipt-issues.test.cjs
node --test functions/test/receipt-preview.test.cjs
CI=true ng test --watch=false --browsers=ChromeHeadless --include='src/app/features/admin/receipt-issues*.spec.ts' --include='src/app/features/receipt-detail/receipt-detail.component.spec.ts' --include='src/app/components/receipt-page-preview/receipt-page-preview.component.spec.ts'
CI=true npm run build
```
