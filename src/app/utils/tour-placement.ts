export interface TourRect { left: number; top: number; width: number; height: number; }
export interface TourPlacement { left: number; top: number; maxHeight: number; side: 'top' | 'bottom' | 'left' | 'right'; arrowLeft: number; arrowTop: number; }

/** Position a compact tip beside its actual control, never on top of it. */
export function placeTourTip(r: TourRect, width: number, height: number, vw: number, vh: number, topInset = 12): TourPlacement {
  const gap = 14, edge = 12;
  const right = r.left + r.width, bottom = r.top + r.height;
  const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(n, Math.max(low, high)));
  const centeredLeft = clamp(r.left + r.width / 2 - width / 2, edge, vw - width - edge);
  const centeredTop = clamp(r.top + r.height / 2 - height / 2, topInset, vh - height - edge);
  const bottomSpace = vh - bottom - gap - edge, topSpace = r.top - gap - topInset;
  let side: TourPlacement['side'], left: number, top: number, maxHeight = vh - topInset - edge;
  const arrowCanPointSideways = r.top + r.height / 2 >= topInset + 26 && r.top + r.height / 2 <= vh - edge - 26;
  if (arrowCanPointSideways && right + gap + width <= vw - edge) { side = 'right'; left = right + gap; top = centeredTop; }
  else if (arrowCanPointSideways && r.left - gap - width >= edge) { side = 'left'; left = r.left - gap - width; top = centeredTop; }
  else if (bottomSpace >= height) { side = 'bottom'; left = centeredLeft; top = bottom + gap; maxHeight = bottomSpace; }
  else if (topSpace >= height) { side = 'top'; left = centeredLeft; top = r.top - gap - height; maxHeight = topSpace; }
  else if (bottomSpace >= topSpace) { side = 'bottom'; left = centeredLeft; top = bottom + gap; maxHeight = Math.max(80, bottomSpace); }
  else { side = 'top'; left = centeredLeft; maxHeight = Math.max(80, topSpace); top = Math.max(topInset, r.top - gap - Math.min(height, maxHeight)); }
  return {left, top, side, maxHeight,
    arrowLeft: side === 'right' ? -6 : side === 'left' ? width - 6 : clamp(r.left + r.width / 2 - left - 6, 20, width - 32),
    arrowTop: side === 'bottom' ? -6 : side === 'top' ? Math.min(height,maxHeight) - 6 : clamp(r.top + r.height / 2 - top - 6, 20, Math.min(height,maxHeight) - 32)};
}
