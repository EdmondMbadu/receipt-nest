import { Injectable, computed, signal } from '@angular/core';
import {
  Auth,
  UserCredential,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendEmailVerification
} from 'firebase/auth';
import {
  Firestore,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';

import { app } from '../../../environments/environments';
import { UserProfile } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly auth: Auth = getAuth(app);
  private readonly db: Firestore = getFirestore(app);

  private initialized = false;
  private readonly initPromise: Promise<void>;
  private authStateReady: Promise<void> = Promise.resolve();
  private resolveAuthStateReady: (() => void) | null = null;

  readonly user = signal<UserProfile | null>(null);
  readonly isLoading = signal<boolean>(true);
  readonly isAuthenticated = computed<boolean>(() => !!this.user());

  constructor() {
    this.initPromise = new Promise((resolve) => {
      onAuthStateChanged(this.auth, async (firebaseUser) => {
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
    const userRef = doc(this.db, 'users', uid);
    const snapshot = await getDoc(userRef);

    if (snapshot.exists()) {
      return snapshot.data() as UserProfile;
    }

    const profile: UserProfile = {
      id: uid,
      firstName: '',
      lastName: '',
      email,
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
    this.resetAuthStateReady();
    const credential = await createUserWithEmailAndPassword(this.auth, form.email, form.password);

    const profile: UserProfile = {
      id: credential.user.uid,
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(this.db, 'users', credential.user.uid), profile);
    await sendEmailVerification(credential.user);
    await signOut(this.auth);
    this.user.set(null);
    this.resolveAuthStateReady?.();
    this.resolveAuthStateReady = null;

    return credential;
  }

  async login(email: string, password: string) {
    this.resetAuthStateReady();
    const credential = await signInWithEmailAndPassword(this.auth, email, password);
    const user = credential.user;

    if (!user.emailVerified) {
      await sendEmailVerification(user);
      await signOut(this.auth);
      this.user.set(null);
      const error: any = new Error('Email not verified');
      error.code = 'auth/email-not-verified';
      throw error;
    }
  }

  async loginWithGoogle() {
    this.resetAuthStateReady();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(this.auth, provider);
  }

  async sendVerificationEmail(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) {
      const error: any = new Error('No signed-in user to verify');
      error.code = 'auth/no-current-user';
      throw error;
    }
    await sendEmailVerification(user);
  }

  async logout() {
    await signOut(this.auth);
    this.user.set(null);
  }

  async waitForInitialization(): Promise<void> {
    return this.initPromise;
  }

  async waitForAuthState(): Promise<void> {
    return this.authStateReady;
  }
}

