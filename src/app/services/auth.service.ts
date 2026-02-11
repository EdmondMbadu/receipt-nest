import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  Auth,
  UserCredential,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import {
  Firestore,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { app } from '../../../environments/environments';
import { UserProfile } from '../models/user.model';

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
      return { ...data, id: uid };
    }

    const profile: UserProfile = {
      id: uid,
      firstName: '',
      lastName: '',
      email,
      role: 'user',
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
}
