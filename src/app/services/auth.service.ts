import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  Auth,
  EmailAuthProvider,
  GoogleAuthProvider,
  UserCredential,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword
} from 'firebase/auth';
import {
  Firestore,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { app } from '../../../environments/environments';
import { NotificationSettings, UserProfile } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly auth: Auth | null;
  private readonly db: Firestore | null;
  private readonly functions: ReturnType<typeof getFunctions> | null;

  private initialized = false;
  private readonly initPromise: Promise<void>;
  private authStateReady: Promise<void> = Promise.resolve();
  private resolveAuthStateReady: (() => void) | null = null;
  private readonly defaultNotificationSettings: NotificationSettings = {
    receiptProcessing: true,
    productUpdates: false,
    securityAlerts: true
  };

  readonly user = signal<UserProfile | null>(null);
  readonly isLoading = signal<boolean>(true);
  readonly isAuthenticated = computed<boolean>(() => !!this.user());

  constructor() {
    if (!this.isBrowser) {
      this.auth = null;
      this.db = null;
      this.functions = null;
      this.isLoading.set(false);
      this.initialized = true;
      this.initPromise = Promise.resolve();
      return;
    }

    this.auth = getAuth(app);
    this.db = getFirestore(app);
    this.functions = getFunctions(app);

    const auth = this.requireAuth();
    this.initPromise = new Promise((resolve) => {
      onAuthStateChanged(auth, async (firebaseUser) => {
        try {
          if (!firebaseUser) {
            this.user.set(null);
            return;
          }

          if (!firebaseUser.emailVerified) {
            this.user.set(null);
            return;
          }

          const userProfile = await this.loadOrCreateUserProfile(firebaseUser.uid, firebaseUser.email ?? '');
          this.user.set(userProfile);
          if (firebaseUser.emailVerified) {
            await this.sendWelcomeEmailIfNeeded();
          }
        } catch (error) {
          console.error('Failed to load auth state', error);
          this.user.set(null);
        } finally {
          this.finishInit(resolve);
          this.resolveAuthStateReady?.();
          this.resolveAuthStateReady = null;
        }
      });
    });
  }

  private resetAuthStateReady() {
    this.authStateReady = new Promise((resolve) => {
      this.resolveAuthStateReady = resolve;
    });
  }

  private finishInit(resolve: () => void) {
    this.isLoading.set(false);
    if (!this.initialized) {
      this.initialized = true;
      resolve();
    }
  }

  private async loadOrCreateUserProfile(uid: string, email: string): Promise<UserProfile> {
    const db = this.requireDb();
    const userRef = doc(db, 'users', uid);
    const snapshot = await getDoc(userRef);

    if (snapshot.exists()) {
      const data = snapshot.data() as UserProfile;
      return {
        ...data,
        id: uid,
        notificationSettings: this.getDefaultNotificationSettings(data)
      };
    }

    const profile: UserProfile = {
      id: uid,
      firstName: '',
      lastName: '',
      email,
      role: 'user',
      notificationSettings: this.getDefaultNotificationSettings(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(userRef, profile);
    return profile;
  }

  async registerUser(form: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }): Promise<UserCredential> {
    const auth = this.requireAuth();
    const db = this.requireDb();
    this.resetAuthStateReady();
    const credential = await createUserWithEmailAndPassword(auth, form.email, form.password);

    const profile: UserProfile = {
      id: credential.user.uid,
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      role: 'user',
      notificationSettings: this.getDefaultNotificationSettings(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, 'users', credential.user.uid), profile);
    await this.sendVerificationEmail();
    await signOut(auth);
    this.user.set(null);
    this.resolveAuthStateReady?.();
    this.resolveAuthStateReady = null;

    return credential;
  }

  async login(email: string, password: string) {
    const auth = this.requireAuth();
    this.resetAuthStateReady();
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const user = credential.user;

    if (!user.emailVerified) {
      await this.sendVerificationEmail();
      await signOut(auth);
      this.user.set(null);
      const error: any = new Error('Email not verified');
      error.code = 'auth/email-not-verified';
      throw error;
    }
  }

  async loginWithGoogle() {
    const auth = this.requireAuth();
    this.resetAuthStateReady();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  }

  async sendVerificationEmail(): Promise<void> {
    const auth = this.requireAuth();
    const functions = this.requireFunctions();
    const user = auth.currentUser;
    if (!user) {
      const error: any = new Error('No signed-in user to verify');
      error.code = 'auth/no-current-user';
      throw error;
    }

    const callable = httpsCallable(functions, 'sendVerificationEmail');
    await callable({});
  }

  async sendPasswordReset(email: string): Promise<void> {
    if (!email) {
      const error: any = new Error('Please enter a valid email address.');
      error.code = 'auth/invalid-email';
      throw error;
    }

    const auth = this.requireAuth();
    await sendPasswordResetEmail(auth, email);
  }

  async logout() {
    const auth = this.requireAuth();
    await signOut(auth);
    this.user.set(null);
  }

  getDefaultNotificationSettings(profile?: { notificationSettings?: NotificationSettings } | null): NotificationSettings {
    const settings = profile?.notificationSettings;
    return {
      receiptProcessing: settings?.receiptProcessing ?? this.defaultNotificationSettings.receiptProcessing,
      productUpdates: settings?.productUpdates ?? this.defaultNotificationSettings.productUpdates,
      securityAlerts: settings?.securityAlerts ?? this.defaultNotificationSettings.securityAlerts
    };
  }

  isCurrentUserPasswordAuth(): boolean {
    const currentUser = this.auth?.currentUser;
    if (!currentUser) {
      return false;
    }
    return currentUser.providerData.some((provider) => provider.providerId === 'password');
  }

  async updateProfileInfo(payload: { firstName: string; lastName: string }): Promise<void> {
    const db = this.requireDb();
    const user = this.user();
    if (!user) {
      throw new Error('User not authenticated.');
    }

    const firstName = payload.firstName.trim();
    const lastName = payload.lastName.trim();

    await updateDoc(doc(db, 'users', user.id), {
      firstName,
      lastName,
      updatedAt: serverTimestamp()
    });

    this.user.update((current) => {
      if (!current) return current;
      return {
        ...current,
        firstName,
        lastName,
        updatedAt: serverTimestamp()
      };
    });
  }

  async updateNotificationSettings(notificationSettings: NotificationSettings): Promise<void> {
    const db = this.requireDb();
    const user = this.user();
    if (!user) {
      throw new Error('User not authenticated.');
    }

    const normalized = this.getDefaultNotificationSettings({ notificationSettings });
    await updateDoc(doc(db, 'users', user.id), {
      notificationSettings: normalized,
      updatedAt: serverTimestamp()
    });

    this.user.update((current) => {
      if (!current) return current;
      return {
        ...current,
        notificationSettings: normalized,
        updatedAt: serverTimestamp()
      };
    });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (!this.isCurrentUserPasswordAuth()) {
      throw new Error('Password changes are only available for email/password accounts.');
    }

    const trimmedCurrentPassword = currentPassword.trim();
    const trimmedNewPassword = newPassword.trim();

    if (!trimmedCurrentPassword) {
      throw new Error('Current password is required.');
    }
    if (trimmedNewPassword.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }

    const currentUser = this.requireCurrentUser();
    const email = currentUser.email;
    if (!email) {
      throw new Error('Current account is missing an email address.');
    }

    const credential = EmailAuthProvider.credential(email, trimmedCurrentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, trimmedNewPassword);
  }

  async deleteAccount(payload?: { currentPassword?: string }): Promise<void> {
    if (this.isCurrentUserPasswordAuth()) {
      const currentPassword = payload?.currentPassword?.trim() ?? '';
      if (!currentPassword) {
        throw new Error('Current password is required to delete this account.');
      }

      const currentUser = this.requireCurrentUser();
      const email = currentUser.email;
      if (!email) {
        throw new Error('Current account is missing an email address.');
      }

      const credential = EmailAuthProvider.credential(email, currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
    }

    const functions = this.requireFunctions();
    const callable = httpsCallable(functions, 'deleteUserAccount');
    await callable({});
    await this.logout();
  }

  async waitForInitialization(): Promise<void> {
    return this.initPromise;
  }

  async waitForAuthState(): Promise<void> {
    return this.authStateReady;
  }

  private async sendWelcomeEmailIfNeeded(): Promise<void> {
    const functions = this.requireFunctions();
    try {
      const callable = httpsCallable(functions, 'sendWelcomeEmail');
      await callable({});
    } catch (error) {
      console.error('Failed to send welcome email', error);
    }
  }

  private requireAuth(): Auth {
    if (!this.auth) {
      const error: any = new Error('Authentication is only available in the browser.');
      error.code = 'auth/not-available-in-this-environment';
      throw error;
    }

    return this.auth;
  }

  private requireDb(): Firestore {
    if (!this.db) {
      const error: any = new Error('Database access is only available in the browser.');
      error.code = 'firestore/not-available-in-this-environment';
      throw error;
    }

    return this.db;
  }

  private requireFunctions(): ReturnType<typeof getFunctions> {
    if (!this.functions) {
      const error: any = new Error('Cloud functions are only available in the browser.');
      error.code = 'functions/not-available-in-this-environment';
      throw error;
    }

    return this.functions;
  }

  private requireCurrentUser(): NonNullable<Auth['currentUser']> {
    const auth = this.requireAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      const error: any = new Error('No signed-in user.');
      error.code = 'auth/no-current-user';
      throw error;
    }
    return currentUser;
  }
}
