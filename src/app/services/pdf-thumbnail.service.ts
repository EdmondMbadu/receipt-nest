import { Injectable } from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist';

// Set the worker source to use local file from assets
pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.min.mjs';

@Injectable({
  providedIn: 'root'
})
export class PdfThumbnailService {
  private thumbnailCache = new Map<string, string>();

  /**
   * Generate a thumbnail image from a PDF URL
   * @param pdfUrl The URL of the PDF file
   * @param scale Scale factor for the thumbnail (default 0.5 for smaller thumbnails)
   * @returns Promise<string> Data URL of the thumbnail image
   */
  async generateThumbnail(pdfUrl: string, scale: number = 0.5): Promise<string> {
    // Check cache first
    const cacheKey = `${pdfUrl}_${scale}`;
    if (this.thumbnailCache.has(cacheKey)) {
      return this.thumbnailCache.get(cacheKey)!;
    }

    try {
      // Load the PDF document
      const loadingTask = pdfjsLib.getDocument({
        url: pdfUrl,
        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
        cMapPacked: true,
      });

      const pdf = await loadingTask.promise;

      // Get the first page
      const page = await pdf.getPage(1);

      // Get the viewport at the desired scale
      const viewport = page.getViewport({ scale });

      // Create a canvas element
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Render the page to the canvas
      await page.render({
        canvasContext: context,
        viewport: viewport,
        canvas: canvas
      }).promise;

      // Convert canvas to data URL
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

      // Cache the result
      this.thumbnailCache.set(cacheKey, dataUrl);

      // Clean up
      pdf.destroy();

      return dataUrl;
    } catch (error) {
      console.error('Error generating PDF thumbnail:', error);
      throw error;
    }
  }

  /**
   * Clear the thumbnail cache
   */
  clearCache(): void {
    this.thumbnailCache.clear();
  }

  /**
   * Remove a specific URL from cache
   */
  removeFromCache(pdfUrl: string): void {
    // Remove all cached versions of this URL
    for (const key of this.thumbnailCache.keys()) {
      if (key.startsWith(pdfUrl)) {
        this.thumbnailCache.delete(key);
      }
    }
  }
}
