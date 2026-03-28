import { HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

export const hasAdminClaim = (token: Record<string, unknown> | undefined | null): boolean =>
  token?.admin === true || token?.role === "admin";

export const assertAdmin = async (
  uid: string,
  token: Record<string, unknown> | undefined | null
): Promise<void> => {
  if (hasAdminClaim(token)) {
    return;
  }

  const userSnap = await admin.firestore().doc(`users/${uid}`).get();
  if (userSnap.get("role") === "admin") {
    return;
  }

  throw new HttpsError("permission-denied", "Admin access required.");
};
