/**
 * Firebase discovery and all other functions retain the original entry point.
 * Receipt workers avoid loading unrelated billing, email and rendering modules
 * every time Cloud Run starts an instance.
 */
const target = process.env.FUNCTION_TARGET;
if (target === "processReceipt" || target === "processAdminReceiptRetry") {
  const admin: typeof import("firebase-admin") = require("firebase-admin");
  const { setGlobalOptions }: typeof import("firebase-functions") = require("firebase-functions");
  if (!admin.apps.length) {
    admin.initializeApp();
    admin.firestore().settings({ ignoreUndefinedProperties: true });
  }
  setGlobalOptions({ maxInstances: 10 });
  const workers: typeof import("./receipt-processor") = require("./receipt-processor");
  module.exports = { [target]: workers[target] };
} else {
  module.exports = require("./index");
}
