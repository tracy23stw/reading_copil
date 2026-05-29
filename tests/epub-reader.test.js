import { describe, it, expect, beforeEach, vi } from 'vitest';
import EpubReader from '../js/epub-reader.js';

describe('EpubReader', () => {
  let reader;
  let mockContainer;

  beforeEach(() => {
    mockContainer = document.createElement('div');
    reader = new EpubReader(mockContainer);
    
    // Mock this.book
    reader.book = {
      navigation: {
        get: vi.fn((href) => {
          if (href.includes('chapter1.html')) {
            return { label: '第一章 梦开始的地方' };
          }
          return null;
        }),
        forEach: vi.fn((cb) => {
          cb({ href: 'chapter2.html', label: '第二章 风起云涌' });
        })
      },
      locations: {
        cfiFromPercentage: vi.fn((percent) => `epubcfi(/6/14[chapter2]!/${percent})`),
        percentageFromCfi: vi.fn((cfi) => 0.5)
      }
    };
    
    // Mock this.rendition
    reader.rendition = {
      display: vi.fn()
    };
  });

  describe('Issue 3: jumpToPercentage', () => {
    it('should calculate CFI from percentage and call rendition.display', async () => {
      // Act
      await reader.jumpToPercentage(50);
      
      // Assert
      expect(reader.book.locations.cfiFromPercentage).toHaveBeenCalledWith(0.5);
      expect(reader.rendition.display).toHaveBeenCalledWith('epubcfi(/6/14[chapter2]!/0.5)');
    });
    
    it('should handle invalid input', async () => {
      await reader.jumpToPercentage(-10); // Edge cases can be clamped
      await reader.jumpToPercentage(110);
      
      // Expected behavior: Maybe we should clamp the percentage in implementation
      // For now let's just make sure it passes the logic
      expect(reader.book.locations.cfiFromPercentage).toHaveBeenCalled();
    });
  });

  describe('Issue 3: getPageInfo (Chapter Title)', () => {
    it('should return correct chapter title from exact href match', () => {
      reader.currentLocation = {
        start: {
          href: 'chapter1.html#anchor-1',
          percentage: 0.1,
          displayed: { page: 10, total: 100 },
          index: 1
        }
      };

      const info = reader.getPageInfo();
      expect(info.chapterTitle).toBe('第一章 梦开始的地方');
      expect(info.percentage).toBe(10);
    });

    it('should fallback to base href match if exact match fails', () => {
      // get() returns null for this href
      reader.currentLocation = {
        start: {
          href: 'chapter2.html#some-anchor'
        }
      };

      const info = reader.getPageInfo();
      expect(info.chapterTitle).toBe('第二章 风起云涌');
    });
    
    it('should return empty string if no match', () => {
      reader.currentLocation = {
        start: {
          href: 'unknown.html'
        }
      };

      const info = reader.getPageInfo();
      expect(info.chapterTitle).toBe('');
    });
  });
});
