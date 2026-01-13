import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  Firestore,
  Timestamp,
  collection,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  Unsubscribe
} from 'firebase/firestore';

import { app } from '../../../../environments/environments';
import { UserProfile } from '../../models/user.model';

type AdminUser = UserProfile;

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css'
})
export class AdminComponent implements OnInit, OnDestroy {
  private readonly db: Firestore = getFirestore(app);
  private usersUnsubscribe: Unsubscribe | null = null;

  readonly users = signal<AdminUser[]>([]);
  readonly isLoading = signal(true);
  readonly error = signal<string | null>(null);

  readonly totalUsers = computed(() => this.users().length);
  readonly adminCount = computed(() => this.users().filter((user) => user.role === 'admin').length);
  readonly proCount = computed(() => this.users().filter((user) => user.subscriptionPlan === 'pro').length);

  ngOnInit(): void {
    const usersRef = collection(this.db, 'users');
    const usersQuery = query(usersRef, orderBy('createdAt', 'desc'));

    this.usersUnsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const users = snapshot.docs.map((doc) => {
          const data = doc.data() as Omit<UserProfile, 'id'>;
          return { id: doc.id, ...data };
        });
        this.users.set(users);
        this.isLoading.set(false);
      },
      (error) => {
        console.error('Failed to load users', error);
        this.error.set('Unable to load users right now.');
        this.isLoading.set(false);
      }
    );
  }

  ngOnDestroy(): void {
    this.usersUnsubscribe?.();
  }

  displayName(user: AdminUser): string {
    const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return fullName || user.email;
  }

  formatDate(value?: UserProfile['createdAt'] | null): string {
    if (!value || !(value instanceof Timestamp)) {
      return '—';
    }

    try {
      return value.toDate().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return '—';
    }
  }
}
