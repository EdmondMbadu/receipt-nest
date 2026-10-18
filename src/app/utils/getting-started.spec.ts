import { shouldIntroduceGuide, canResumeGuide, GuideProgress } from './getting-started';
describe('getting started eligibility', () => {
  const progress: GuideProgress = {version:1,status:'in_progress',step:2,seenAt:1,updatedAt:2};
  it('includes unseen accounts with 0–4 receipts, including legacy accounts', () => {
    for (const count of [0,1,4]) expect(shouldIntroduceGuide(count,null)).toBeTrue();
  });
  it('waits for an authoritative count and excludes 5 or more', () => {
    for (const count of [null,-1,NaN,5,258]) expect(shouldIntroduceGuide(count,null)).toBeFalse();
  });
  it('offers resume without repeating the introduction', () => {
    expect(shouldIntroduceGuide(2,progress)).toBeFalse();
    expect(canResumeGuide(2,progress)).toBeTrue();
    expect(canResumeGuide(5,progress)).toBeFalse();
  });
  it('does not automatically reopen dismissed or completed guides', () => {
    for (const status of ['dismissed','completed'] as const) {
      const terminal = {...progress,status};
      expect(shouldIntroduceGuide(0,terminal)).toBeFalse();
      expect(canResumeGuide(0,terminal)).toBeFalse();
    }
  });
});
