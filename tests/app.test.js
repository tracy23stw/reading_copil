import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock environment for app.js
describe('App controller logic', () => {
  let appMock;

  beforeEach(() => {
    appMock = {
      reader: {
        currentLocation: {
          start: { cfi: 'epubcfi(/6/14)' }
        },
        jumpToPercentage: vi.fn(),
        getPageInfo: vi.fn(() => ({
          percentage: 50,
          chapterTitle: '第三章'
        }))
      },
      bookMeta: { title: 'Test Book' },
      els: {
        progressInput: { value: '' },
        chapterInfo: { textContent: '' },
        navCharacters: {}
      },
      saveCurrentProgress() {
        if (this.reader && this.reader.currentLocation && this.reader.currentLocation.start.cfi) {
          const cfi = this.reader.currentLocation.start.cfi;
          const title = this.bookMeta ? this.bookMeta.title : 'unknown';
          localStorage.setItem(`readingCopilot_progress_${title}`, cfi);
          localStorage.setItem('readingCopilot_latest_cfi', cfi);
        }
      },
      updatePageInfo() {
        if (!this.reader) return;
        const info = this.reader.getPageInfo();
        if (this.els.progressInput) this.els.progressInput.value = info.percentage;
        if (this.els.chapterInfo) this.els.chapterInfo.textContent = info.chapterTitle;
      },
      handleProgressInput(e) {
        if (e.key === 'Enter' || e.type === 'change') {
          const val = this.els.progressInput.value;
          this.reader.jumpToPercentage(val);
        }
      }
    };
    
    // reset localStorage
    localStorage.clear();
  });

  it('saveCurrentProgress should save cfi to localStorage', () => {
    appMock.saveCurrentProgress();
    expect(localStorage.getItem('readingCopilot_progress_Test Book')).toBe('epubcfi(/6/14)');
    expect(localStorage.getItem('readingCopilot_latest_cfi')).toBe('epubcfi(/6/14)');
  });

  it('updatePageInfo should update input and chapter info', () => {
    appMock.updatePageInfo();
    expect(appMock.els.progressInput.value).toBe(50);
    expect(appMock.els.chapterInfo.textContent).toBe('第三章');
  });

  it('handleProgressInput should call jumpToPercentage', () => {
    appMock.els.progressInput.value = 42;
    appMock.handleProgressInput({ type: 'change' });
    expect(appMock.reader.jumpToPercentage).toHaveBeenCalledWith(42);
  });
});
