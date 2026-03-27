import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-goodbye',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './goodbye.component.html',
  styleUrl: './goodbye.component.css'
})
export class GoodbyeComponent {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  constructor() {
    this.title.setTitle('Goodbye - ReceiptNest AI');
    this.meta.updateTag({ name: 'description', content: 'Manage your ReceiptNest AI account status.' });
    this.meta.updateTag({ name: 'robots', content: 'noindex, follow' });
    this.meta.updateTag({ name: 'googlebot', content: 'noindex, follow' });
  }
}
