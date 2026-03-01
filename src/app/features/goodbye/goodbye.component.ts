import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-goodbye',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './goodbye.component.html',
  styleUrl: './goodbye.component.css'
})
export class GoodbyeComponent {}
