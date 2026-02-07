import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { ChatShareMessage, GraphSharePoint, PublicShare } from '../../models/share-link.model';
import { ShareService } from '../../services/share.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-share-view',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './share-view.component.html',
  styleUrl: './share-view.component.css'
})
export class ShareViewComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly shareService = inject(ShareService);
  private readonly theme = inject(ThemeService);
  private routeSub: Subscription | null = null;

  readonly isLoading = signal(true);
  readonly error = signal<string | null>(null);
  readonly share = signal<PublicShare | null>(null);
  readonly hoveredDay = signal<GraphSharePoint | null>(null);
  readonly Math = Math;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly isGraphShare = computed(() => this.share()?.shareType === 'graph');
  readonly isChatShare = computed(() => this.share()?.shareType === 'chat');

  readonly dailyData = computed<GraphSharePoint[]>(() => {
    const currentShare = this.share();
    return currentShare?.shareType === 'graph' ? currentShare.dailyData : [];
  });
  readonly monthLabel = computed(() => {
    const currentShare = this.share();
    return currentShare?.shareType === 'graph' ? currentShare.monthLabel : '';
  });
  readonly totalSpend = computed(() => {
    const currentShare = this.share();
    return currentShare?.shareType === 'graph' ? currentShare.totalSpend : 0;
  });
  readonly includeName = computed(() => {
    const currentShare = this.share();
    return currentShare?.shareType === 'graph' && !!currentShare.includeName && !!currentShare.ownerName;
  });
  readonly includeEmail = computed(() => {
    const currentShare = this.share();
    return currentShare?.shareType === 'graph' && !!currentShare.includeEmail && !!currentShare.ownerEmail;
  });
  readonly chatTitle = computed(() => {
    const currentShare = this.share();
    return currentShare?.shareType === 'chat' ? currentShare.title : '';
  });
  readonly chatMessages = computed<ChatShareMessage[]>(() => {
    const currentShare = this.share();
    return currentShare?.shareType === 'chat' ? currentShare.messages : [];
  });

  readonly chartPathData = computed(() => {
    const data = this.dailyData();
    if (!data.length) {
      return {
        linePath: 'M 0,95 L 200,95',
        areaPath: 'M 0,95 L 200,95 L 200,100 L 0,100 Z',
        hasData: false,
        maxDailySpend: 0
      };
    }

    const maxValue = Math.max(...data.map((d: GraphSharePoint) => d.amount), 1);
    const width = 200;
    const height = 100;
    const padding = 5;
    const chartHeight = height - padding * 2;

    const points = data.map((d: GraphSharePoint, index: number) => ({
      x: data.length > 1 ? (index / (data.length - 1)) * width : width / 2,
      y: padding + chartHeight - (d.amount / maxValue) * chartHeight
    }));

    let linePath = `M ${points[0].x},${points[0].y}`;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      linePath += ` C ${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
    }

    const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

    return {
      linePath,
      areaPath,
      hasData: true,
      maxDailySpend: maxValue
    };
  });

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe(params => {
      const shareId = params.get('id');
      if (!shareId) {
        this.error.set('Missing share identifier.');
        this.isLoading.set(false);
        this.share.set(null);
        return;
      }
      this.loadShare(shareId);
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
  }

  private async loadShare(shareId: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const share = await this.shareService.getPublicShare(shareId);
      if (!share) {
        this.error.set('This share link no longer exists or has been removed.');
        this.share.set(null);
        return;
      }
      this.share.set(share);
    } catch (error) {
      console.error('Failed to load share link', error);
      this.error.set('Unable to load this share right now. Please try again later.');
      this.share.set(null);
    } finally {
      this.isLoading.set(false);
    }
  }

  formatCurrency(amount?: number): string {
    if (amount === undefined || amount === null) {
      return '-';
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }

  getChartX(day: number): number {
    const data = this.dailyData();
    if (!data.length) return 0;
    const index = data.findIndex((d: GraphSharePoint) => d.day === day);
    if (index === -1) return 0;
    if (data.length <= 1) return 100;
    return (index / (data.length - 1)) * 200;
  }

  getChartY(amount: number): number {
    const data = this.dailyData();
    if (!data.length) return 95;
    const maxValue = Math.max(...data.map((d: GraphSharePoint) => d.amount), 1);
    const height = 100;
    const padding = 5;
    const chartHeight = height - padding * 2;
    return padding + chartHeight - (amount / maxValue) * chartHeight;
  }

  axisLabel(value: number): number {
    const totalDays = this.dailyData().length || 1;
    return Math.min(totalDays, Math.max(1, value));
  }

  formatChatTime(isoValue: string): string {
    const date = new Date(isoValue);
    if (isNaN(date.getTime())) {
      return '';
    }
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  toggleTheme(): void {
    this.theme.toggleTheme();
  }
}
