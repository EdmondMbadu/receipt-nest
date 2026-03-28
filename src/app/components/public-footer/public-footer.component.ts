import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

type SocialPlatform = 'youtube';

interface SocialLink {
  readonly href: string;
  readonly label: string;
  readonly platform: SocialPlatform;
}

@Component({
  selector: 'app-public-footer',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './public-footer.component.html',
  styleUrl: './public-footer.component.css'
})
export class PublicFooterComponent {
  readonly currentYear = new Date().getFullYear();

  // Extend this list as more public social channels are added.
  readonly socialLinks: readonly SocialLink[] = [
    {
      platform: 'youtube',
      label: 'YouTube',
      href: 'https://www.youtube.com/@ReceiptNestAI'
    }
  ];
}
