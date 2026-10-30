# Admin receipt issues

The admin dashboard links to `/app/admin/receipt-issues`. Priority sorting keeps failures first and the oldest receipts first within each group. Choose Oldest first or Newest first for global chronological order, or click the Date header to reverse it. Resolved rows use their resolution date. Sorting stays selected through automatic refreshes. The queue includes failed extractions, receipts uploaded or processing for at least ten minutes, and incomplete receipts. Awaiting-user issues remain unresolved. Normally processing receipts are excluded unless a retry is already tracked as an open issue.

The all-time dashboard statistic is labeled **Total receipts** because it uses account receipt counts. **Processing finished today** includes successful and unsuccessful completed attempts; it is not a model accuracy metric.

## Workflow

- Review the original beside the extracted fields. The admin-only preview callable checks the selected receipt and file ownership on the server, so viewing another user’s receipt does not depend on client Storage metadata access. Existing download tokens are reused; tokenless uploads are returned inline to the authorized admin. PDFs use the browser viewer and HEIC images are converted for display. A missing source file does not prevent manual entry.
- **Run again** fills the values extraction can detect and keeps unsaved form edits through polling. **Save to user’s receipt** writes the entered values directly to the customer’s receipt; investigation notes are optional.
- Retry uses the same receipt. A transaction reserves a unique attempt; a server-only job triggers processing. Duplicate job deliveries and stale worker completions cannot restart or overwrite a newer attempt. Abandoned attempts become eligible for retry after ten minutes.
- Existing manual values and values edited during an attempt are preserved. A retry replaces values that still match their previous extraction. A retry resolves an issue only when merchant, positive total, currency and date validate; otherwise the issue stays open.
- Record a cause and note, then save verified corrections or resolve the existing values. Before/after values and extraction evidence stay in `users/{uid}/receipts/{id}/processingHistory`. Detailed history shows the latest 100 events, with older events retained.
- Awaiting user requires a note and does not send a message. Another receipt can be opened by owner ID and receipt ID, including a completed receipt with a reported mistake.
- Recurring problems group open and resolved issues by reason and cause. Selecting a pattern opens its examples across all history. These records support future evaluation; they do not automatically train a model.

Legacy review/stuck receipts are diagnosed from existing status, fields and timestamps. Historical provider errors and model versions are not invented. New attempts record a sanitized failure reason, stage, model and pipeline version. Provider error payloads remain in server logs. The model ID is shared with the processor; bump `RECEIPT_PIPELINE_VERSION` in `receipt-issue-policy.ts` when changing extraction prompts or validation behavior.

`receiptIssues` and `receiptProcessingJobs` deny direct client access. All reads and mutations use authenticated admin callables. Actions require the current receipt revision to prevent competing admin updates. Receipt deletion recursively removes its processing history and issue record; account deletion also removes the user-linked operational records through the existing deletion flow.

## Deployment

Deploy the index and rules before releasing the UI. Wait for the `receipts.status` collection-group index to finish building.

```sh
firebase deploy --only firestore:indexes,firestore:rules
firebase deploy --only functions:processReceipt,functions:processAdminReceiptRetry,functions:getAdminReceiptIssues,functions:getAdminReceiptIssue,functions:getAdminReceiptPreview,functions:actOnAdminReceiptIssue,functions:cleanupReceiptIssue
firebase deploy --only hosting
```

No receipt migration is required. The initial queue combines historical candidates with recorded issues. No existing receipts are automatically retried. The queue refreshes once a minute while visible; an active receipt workspace checks every five seconds. The queue loads complete issue summaries and paginates the table in groups of 25; its server-side queries should be paginated before substantially larger issue volumes.

## Verification

```sh
npm --prefix functions test
ng test --watch=false --browsers=ChromeHeadless --include='src/app/features/admin/receipt-issues.component.spec.ts'
npm run build
```

After deployment, use an admin test account to open an older review receipt, retry a failed test upload, correct its fields, and check resolved history. Confirm that a non-admin cannot invoke the callables. No production receipts need to be modified as part of local verification.
