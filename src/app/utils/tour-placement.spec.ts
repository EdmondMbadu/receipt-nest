import { placeTourTip, TourRect } from './tour-placement';
describe('tour callout placement', () => {
  const check=(r:TourRect,w:number,h:number,vw:number,vh:number,inset=12)=>{
    const p=placeTourTip(r,w,h,vw,vh,inset), actualHeight=Math.min(h,p.maxHeight);
    expect(p.left).toBeGreaterThanOrEqual(12);expect(p.left+w).toBeLessThanOrEqual(vw-12);
    expect(p.top).toBeGreaterThanOrEqual(inset);expect(p.top+actualHeight).toBeLessThanOrEqual(vh-12);
    const overlap=p.left<r.left+r.width && p.left+w>r.left && p.top<r.top+r.height && p.top+actualHeight>r.top;
    expect(overlap).toBeFalse(); return p;
  };
  it('anchors beside desktop buttons without covering them',()=>{
    check({left:1020,top:180,width:120,height:44},336,235,1280,720);
    check({left:310,top:330,width:160,height:38},336,260,1280,720);
  });
  it('places mobile tips above or below real controls, including small screens',()=>{
    expect(check({left:20,top:90,width:350,height:45},336,235,390,844).side).toBe('bottom');
    expect(check({left:310,top:760,width:56,height:56},336,235,390,844).side).toBe('top');
    check({left:24,top:120,width:327,height:220},336,260,375,667,100);
    check({left:24,top:250,width:327,height:44},336,260,375,568);
  });
});
