import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { workflowPages } from '../../content/public-pages';

@Component({
  selector: 'app-public-footer',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './public-footer.component.html'
})
export class PublicFooterComponent {
  readonly workflows = workflowPages;
  readonly year = new Date().getFullYear();
}
