import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ReceiptTourService } from '../../services/receipt-tour.service';

/** The admin entry point starts the same guide on the actual dashboard. */
@Component({selector:'app-onboarding-preview',standalone:true,templateUrl:'./onboarding-preview.component.html'})
export class OnboardingPreviewComponent implements OnInit {
  private readonly tour = inject(ReceiptTourService);
  private readonly router = inject(Router);
  ngOnInit(): void {
    this.tour.start(true);
    void this.router.navigate(['/app'],{replaceUrl:true});
  }
}
